"use client";


/*
 * Spiral3DSlider — supplied source, adapted for VANTA. Scoped changes:
 * - Textures: `useLoader` suspends and throws if any one URL fails, which blanked the whole gallery.
 *   Replaced with a per-item loader that substitutes a generated graphite placeholder for a failed image,
 *   and disposes textures on unmount.
 * - Slots: items were repeated up to 16 with `index % length`; for 5 items that put two copies of the same
 *   image side by side at the wrap. Now repeats to the next whole multiple of `items.length` (≥ 16).
 * - Accessibility: the stage is focusable; ←/→ (and ↑/↓) step one slide, Home returns to the first.
 *   `ref` exposes `step()`/`goTo()` for visible buttons, and `onActiveChange` reports the front slide so
 *   captions outside the canvas can follow it.
 * - Performance: rendering stops (`frameloop="never"`) while off-screen; DPR capped at 1.5.
 * - Theme: `bg-white dark:bg-black` replaced with the VANTA background; on a light-scheme OS the `dark:`
 *   variant left a white stage on a dark page.
 * - `cardViewportRatio` / `radiusViewportRatio` expose the hardcoded 0.225 / 0.245 stage-width caps
 *   (defaults unchanged) so narrow stages can use larger cards.
 * - Ref props renamed with a `Ref` suffix (React Compiler lint); unused eslint-disable removed.
 * - Page scroll still turns the spiral while it is in view (passive listener) and wheel input is never
 *   prevented, so the page always keeps scrolling normally.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { WebGLErrorBoundary, WebGLFallback } from "@/components/ui/webgl-error-boundary";
import { cn } from "@/lib/utils";
import { CanvasTexture, DoubleSide, LinearFilter, Mesh, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader } from "three";
import {
  type KeyboardEvent,
  type MutableRefObject,
  type Ref,
  type WheelEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

export interface Spiral3DSlide {
  /** Image source rendered inside the slide. */
  src: string;
  /** Accessible description for the image. */
  alt: string;
}

export interface Spiral3DSliderHandle {
  /** Move by whole slides (negative = back). */
  step: (delta: number) => void;
  /** Bring item `index` of `items` to the front by the shortest route. */
  goTo: (index: number) => void;
}

export interface Spiral3DSliderProps {
  /** Images arranged along the spiral. */
  items: Spiral3DSlide[];
  /** Additional classes for the WebGL stage. */
  className?: string;
  /** Maximum horizontal radius of the spiral in pixels. */
  radius?: number;
  /** Vertical distance between neighboring images in pixels. */
  verticalGap?: number;
  /** Maximum width of every image plane in pixels. */
  cardWidth?: number;
  /** Width divided by height for every image plane. */
  cardAspectRatio?: number;
  /** Whether the spiral advances automatically while idle. */
  autoRotate?: boolean;
  /** Automatic movement in slides per second. */
  autoSpeed?: number;
  /** Amount of scroll required to move along the spiral. */
  scrollSensitivity?: number;
  /** Motion smoothing between 0 and 1. */
  smoothing?: number;
  /** Maximum blur applied to distant images. */
  blurStrength?: number;
  /** Amount each image plane bends into the spiral. */
  bend?: number;
  /** Perspective camera field of view in degrees. */
  fov?: number;
  /** Accessible name for the gallery region. */
  ariaLabel?: string;
  /** Largest card width as a fraction of the stage width (source value 0.225; raise it on narrow stages). */
  cardViewportRatio?: number;
  /** Largest spiral radius as a fraction of the stage width (source value 0.245). */
  radiusViewportRatio?: number;
  /** Index into `items` of the slide nearest the front, reported when it changes. */
  onActiveChange?: (index: number) => void;
  ref?: Ref<Spiral3DSliderHandle>;
}

