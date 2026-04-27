import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const dir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(dir, "../../../.env"), quiet: true });
config({ path: path.resolve(dir, "../.env"), override: false, quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DIRECT_URL or DATABASE_URL is required.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const loc = await prisma.location.findUnique({ where: { code: "LON01" } });
console.log(loc?.id ?? "NOT_FOUND");
await prisma.$disconnect();
