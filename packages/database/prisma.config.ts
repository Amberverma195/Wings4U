import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(configDir, "../../.env");
const packageEnvPath = path.resolve(configDir, ".env");

loadEnv({ path: repoRootEnvPath, quiet: true });
loadEnv({ path: packageEnvPath, override: false, quiet: true });

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

// `prisma generate` does not connect to the database, but Prisma still
// resolves the datasource URL while loading this config. Railway build
// environments may omit runtime DB variables, so keep generation/builds from
// failing on a missing URL. Runtime commands such as migrate/deploy should
// still provide DIRECT_URL or DATABASE_URL.
const datasourceUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgresql://wings4u:wings4u@localhost:5432/wings4u?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
});

