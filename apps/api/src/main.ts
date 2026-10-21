import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { PrismaService } from "./database/prisma.service";
import { assertDatabaseSchemaCompatible } from "./database/schema-compatibility";

const rootEnvPath = resolve(__dirname, "../../../.env");

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await assertDatabaseSchemaCompatible(app.get(PrismaService));
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
