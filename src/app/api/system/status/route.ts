import { apiRoute } from "@/server/api";
import { currentMode, getEnv } from "@/lib/env";
import { verifyAuditChain } from "@/server/audit";

/** Integration status for Settings. Never returns secret values. */
export const GET = apiRoute(async ({ db }) => {
  const env = getEnv();
  let database: { ok: boolean; detail: string };
  try {
    await db.$queryRaw`SELECT 1`;
    database = { ok: true, detail: "PostgreSQL reachable" };
  } catch {
    database = { ok: false, detail: "Database unreachable" };
  }
  const chain = await verifyAuditChain(db);
  const mask = (v: string | null) => (v ? `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)` : null);
  return {
    mode: currentMode(env),
    environment: env.environment,
    nodeEnv: env.nodeEnv,
    database,
    auditChain: chain,
    paypal: {
      connected: env.paypal.configured,
      baseUrl: env.paypal.baseUrl,
      live: env.paypal.live,
      clientId: mask(env.paypal.clientId),
      publicClientIdMatches: env.paypal.publicClientId ? env.paypal.publicClientId === env.paypal.clientId : null,
      webhookConfigured: !!env.paypal.webhookId,
      merchantIdConfigured: !!env.paypal.merchantId,
    },
    ai: { connected: env.ai.configured, model: env.ai.model, fallback: "deterministic parser + structured manual form" },
    productProvider: {
      active: "demo",
      channel3: env.channel3.configured ? "Key present, but the Channel3 adapter is not implemented (no verified API access). Demo provider remains active." : "Not connected",
    },
    flags: {
      webhooks: !!env.paypal.webhookId && env.paypal.configured,
      llmExplanations: env.ai.configured,
      liveRefused: !env.paypal.live,
    },
    warnings: env.warnings,
  };
});
