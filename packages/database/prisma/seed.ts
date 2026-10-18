import { seedRestaurant } from "./seed-catalog.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { requireSafeDestructiveTarget } from "../production-database-guard.cjs";

const seedDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(seedDir, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(seedDir, "../.env"), override: false, quiet: true });

requireSafeDestructiveTarget("the Prisma seed");

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to run the Prisma seed script.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});


seedRestaurant(prisma)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
