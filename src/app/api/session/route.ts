import { apiRoute } from "@/server/api";
import { currentMode, getEnv } from "@/lib/env";

/** Current demo identity. This is demo identity, not authentication. */
export const GET = apiRoute(async ({ user }) => {
  const env = getEnv();
  return {
    user: { id: user.id, displayName: user.displayName, roles: user.roles },
    mode: currentMode(env),
    paypalConnected: env.paypal.configured,
    aiConnected: env.ai.configured,
    demoAuthNotice: "Demo identity: a signed per-browser session cookie. Not production authentication.",
  };
});
