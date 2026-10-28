"use client";

/*
 * ScrollChoreography — supplied source, adapted for VANTA. Scoped changes:
 * - Imports `motion/react` instead of `framer-motion`. The project depends on `motion` 14.2, whose
 *   `motion/react` entry is the same engine as `framer-motion` 14.2; importing both names would risk two
 *   copies of the runtime in the bundle.
 * - Each image is `{ src, alt }` so callers supply meaningful alt text (the original hardcoded
 *   "Top Left" etc.).
 * - Optional `overlay(progress)` renders captions above every image layer (z-50), driven by the same
 *   smoothed progress, so text is never hidden behind an expanding panel.
 * - Phones (< 768px) use larger, taller-ratio cards with a tighter spread and a shorter 240vh track, so
 *   panels stay legible and the sequence does not drag on.
 * - Reduced motion renders a static 2×2 composition with no sticky track or scroll-linked transforms.
 * - `bg-muted` (a text colour in this theme) replaced with the graphite surface token; the sticky stage
 *   uses `100svh` so mobile browser chrome does not crop it.
 */

import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery, usePrefersReducedMotion } from "@/lib/client/media";

export interface ChoreographyImage {
  src: string;
  alt: string;
}

interface ScrollChoreographyProps {
  className?: string;
  images: {
    topLeft: ChoreographyImage;
    topRight: ChoreographyImage;
    bottomLeft: ChoreographyImage;
    bottomRight: ChoreographyImage;
  };
  /** Rendered above the images inside the sticky stage. Receives smoothed progress 0–1. */
  overlay?: (progress: MotionValue<number>) => ReactNode;
}

export function ScrollChoreography({ className, images, overlay }: ScrollChoreographyProps) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <StaticComposition className={className} images={images} />;
  return <Choreography className={className} images={images} overlay={overlay} />;
}

function Choreography({ className, images, overlay }: ScrollChoreographyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery("(max-width: 767px)");

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 400, // Higher stiffness for a slightly faster snap
    damping: 50, // Play with damping to add a little bounce/jerk
    mass: 1.2, // Adds a bit more weight to the movement
    restDelta: 0.001,
  });

  // Default positions relative to center
  const xLeft = compact ? "-24vw" : "-20vw";
  const xRight = compact ? "24vw" : "20vw";
  const yTop = compact ? "-11vh" : "-14vh";
  const yBottom = compact ? "11vh" : "14vh";
  const cardW = compact ? "46vw" : "36vw";
  const cardH = compact ? "20vh" : "24vh";

  // Phase 1: 0 - 0.3 (Diagonal movement)
  // Phase 2: 0.35 - 0.65 (Stack alignment to center)
  // Phase 3: 0.7 - 0.9 (Top Right expands to full screen)

  // Top Left -> moves to Bottom Left, then to Center
  const tlX = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [xLeft, xLeft, xLeft, "0vw", "0vw"]);
  const tlY = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [yTop, yBottom, yBottom, "0vh", "0vh"]);

  // Bottom Right -> moves to Top Right, then to Center
  const brX = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [xRight, xRight, xRight, "0vw", "0vw"]);
  const brY = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [yBottom, yTop, yTop, "0vh", "0vh"]);

  // Bottom Left -> stays, then moves to Center
  const blX = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [xLeft, xLeft, xLeft, "0vw", "0vw"]);
  const blY = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [yBottom, yBottom, yBottom, "0vh", "0vh"]);

  // Top Right -> stays, then moves to Center, then expands
  const trX = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [xRight, xRight, xRight, "0vw", "0vw"]);
  const trY = useTransform(smoothProgress, [0, 0.3, 0.35, 0.65, 1], [yTop, yTop, yTop, "0vh", "0vh"]);

  // Top Right (Hero) scaling/expansion properties
  const heroWidth = useTransform(smoothProgress, [0.65, 0.7, 0.9, 1], [cardW, cardW, "100vw", "100vw"]);
  const heroHeight = useTransform(smoothProgress, [0.65, 0.7, 0.9, 1], [cardH, cardH, "100vh", "100vh"]);

  // Opacity fading for images underneath the hero as it expands
  const underImagesOpacity = useTransform(smoothProgress, [0.75, 0.85], [1, 0]);

  const baseImageClasses = cn(
    "absolute left-1/2 top-1/2 overflow-hidden -translate-x-1/2 -translate-y-1/2 bg-bg-2 shadow-2xl will-change-transform",
    compact ? "w-[46vw] h-[20vh]" : "w-[36vw] h-[24vh]",
  );

  return (
    <div ref={containerRef} className={cn("relative w-full", compact ? "h-[240vh]" : "h-[300vh]", className)}>
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Top Left Image */}
          <motion.div style={{ x: tlX, y: tlY, opacity: underImagesOpacity }} className={cn(baseImageClasses, "z-10")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- transformed absolutely-positioned panel; next/image adds nothing here */}
            <img src={images.topLeft.src} alt={images.topLeft.alt} className="h-full w-full object-cover" draggable={false} />
          </motion.div>

          {/* Bottom Right Image */}
          <motion.div style={{ x: brX, y: brY, opacity: underImagesOpacity }} className={cn(baseImageClasses, "z-20")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images.bottomRight.src} alt={images.bottomRight.alt} className="h-full w-full object-cover" draggable={false} />
          </motion.div>

          {/* Bottom Left Image */}
          <motion.div style={{ x: blX, y: blY, opacity: underImagesOpacity }} className={cn(baseImageClasses, "z-30")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images.bottomLeft.src} alt={images.bottomLeft.alt} className="h-full w-full object-cover" draggable={false} />
          </motion.div>

          {/* Top Right Image (Hero - expands at the end) */}
          <motion.div
            style={{
              x: trX,
              y: trY,
              width: heroWidth,
              height: heroHeight,
            }}
            className={cn(baseImageClasses, "z-40 origin-center bg-black/5")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images.topRight.src} alt={images.topRight.alt} className="h-full w-full object-cover" draggable={false} />
          </motion.div>
        </div>
        {overlay && <div className="pointer-events-none absolute inset-0 z-50">{overlay(smoothProgress)}</div>}
      </div>
    </div>
  );
}

function StaticComposition({ className, images }: Pick<ScrollChoreographyProps, "className" | "images">) {
  const order = [images.topLeft, images.bottomRight, images.bottomLeft, images.topRight];
  return (
    <div className={cn("grid w-full grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {order.map((image) => (
        <div key={image.src} className="aspect-[3/2] overflow-hidden rounded-[6px] border border-line bg-bg-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} className="h-full w-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}
