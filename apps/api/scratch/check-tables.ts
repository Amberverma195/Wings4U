
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    console.log("Tables in database:", JSON.stringify(tables, null, 2));
  } catch (err) {
    console.error("Error querying tables:", err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
