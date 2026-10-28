import { afterAll, beforeEach } from "vitest";
import { prisma } from "@/server/db";

const TABLES = ["AuditEvent", "PolicyOverrideRequest", "Payment", "SimulatedOrder", "Approval", "AgentRun", "MissionProduct", "Product", "Mission", "Policy", "User", "WebhookEvent", "RateLimitBucket"];

beforeEach(async () => {
  // TRUNCATE does not fire the row-level append-only triggers; UPDATE/DELETE still do.
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
