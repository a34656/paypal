"use client";

import { Dithering, type DitheringProps } from "@paper-design/shaders-react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/client/cn";

export type DitherCreditCardColors = {
  accent?: string;
  background?: string;
  details?: string;
  foreground?: string;
};

export type DitherCreditCardContent = {
  brandName?: string;
  cardNumber?: string;
  cardholder?: string;
};

export type DitherCreditCardDither = {
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  scale?: number;
  shape?: DitheringProps["shape"];
  size?: number;
  speed?: number;
  type?: DitheringProps["type"];
};

export type DitherCreditCardPhysicsMode = "tilt" | "magnetic" | "zero-gravity";

export type DitherCreditCardSpring = {
  bounce?: number;
  damping?: number;
  mass?: number;
  stiffness?: number;
  visualDuration?: number;
};

export type DitherCreditCardPhysics = {
  glare?: number;
  lift?: number;
  magnetism?: number;
  mode?: DitherCreditCardPhysicsMode;
  perspective?: number;
  scale?: number;
  spring?: DitherCreditCardSpring;
  tilt?: number;
};

export type DitherCreditCardProps = {
  ariaLabel?: string;
  className?: string;
  colors?: DitherCreditCardColors;
  content?: DitherCreditCardContent;
  dither?: DitherCreditCardDither;
  interactive?: boolean;
  physics?: DitherCreditCardPhysics;
  /** @deprecated Use `interactive` to enable or disable the complete physics system. */
  tilt?: boolean;
};

const CARD_DOTS = ["dot-1", "dot-2", "dot-3", "dot-4"];
const DEFAULT_PHYSICS = {
  glare: 0.28,
  lift: 8,
  magnetism: 14,
  mode: "tilt",
  perspective: 1200,
  scale: 1,
  spring: {
    bounce: 0.08,
    visualDuration: 0.32,
  },
  tilt: 7,
} satisfies Required<DitherCreditCardPhysics>;
const DEFAULT_COLORS = {
  accent: "#ffc831",
  background: "#faa200",
  details: "#5f5f5f",
  foreground: "#ffffff",
} satisfies Required<DitherCreditCardColors>;
const DEFAULT_CONTENT = {
  brandName: "VANTA",
  cardNumber: "•••• ••••",
  cardholder: "SECURE PAYMENT",
} satisfies Required<DitherCreditCardContent>;
const DEFAULT_DITHER = {
  offsetX: 0.6,
  offsetY: 0.46,
  rotation: 8,
  scale: 2.52,
  shape: "wave",
  size: 2,
  speed: 0.26,
  type: "8x8",
} satisfies Required<DitherCreditCardDither>;

const SHADER_STYLE = { width: "100%", height: "100%" } as const;

function resolveSpring(spring: DitherCreditCardSpring) {
  if (spring.visualDuration !== undefined || spring.bounce !== undefined) {
    return {
      bounce: spring.bounce ?? 0,
      visualDuration: spring.visualDuration ?? 0.32,
    };
  }

  return {
    damping: spring.damping ?? 22,
    mass: spring.mass ?? 0.8,
    stiffness: spring.stiffness ?? 180,
  };
}

function useFinePointer() {
  const [hasFinePointer, setHasFinePointer] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updatePointer = () => setHasFinePointer(query.matches);

    updatePointer();
    query.addEventListener("change", updatePointer);

    return () => query.removeEventListener("change", updatePointer);
  }, []);

  return hasFinePointer;
}

