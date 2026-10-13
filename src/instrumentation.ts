/** Boot-time validation: refuse to start on an unsafe environment (e.g. live PayPal host). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrExit } = await import("./instrumentation-node");
    validateEnvOrExit();
  }
}