const vertexShader = `
  uniform float uBend;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    float curve = 1.0 - cos(position.x * 3.14159265);
    transformed.z -= curve * uBend;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  uniform float uImageAspect;
  uniform float uPlaneAspect;
  uniform float uBlur;
  varying vec2 vUv;

  vec2 coverUv(vec2 uv) {
    vec2 scale = vec2(1.0);
    if (uImageAspect > uPlaneAspect) {
      scale.x = uPlaneAspect / uImageAspect;
    } else {
      scale.y = uImageAspect / uPlaneAspect;
    }
    return (uv - 0.5) * scale + 0.5;
  }

  void main() {
    vec2 uv = coverUv(vUv);
    vec2 stepSize = vec2(0.0065) * uBlur;
    vec4 color = texture2D(uTexture, uv) * 0.23;

    color += texture2D(uTexture, uv + vec2(stepSize.x, 0.0)) * 0.12;
    color += texture2D(uTexture, uv - vec2(stepSize.x, 0.0)) * 0.12;
    color += texture2D(uTexture, uv + vec2(stepSize.x * 2.0, 0.0)) * 0.06;
    color += texture2D(uTexture, uv - vec2(stepSize.x * 2.0, 0.0)) * 0.06;
    color += texture2D(uTexture, uv + vec2(0.0, stepSize.y)) * 0.12;
    color += texture2D(uTexture, uv - vec2(0.0, stepSize.y)) * 0.12;
    color += texture2D(uTexture, uv + vec2(0.0, stepSize.y * 2.0)) * 0.06;
    color += texture2D(uTexture, uv - vec2(0.0, stepSize.y * 2.0)) * 0.06;
    color += texture2D(uTexture, uv + stepSize) * 0.025;
    color += texture2D(uTexture, uv - stepSize) * 0.025;

    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luminance), color.rgb, 1.18);
    color.rgb = (color.rgb - 0.5) * 1.08 + 0.5;
    float brightness = 1.04 - min(uBlur * 0.025, 0.07);
    gl_FragColor = vec4(clamp(color.rgb * brightness, 0.0, 1.0), 1.0);
  }
`;

function wrappedPosition(value: number, length: number) {
  const wrapped = ((value % length) + length) % length;
  return wrapped > length / 2 ? wrapped - length : wrapped;
}

function imageAspect(texture: Texture) {
  const image = texture.image as
    | {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
    | undefined;
  const width = image?.naturalWidth ?? image?.width ?? 1;
  const height = image?.naturalHeight ?? image?.height ?? 1;
  return width / Math.max(height, 1);
}

/** Graphite card with a hairline frame, used when an image fails to load. */
function placeholderTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 200;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#0b0d12";
  g.fillRect(0, 0, 300, 200);
  g.strokeStyle = "rgba(111,227,238,0.35)";
  g.strokeRect(12.5, 12.5, 275, 175);
  return new CanvasTexture(canvas);
}

/** Loads every URL once; a failed load resolves to a placeholder instead of throwing. */
function useSafeTextures(urls: string[]) {
  const key = urls.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; textures: Texture[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new TextureLoader();
    const unique = [...new Set(key.split("\n"))];
    const created: Texture[] = [];
    Promise.all(
      unique.map(
        (url) =>
          new Promise<[string, Texture]>((resolve) => {
            loader.load(
              url,
              (texture) => resolve([url, texture]),
              undefined,
              () => {
                if (process.env.NODE_ENV !== "production") console.warn(`[Spiral3DSlider] image failed to load: ${url}`);
                resolve([url, placeholderTexture()]);
              },
            );
          }),
      ),
    ).then((entries) => {
      entries.forEach(([, texture]) => created.push(texture));
      if (!alive) return created.forEach((texture) => texture.dispose());
      const byUrl = new Map(entries);
      setLoaded({ key, textures: key.split("\n").map((url) => byUrl.get(url)!) });
    });
    return () => {
      alive = false;
      created.forEach((texture) => texture.dispose());
    };
  }, [key]);
  return loaded?.key === key ? loaded.textures : null;
}

interface SpiralSceneProps {
  items: Spiral3DSlide[];
  targetProgressRef: MutableRefObject<number>;
  radius: number;
  verticalGap: number;
  cardWidth: number;
  cardAspectRatio: number;
  autoRotate: boolean;
  autoSpeed: number;
  smoothing: number;
  blurStrength: number;
  bend: number;
  reducedMotionRef: MutableRefObject<boolean>;
  lastInteractionRef: MutableRefObject<number>;
  slotCount: number;
  cardViewportRatio: number;
  radiusViewportRatio: number;
  onActiveChange?: (index: number) => void;
}

