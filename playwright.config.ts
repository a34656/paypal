import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://aegis:aegis_local_dev@localhost:5433/aegis_e2e?schema=public";

/**
 * E2E runs the production build against an isolated database in DEMO mode.
 * PayPal credentials are explicitly blanked: tests never reach PayPal.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      AEGIS_APP_ORIGIN: `http://localhost:${PORT}`,
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
