import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { EnvValidationError, getEnv } from "@/lib/env";

/** Node-only boot check. Next.js only logs errors thrown from register(), so exit explicitly. */
export function validateEnvOrExit() {
  // Happy-eyeballs: Node's default 250 ms per address family makes outbound calls (PayPal,
  // Channel3, Gemini) fail with ETIMEDOUT on networks with slow or broken IPv6.
  setDefaultAutoSelectFamilyAttemptTimeout(2_000);
  try {
    const env = getEnv();
    for (const w of env.warnings) console.warn(`[aegis] WARNING: ${w}`);
    console.info(`[aegis] mode=${env.paypal.configured ? (env.paypal.live ? "LIVE" : "SANDBOX") : "DEMO"} ai=${env.ai.configured ? "gemini" : "deterministic"} products=${env.productProvider}`);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`[aegis] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
