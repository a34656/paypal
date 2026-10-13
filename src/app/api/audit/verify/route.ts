import { apiRoute } from "@/server/api";
import { verifyAuditChain } from "@/server/audit";

export const GET = apiRoute(async ({ db }) => verifyAuditChain(db));
