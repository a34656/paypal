"use client";
import { useEffect, useState } from "react";

export interface RenderCapability {
  /** "3d" = WebGL scene, "2d" = static/SVG fallback; null until detected after mount. */
  mode: "3d" | "2d" | null;
  webgl: "webgl2" | "webgl" | "none" | null;
  reducedMotion: boolean;
  lowPower: boolean;
}

function detectWebgl(): "webgl2" | "webgl" | "none" {
  try {
    const c = document.createElement("canvas");
    if (c.getContext("webgl2")) return "webgl2";
    if (c.getContext("webgl")) return "webgl";
  } catch {
    /* fall through */
  }
  return "none";
}

/** One-time client capability detection; listens for reduced-motion changes. */
export function useRenderCapability(): RenderCapability {
  const [cap, setCap] = useState<RenderCapability>({ mode: null, webgl: null, reducedMotion: false, lowPower: false });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compute = () => {
      const webgl = detectWebgl();
      const nav = navigator as Navigator & { deviceMemory?: number };
      const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || window.innerWidth < 640;
      const reducedMotion = mq.matches;
      setCap({ mode: webgl === "none" || reducedMotion ? "2d" : "3d", webgl, reducedMotion, lowPower });
    };
    compute();
    mq.addEventListener("change", compute);
    return () => mq.removeEventListener("change", compute);
  }, []);
  return cap;
}

/** True while the element is on screen (pauses render loops off-screen). */
export function useOnScreen<T extends Element>(ref: React.RefObject<T | null>, rootMargin = "0px"): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin });
    io.observe(el);
    const vis = () => setOn((o) => (document.hidden ? false : o));
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ref, rootMargin]);
  return on;
}
