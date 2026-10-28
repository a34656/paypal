import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoReducer, initialDemoState, persistable, type DemoState } from "@/components/demo/state";
import { DemoAbort, PauseGate, sleep, typeInto } from "@/components/demo/runtime";
import { matchQuestion, SCENES, timelineUpTo } from "@/components/demo/scenes";
import type { SceneContext } from "@/components/demo/types";

const started = (mode: "presentation" | "live" = "presentation") => demoReducer(demoReducer(initialDemoState, { type: "START", mode, sceneCount: SCENES[mode].length }), { type: "READY" });

describe("walkthrough state machine", () => {
  it("starts in initializing then running at scene 0", () => {
    const s0 = demoReducer(initialDemoState, { type: "START", mode: "presentation", sceneCount: 5 });
    expect(s0.status).toBe("initializing");
    expect(demoReducer(s0, { type: "READY" })).toMatchObject({ status: "running", sceneIndex: 0 });
  });

  it("pauses and resumes without restarting the scene", () => {
    const s = started();
    const p = demoReducer(s, { type: "PAUSE" });
    expect(p.status).toBe("paused");
    const r = demoReducer(p, { type: "RESUME" });
    expect(r.status).toBe("running");
    expect(r.runId).toBe(s.runId);
  });

  it("returns to the pending decision when resumed from a pause taken during it", () => {
    const s = started();
    const d = demoReducer(s, { type: "REQUEST_DECISION", runId: s.runId, decision: { kind: "choice", id: "x", prompt: "?", options: [] } });
    const r = demoReducer(demoReducer(d, { type: "PAUSE" }), { type: "RESUME" });
    expect(r.status).toBe("awaiting_demo_decision");
    expect(r.decision?.id).toBe("x");
  });

  it("next/prev/goto start a new run; prev clamps at 0; next past the end completes", () => {
    let s = started();
    const prev = demoReducer(s, { type: "PREV" });
    expect(prev.sceneIndex).toBe(0);
    expect(prev.runId).toBeGreaterThan(s.runId);
    s = demoReducer(s, { type: "GOTO", index: s.sceneCount - 1 });
    expect(s.sceneIndex).toBe(s.sceneCount - 1);
    expect(demoReducer(s, { type: "NEXT" }).status).toBe("completed");
  });

  it("ignores completion and failure from a stale run", () => {
    const s = started();
    const moved = demoReducer(s, { type: "NEXT" });
    expect(demoReducer(moved, { type: "SCENE_COMPLETE", runId: s.runId })).toBe(moved);
    expect(demoReducer(moved, { type: "FAIL", runId: s.runId, message: "x" })).toBe(moved);
  });

  it("does not complete a scene while paused", () => {
    const s = demoReducer(started(), { type: "PAUSE" });
    expect(demoReducer(s, { type: "SCENE_COMPLETE", runId: s.runId }).status).toBe("paused");
  });

  it("errors are recoverable: resume retries the same scene with a fresh run", () => {
    const s = demoReducer(started(), { type: "NEXT" });
    const e = demoReducer(s, { type: "FAIL", runId: s.runId, message: "API down" });
    expect(e.status).toBe("error");
    const r = demoReducer(e, { type: "RESUME" });
    expect(r).toMatchObject({ status: "running", sceneIndex: s.sceneIndex, error: null });
    expect(r.runId).toBeGreaterThan(e.runId);
  });

  it("replay clears simulated decisions and restarts at scene 0", () => {
    let s = demoReducer(started(), { type: "GOTO", index: 3 });
    s = demoReducer(s, { type: "REQUEST_DECISION", runId: s.runId, decision: { kind: "choice", id: "approval-branch", prompt: "", options: [] } });
    s = demoReducer(s, { type: "DECIDE", id: "approval-branch", choice: "approve" });
    expect(s.decisions["approval-branch"]).toBe("approve");
    const r = demoReducer(s, { type: "REPLAY" });
    expect(r).toMatchObject({ sceneIndex: 0, decisions: {}, status: "running" });
  });

  it("ignores decisions that do not match the pending one", () => {
    const s = started();
    const d = demoReducer(s, { type: "REQUEST_DECISION", runId: s.runId, decision: { kind: "choice", id: "a", prompt: "", options: [] } });
    expect(demoReducer(d, { type: "DECIDE", id: "b", choice: "x" })).toBe(d);
    expect(demoReducer(s, { type: "DECIDE", id: "a", choice: "x" })).toBe(s);
  });

  it("exit returns to idle and invalidates the running scene", () => {
    const s = started();
    const x = demoReducer(s, { type: "EXIT" });
    expect(x.status).toBe("idle");
    expect(x.runId).toBeGreaterThan(s.runId);
    expect(persistable(x)).toBeNull();
  });

  it("restores after reload in a paused state at the saved scene", () => {
    const r: DemoState = demoReducer(initialDemoState, { type: "RESTORE", snapshot: { mode: "presentation", sceneIndex: 99, decisions: {}, liveMissionId: null }, sceneCount: 5 });
    expect(r).toMatchObject({ status: "paused", sceneIndex: 4 });
    expect(r.pausedReason).toMatch(/reloaded/);
  });
});

