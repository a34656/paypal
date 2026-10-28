/**
 * The walkthrough script: five chapters, deterministic scene definitions, one list per mode.
 * Presentation scenes never submit a form or call a mutating API. Live scenes type into the real input
 * and then only WAIT for the visitor to take each consequential step themselves.
 */
import { formatMoney } from "@/lib/money";
import { LIVE_WALKTHROUGH_PROMPT, WALKTHROUGH_PROMPT } from "@/domain/demo/walkthrough-scenario";
import type { DemoMode } from "./state";
import type { DemoEvaluation, DemoOffer, DemoQuestion, DemoScene, SceneContext, TimelineEvent } from "./types";

export const CHAPTERS = ["The trust problem", "An agent receives a task", "Risk and policy checks", "Human authorization", "Payment and accountability"] as const;

const money = (minor: number | null | undefined, cur = "USD") => formatMoney(minor ?? null, cur);
const recommended = (e: DemoEvaluation | null): DemoOffer | null => e?.offers.find((o) => o.key === e.recommendedKey) ?? null;
const blocked = (e: DemoEvaluation | null) => e?.offers.filter((o) => o.policy.decision === "BLOCK") ?? [];
const firstBlock = (o: DemoOffer) => o.policy.checks.find((c) => c.result === "BLOCK");
const findings = (o: DemoOffer | null) => o?.policy.checks.filter((c) => c.result !== "PASS") ?? [];
const branch = (ctx: SceneContext) => ctx.decisions["approval-branch"] ?? null;
const ENGINE_NOTE = "Computed just now by VANTA's real risk, optimizer and policy engines against your active policy. The offers are fictional; nothing was saved.";

const LIVE_PATH = /^\/missions\/(?!new$)[^/]+$/;
const liveStatus = (ctx: SceneContext) => ctx.live?.mission.status ?? null;
const AFTER_AGENTS = ["AWAITING_APPROVAL", "READY_FOR_CHECKOUT", "BLOCKED", "FAILED", "DENIED", "EXPIRED", "COMPLETED", "CHECKOUT_IN_PROGRESS", "CAPTURE_PENDING", "HOLD_PLACED"];
const PAYMENT_DONE = ["CAPTURED", "COMPLETED", "AUTHORIZED", "HOLD_PLACED", "FAILED", "CANCELLED", "EXPIRED", "BLOCKED", "REFUNDED"];

const GLOBAL_QUESTIONS: DemoQuestion[] = [
  {
    q: "Was this a real PayPal transaction?",
    keywords: ["real", "paypal", "transaction", "money", "paid", "charged"],
    a: (ctx) =>
      ctx.mode === "presentation"
        ? "No. Presentation mode never creates a PayPal order, captures money or writes to your audit log. The offers are fictional; only the risk, ranking and policy results were computed by VANTA's real engines."
        : ctx.live?.payments.length
          ? `This live mission has ${ctx.live.payments.length} payment record(s); the latest status is ${ctx.live.payments[0]!.status.replace(/_/g, " ").toLowerCase()} (${ctx.live.payments[0]!.provider === "simulated" ? "simulated — PayPal is not configured" : "PayPal Sandbox — test money only"}).`
          : "Not yet. In live mode a payment only exists after you approve the mission and complete checkout yourself. Sandbox uses test money; live payments are refused.",
  },
  {
    q: "What is recorded in the audit trail?",
    keywords: ["audit", "record", "log", "trail", "history"],
    a: () => "Every state change — mission created, confirmed, each agent step, the policy evaluation, approvals or denials, and every payment step — is written as an append-only, hash-chained audit event in the same database transaction as the change itself.",
  },
];

const POLICY_QUESTIONS: DemoQuestion[] = [
  {
    q: "Why was this transaction flagged?",
    keywords: ["why", "flag", "flagged", "approval", "required"],
    a: (ctx) => {
      const o = recommended(ctx.evaluation);
      if (!o) return "The evaluation has not loaded yet.";
      const f = findings(o);
      return f.length ? `${o.title} (${o.seller}) needs a person because: ${f.map((c) => c.detail).join(" ")} ${ENGINE_NOTE}` : "Every check passed, but a human still authorizes checkout.";
    },
  },
  {
    q: "Which policy blocked this action?",
    keywords: ["which", "block", "blocked", "rule", "policy"],
    a: (ctx) => {
      const b = blocked(ctx.evaluation);
      return b.length ? b.map((o) => `${o.seller}: “${firstBlock(o)?.label}” — ${firstBlock(o)?.detail}`).join(" ") : "No offer was blocked in this run.";
    },
  },
];

