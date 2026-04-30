import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const rootEnvPath = resolve(__dirname, "../../../../.env");

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

function getConnectionString(): string {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("PrismaService requires DIRECT_URL or DATABASE_URL to be set");
  }

  return connectionString;
}

function createPrismaClientOptions(): ConstructorParameters<typeof PrismaClient>[0] {
  return {
    adapter: new PrismaPg({
      connectionString: getConnectionString(),
    }),
    transactionOptions: {
      maxWait: 10_000,
      timeout: 20_000,
    },
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(createPrismaClientOptions());
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