describe("walkthrough runtime", () => {
  it("sleep does not count paused time and resumes where it left off", async () => {
    const gate = new PauseGate();
    const ac = new AbortController();
    const t0 = Date.now();
    const p = sleep(250, gate, ac.signal);
    setTimeout(() => gate.setPaused(true), 50);
    setTimeout(() => gate.setPaused(false), 450);
    await p;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
  });

  it("abort cancels a sleep, including one that is paused", async () => {
    const gate = new PauseGate();
    const ac = new AbortController();
    gate.setPaused(true);
    const p = sleep(10_000, gate, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toBeInstanceOf(DemoAbort);
  });

  it("typeInto writes through the setter one character at a time and can be cancelled mid-way", async () => {
    const values: string[] = [];
    const gate = new PauseGate();
    await typeInto("abc", (v) => values.push(v), { gate, signal: new AbortController().signal, delay: 1 });
    expect(values).toEqual(["", "a", "ab", "abc"]);

    const ac = new AbortController();
    const seen: string[] = [];
    const p = typeInto("a long sentence to type", (v) => seen.push(v), { gate, signal: ac.signal, delay: 20 });
    setTimeout(() => ac.abort(), 70);
    await expect(p).rejects.toBeInstanceOf(DemoAbort);
    expect(seen.at(-1)!.length).toBeLessThan("a long sentence to type".length);
  });

  it("reduced motion types instantly", async () => {
    const values: string[] = [];
    await typeInto("hello", (v) => values.push(v), { gate: new PauseGate(), signal: new AbortController().signal, instant: true });
    expect(values).toEqual(["hello"]);
  });
});

describe("walkthrough script safety", () => {
  const ctx: SceneContext = { mode: "presentation", evaluation: null, decisions: {}, live: null, liveMissionId: null, pathname: "/" };

  it("both modes cover all five chapters in order", () => {
    for (const scenes of Object.values(SCENES)) {
      const chapters = scenes.map((s) => s.chapter);
      expect([...new Set(chapters)]).toEqual([1, 2, 3, 4, 5]);
      expect(chapters).toEqual([...chapters].sort());
      expect(new Set(scenes.map((s) => s.id)).size).toBe(scenes.length);
    }
  });

  it("presentation mode never waits on or performs a real human step", () => {
    const kinds = SCENES.presentation.flatMap((s) => s.actions.map((a) => a.kind));
    expect(kinds).not.toContain("await-human");
    expect(kinds).not.toContain("live-refresh");
  });

  it("live mode waits for the human at parse, confirm, approval and checkout", () => {
    const waits = SCENES.live.flatMap((s) => s.actions.filter((a) => a.kind === "await-human").map((a) => (a as { id: string }).id));
    expect(waits).toEqual(expect.arrayContaining(["parse", "confirm", "approve", "checkout"]));
  });

  it("the walkthrough code never calls a mutating endpoint", () => {
    const dir = path.resolve(__dirname, "../../src/components/demo");
    for (const f of ["controller.tsx", "scenes.ts", "stage.tsx", "story-panel.tsx", "launcher.tsx", "spotlight.tsx"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\/api\/(paypal|overrides)|\/(approve|deny|revise|recovery|confirm)["'`]|method:\s*["']POST/);
      expect(src, f).not.toMatch(/\.click\(\)|requestSubmit|dispatchEvent/);
    }
    const ctl = readFileSync(path.join(dir, "controller.tsx"), "utf8");
    expect([...ctl.matchAll(/apiFetch(?:<[^>]*>)?\(\s*[`"']([^`"']+)/g)].map((m) => m[1])).toEqual(["/api/demo/evaluate", "/api/missions/${id}"]);
  });

  it("the timeline is deterministic per scene index, so revisiting never duplicates entries", () => {
    const scenes = SCENES.presentation;
    const a = timelineUpTo(scenes, scenes.length - 1, ctx);
    expect(timelineUpTo(scenes, scenes.length - 1, ctx)).toEqual(a);
  });

  it("matches free-text questions to grounded answers", () => {
    const qs = SCENES.presentation.find((s) => s.id === "policy")!.questions!;
    expect(matchQuestion(qs, "which policy blocked it?")?.q).toBe("Which policy blocked this action?");
    expect(matchQuestion(qs, "zzz")).toBeNull();
    expect(qs.find((q) => q.q.startsWith("Was this a real"))!.a(ctx)).toMatch(/^No\./);
  });
});