const APPROVAL_QUESTIONS: DemoQuestion[] = [
  {
    q: "What would happen if the approver denied it?",
    keywords: ["deny", "denied", "reject", "approver"],
    a: () => "The mission ends as DENIED and an approval.denied audit event is recorded. No order can be created for it, and the agent cannot retry the same purchase without a new, explicit approval.",
  },
  {
    q: "Does the walkthrough approve anything for real?",
    keywords: ["walkthrough", "demo", "approve", "automatic", "real"],
    a: (ctx) =>
      ctx.mode === "presentation"
        ? "No. The approve/deny buttons here only choose which branch of the story to show. No approval API is called and no approval record exists."
        : "No. In live mode the walkthrough stops and waits for you to use the real approval panel. The narration never counts as authorization.",
  },
];

/* ---------------------------------------------------------------- presentation ---------------- */

const chapter1: DemoScene[] = [
  {
    id: "trust-core",
    chapter: 1,
    title: "Meet the Trust Core",
    narration: "AI agents can research, compare, and act at machine speed. But when an agent can initiate a financial action, speed alone is not enough. VANTA introduces a trust layer between an agent's intention and its execution.",
    why: "Agents are useful precisely because they act without asking. Payments are the one place where that has to stop.",
    agents: [],
    actions: [{ kind: "navigate", href: "/" }, { kind: "stage", view: null }, { kind: "spotlight", target: "trust-core", caption: "The Trust Core: every agent action passes through it before money can move." }, { kind: "hold" }],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "governance-workflow",
    chapter: 1,
    title: "The governance workflow",
    narration: "Six stages sit between intent and payment: discover, assess, optimize, govern, authorize, transact. Agents own the first three. Deterministic policy and people own the rest.",
    why: "Separating who proposes from who decides is what makes an autonomous system auditable.",
    agents: ["scout", "risk", "optimizer", "policy", "human", "payment"],
    actions: [{ kind: "navigate", href: "/" }, { kind: "spotlight", target: "governance-workflow", caption: "Agents propose. Policy decides. People authorize. Payment comes last." }, { kind: "hold" }],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "console",
    chapter: 1,
    title: "The command center",
    narration: "This is the operator's console. Missions, policies, the audit log and every transaction live here — the same screens a real team would use.",
    why: "Governance has to be inspectable by people, not just enforced by code.",
    agents: [],
    actions: [{ kind: "navigate", href: "/command-center" }, { kind: "spotlight", target: "app-navigation", caption: "Operate, govern and review: every area the walkthrough visits is one click away." }, { kind: "hold" }],
    questions: GLOBAL_QUESTIONS,
  },
];