function SpiralScene({
  items,
  targetProgressRef,
  radius,
  verticalGap,
  cardWidth,
  cardAspectRatio,
  autoRotate,
  autoSpeed,
  smoothing,
  blurStrength,
  bend,
  reducedMotionRef,
  lastInteractionRef,
  slotCount,
  cardViewportRatio,
  radiusViewportRatio,
  onActiveChange,
}: SpiralSceneProps) {
  const sceneItems = useMemo(() => Array.from({ length: slotCount }, (_, index) => items[index % items.length]!), [items, slotCount]);
  const textures = useSafeTextures(useMemo(() => sceneItems.map((item) => item.src), [sceneItems]));
  const { gl, viewport } = useThree();
  const progress = useRef(0);
  const active = useRef(-1);
  const meshes = useRef<(Mesh | null)[]>([]);
  const materials = useRef<(ShaderMaterial | null)[]>([]);

  const uniforms = useMemo(
    () =>
      (textures ?? []).map((texture) => ({
        uTexture: { value: texture },
        uImageAspect: { value: imageAspect(texture) },
        uPlaneAspect: { value: cardAspectRatio },
        uBlur: { value: 0 },
        uBend: { value: 0 },
      })),
    [cardAspectRatio, textures],
  );

  useEffect(() => {
    textures?.forEach((texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
    });
  }, [gl, textures]);

  useFrame((_state, delta) => {
    if (autoRotate && !reducedMotionRef.current && performance.now() - lastInteractionRef.current > 450) {
      targetProgressRef.current += autoSpeed * Math.min(delta, 0.05);
    }

    const frameScale = Math.min(delta * 60, 3);
    const ease = reducedMotionRef.current ? 1 : 1 - Math.pow(1 - smoothing, frameScale);
    progress.current += (targetProgressRef.current - progress.current) * ease;

    const front = (((Math.round(progress.current) % slotCount) + slotCount) % slotCount) % items.length;
    if (front !== active.current) {
      active.current = front;
      onActiveChange?.(front);
    }

    const factor = Math.max(viewport.factor, 1);
    const planeWidth = Math.min(cardWidth / factor, viewport.width * cardViewportRatio);
    const planeHeight = planeWidth / cardAspectRatio;
    const spiralRadius = Math.min(radius / factor, viewport.width * radiusViewportRatio);
    const gap = Math.min(verticalGap / factor, viewport.height * 0.082);
    const count = sceneItems.length;

    meshes.current.forEach((mesh, index) => {
      const material = materials.current[index];
      if (!mesh || !material) return;

      const position = wrappedPosition(index - progress.current, count);
      const angle = position * 0.78;
      const depth = (Math.cos(angle) + 1) / 2;
      const distance = Math.min(Math.abs(position) / (count * 0.43), 1);
      const scale = 0.74 + depth * 0.26;

      mesh.position.set(Math.sin(angle) * spiralRadius, -position * gap, Math.cos(angle) * 2.55);
      mesh.rotation.set(0, Math.sin(angle) * -1.12, 0);
      mesh.scale.set(planeWidth * scale, planeHeight * scale, 1);

      material.uniforms.uBlur!.value = Math.pow(distance, 1.28) * blurStrength;
      material.uniforms.uBend!.value = planeWidth * bend;
      material.uniforms.uPlaneAspect!.value = cardAspectRatio;
    });
  });

  if (!textures) return null;

  return (
    <>
      {sceneItems.map((item, index) => (
        <mesh
          key={`${item.src}-${index}`}
          ref={(node) => {
            meshes.current[index] = node;
          }}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1, 48, 2]} />
          <shaderMaterial
            ref={(node) => {
              materials.current[index] = node;
            }}
            uniforms={uniforms[index]}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            side={DoubleSide}
            depthTest
            depthWrite
          />
        </mesh>
      ))}
    </>
  );
}

