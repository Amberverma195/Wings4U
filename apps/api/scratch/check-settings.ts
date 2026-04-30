
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

  const locationId = "a68bcda6-3295-42d8-9e53-c2c49dcfc765";

  try {
    const settings = await prisma.locationSettings.findUnique({
      where: { locationId },
    });
    console.log("Settings for location:", JSON.stringify(settings, null, 2));
    
    const location = await prisma.location.findUnique({
      where: { id: locationId },
    });
    console.log("Location details:", JSON.stringify(location, null, 2));

  } catch (err) {
    console.error("Error querying settings:", err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
