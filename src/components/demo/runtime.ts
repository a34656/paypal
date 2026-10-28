/**
 * Walkthrough runtime primitives. Framework-free so they can be unit-tested.
 *
 * Every scripted wait goes through `sleep`, which only counts time while the gate is open and rejects
 * with DemoAbort as soon as the run's AbortSignal fires. Pausing therefore suspends a scene in place
 * (no restart, no duplicated actions); skipping, exiting or unmounting aborts it.
 */

export class DemoAbort extends Error {
  constructor() {
    super("Walkthrough step cancelled");
    this.name = "DemoAbort";
  }
}

export const isAbort = (e: unknown): e is DemoAbort => e instanceof DemoAbort;

/** Open = running. Closed = paused; waiters resume when it reopens. */
export class PauseGate {
  private paused = false;
  private waiters = new Set<() => void>();

  get isPaused() {
    return this.paused;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) {
      const ws = [...this.waiters];
      this.waiters.clear();
      ws.forEach((w) => w());
    }
  }

  /** Resolves immediately while open; otherwise when reopened. Rejects on abort. */
  wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DemoAbort());
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiters.delete(done);
        reject(new DemoAbort());
      };
      this.waiters.add(done);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Pausable, abortable delay. Time spent paused does not count. */
export async function sleep(ms: number, gate: PauseGate, signal: AbortSignal): Promise<void> {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    await gate.wait(signal);
    const slice = Math.min(remaining, 100);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, slice);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DemoAbort());
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
    if (!gate.isPaused) remaining -= slice;
  }
  if (signal.aborted) throw new DemoAbort();
}

export interface TypeOptions {
  gate: PauseGate;
  signal: AbortSignal;
  /** Milliseconds per character. */
  delay?: number;
  /** Reduced motion or "complete now": write the whole value in one update. */
  instant?: boolean;
}

/**
 * Types `text` through the input's own state setter, one character per update, so the visible value and
 * the controlled React state never diverge. Starts from empty, which makes a replayed scene idempotent.
 */
export async function typeInto(text: string, set: (value: string) => void, { gate, signal, delay = 28, instant = false }: TypeOptions): Promise<void> {
  if (signal.aborted) throw new DemoAbort();
  if (instant) {
    set(text);
    return;
  }
  set("");
  for (let i = 1; i <= text.length; i++) {
    await sleep(text[i - 1] === " " ? delay * 0.6 : delay, gate, signal);
    set(text.slice(0, i));
  }
}

/** Polls `check` (pausable, abortable) until it returns true. */
export async function waitUntil(check: () => boolean | Promise<boolean>, gate: PauseGate, signal: AbortSignal, intervalMs = 250, timeoutMs = Infinity): Promise<boolean> {
  let waited = 0;
  while (waited <= timeoutMs) {
    await gate.wait(signal);
    if (await check()) return true;
    await sleep(intervalMs, gate, signal);
    waited += intervalMs;
  }
  return false;
}

/** Reading time for narration: ~55 ms per character, clamped. */
export const readingTime = (text: string, reduced: boolean) => Math.min(reduced ? 7000 : 9000, Math.max(2600, text.length * 55));
