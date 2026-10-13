import { execSync } from "node:child_process";
import pg from "pg";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://aegis:aegis_local_dev@localhost:5433/aegis_e2e?schema=public";
  if (!/aegis_e2e/.test(url)) throw new Error("Refusing to reset a database whose name is not aegis_e2e");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await c.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
