function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const apiEnvironment = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  redisIdleDisconnectMs: positiveIntFromEnv(
    "REDIS_IDLE_DISCONNECT_MS",
    60_000,
  ),
  catalogMenuCacheTtlSeconds: positiveIntFromEnv(
    "CATALOG_MENU_CACHE_TTL_SECONDS",
    60,
  ),
  catalogWingFlavoursCacheTtlSeconds: positiveIntFromEnv(
    "CATALOG_WING_FLAVOURS_CACHE_TTL_SECONDS",
    300,
  ),
};
