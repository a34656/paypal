import { apiRoute } from "@/server/api";
import { currentMode, getEnv } from "@/lib/env";

/** Public checkout configuration. Never includes secrets. */
export const GET = apiRoute(async () => {
  const env = getEnv();
  return {
    mode: currentMode(env),
    paypalConnected: env.paypal.configured,
    publicClientId: env.paypal.configured ? env.paypal.publicClientId : null,
    clientIdMismatch: env.paypal.configured && !!env.paypal.publicClientId && env.paypal.publicClientId !== env.paypal.clientId,
  };
});
