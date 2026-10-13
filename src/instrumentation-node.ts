import { EnvValidationError, getEnv } from "@/lib/env";

/** Node-only boot check. Next.js only logs errors thrown from register(), so exit explicitly. */
export function validateEnvOrExit() {
  try {
    const env = getEnv();
    for (const w of env.warnings) console.warn(`[aegis] WARNING: ${w}`);
    console.info(`[aegis] mode=${env.paypal.configured ? (env.paypal.live ? "LIVE" : "SANDBOX") : "DEMO"} ai=${env.ai.configured ? "anthropic" : "deterministic"}`);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`[aegis] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