const presentation: DemoScene[] = [
  ...chapter1,
  {
    id: "task",
    chapter: 2,
    title: "An agent receives a task",
    narration: "Let's give an agent a task: find an appropriate product and prepare a purchase within a defined budget. Watch how the request moves through the trust layer.",
    why: "The request is plain language. Before anything runs, VANTA turns it into explicit constraints a person confirms.",
    agents: ["scout"],
    actions: [
      { kind: "navigate", href: "/missions/new?scenario=walkthrough" },
      { kind: "spotlight", target: "purchase-prompt", caption: "Example task (fictional company and product)." },
      { kind: "type", input: "purchase-prompt", text: WALKTHROUGH_PROMPT },
      { kind: "spotlight", target: "parse-mission", caption: "Presentation mode stops here: it never submits. Nothing is created." },
      { kind: "hold" },
    ],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "scout",
    chapter: 2,
    title: "Scout and Optimizer",
    narration: (ctx) => {
      const e = ctx.evaluation;
      const r = recommended(e);
      if (!e) return "Scout gathers candidate offers, and Optimizer ranks the ones that pass hard gates.";
      return `Scout found ${e.offers.length} fictional offers. Optimizer ranked the ${e.offers.filter((o) => o.optimizer.eligible).length} that passed its hard gates and recommends ${r ? `${r.title} from ${r.seller} at ${money(r.amounts?.totalMinor)} all-in` : "none of them"}.`;
    },
    why: (ctx) => recommended(ctx.evaluation)?.optimizer.explanation ?? ENGINE_NOTE,
    agents: ["scout", "optimizer"],
    actions: [{ kind: "clear-spotlight" }, { kind: "evaluate" }, { kind: "stage", view: "offers" }, { kind: "hold" }],
    timeline: (ctx) => {
      const e = ctx.evaluation;
      if (!e) return [];
      const r = recommended(e);
      return [
        { id: "scout", agent: "scout", status: "completed", label: `${e.offers.length} fictional offers discovered`, source: "simulated" },
        ...e.offers.filter((o) => !o.optimizer.eligible).map((o): TimelineEvent => ({ id: `opt-${o.key}`, agent: "optimizer", status: "flagged", label: `${o.seller}: ${o.optimizer.ineligibleReasons[0] ?? "not eligible"}`, source: "engine" })),
        { id: "opt", agent: "optimizer", status: "completed", label: r ? `Ranked #1: ${r.seller}` : "No eligible offer", source: "engine" },
      ];
    },
    questions: [
      { q: "Why was this offer selected?", keywords: ["why", "select", "selected", "chose", "recommend", "best"], a: (ctx) => `${recommended(ctx.evaluation)?.optimizer.explanation ?? "No offer was selected."} ${ENGINE_NOTE}` },
      ...GLOBAL_QUESTIONS,
    ],
  },
  {
    id: "risk",
    chapter: 3,
    title: "Risk reads the evidence",
    narration: "Before money moves, VANTA evaluates the proposed action against its configured policies. The goal is not merely to detect risk; it is to make the reason behind each decision understandable.",
    why: "Risk only scores structured evidence. Missing evidence counts against an offer, and text in a listing can never lower a score.",
    agents: ["risk"],
    actions: [{ kind: "evaluate" }, { kind: "stage", view: "risk" }, { kind: "hold" }],
    timeline: (ctx) =>
      (ctx.evaluation?.offers ?? []).map((o): TimelineEvent => ({
        id: `risk-${o.key}`,
        agent: "risk",
        status: o.risk.injectionSignals.length || o.risk.score > 35 ? "flagged" : "completed",
        label: `${o.seller}: risk ${o.risk.score} (${o.risk.level.toLowerCase()})${o.risk.injectionSignals.length ? " · instructions found in listing" : ""}`,
        source: "engine",
      })),
    questions: [
      { q: "Is the risk score a model prediction?", keywords: ["score", "model", "prediction", "ai", "risk"], a: () => "No. It is a deterministic, rule-based score from VANTA's risk engine (0 = lowest risk). No machine-learning model and no AI confidence is involved. Here it was computed on fictional offers." },
      ...POLICY_QUESTIONS,
      ...GLOBAL_QUESTIONS,
    ],
  },
  {
    id: "policy",
    chapter: 3,
    title: "Policy Guard decides",
    narration: (ctx) => {
      const e = ctx.evaluation;
      if (!e) return "Policy Guard checks every offer against your rules. The most restrictive result wins.";
      const b = blocked(e);
      return `Policy Guard ran every check from policy version ${e.policy.version}. ${b.length} offer${b.length === 1 ? " was" : "s were"} blocked outright${b.length ? ` — ${b.map((o) => `${(o.seller ?? "unknown seller").replace(" (fictional)", "")} failed “${firstBlock(o)?.label.toLowerCase()}”`).join("; ")}` : ""}. The recommended offer needs a human: ${e.decision.replace(/_/g, " ").toLowerCase()}.`;
    },
    why: "Policy is code, not judgment: the same inputs always give the same decision, with a readable reason for every check.",
    agents: ["policy"],
    actions: [{ kind: "evaluate" }, { kind: "stage", view: "policy" }, { kind: "hold" }],
    timeline: (ctx) =>
      (ctx.evaluation?.offers ?? []).map((o): TimelineEvent => ({
        id: `pol-${o.key}`,
        agent: "policy",
        status: o.policy.decision === "BLOCK" ? "blocked" : o.policy.decision === "REQUIRE_APPROVAL" ? "awaiting_authorization" : "completed",
        label: `${o.seller}: ${o.policy.decision.replace(/_/g, " ").toLowerCase()}`,
        source: "engine",
      })),
    questions: [...POLICY_QUESTIONS, ...GLOBAL_QUESTIONS],
  },
  {
    id: "policy-config",
    chapter: 3,
    title: "Where the rules live",
    narration: "Those rules are not hidden in a prompt. They are a versioned policy your team owns. A blocked offer stays blocked; the agent's options are to pick a different eligible offer or ask a person to revise the mission.",
    why: "If an agent could argue its way past a rule, it would not be a rule.",
    agents: ["policy"],
    actions: [{ kind: "stage", view: null }, { kind: "navigate", href: "/policies" }, { kind: "spotlight", target: "policy-config", caption: "Your active policy. Every change creates a new immutable version." }, { kind: "hold" }],
    questions: [...POLICY_QUESTIONS, ...GLOBAL_QUESTIONS],
  },
  {
    id: "approval-request",
    chapter: 4,
    title: "An approval request",
    narration: "Some actions require human authorization. An agent may prepare a transaction, but it must not bypass the authorization rules governing that transaction.",
    why: (ctx) => {
      const f = findings(recommended(ctx.evaluation));
      return f.length ? `Required here because: ${f.map((c) => c.label.toLowerCase()).join(", ")}.` : "A person always authorizes checkout, even when every check passes.";
    },
    agents: ["human"],
    actions: [{ kind: "clear-spotlight" }, { kind: "evaluate" }, { kind: "stage", view: "approval" }, { kind: "hold" }],
    timeline: (ctx) => [{ id: "human-req", agent: "human", status: "awaiting_authorization", label: `Approval requested for ${money(recommended(ctx.evaluation)?.amounts?.totalMinor)}`, source: "simulated" }],
    questions: [...APPROVAL_QUESTIONS, ...POLICY_QUESTIONS, ...GLOBAL_QUESTIONS],
  },
  {
    id: "approval-branch",
    chapter: 4,
    title: "Approve or deny (simulation)",
    narration: (ctx) =>
      branch(ctx) === "deny"
        ? "You chose the denial branch. In the real system the mission would end as DENIED, and no order could be created for it."
        : branch(ctx) === "approve"
          ? "You chose the approval branch. In the real system this would bind an approval to the exact snapshot — items, total, policy version — with an expiry."
          : "Choose a branch to see what happens next. This is a simulation: no approval is recorded and nothing is authorized.",
    why: "The walkthrough's narration can never count as authorization. Only a person using the real approval panel can approve a real mission.",
    agents: ["human"],
    actions: [
      { kind: "evaluate" },
      { kind: "stage", view: "approval" },
      {
        kind: "choice",
        id: "approval-branch",
        prompt: "Which branch should the demo show? (Simulation — nothing is approved.)",
        options: [
          { id: "approve", label: "Simulate approval", description: "Show what happens after a person approves." },
          { id: "deny", label: "Simulate denial", description: "Show what happens after a person denies." },
        ],
      },
      { kind: "hold" },
    ],
    timeline: (ctx) =>
      branch(ctx)
        ? [{ id: "human-dec", agent: "human", status: branch(ctx) === "approve" ? "completed" : "blocked", label: branch(ctx) === "approve" ? "Approval (simulated — not recorded)" : "Denial (simulated — not recorded)", source: "simulated" }]
        : [],
    questions: [...APPROVAL_QUESTIONS, ...GLOBAL_QUESTIONS],
  },
  {
    id: "payment",
    chapter: 5,
    title: "Payment execution",
    narration: (ctx) =>
      branch(ctx) === "deny"
        ? "Because the approval was denied, the payment workflow never starts. No PayPal order exists."
        : "Once the required authorization conditions are satisfied, the payment workflow can proceed: an order created server-side, buyer approval in PayPal, then verification and capture. In this presentation none of it was executed — no order was created and no payment was made.",
    why: "A payment state is only ever what PayPal reports back to the server. An animation finishing proves nothing.",
    agents: ["payment"],
    actions: [{ kind: "evaluate" }, { kind: "stage", view: "payment" }, { kind: "hold" }],
    timeline: (ctx) => [
      branch(ctx) === "deny"
        ? { id: "pay", agent: "payment", status: "blocked", label: "Not started — approval denied", source: "simulated" }
        : { id: "pay", agent: "payment", status: "pending", label: "Not executed — presentation mode, no payment made", source: "simulated" },
    ],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "audit",
    chapter: 5,
    title: "Accountability",
    narration: "VANTA records the outcome so the decision can be inspected later. This is your real audit log — the walkthrough wrote nothing to it. The panel shows the events this mission would have produced.",
    why: "Each event is hash-chained to the previous one, so the history cannot be edited quietly.",
    agents: [],
    actions: [{ kind: "stage", view: null }, { kind: "navigate", href: "/audit" }, { kind: "spotlight", target: "audit-log", caption: "Your real, append-only audit log." }, { kind: "stage", view: "audit" }, { kind: "hold" }],
    questions: GLOBAL_QUESTIONS,
  },
];

