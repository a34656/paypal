import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { aegisPrisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.aegisPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.aegisPrisma = prisma;
