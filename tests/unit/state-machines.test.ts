import { describe, expect, it } from "vitest";
import {
  assertPaymentTransition,
  assertWorkflowTransition,
  canTransitionPayment,
  canTransitionWorkflow,
  deriveDisplayStatus,
  IllegalTransitionError,
  PAYMENT_TRANSITIONS,
  WORKFLOW_TERMINAL,
  WORKFLOW_TRANSITIONS,
} from "@/domain/state/machines";
import type { PaymentStatus, WorkflowStatus } from "@/generated/prisma/enums";

const WF = Object.keys(WORKFLOW_TRANSITIONS) as WorkflowStatus[];
const PAY = Object.keys(PAYMENT_TRANSITIONS) as PaymentStatus[];

describe("workflow state machine", () => {
  it("accepts every legal transition and rejects every other pair", () => {
    for (const from of WF)
      for (const to of WF) {
        const legal = WORKFLOW_TRANSITIONS[from].includes(to);
        expect(canTransitionWorkflow(from, to)).toBe(legal);
        if (legal) expect(() => assertWorkflowTransition(from, to)).not.toThrow();
        else expect(() => assertWorkflowTransition(from, to)).toThrow(IllegalTransitionError);
      }
  });

  it("terminal states have no outgoing edges (monotonic)", () => {
    for (const t of WORKFLOW_TERMINAL) expect(WORKFLOW_TRANSITIONS[t]).toEqual([]);
  });

  it("follows the documented happy path", () => {
    const path: WorkflowStatus[] = ["CREATED", "PARSED", "CONFIRMED", "SCOUTING", "SCOUTED", "RISK_ANALYSIS", "OPTIMIZING", "POLICY_EVALUATION", "AWAITING_APPROVAL", "READY_FOR_CHECKOUT", "COMPLETED"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransitionWorkflow(path[i], path[i + 1])).toBe(true);
  });

  it("cannot skip confirmation or policy evaluation", () => {
    expect(canTransitionWorkflow("PARSED", "SCOUTING")).toBe(false);
    expect(canTransitionWorkflow("OPTIMIZING", "READY_FOR_CHECKOUT")).toBe(false);
    expect(canTransitionWorkflow("BLOCKED", "READY_FOR_CHECKOUT")).toBe(false);
  });
});

describe("payment state machine", () => {
  it("accepts every legal transition and rejects every other pair", () => {
    for (const from of PAY)
      for (const to of PAY) {
        const legal = PAYMENT_TRANSITIONS[from].includes(to);
        expect(canTransitionPayment(from, to)).toBe(legal);
        if (!legal) expect(() => assertPaymentTransition(from, to)).toThrow(IllegalTransitionError);
      }
  });

  it("a late webhook can never regress a terminal or captured payment", () => {
    for (const to of ["CAPTURE_PENDING", "CHECKOUT_PENDING", "APPROVED", "FAILED"] as PaymentStatus[]) {
      expect(canTransitionPayment("CAPTURED", to)).toBe(false);
      expect(canTransitionPayment("REFUNDED", to)).toBe(false);
    }
    expect(canTransitionPayment("DISPUTED", "CAPTURED")).toBe(false);
    for (const t of ["FAILED", "CANCELLED", "BLOCKED", "EXPIRED", "REFUNDED"] as PaymentStatus[]) expect(PAYMENT_TRANSITIONS[t]).toEqual([]);
  });

  it("capture only from CAPTURE_PENDING (no capture without the CAS step)", () => {
    for (const from of PAY) if (from !== "CAPTURE_PENDING" && from !== "CAPTURE_PROVIDER_PENDING" && from !== "DISPUTED") expect(canTransitionPayment(from, "CAPTURED")).toBe(false);
  });
});

describe("derived display status", () => {
  it("derives from workflow + payment with no duplicated names", () => {
    expect(deriveDisplayStatus("PARSED", null)).toBe("AWAITING_CONFIRMATION");
    expect(deriveDisplayStatus("RISK_ANALYSIS", null)).toBe("RUNNING");
    expect(deriveDisplayStatus("READY_FOR_CHECKOUT", "CHECKOUT_PENDING")).toBe("CHECKOUT_IN_PROGRESS");
    expect(deriveDisplayStatus("READY_FOR_CHECKOUT", "CAPTURE_PROVIDER_PENDING")).toBe("CAPTURE_PENDING");
    expect(deriveDisplayStatus("COMPLETED", "CAPTURED")).toBe("COMPLETED");
    expect(deriveDisplayStatus("COMPLETED", "REFUNDED")).toBe("REFUNDED");
    expect(deriveDisplayStatus("BLOCKED", null)).toBe("BLOCKED");
  });
});