/* ---------------------------------------------------------------- live ------------------------ */

const live: DemoScene[] = [
  ...chapter1,
  {
    id: "live-task",
    chapter: 2,
    title: "Give the agent a real task",
    narration: "Let's give an agent a task: find an appropriate product and prepare a purchase within a defined budget. This is a live mission — VANTA's real backend will process it.",
    why: "You stay in control of every consequential step. The walkthrough types; you decide whether to submit.",
    agents: ["scout"],
    actions: [
      { kind: "navigate", href: "/missions/new?scenario=walkthrough" },
      { kind: "spotlight", target: "purchase-prompt", caption: "Example task. Edit it if you like." },
      { kind: "type", input: "purchase-prompt", text: LIVE_WALKTHROUGH_PROMPT },
      { kind: "await-human", id: "parse", prompt: "Click “Parse mission” yourself to create a real mission in your session.", target: "parse-mission", until: (ctx) => LIVE_PATH.test(ctx.pathname) },
    ],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "live-confirm",
    chapter: 2,
    title: "Confirm the constraints",
    narration: "The parser only proposes. Review the structured constraints and confirm them — only then do the agents run.",
    why: "Raw text never reaches the policy engine; confirmed constraints do.",
    agents: ["scout"],
    actions: [
      { kind: "navigate", href: (ctx) => (ctx.liveMissionId ? `/missions/${ctx.liveMissionId}` : null) },
      { kind: "live-refresh" },
      { kind: "await-human", id: "confirm", prompt: "Review and confirm the mission constraints.", target: "confirm-mission", until: (ctx) => !!liveStatus(ctx) && !["CREATED", "PARSED"].includes(liveStatus(ctx)!) },
    ],
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "live-agents",
    chapter: 3,
    title: "Agents and policy at work",
    narration: (ctx) =>
      ctx.live && AFTER_AGENTS.includes(ctx.live.mission.status)
        ? `The agents finished. Policy decision: ${(ctx.live.mission.decision ?? ctx.live.mission.status).replace(/_/g, " ").toLowerCase()}. Every offer below carries its own risk score and policy result.`
        : "Scout, Risk, Optimizer and Policy Guard are running on the server now. This waits for their real results.",
    why: "Every status here comes from the real mission record, not from the walkthrough.",
    agents: ["scout", "risk", "optimizer", "policy"],
    actions: [
      { kind: "live-refresh" },
      { kind: "await-human", id: "agents", prompt: "Waiting for the agents to finish (no action needed).", until: (ctx) => !!liveStatus(ctx) && AFTER_AGENTS.includes(liveStatus(ctx)!) },
      { kind: "spotlight", target: "offer-comparison", caption: "Real offers, real risk scores, real policy decisions.", optional: true },
      { kind: "hold" },
    ],
    timeline: (ctx) => (ctx.live?.agentRuns ?? []).map((r, i) => ({ id: `run-${i}`, agent: agentForStep(r.step), status: r.status === "COMPLETED" ? "completed" : r.status === "FAILED" ? "failed" : "running", label: `${r.step.toLowerCase()}: ${r.status.toLowerCase()}`, source: "live" })),
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "live-approval",
    chapter: 4,
    title: "Your authorization",
    narration: (ctx) =>
      liveStatus(ctx) === "BLOCKED"
        ? "Policy blocked every offer, so there is nothing to authorize. The mission page explains why and how to revise it."
        : "Some actions require human authorization. The agent prepared this transaction, but only you can approve or deny it — the walkthrough will not.",
    why: "The approval binds to the exact snapshot, the policy version and an expiry. Change any of them and it no longer counts.",
    agents: ["human"],
    actions: [
      { kind: "live-refresh" },
      {
        kind: "await-human",
        id: "approve",
        prompt: "Use the real approval panel to approve or deny — or skip this step.",
        target: "approval-panel",
        until: (ctx) => liveStatus(ctx) === "BLOCKED" || liveStatus(ctx) === "DENIED" || !!ctx.live?.approvals.some((a) => a.status === "ACTIVE") || (ctx.live?.payments.length ?? 0) > 0,
      },
      { kind: "hold" },
    ],
    timeline: (ctx) => {
      const s = liveStatus(ctx);
      if (s === "DENIED") return [{ id: "h", agent: "human", status: "blocked", label: "You denied the mission", source: "live" }];
      if (ctx.live?.approvals.some((a) => a.status === "ACTIVE" || a.status === "CONSUMED")) return [{ id: "h", agent: "human", status: "completed", label: "You approved the exact snapshot", source: "live" }];
      return s === "AWAITING_APPROVAL" ? [{ id: "h", agent: "human", status: "awaiting_authorization", label: "Awaiting your decision", source: "live" }] : [];
    },
    questions: [...APPROVAL_QUESTIONS, ...GLOBAL_QUESTIONS],
  },
  {
    id: "live-payment",
    chapter: 5,
    title: "Checkout",
    narration: (ctx) => {
      const p = ctx.live?.payments[0];
      if (!p) return "Once the required authorization conditions are satisfied, the payment workflow can proceed. Start checkout yourself in the panel below, or skip.";
      return `Payment status reported by the server: ${p.status.replace(/_/g, " ").toLowerCase()} for ${money(p.amountMinor, p.currency)} (${p.provider === "simulated" ? "simulated — PayPal is not configured" : "PayPal Sandbox, test money"}).`;
    },
    why: "The server verifies the PayPal order against the approved amount, currency and IDs before any capture or hold.",
    agents: ["payment"],
    actions: [
      { kind: "live-refresh" },
      { kind: "await-human", id: "checkout", prompt: "Complete checkout in the real panel (PayPal Sandbox), or skip.", target: "checkout-panel", until: (ctx) => !!ctx.live?.payments.some((p) => PAYMENT_DONE.includes(p.status)) || ["DENIED", "BLOCKED"].includes(liveStatus(ctx) ?? "") },
      { kind: "hold" },
    ],
    timeline: (ctx) => (ctx.live?.payments ?? []).slice(0, 1).map((p) => ({ id: "pay", agent: "payment", status: PAYMENT_DONE.includes(p.status) ? (p.status === "FAILED" ? "failed" : "completed") : "running", label: `${p.status.replace(/_/g, " ").toLowerCase()} · ${money(p.amountMinor, p.currency)}`, source: "live" })),
    questions: GLOBAL_QUESTIONS,
  },
  {
    id: "live-audit",
    chapter: 5,
    title: "Accountability",
    narration: "VANTA records the outcome so the decision can be inspected later. These are the real audit events for this mission, in order.",
    why: "Each event is hash-chained to the previous one, so the history cannot be edited quietly.",
    agents: [],
    actions: [{ kind: "navigate", href: (ctx) => (ctx.liveMissionId ? `/audit?missionId=${encodeURIComponent(ctx.liveMissionId)}` : "/audit") }, { kind: "spotlight", target: "audit-log", caption: "Real audit events for your live mission." }, { kind: "hold" }],
    questions: GLOBAL_QUESTIONS,
  },
];

