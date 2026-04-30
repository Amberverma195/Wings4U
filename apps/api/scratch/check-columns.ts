
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
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pos_login_attempts'
      ORDER BY ordinal_position;
    `;
    console.log("Columns in pos_login_attempts:", JSON.stringify(columns, null, 2));
    
    const kdsColumns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kds_station_sessions'
      ORDER BY ordinal_position;
    `;
    console.log("Columns in kds_station_sessions:", JSON.stringify(kdsColumns, null, 2));

  } catch (err) {
    console.error("Error querying columns:", err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
