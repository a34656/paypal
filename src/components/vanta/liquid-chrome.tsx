"use client";

/*
 * LiquidChrome — supplied source, adapted for VANTA. Changes from the original, all scoped:
 * - Removed the stray `;;` after the fragment shader template (harmless empty statement, flagged by lint).
 * - Failure paths (no context, shader compile/link error, context lost) call `onError` so the parent can
 *   show a static fallback instead of a blank canvas; dev-only logging instead of console.error in prod.
 * - Backing store is capped (`maxDpr`) and rendered at `resolutionScale`: the warped noise is soft, so a
 *   half-resolution buffer is visually identical and costs a quarter of the fill rate.
 * - ResizeObserver instead of window resize, so container-driven size changes are picked up.
 * - Pauses when off-screen, when the tab is hidden, or when `paused` is set; with reduced motion it
 *   renders a single still frame and ignores the pointer.
 * - Canvas no longer sets `touch-action: none` and ignores pointer events: as a background it must not
 *   block page scrolling or clicks. Pointer position is still read from window `pointermove`.
 * - Cleanup now deletes the buffer, shaders and program, not just the frame and listeners.
 */

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface LiquidChromeProps {
  /** Additional CSS classes for custom styling */
  className?: string;
  /** Base color tint for the chrome. Default is white/silver. Use hex or rgb. */
  baseColor?: [number, number, number];
  /** Animation speed multiplier. Default is 1.0 */
  speed?: number;
  /** Detail level of the fluid waves. Higher is more detailed. Default is 0.4 */
  amplitude?: number;
  /** Enables mouse interaction if true */
  interactive?: boolean;
  /** Stop the render loop (e.g. the section is scrolled away). */
  paused?: boolean;
  /** Fraction of CSS pixels rendered (0–1]. */
  resolutionScale?: number;
  /** Upper bound on devicePixelRatio. */
  maxDpr?: number;
  /** Called once if WebGL is unavailable, shaders fail, or the context is lost. */
  onError?: (reason: string) => void;
}

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform vec3 u_baseColor;
  uniform float u_amplitude;

  // Simple 2D noise
  const mat2 m = mat2( 0.80,  0.60, -0.60,  0.80 );

  float hash( vec2 p ) {
      float h = dot(p,vec2(127.1,311.7));
      return fract(sin(h)*43758.5453123);
  }

  float noise( in vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f*f*(3.0-2.0*f);
      return mix( mix( hash( i + vec2(0.0,0.0) ),
                       hash( i + vec2(1.0,0.0) ), u.x),
                  mix( hash( i + vec2(0.0,1.0) ),
                       hash( i + vec2(1.0,1.0) ), u.x), u.y);
  }

  float fbm( vec2 p ) {
      float f = 0.0;
      f += 0.5000*noise( p ); p = m*p*2.02;
      f += 0.2500*noise( p ); p = m*p*2.03;
      f += 0.1250*noise( p ); p = m*p*2.01;
      f += 0.0625*noise( p );
      return f/0.9375;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = -1.0 + 2.0 * uv;
    if (u_resolution.y > 0.0) {
        p.x *= u_resolution.x / u_resolution.y;
    }

    // Mouse interaction
    vec2 mouse = (u_mouse - 0.5) * 2.0;
    if (u_resolution.y > 0.0) {
        mouse.x *= u_resolution.x / u_resolution.y;
    }

    // Distort based on distance to mouse
    vec2 diff = p - mouse;
    float dist = length(diff);
    vec2 distortion = vec2(0.0);
    if (dist > 0.0) {
        distortion = (diff / dist) * exp(-dist * 3.0) * 0.1;
    }
    p += distortion;

    float time = u_time * 0.5;

    // Domain warping
    vec2 q = vec2(0.0);
    q.x = fbm(p + vec2(0.0, 0.0) + time * 0.1);
    q.y = fbm(p + vec2(5.2, 1.3) + time * 0.15);

    vec2 r = vec2(0.0);
    r.x = fbm(p + 4.0 * q + vec2(1.7, 9.2) + time * 0.2);
    r.y = fbm(p + 4.0 * q + vec2(8.3, 2.8) + time * 0.25);

    float f = fbm(p + r * 4.0 * u_amplitude);

    // Color mixing (Chrome / Liquid Metal style)
    vec3 col = u_baseColor;

    // Add bright highlights based on the warped noise
    float highlight = smoothstep(0.4, 0.6, f);
    float highlight2 = smoothstep(0.6, 0.8, f);
    float dark = smoothstep(0.1, 0.3, f);

    col = mix(col, vec3(0.0), 1.0 - dark); // add shadows
    col = mix(col, vec3(0.8, 0.8, 0.9), highlight); // add silver midtones
    col = mix(col, vec3(1.0, 1.0, 1.0), highlight2); // add bright white specular

    // Vignette
    float v = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
    col *= 0.5 + 0.5 * pow(max(0.0, v), 0.2);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function LiquidChrome({
  className,
  baseColor = [0.1, 0.1, 0.1],
  speed = 1.0,
  amplitude = 0.6,
  interactive = true,
  paused = false,
  resolutionScale = 0.5,
  maxDpr = 1.5,
  onError,
}: LiquidChromeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(baseColor);
  const speedRef = useRef(speed);
  const amplitudeRef = useRef(amplitude);
  const interactiveRef = useRef(interactive);
  const pausedRef = useRef(paused);
  const onErrorRef = useRef(onError);
  /** Set by the effect: restarts the loop after `paused` flips back to false. */
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    colorRef.current = baseColor;
    speedRef.current = speed;
    amplitudeRef.current = amplitude;
    interactiveRef.current = interactive;
    onErrorRef.current = onError;
    pausedRef.current = paused;
    wakeRef.current();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fail = (reason: string) => {
      if (process.env.NODE_ENV !== "production") console.warn(`[LiquidChrome] ${reason}`);
      onErrorRef.current?.(reason);
    };

    const gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) {
      fail("WebGL not supported");
      return;
    }

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    const program = gl.createProgram()!;
    const positionBuffer = gl.createBuffer();
    const release = () => {
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };

    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      fail(`Vertex shader error: ${gl.getShaderInfoLog(vertexShader)}`);
      release();
      return;
    }

    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      fail(`Fragment shader error: ${gl.getShaderInfoLog(fragmentShader)}`);
      release();
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      fail(`Program link error: ${gl.getProgramInfoLog(program)}`);
      release();
      return;
    }
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const mouseLocation = gl.getUniformLocation(program, "u_mouse");
    const baseColorLocation = gl.getUniformLocation(program, "u_baseColor");
    const amplitudeLocation = gl.getUniformLocation(program, "u_amplitude");

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse: [number, number] = [0.5, 0.5];
    let animationFrameId = 0;
    let onScreen = true;
    let lost = false;
    // Time only advances while frames are drawn, so resuming does not jump.
    let elapsed = 0;
    let last = 0;

    const draw = () => {
      gl.uniform1f(timeLocation, elapsed);
      gl.uniform2f(mouseLocation, mouse[0], mouse[1]);
      gl.uniform3f(baseColorLocation, colorRef.current[0], colorRef.current[1], colorRef.current[2]);
      gl.uniform1f(amplitudeLocation, amplitudeRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const running = () => !lost && onScreen && !document.hidden && !pausedRef.current && !motionQuery.matches;

    const render = (time: number) => {
      animationFrameId = 0;
      if (!running()) return;
      elapsed += (last ? Math.min(time - last, 100) : 0) * 0.001 * speedRef.current;
      last = time;
      draw();
      animationFrameId = requestAnimationFrame(render);
    };

    const wake = () => {
      if (lost) return;
      if (!running()) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
        // Reduced motion still gets one still frame.
        if (motionQuery.matches) draw();
        return;
      }
      if (!animationFrameId) {
        last = 0;
        animationFrameId = requestAnimationFrame(render);
      }
    };
    wakeRef.current = wake;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * resolutionScale;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      if (!animationFrameId && !lost) draw();
    };

    const handleMouseMove = (e: PointerEvent) => {
      if (!interactiveRef.current || motionQuery.matches || e.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      mouse[0] = (e.clientX - rect.left) / rect.width;
      mouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(animationFrameId);
      fail("WebGL context lost");
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      wake();
    });
    intersection.observe(canvas);
    window.addEventListener("pointermove", handleMouseMove, { passive: true });
    document.addEventListener("visibilitychange", wake);
    motionQuery.addEventListener("change", wake);
    canvas.addEventListener("webglcontextlost", handleContextLost);

    resize();
    draw();
    wake();

    return () => {
      wakeRef.current = () => {};
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", handleMouseMove);
      document.removeEventListener("visibilitychange", wake);
      motionQuery.removeEventListener("change", wake);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      cancelAnimationFrame(animationFrameId);
      if (!lost) release();
    };
  }, [maxDpr, resolutionScale]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none block h-full w-full", className)} />;
}
