/**
 * Resets all AEGIS demo data in the configured database, then re-seeds the demo catalogue.
 * Refuses to run against a non-local database unless --force is passed.
 * TRUNCATE is used deliberately: the append-only triggers block row-level UPDATE/DELETE.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "postgres"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refusing to reset non-local database host "${host}". Pass --force if you really mean it.`);
  process.exit(1);
}

const TABLES = ["AuditEvent", "Payment", "SimulatedOrder", "Approval", "AgentRun", "MissionProduct", "Product", "Mission", "Policy", "User", "WebhookEvent", "RateLimitBucket"];

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  await client.end();
  console.log("Demo data cleared.");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
