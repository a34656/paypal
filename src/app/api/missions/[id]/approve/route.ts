import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { approvePurchase } from "@/server/approvals";
import { RATE_LIMITS } from "@/server/ratelimit";
import { minorSchema } from "@/domain/types";

/** Human approval. The client states what it reviewed; the server recomputes everything. */
const body = z.object({ productId: z.string().min(1).max(40), expectedTotalMinor: minorSchema, acknowledge: z.literal(true) });

export const POST = apiRoute<{ id: string }>(
  async ({ req, user, db, params, correlationId }) => {
    const input = await readJson(req, body);
    const approval = await approvePurchase(db, user, params.id, input, correlationId);
    return { approvalId: approval.id, kind: approval.kind, expiresAt: approval.expiresAt, snapshotHash: approval.snapshotHash, policyVersion: approval.policyVersion };
  },
  { rateLimit: RATE_LIMITS.approve },
);
