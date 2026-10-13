/** Resets the dedicated test database and applies all migrations (including SQL triggers). */
import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://aegis:aegis_local_dev@localhost:5433/aegis_test?schema=public";
  if (!/aegis_test/.test(url)) throw new Error("Refusing to reset a database whose name is not aegis_test");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
