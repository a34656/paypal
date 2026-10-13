/**
 * Seeds the DEMO product catalogue (fictional sellers, seeded reference prices).
 * Users, policies and missions are created per demo session at runtime.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEMO_PRODUCTS, DEMO_PROVIDER } from "../src/domain/providers/demo-catalog";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  for (const p of DEMO_PRODUCTS) {
    const { keywords: _k, baselineUnitPriceMinor, providerProductId, ...rest } = p;
    void _k;
    const data = { ...rest, isDemoData: true, metadata: { baselineUnitPriceMinor, baselineSource: "seeded-demo" } };
    await prisma.product.upsert({
      where: { provider_providerProductId: { provider: DEMO_PROVIDER, providerProductId } },
      create: { provider: DEMO_PROVIDER, providerProductId, ...data },
      update: data,
    });
  }
  console.log(`Seeded ${DEMO_PRODUCTS.length} DEMO products (fictional sellers).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
