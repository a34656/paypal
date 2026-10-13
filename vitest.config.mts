import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://aegis:aegis_local_dev@localhost:5433/aegis_test?schema=public";

// Inline projects inherit plugins and aliases from this root config.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `server-only` throws outside the React Server bundle; tests import server modules directly.
      "server-only": path.resolve(root, "tests/helpers/empty.ts"),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts"] } },
      { extends: true, test: { name: "components", environment: "jsdom", include: ["tests/components/**/*.test.tsx"], setupFiles: ["tests/helpers/jsdom-setup.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/helpers/integration-global-setup.ts"],
          setupFiles: ["tests/helpers/integration-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: { DATABASE_URL: TEST_DB, NODE_ENV: "test", SESSION_SECRET: "test-session-secret-0123456789-abcdefghijklmnop" },
        },
      },
    ],
  },
});
