/**
 * Boot-time environment validation. Imported by instrumentation.ts so the server refuses
 * to start on an unsafe configuration. Pure `parseEnv` is exported for tests.
 *
 * Sandbox by default. A live PayPal host is refused unless BOTH AEGIS_ALLOW_LIVE=true and
 * AEGIS_ENVIRONMENT=production are set — and even then AEGIS never pays automatically:
 * every capture still needs a human approval and PayPal buyer approval.
 */
import { z } from "zod";

export const PAYPAL_SANDBOX_HOST = "https://api-m.sandbox.paypal.com";
export const PAYPAL_LIVE_HOST = "https://api-m.paypal.com";
const PAYPAL_HOST_ALLOWLIST = [PAYPAL_SANDBOX_HOST, PAYPAL_LIVE_HOST] as const;

const optionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL)"),
  SESSION_SECRET: optionalNonEmpty,
  AEGIS_APP_ORIGIN: optionalNonEmpty,
  AEGIS_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  AEGIS_ALLOW_LIVE: z.enum(["true", "false"]).default("false"),

  PAYPAL_CLIENT_ID: optionalNonEmpty,
  PAYPAL_CLIENT_SECRET: optionalNonEmpty,
  PAYPAL_BASE_URL: z.string().trim().default(PAYPAL_SANDBOX_HOST),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: optionalNonEmpty,
  PAYPAL_WEBHOOK_ID: optionalNonEmpty,
  PAYPAL_MERCHANT_ID: optionalNonEmpty,

  ANTHROPIC_API_KEY: optionalNonEmpty,
  AI_MODEL: optionalNonEmpty,

  CHANNEL3_API_KEY: optionalNonEmpty,
});

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  sessionSecret: string;
  appOrigin: string | null;
  environment: "development" | "staging" | "production";
  paypal: {
    configured: boolean;
    clientId: string | null;
    clientSecret: string | null;
    publicClientId: string | null;
    baseUrl: string;
    live: boolean;
    webhookId: string | null;
    merchantId: string | null;
  };
  ai: { configured: boolean; apiKey: string | null; model: string | null };
  channel3: { configured: boolean; apiKey: string | null };
  warnings: string[];
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`AEGIS refused to start — invalid environment:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789abcdef";

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const e = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];

  const baseUrl = e.PAYPAL_BASE_URL.replace(/\/+$/, "");
  if (!(PAYPAL_HOST_ALLOWLIST as readonly string[]).includes(baseUrl)) {
    problems.push(`PAYPAL_BASE_URL "${baseUrl}" is not on the allowlist (${PAYPAL_HOST_ALLOWLIST.join(", ")}).`);
  }
  const live = baseUrl === PAYPAL_LIVE_HOST;
  if (live && !(e.AEGIS_ALLOW_LIVE === "true" && e.AEGIS_ENVIRONMENT === "production")) {
    problems.push("PAYPAL_BASE_URL points at LIVE PayPal. Refusing: requires AEGIS_ALLOW_LIVE=true AND AEGIS_ENVIRONMENT=production.");
  }

  let sessionSecret = e.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    if (e.NODE_ENV === "production") {
      problems.push("SESSION_SECRET must be at least 32 characters in production.");
    } else {
      warnings.push("SESSION_SECRET missing or short; using the development default. Never deploy like this.");
    }
    sessionSecret = sessionSecret && sessionSecret.length >= 32 ? sessionSecret : DEV_SESSION_SECRET;
  } else if (e.NODE_ENV === "production" && sessionSecret === DEV_SESSION_SECRET) {
    problems.push("SESSION_SECRET is the development default. Set a unique secret in production.");
  }

  const hasId = !!e.PAYPAL_CLIENT_ID;
  const hasSecret = !!e.PAYPAL_CLIENT_SECRET;
  if (hasId !== hasSecret) {
    warnings.push("Only one of PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET is set. PayPal stays disconnected (demo mode).");
  }
  const configured = hasId && hasSecret;
  if (configured && !e.NEXT_PUBLIC_PAYPAL_CLIENT_ID) {
    warnings.push("NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set: the PayPal checkout button cannot render.");
  }
  if (configured && e.NEXT_PUBLIC_PAYPAL_CLIENT_ID && e.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== e.PAYPAL_CLIENT_ID) {
    warnings.push(
      "!!! NEXT_PUBLIC_PAYPAL_CLIENT_ID differs from PAYPAL_CLIENT_ID. They must belong to the same PayPal app, otherwise the buyer approves an order the server cannot see. !!!",
    );
  }
  if (configured && !e.PAYPAL_MERCHANT_ID) {
    warnings.push("PAYPAL_MERCHANT_ID not set: the payee merchant check at capture is skipped (documented limitation).");
  }

  if (problems.length > 0) throw new EnvValidationError(problems);

  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    sessionSecret,
    appOrigin: e.AEGIS_APP_ORIGIN ?? null,
    environment: e.AEGIS_ENVIRONMENT,
    paypal: {
      configured,
      clientId: e.PAYPAL_CLIENT_ID ?? null,
      clientSecret: e.PAYPAL_CLIENT_SECRET ?? null,
      publicClientId: e.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? null,
      baseUrl,
      live,
      webhookId: e.PAYPAL_WEBHOOK_ID ?? null,
      merchantId: e.PAYPAL_MERCHANT_ID ?? null,
    },
    ai: { configured: !!e.ANTHROPIC_API_KEY && !!e.AI_MODEL, apiKey: e.ANTHROPIC_API_KEY ?? null, model: e.AI_MODEL ?? null },
    channel3: { configured: !!e.CHANNEL3_API_KEY, apiKey: e.CHANNEL3_API_KEY ?? null },
    warnings,
  };
}

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test hook. */
export function resetEnvCache(): void {
  cached = null;
}

/** Mode for newly created records. LIVE is never selected automatically by this MVP. */
export function currentMode(env: AppEnv = getEnv()): "DEMO" | "SANDBOX" | "LIVE" {
  if (!env.paypal.configured) return "DEMO";
  return env.paypal.live ? "LIVE" : "SANDBOX";
}
