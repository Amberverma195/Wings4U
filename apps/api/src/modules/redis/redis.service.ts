import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { apiEnvironment } from "../../config/env";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connectPromise: Promise<Redis | null> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private activeOperations = 0;
  private shuttingDown = false;

  onModuleInit(): void {
    if (!apiEnvironment.redisUrl.trim()) {
      this.logger.log("REDIS_URL not set; Redis-backed features will use fallbacks");
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.clearIdleTimer();
    await this.closeClient();
  }

  isReady(): boolean {
    return this.client?.status === "ready";
  }

  async withClient<T>(operation: (client: Redis) => Promise<T>): Promise<T | null> {
    const client = await this.ensureClient();
    if (!client) return null;

    this.clearIdleTimer();
    this.activeOperations += 1;
    try {
      return await operation(client);
    } finally {
      this.activeOperations -= 1;
      this.scheduleIdleDisconnect();
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.withClient((client) => client.get(key));
    } catch (err) {
      this.logger.warn(`Redis get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw == null) return null;

    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Redis JSON parse failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    try {
      const payload = JSON.stringify(value);
      const result = await this.withClient(async (client) => {
        if (ttlSeconds > 0) {
          await client.set(key, payload, "EX", ttlSeconds);
        } else {
          await client.set(key, payload);
        }
        return true;
      });
      return result ?? false;
    } catch (err) {
      this.logger.warn(`Redis set failed for ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async incr(key: string): Promise<number | null> {
    try {
      return await this.withClient((client) => client.incr(key));
    } catch (err) {
      this.logger.warn(`Redis incr failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  private async ensureClient(): Promise<Redis | null> {
    const url = apiEnvironment.redisUrl.trim();
    if (!url || this.shuttingDown) return null;
    if (this.client?.status === "ready") return this.client;
    if (this.connectPromise) return this.connectPromise;

    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.client = client;
    this.attachClientListeners(client);

    const connecting = client
      .connect()
      .then(() => {
        if (this.client !== client || this.shuttingDown) {
          client.disconnect();
          return null;
        }
        return client;
      })
      .catch((err) => {
        this.logger.warn(
          `Redis connect failed; Redis-backed features will use fallbacks: ${(err as Error).message}`,
        );
        if (this.client === client) this.client = null;
        client.disconnect();
        return null;
      })
      .finally(() => {
        if (this.connectPromise === connecting) this.connectPromise = null;
      });
    this.connectPromise = connecting;
    return connecting;
  }

  private attachClientListeners(client: Redis): void {
    client.on("ready", () => {
      if (this.client === client) this.logger.log("Redis connected");
    });
    client.on("error", (err) => {
      if (this.client === client && client.status === "ready") {
        this.logger.warn(`Redis error: ${err.message}`);
      }
    });
    client.on("end", () => {
      if (this.client === client) this.client = null;
    });
  }

  private scheduleIdleDisconnect(): void {
    if (this.shuttingDown || this.activeOperations > 0 || !this.client) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.activeOperations === 0) void this.closeClient();
    }, apiEnvironment.redisIdleDisconnectMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async closeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;

    try {
      if (client.status === "ready") {
        await client.quit();
      } else {
        client.disconnect();
      }
    } catch {
      client.disconnect();
    }
  }
}