function agentForStep(step: string): TimelineEvent["agent"] {
  const s = step.toUpperCase();
  if (s.includes("SCOUT")) return "scout";
  if (s.includes("RISK")) return "risk";
  if (s.includes("OPTIM")) return "optimizer";
  if (s.includes("POLICY")) return "policy";
  return "scout";
}

export const SCENES: Record<DemoMode, DemoScene[]> = { presentation, live };

export const resolve = <T>(v: T | ((ctx: SceneContext) => T), ctx: SceneContext): T => (typeof v === "function" ? (v as (c: SceneContext) => T)(ctx) : v);

/** Timeline = everything the scenes up to and including `index` contributed. Deterministic, so revisiting never duplicates. */
export function timelineUpTo(scenes: DemoScene[], index: number, ctx: SceneContext): TimelineEvent[] {
  return scenes.slice(0, index + 1).flatMap((s) => s.timeline?.(ctx) ?? []);
}

/** Best-matching canned question for free text; null when nothing overlaps. */
export function matchQuestion(questions: DemoQuestion[], text: string): DemoQuestion | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  let best: DemoQuestion | null = null;
  let bestScore = 0;
  for (const q of questions) {
    const score = words.filter((w) => q.keywords.some((k) => k.startsWith(w) || w.startsWith(k))).length;
    if (score > bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}
