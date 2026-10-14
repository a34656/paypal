"use client";
/**
 * The AEGIS Core — landing-page centerpiece. Purely decorative: it reflects no mission state
 * and makes no decisions. Original geometry: a faceted glass core inside a metallic lattice,
 * thin orbital rings with travelling beads, a sparse particle field and additive halos in
 * place of a post-processing bloom pass. Pointer gently steers it; scroll dollies the camera.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";

export interface CoreSceneProps {
  /** 0 at the top of the hero, 1 once the hero has scrolled away. Written by the page, read per frame. */
  scroll?: MutableRefObject<number>;
  /** Lower particle counts and resolution. */
  lowPower?: boolean;
  /** Stop the render loop (off-screen or tab hidden). */
  paused?: boolean;
  onContextLost?: () => void;
  onReady?: () => void;
}

const CYAN = new THREE.Color("#6FE3EE");
const ICE = new THREE.Color("#B8DCFF");
const VIOLET = new THREE.Color("#9D8CF2");

/** Soft radial sprite texture generated on the client (no asset fetch). */
function useHaloTexture() {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

function Halo({ size, color, opacity }: { size: number; color: THREE.Color; opacity: number }) {
  const tex = useHaloTexture();
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite scale={[size, size, 1]}>
      <spriteMaterial map={tex} color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  );
}

function Lattice() {
  const ref = useRef<THREE.LineSegments>(null);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.12, 1)), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.y += dt * 0.06;
      ref.current.rotation.x += dt * 0.025;
    }
  });
  return (
    <lineSegments ref={ref} geometry={geo}>
      <lineBasicMaterial color={ICE} transparent opacity={0.32} />
    </lineSegments>
  );
}

function Facets() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y -= dt * 0.04;
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.1, 1]} />
      <meshStandardMaterial color="#1a2030" metalness={1} roughness={0.22} flatShading transparent opacity={0.38} envMapIntensity={1.4} />
    </mesh>
  );
}

function GlassCore() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = t * 0.12;
    ref.current.rotation.z = Math.sin(t * 0.2) * 0.15;
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.62, 0]} />
      {/* Glass look without a transmission pass (cheaper, and halos are not refracted into blobs). */}
      <meshPhysicalMaterial color="#cfefff" metalness={0.25} roughness={0.08} iridescence={0.5} iridescenceIOR={1.3} clearcoat={1} envMapIntensity={2.2} transparent opacity={0.42} flatShading depthWrite={false} />
    </mesh>
  );
}

function Heart() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.1) * 0.06);
  });
  return (
    <group>
      <mesh ref={ref}>
        <sphereGeometry args={[0.09, 32, 32]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
      <Halo size={0.85} color={CYAN} opacity={0.45} />
      <Halo size={4.2} color={ICE} opacity={0.06} />
    </group>
  );
}

function Orbit({ radius, tilt, speed, color, beads = 1, opacity = 0.5 }: { radius: number; tilt: [number, number, number]; speed: number; color: THREE.Color; beads?: number; opacity?: number }) {
  const group = useRef<THREE.Group>(null);
  const beadRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((state, dt) => {
    if (group.current) group.current.rotation.z += dt * speed * 0.15;
    const t = state.clock.elapsedTime * speed;
    beadRefs.current.forEach((m, i) => {
      if (!m) return;
      const a = t + (i / beads) * Math.PI * 2;
      m.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    });
  });
  return (
    <group rotation={tilt}>
      <group ref={group}>
        <mesh>
          <torusGeometry args={[radius, 0.004, 6, 220]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      </group>
      {Array.from({ length: beads }).map((_, i) => (
        <mesh key={i} ref={(m) => void (beadRefs.current[i] = m)}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Deterministic PRNG so the particle field is pure and identical across renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Particles({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const random = mulberry32(0xae915);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Shell distribution between r=2.2 and r=9, flattened slightly (atmospheric disc).
      const r = 2.2 + Math.pow(random(), 1.6) * 6.8;
      const th = random() * Math.PI * 2;
      const ph = Math.acos(2 * random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.55;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const c = random() < 0.08 ? VIOLET : random() < 0.5 ? CYAN : ICE;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.012;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.022} vertexColors transparent opacity={0.65} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/** Cyan rim from behind; a violet light orbits slowly so reflections shift occasionally. */
function Lights() {
  const violet = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.18;
    violet.current?.position.set(Math.cos(t) * 4, 1.2 + Math.sin(t * 1.7), Math.sin(t) * 4);
  });
  return (
    <>
      <ambientLight intensity={0.08} />
      <spotLight position={[-3, 3, -4]} angle={0.6} penumbra={1} intensity={60} color={CYAN} />
      <pointLight position={[3, -2, 3]} intensity={6} color={ICE} />
      <pointLight ref={violet} intensity={9} color={VIOLET} distance={12} />
    </>
  );
}

function Rig({ scroll }: { scroll?: MutableRefObject<number> }) {
  const core = useRef<THREE.Group>(null);
  useFrame(({ camera, pointer }, dt) => {
    const k = 1 - Math.exp(-dt * 2.2); // frame-rate independent easing
    const s = scroll?.current ?? 0;
    if (core.current) {
      core.current.rotation.y += (pointer.x * 0.35 - core.current.rotation.y) * k;
      core.current.rotation.x += (-pointer.y * 0.22 + s * 0.5 - core.current.rotation.x) * k;
    }
    // Scroll: dolly back and drift up as the hero leaves; pointer adds slight parallax.
    const tx = pointer.x * 0.25;
    const ty = pointer.y * 0.15 + s * 1.2;
    const tz = 6.2 + s * 3.5;
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    camera.lookAt(0, s * 0.6, 0);
  });
  return (
    <group ref={core}>
      <Facets />
      <Lattice />
      <GlassCore />
      <Heart />
      <Orbit radius={1.75} tilt={[Math.PI / 2.15, 0, 0.2]} speed={0.35} color={CYAN} beads={2} opacity={0.55} />
      <Orbit radius={2.15} tilt={[Math.PI / 2.6, 0.5, -0.4]} speed={-0.22} color={ICE} opacity={0.3} />
      <Orbit radius={2.6} tilt={[Math.PI / 1.85, -0.35, 0.9]} speed={0.14} color={VIOLET} beads={1} opacity={0.22} />
    </group>
  );
}

export default function CoreScene({ scroll, lowPower = false, paused = false, onContextLost, onReady }: CoreSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 6.2], fov: 38 }}
      dpr={lowPower ? 1 : [1, 1.5]}
      frameloop={paused ? "never" : "always"}
      gl={{ antialias: !lowPower, alpha: true, powerPreference: lowPower ? "low-power" : "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        const el = gl.domElement;
        const lost = (e: Event) => {
          e.preventDefault();
          onContextLost?.();
        };
        el.addEventListener("webglcontextlost", lost, { once: true });
        onReady?.();
      }}
      aria-hidden
    >
      <fog attach="fog" args={["#050608", 7, 16]} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.4} color="#6FE3EE" position={[-4, 2, -3]} scale={[4, 1, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#B8DCFF" position={[4, -1, 2]} scale={[3, 2, 1]} />
        <Lightformer form="ring" intensity={1.2} color="#9D8CF2" position={[0, 4, 3]} scale={2} />
      </Environment>
      <Lights />
      <Rig scroll={scroll} />
      <Particles count={lowPower ? 260 : 900} />
    </Canvas>
  );
}
