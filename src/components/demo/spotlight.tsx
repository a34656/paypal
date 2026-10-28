"use client";
import { useEffect, useRef, useState } from "react";
import { useDemo } from "./controller";

interface Box {
  target: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Outlines the scene's target and dims the rest of the page. Purely visual: pointer events pass straight
 * through, so the visitor can always click anything (including the walkthrough controls).
 */
export function DemoSpotlight() {
  const demo = useDemo();
  const spot = demo?.ui.spotlight ?? null;
  const reduced = demo?.reducedMotion ?? false;
  const [box, setBox] = useState<Box | null>(null);
  const last = useRef("");

  useEffect(() => {
    if (!spot) return;
    const el = document.querySelector<HTMLElement>(`[data-demo-target="${spot.target}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    let frame = 0;
    const track = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
      if (key !== last.current) {
        last.current = key;
        setBox(r.width && r.height ? { target: spot.target, top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 } : null);
      }
      frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    return () => {
      cancelAnimationFrame(frame);
      last.current = "";
    };
  }, [spot, reduced]);

  // A box measured for a previous target is stale until the next frame measures the new one.
  if (!spot || !box || box.target !== spot.target) return null;
  const below = box.top + box.height + 96 < window.innerHeight;
  const transition = reduced ? undefined : "top .45s var(--ease-cine), left .45s var(--ease-cine), width .45s var(--ease-cine), height .45s var(--ease-cine)";

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden>
      <div
        className="absolute rounded-[10px] ring-1 ring-cyan/80"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height, transition, boxShadow: "0 0 0 200vmax rgb(5 6 8 / 0.5), 0 0 40px -6px rgb(111 227 238 / 0.45)" }}
      />
      <div
        className="absolute max-w-xs rounded-[6px] border border-cyan/30 bg-bg/95 px-3 py-2 text-[12.5px] leading-snug text-fg shadow-2xl"
        style={{
          // Keep clear of the story panel (420px + gutter, docked right from md up).
          left: Math.max(12, Math.min(box.left, window.innerWidth - 332 - (window.innerWidth >= 768 ? 440 : 0))),
          top: below ? box.top + box.height + 10 : Math.max(12, box.top - 64),
          transition: reduced ? undefined : "top .45s var(--ease-cine), left .45s var(--ease-cine)",
        }}
      >
        {spot.caption}
      </div>
    </div>
  );
}
