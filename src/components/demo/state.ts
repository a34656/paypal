/**
 * Walkthrough state machine. Pure reducer; the scene runner (controller.tsx) is the only thing that
 * performs side effects. `runId` changes whenever a scene must (re)start, so a stale run can never
 * complete or fail a scene it no longer owns.
 */

export type DemoMode = "presentation" | "live";
export type DemoStatus = "idle" | "initializing" | "running" | "paused" | "awaiting_demo_decision" | "completed" | "error";

export interface DemoChoiceOption {
  id: string;
  label: string;
  description?: string;
}

export type PendingDecision =
  /** A demo-only branch (presentation mode). Never an authorization. */
  | { kind: "choice"; id: string; prompt: string; options: DemoChoiceOption[] }
  /** A real action only the visitor can take in the real UI (live mode). The demo never takes it. */
  | { kind: "human"; id: string; prompt: string; target?: string };

export interface DemoState {
  status: DemoStatus;
  mode: DemoMode;
  sceneIndex: number;
  sceneCount: number;
  runId: number;
  decision: PendingDecision | null;
  decisions: Record<string, string>;
  error: { message: string; recoverable: boolean } | null;
  pausedReason: string | null;
  /** Where RESUME returns to. */
  resumeTo: "running" | "awaiting_demo_decision";
  liveMissionId: string | null;
}

export type DemoEvent =
  | { type: "START"; mode: DemoMode; sceneCount: number }
  | { type: "READY" }
  | { type: "PAUSE"; reason?: string }
  | { type: "RESUME" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "GOTO"; index: number }
  | { type: "REPLAY" }
  | { type: "EXIT" }
  | { type: "SCENE_COMPLETE"; runId: number }
  | { type: "REQUEST_DECISION"; runId: number; decision: PendingDecision }
  | { type: "DECIDE"; id: string; choice: string }
  | { type: "FAIL"; runId: number; message: string; recoverable?: boolean }
  | { type: "SET_LIVE_MISSION"; id: string | null }
  | { type: "RESTORE"; snapshot: PersistedDemo; sceneCount: number };

export interface PersistedDemo {
  mode: DemoMode;
  sceneIndex: number;
  decisions: Record<string, string>;
  liveMissionId: string | null;
}

export const initialDemoState: DemoState = {
  status: "idle",
  mode: "presentation",
  sceneIndex: 0,
  sceneCount: 0,
  runId: 0,
  decision: null,
  decisions: {},
  error: null,
  pausedReason: null,
  resumeTo: "running",
  liveMissionId: null,
};

const ACTIVE: DemoStatus[] = ["initializing", "running", "paused", "awaiting_demo_decision", "error"];
export const isDemoActive = (s: DemoState) => ACTIVE.includes(s.status) || s.status === "completed";

function goTo(s: DemoState, index: number): DemoState {
  if (index >= s.sceneCount) return { ...s, status: "completed", decision: null, error: null, pausedReason: null };
  return { ...s, sceneIndex: Math.max(0, index), runId: s.runId + 1, status: "running", decision: null, error: null, pausedReason: null, resumeTo: "running" };
}

export function demoReducer(s: DemoState, e: DemoEvent): DemoState {
  switch (e.type) {
    case "START":
      return { ...initialDemoState, status: "initializing", mode: e.mode, sceneCount: e.sceneCount, runId: s.runId + 1 };
    case "READY":
      return s.status === "initializing" ? { ...s, status: "running" } : s;
    case "PAUSE":
      if (s.status !== "running" && s.status !== "awaiting_demo_decision") return s;
      return { ...s, status: "paused", resumeTo: s.status, pausedReason: e.reason ?? null };
    case "RESUME":
      if (s.status === "paused") return { ...s, status: s.resumeTo, pausedReason: null };
      // Recovery path: retry the failed scene from its start.
      if (s.status === "error" && s.error?.recoverable) return goTo(s, s.sceneIndex);
      return s;
    case "NEXT":
      return isDemoActive(s) && s.status !== "completed" ? goTo(s, s.sceneIndex + 1) : s;
    case "PREV":
      return isDemoActive(s) ? goTo({ ...s, sceneCount: s.sceneCount }, Math.max(0, s.status === "completed" ? s.sceneCount - 1 : s.sceneIndex - 1)) : s;
    case "GOTO":
      return isDemoActive(s) ? goTo(s, Math.min(Math.max(0, e.index), s.sceneCount - 1)) : s;
    case "REPLAY":
      return isDemoActive(s) ? goTo({ ...s, decisions: {} }, 0) : s;
    case "EXIT":
      return { ...initialDemoState, runId: s.runId + 1 };
    case "SCENE_COMPLETE":
      return e.runId === s.runId && s.status === "running" ? goTo(s, s.sceneIndex + 1) : s;
    case "REQUEST_DECISION":
      return e.runId === s.runId && s.status === "running" ? { ...s, status: "awaiting_demo_decision", decision: e.decision } : s;
    case "DECIDE":
      if (s.status !== "awaiting_demo_decision" || s.decision?.id !== e.id) return s;
      return { ...s, status: "running", decision: null, decisions: { ...s.decisions, [e.id]: e.choice } };
    case "FAIL":
      return e.runId === s.runId && (s.status === "running" || s.status === "initializing" || s.status === "awaiting_demo_decision")
        ? { ...s, status: "error", decision: null, error: { message: e.message, recoverable: e.recoverable ?? true } }
        : s;
    case "SET_LIVE_MISSION":
      return { ...s, liveMissionId: e.id };
    case "RESTORE":
      return {
        ...initialDemoState,
        status: "paused",
        resumeTo: "running",
        mode: e.snapshot.mode,
        sceneIndex: Math.min(Math.max(0, e.snapshot.sceneIndex), e.sceneCount - 1),
        sceneCount: e.sceneCount,
        decisions: e.snapshot.decisions,
        liveMissionId: e.snapshot.liveMissionId,
        runId: s.runId + 1,
        pausedReason: "The page reloaded. The walkthrough is paused where you left it.",
      };
  }
}

export const persistable = (s: DemoState): PersistedDemo | null =>
  s.status === "idle" || s.status === "completed" ? null : { mode: s.mode, sceneIndex: s.sceneIndex, decisions: s.decisions, liveMissionId: s.liveMissionId };
