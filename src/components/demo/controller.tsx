"use client";
/**
 * Walkthrough controller: owns the state machine, runs the current scene's allowlisted actions, and
 * exposes controls to the UI. Scene effects are cancellable (AbortController per run) and pausable
 * (PauseGate); `runId` guarantees a stale run can never advance or fail the walkthrough.
 *
 * Safety: the runner can navigate, highlight, type through an input's own setter, read data and show
 * simulated branches. It has no action that submits a form, approves, denies, or touches a payment.
 */
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client/api";
import { usePrefersReducedMotion } from "@/lib/client/media";
import { demoReducer, initialDemoState, isDemoActive, persistable, type DemoMode, type DemoState, type PersistedDemo } from "./state";
import { isAbort, PauseGate, readingTime, sleep, typeInto, waitUntil } from "./runtime";
import { resolve, SCENES } from "./scenes";
import type { DemoAction, DemoEvaluation, DemoScene, DemoTarget, LiveMission, SceneContext, StageView } from "./types";

const STORAGE_KEY = "vanta-walkthrough";
const LIVE_PATH = /^\/missions\/(?!new$)([^/]+)$/;

export interface DemoUi {
  stage: StageView | null;
  spotlight: { target: DemoTarget; caption: string } | null;
  /** A target the current scene wanted but could not find on the page. */
  missingTarget: string | null;
  evaluation: DemoEvaluation | null;
  live: LiveMission | null;
  typing: boolean;
}

const emptyUi: DemoUi = { stage: null, spotlight: null, missingTarget: null, evaluation: null, live: null, typing: false };

export interface DemoApi {
  state: DemoState;
  scenes: DemoScene[];
  scene: DemoScene | null;
  ui: DemoUi;
  ctx: SceneContext;
  reducedMotion: boolean;
  start: (mode: DemoMode) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  replay: () => void;
  exit: () => void;
  decide: (choice: string) => void;
  registerInput: (id: string, set: (value: string) => void) => () => void;
}

const DemoContext = createContext<DemoApi | null>(null);

export function useDemo() {
  return useContext(DemoContext);
}

/** Lets a controlled input receive walkthrough typing through its own state setter. No-op outside the provider. */
export function useDemoInput(id: string, set: (value: string) => void) {
  const api = useContext(DemoContext);
  const register = api?.registerInput;
  useEffect(() => register?.(id, set), [register, id, set]);
}

const targetSelector = (t: string) => `[data-demo-target="${t}"]`;