function VantaMark({ accent, foreground }: { accent: string; foreground: string }) {
  return (
    <svg width="41" height="39" viewBox="0 0 41 39" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="40" height="39" rx="10" fill={foreground} fillOpacity="0.15" />
      <path
        d="M8 11 L20 28 L32 11"
        stroke={accent}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}



export function DitherCreditCard({
  ariaLabel,
  className,
  colors,
  content,
  dither,
  interactive = true,
  physics,
  tilt = true,
}: DitherCreditCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const hasFinePointer = useFinePointer();
  const [isHovered, setIsHovered] = useState(false);
  const pointerBoundsRef = useRef<DOMRect | null>(null);
  const rotateXTarget = useMotionValue(0);
  const rotateYTarget = useMotionValue(0);
  const xTarget = useMotionValue(0);
  const yTarget = useMotionValue(0);
  const scaleTarget = useMotionValue(1);
  const glareXTarget = useMotionValue(0);
  const glareYTarget = useMotionValue(0);
  const glareOpacityTarget = useMotionValue(0);
  const resolvedColors = { ...DEFAULT_COLORS, ...colors };
  const resolvedContent = { ...DEFAULT_CONTENT, ...content };
  const resolvedDither = { ...DEFAULT_DITHER, ...dither };
  const resolvedPhysics = {
    ...DEFAULT_PHYSICS,
    ...physics,
    spring: { ...DEFAULT_PHYSICS.spring, ...physics?.spring },
  };
  const spring = resolveSpring(resolvedPhysics.spring);
  const rotateX = useSpring(rotateXTarget, spring);
  const rotateY = useSpring(rotateYTarget, spring);
  const x = useSpring(xTarget, spring);
  const y = useSpring(yTarget, spring);
  const scale = useSpring(scaleTarget, spring);
  const glareX = useSpring(glareXTarget, spring);
  const glareY = useSpring(glareYTarget, spring);
  const glareOpacity = useSpring(glareOpacityTarget, {
    bounce: 0,
    visualDuration: 0.2,
  });
  const physicsEnabled = interactive && tilt && hasFinePointer && !shouldReduceMotion;
  const resolvedAriaLabel = ariaLabel ?? `${resolvedContent.brandName} secure payment card`;

  const resetPhysics = useCallback(() => {
    pointerBoundsRef.current = null;
    rotateXTarget.set(0);
    rotateYTarget.set(0);
    xTarget.set(0);
    yTarget.set(0);
    scaleTarget.set(1);
    glareXTarget.set(0);
    glareYTarget.set(0);
    glareOpacityTarget.set(0);
  }, [
    glareOpacityTarget,
    glareXTarget,
    glareYTarget,
    rotateXTarget,
    rotateYTarget,
    scaleTarget,
    xTarget,
    yTarget,
  ]);

  useEffect(() => {
    if (!physicsEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset hover state when physics changes
      setIsHovered(false);
      resetPhysics();
    }
  }, [physicsEnabled, resetPhysics]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!physicsEnabled || event.pointerType !== "mouse") return;

      const bounds = pointerBoundsRef.current ?? event.currentTarget.getBoundingClientRect();
      pointerBoundsRef.current = bounds;

      const normalizedX = Math.max(
        -1,
        Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
      );
      const normalizedY = Math.max(
        -1,
        Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
      );
      const mode = resolvedPhysics.mode;
      const rotationFactor = mode === "magnetic" ? 0.45 : 1;
      const magnetismFactor = mode === "tilt" ? 0 : mode === "zero-gravity" ? 1.35 : 1;
      const liftFactor = mode === "zero-gravity" ? 1.45 : 1;

      rotateXTarget.set(normalizedY * resolvedPhysics.tilt * -rotationFactor);
      rotateYTarget.set(normalizedX * resolvedPhysics.tilt * rotationFactor);
      xTarget.set(normalizedX * resolvedPhysics.magnetism * magnetismFactor);
      yTarget.set(
        normalizedY * resolvedPhysics.magnetism * magnetismFactor -
          resolvedPhysics.lift * liftFactor,
      );
      glareXTarget.set(normalizedX * 88);
      glareYTarget.set(normalizedY * 56);
    },
    [
      glareXTarget,
      glareYTarget,
      physicsEnabled,
      resolvedPhysics.lift,
      resolvedPhysics.magnetism,
      resolvedPhysics.mode,
      resolvedPhysics.tilt,
      rotateXTarget,
      rotateYTarget,
      xTarget,
      yTarget,
    ],
  );

  return (
    <motion.article
      aria-label={resolvedAriaLabel}
      className={cn(
        "relative isolate aspect-[121/73] w-full max-w-[605px] origin-center overflow-hidden rounded-[clamp(16px,5%,24px)] border border-white/10 [backface-visibility:hidden] [container-type:inline-size] [transform-style:preserve-3d]",
        className,
      )}
      onPointerEnter={(event) => {
        if (physicsEnabled && event.pointerType === "mouse") {
          pointerBoundsRef.current = event.currentTarget.getBoundingClientRect();
          setIsHovered(true);
          const liftFactor = resolvedPhysics.mode === "zero-gravity" ? 1.45 : 1;
          yTarget.set(resolvedPhysics.lift * -liftFactor);
          scaleTarget.set(resolvedPhysics.scale);
          glareOpacityTarget.set(resolvedPhysics.glare);
        }
      }}
      onPointerLeave={() => {
        setIsHovered(false);
        resetPhysics();
      }}
      onPointerMove={handlePointerMove}
      style={{
        backgroundColor: resolvedColors.background,
        rotateX,
        rotateY,
        scale,
        transformPerspective: resolvedPhysics.perspective,
        willChange: isHovered ? "transform" : "auto",
        x,
        y,
      }}
    >
      <Dithering
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
        width={1280}
        height={720}
        colorBack={resolvedColors.background}
        colorFront={resolvedColors.foreground}
        shape={resolvedDither.shape}
        type={resolvedDither.type}
        size={resolvedDither.size}
        speed={shouldReduceMotion ? 0 : resolvedDither.speed}
        scale={resolvedDither.scale}
        rotation={resolvedDither.rotation}
        offsetX={resolvedDither.offsetX}
        offsetY={resolvedDither.offsetY}
        style={SHADER_STYLE}
      />

      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[28%] z-[5] rounded-full mix-blend-soft-light"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, ${resolvedColors.foreground} 68%, transparent) 0%, transparent 64%)`,
          opacity: glareOpacity,
          x: glareX,
          y: glareY,
        }}
      />

      {/* Top-left: brand */}
      <div
        className="absolute left-[7.27%] top-[8.77%] z-10 flex items-center gap-[clamp(6px,1.8cqw,10px)]"
        style={{ color: resolvedColors.foreground }}
      >
        <span className="block w-[clamp(24px,5.5cqw,36px)] shrink-0 opacity-90">
          <VantaMark accent={resolvedColors.accent} foreground={resolvedColors.foreground} />
        </span>
        <span className="whitespace-nowrap font-mono text-[clamp(16px,4cqw,26px)] font-bold leading-none tracking-[0.06em] opacity-95">
          {resolvedContent.brandName}
        </span>
      </div>

      {/* Top-right: secure badge */}
      <div
        className="absolute right-[7.1%] top-[10%] z-10 flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5"
        style={{ color: resolvedColors.foreground, backgroundColor: "rgba(255,255,255,0.06)" }}
      >
        <svg width="8" height="9" viewBox="0 0 8 9" fill="none" aria-hidden>
          <path d="M4 0.5L7 2V5C7 6.66 5.66 8.16 4 8.5C2.34 8.16 1 6.66 1 5V2L4 0.5Z" fill="currentColor" fillOpacity="0.7" />
        </svg>
        <span className="font-mono text-[clamp(6px,1.4cqw,9px)] font-medium tracking-[0.14em] uppercase opacity-70">
          Secure
        </span>
      </div>

      {/* Bottom-left: masked card number */}
      <p
        className="absolute bottom-[10.25%] left-[7.27%] z-10 m-0 flex items-center gap-[clamp(5px,1.15cqw,7px)] font-mono text-[clamp(13px,3.4cqw,22px)] font-semibold leading-none tracking-[-0.01em]"
        style={{ color: resolvedColors.details }}
      >
        <span aria-hidden="true" className="flex gap-[clamp(3px,0.9cqw,5px)]">
          {CARD_DOTS.map((dot) => (
            <span className="size-[clamp(4px,1.1cqw,7px)] rounded-full bg-current opacity-60" key={dot} />
          ))}
        </span>
        <span className="opacity-80">{resolvedContent.cardNumber}</span>
      </p>

      {/* Bottom-right: cardholder */}
      <p
        className="absolute bottom-[10.25%] right-[7.1%] z-10 m-0 font-mono text-[clamp(9px,2.2cqw,14px)] font-medium leading-none tracking-[0.1em] uppercase opacity-60"
        style={{ color: resolvedColors.details }}
      >
        {resolvedContent.cardholder}
      </p>
    </motion.article>
  );
}