export function Spiral3DSlider({
  items,
  className,
  radius = 235,
  verticalGap = 64,
  cardWidth = 255,
  cardAspectRatio = 3 / 2,
  autoRotate = true,
  autoSpeed = 0.13,
  scrollSensitivity = 0.0024,
  smoothing = 0.065,
  blurStrength = 1.65,
  bend = 0.17,
  fov = 44,
  ariaLabel = "Spiral image gallery",
  cardViewportRatio = 0.225,
  radiusViewportRatio = 0.245,
  onActiveChange,
  ref,
}: Spiral3DSliderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const targetProgressRef = useRef(0);
  const previousScroll = useRef(0);
  const lastWheelTime = useRef(0);
  const lastInteractionRef = useRef(0);
  const visible = useRef(false);
  const reducedMotionRef = useRef(false);
  const [onScreen, setOnScreen] = useState(false);
  const slotCount = items.length ? Math.ceil(16 / items.length) * items.length : 0;

  useImperativeHandle(
    ref,
    () => ({
      step: (delta) => {
        lastInteractionRef.current = performance.now();
        targetProgressRef.current = Math.round(targetProgressRef.current) + delta;
      },
      goTo: (index) => {
        lastInteractionRef.current = performance.now();
        const n = items.length;
        const current = Math.round(targetProgressRef.current);
        const at = ((current % n) + n) % n;
        let delta = (((index - at) % n) + n) % n;
        if (delta > n / 2) delta -= n;
        targetProgressRef.current = current + delta;
      },
    }),
    [items.length],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    previousScroll.current = window.scrollY;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => {
      reducedMotionRef.current = motionQuery.matches;
    };
    syncMotionPreference();
    motionQuery.addEventListener("change", syncMotionPreference);

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = Boolean(entry?.isIntersecting);
        setOnScreen(visible.current && !document.hidden);
      },
      { threshold: 0.08 },
    );
    observer.observe(stage);
    const onVisibility = () => setOnScreen(visible.current && !document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    const handlePageScroll = () => {
      const scrollY = window.scrollY;
      const delta = scrollY - previousScroll.current;
      previousScroll.current = scrollY;
      if (visible.current && performance.now() - lastWheelTime.current > 80) {
        lastInteractionRef.current = performance.now();
        const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), 160);
        targetProgressRef.current += boundedDelta * scrollSensitivity;
      }
    };
    window.addEventListener("scroll", handlePageScroll, { passive: true });

    return () => {
      observer.disconnect();
      motionQuery.removeEventListener("change", syncMotionPreference);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", handlePageScroll);
    };
  }, [scrollSensitivity]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    lastWheelTime.current = performance.now();
    lastInteractionRef.current = lastWheelTime.current;
    const delta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 160);
    targetProgressRef.current += delta * scrollSensitivity;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined && event.key !== "Home") return;
    event.preventDefault();
    lastInteractionRef.current = performance.now();
    targetProgressRef.current = event.key === "Home" ? Math.round(targetProgressRef.current / slotCount) * slotCount : Math.round(targetProgressRef.current) + step!;
  };

  if (!items.length) return null;

  return (
    <div
      ref={stageRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      className={cn("relative min-h-[42rem] w-full overflow-hidden bg-bg outline-none focus-visible:ring-1 focus-visible:ring-cyan/60", className)}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <WebGLErrorBoundary fallback={<WebGLFallback className="absolute inset-0 h-full w-full" />}>
        <div className="absolute inset-0">
          <Canvas
            dpr={[1, 1.5]}
            frameloop={onScreen ? "always" : "never"}
            camera={{ position: [0, 0, 10], fov, near: 0.1, far: 100 }}
            gl={{
              alpha: true,
              antialias: true,
              powerPreference: "high-performance",
            }}
          >
            <SpiralScene
              items={items}
              targetProgressRef={targetProgressRef}
              radius={radius}
              verticalGap={verticalGap}
              cardWidth={cardWidth}
              cardAspectRatio={cardAspectRatio}
              autoRotate={autoRotate}
              autoSpeed={autoSpeed}
              smoothing={smoothing}
              blurStrength={blurStrength}
              bend={bend}
              reducedMotionRef={reducedMotionRef}
              lastInteractionRef={lastInteractionRef}
              slotCount={slotCount}
              cardViewportRatio={cardViewportRatio}
              radiusViewportRatio={radiusViewportRatio}
              onActiveChange={onActiveChange}
            />
          </Canvas>
        </div>
      </WebGLErrorBoundary>

      <div className="sr-only">
        <p>{ariaLabel}. Use the arrow keys to move between slides.</p>
        <ul>
          {items.map((item, index) => (
            <li key={`${item.src}-description-${index}`}>{item.alt}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