export function DemoProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);
  const [ui, setUi] = useState<DemoUi>(emptyUi);
  const gate = useRef(new PauseGate());
  const inputs = useRef(new Map<string, (v: string) => void>());
  const decisionWaiter = useRef<((choice: string) => void) | null>(null);
  /** The page the runner last put the visitor on; leaving it unprompted pauses the walkthrough. */
  const runnerPath = useRef<string | null>(null);
  const humanWait = useRef(false);

  const scenes = SCENES[state.mode];
  const scene = state.status === "idle" ? null : (scenes[state.sceneIndex] ?? null);

  const ctx = useMemo<SceneContext>(
    () => ({ mode: state.mode, evaluation: ui.evaluation, decisions: state.decisions, live: ui.live, liveMissionId: state.liveMissionId, pathname }),
    [state.mode, ui.evaluation, state.decisions, ui.live, state.liveMissionId, pathname],
  );
  const ctxRef = useRef(ctx);
  const stateRef = useRef(state);
  useEffect(() => {
    ctxRef.current = ctx;
    stateRef.current = state;
  });

  // Paused, initializing and errored runs hold at their next step.
  useEffect(() => {
    gate.current.setPaused(state.status === "paused" || state.status === "initializing" || state.status === "error");
  }, [state.status]);

  // Restore after a reload: always paused, so nothing moves until the visitor resumes.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as PersistedDemo;
      if (snap.mode !== "presentation" && snap.mode !== "live") return;
      dispatch({ type: "RESTORE", snapshot: snap, sceneCount: SCENES[snap.mode].length });
    } catch {
      /* storage unavailable: start fresh */
    }
  }, []);

  useEffect(() => {
    try {
      const snap = persistable(state);
      if (snap) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [state]);

  // Visitor navigated somewhere the walkthrough did not take them: pause rather than drag them back.
  useEffect(() => {
    const s = stateRef.current;
    if (humanWait.current) {
      const m = LIVE_PATH.exec(pathname);
      if (m && s.mode === "live" && s.liveMissionId !== m[1]) dispatch({ type: "SET_LIVE_MISSION", id: m[1]! });
      return;
    }
    if ((s.status === "running" || s.status === "awaiting_demo_decision") && runnerPath.current && pathname !== runnerPath.current) {
      dispatch({ type: "PAUSE", reason: "You opened another page, so the walkthrough paused. Resume to continue, or exit to keep exploring." });
    }
  }, [pathname]);

  useEffect(() => {
    if (state.status === "initializing") dispatch({ type: "READY" });
  }, [state.status]);

  const fail = (runId: number, message: string) => dispatch({ type: "FAIL", runId, message });

  async function perform(action: DemoAction, scene: DemoScene, runId: number, signal: AbortSignal) {
    const g = gate.current;
    await g.wait(signal);
    switch (action.kind) {
      case "navigate": {
        const href = resolve(action.href, ctxRef.current);
        if (!href) return;
        const target = new URL(href, window.location.origin);
        runnerPath.current = target.pathname;
        if (window.location.pathname + window.location.search !== target.pathname + target.search) router.push(href, { scroll: true });
        const ok = await waitUntil(() => window.location.pathname === target.pathname, g, signal, 100, 12_000);
        if (!ok) throw new SceneError(`The page ${target.pathname} did not open.`);
        return;
      }
      case "spotlight": {
        setUi((u) => ({ ...u, stage: null, spotlight: null, missingTarget: null }));
        const found = await waitUntil(() => !!document.querySelector(targetSelector(action.target)), g, signal, 120, 5000);
        // A missing highlight never blocks the story: say so and carry on.
        setUi((u) => (found ? { ...u, spotlight: { target: action.target, caption: action.caption } } : { ...u, missingTarget: action.target }));
        if (found && !action.optional) await sleep(reducedMotion ? 150 : 700, g, signal);
        return;
      }
      case "clear-spotlight":
        setUi((u) => ({ ...u, spotlight: null, missingTarget: null }));
        return;
      case "stage":
        setUi((u) => ({ ...u, stage: action.view, spotlight: action.view ? null : u.spotlight }));
        return;
      case "type": {
        const ready = await waitUntil(() => inputs.current.has(action.input), g, signal, 100, 6000);
        const set = inputs.current.get(action.input);
        if (!ready || !set) throw new SceneError("The purchase input is not on this page, so the example task could not be typed.");
        setUi((u) => ({ ...u, typing: true }));
        try {
          await typeInto(action.text, set, { gate: g, signal, instant: reducedMotion });
        } finally {
          setUi((u) => ({ ...u, typing: false }));
        }
        return;
      }
      case "wait":
        await sleep(action.ms, g, signal);
        return;
      case "evaluate": {
        if (ctxRef.current.evaluation) return;
        try {
          const evaluation = await apiFetch<DemoEvaluation>("/api/demo/evaluate");
          if (signal.aborted) return;
          ctxRef.current = { ...ctxRef.current, evaluation };
          setUi((u) => ({ ...u, evaluation }));
        } catch (e) {
          throw new SceneError(`VANTA's evaluation service did not respond (${e instanceof ApiError ? e.message : "network error"}). Nothing was changed.`);
        }
        return;
      }
      case "live-refresh":
        await refreshLive(signal);
        if (!ctxRef.current.liveMissionId) throw new SceneError("There is no live mission yet. Go back a step and create one.");
        return;
      case "choice": {
        const choice = await new Promise<string>((res, rej) => {
          decisionWaiter.current = res;
          signal.addEventListener("abort", () => rej(new DemoAbortSignal()), { once: true });
          dispatch({ type: "REQUEST_DECISION", runId, decision: { kind: "choice", id: action.id, prompt: action.prompt, options: action.options } });
        });
        ctxRef.current = { ...ctxRef.current, decisions: { ...ctxRef.current.decisions, [action.id]: choice } };
        return;
      }
      case "await-human": {
        if (action.target) {
          const found = await waitUntil(() => !!document.querySelector(targetSelector(action.target!)), g, signal, 150, 4000);
          setUi((u) => (found ? { ...u, stage: null, spotlight: { target: action.target!, caption: action.prompt } } : { ...u, missingTarget: action.target! }));
        }
        humanWait.current = true;
        dispatch({ type: "REQUEST_DECISION", runId, decision: { kind: "human", id: action.id, prompt: action.prompt, target: action.target } });
        try {
          await waitUntil(
            async () => {
              const m = LIVE_PATH.exec(window.location.pathname);
              if (m) ctxRef.current = { ...ctxRef.current, liveMissionId: m[1]!, pathname: window.location.pathname };
              else ctxRef.current = { ...ctxRef.current, pathname: window.location.pathname };
              if (ctxRef.current.liveMissionId) await refreshLive(signal).catch(() => undefined);
              return action.until(ctxRef.current);
            },
            g,
            signal,
            2000,
          );
        } finally {
          humanWait.current = false;
        }
        runnerPath.current = window.location.pathname;
        dispatch({ type: "DECIDE", id: action.id, choice: "done" });
        return;
      }
      case "hold": {
        const text = resolve(scene.narration, ctxRef.current);
        await sleep(readingTime(text, reducedMotion), g, signal);
        return;
      }
    }
  }

  async function refreshLive(signal: AbortSignal) {
    const id = ctxRef.current.liveMissionId ?? stateRef.current.liveMissionId;
    if (!id) return;
    const live = await apiFetch<LiveMission>(`/api/missions/${id}`);
    if (signal.aborted) return;
    ctxRef.current = { ...ctxRef.current, live, liveMissionId: id };
    if (stateRef.current.liveMissionId !== id) dispatch({ type: "SET_LIVE_MISSION", id });
    setUi((u) => ({ ...u, live }));
  }

  const runScene = useEffectEvent((signal: AbortSignal) => {
    const s = stateRef.current;
    const current = SCENES[s.mode][s.sceneIndex];
    if (!current) return;
    const runId = s.runId;
    runnerPath.current = window.location.pathname;
    setUi((u) => ({ ...u, missingTarget: null }));
    void (async () => {
      try {
        for (const action of current.actions) {
          if (signal.aborted) return;
          await perform(action, current, runId, signal);
        }
        await gate.current.wait(signal);
        if (!signal.aborted) dispatch({ type: "SCENE_COMPLETE", runId });
      } catch (e) {
        if (isAbort(e) || e instanceof DemoAbortSignal || signal.aborted) return;
        fail(runId, e instanceof SceneError ? e.message : "Something went wrong in this step.");
      }
    })();
  });

  // One run per runId. Pause/resume keep the same run; next/prev/replay/exit abort it.
  useEffect(() => {
    if (state.status === "idle" || state.status === "completed") return;
    const ac = new AbortController();
    runScene(ac.signal);
    return () => {
      ac.abort();
      decisionWaiter.current = null;
      humanWait.current = false;
    };
  }, [state.runId, state.status === "idle" || state.status === "completed"]); // eslint-disable-line react-hooks/exhaustive-deps

  const registerInput = useCallback((id: string, set: (v: string) => void) => {
    inputs.current.set(id, set);
    return () => {
      if (inputs.current.get(id) === set) inputs.current.delete(id);
    };
  }, []);

  const api = useMemo<DemoApi>(
    () => ({
      state,
      scenes,
      scene,
      // Overlays never outlive the walkthrough.
      ui: state.status === "idle" || state.status === "completed" ? { ...ui, stage: null, spotlight: null, missingTarget: null, typing: false } : ui,
      ctx,
      reducedMotion,
      start: (mode) => {
        setUi((u) => ({ ...emptyUi, evaluation: u.evaluation }));
        dispatch({ type: "START", mode, sceneCount: SCENES[mode].length });
      },
      pause: () => dispatch({ type: "PAUSE" }),
      resume: () => {
        runnerPath.current = window.location.pathname;
        dispatch({ type: "RESUME" });
      },
      next: () => dispatch({ type: "NEXT" }),
      prev: () => dispatch({ type: "PREV" }),
      goTo: (index) => dispatch({ type: "GOTO", index }),
      replay: () => dispatch({ type: "REPLAY" }),
      exit: () => {
        setUi((u) => ({ ...emptyUi, evaluation: u.evaluation }));
        dispatch({ type: "EXIT" });
      },
      decide: (choice) => {
        const d = stateRef.current.decision;
        if (!d || d.kind !== "choice") return;
        dispatch({ type: "DECIDE", id: d.id, choice });
        decisionWaiter.current?.(choice);
        decisionWaiter.current = null;
      },
      registerInput,
    }),
    [state, scenes, scene, ui, ctx, reducedMotion, registerInput],
  );

  return <DemoContext.Provider value={api}>{children}</DemoContext.Provider>;
}

class SceneError extends Error {}
class DemoAbortSignal extends Error {}

export { isDemoActive };
