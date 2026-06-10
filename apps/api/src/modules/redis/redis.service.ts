import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { apiEnvironment } from "../../config/env";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private ready = false;

  onModuleInit() {
    const url = apiEnvironment.redisUrl.trim();
    if (!url) {
      this.logger.log("REDIS_URL not set; Redis-backed features will use fallbacks");
      return;
    }

    try {
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.client.on("ready", () => {
        this.ready = true;
        this.logger.log("Redis connected");
      });
      this.client.on("error", (err) => {
        if (this.ready) {
          this.logger.warn(`Redis error: ${err.message}`);
        }
        this.ready = false;
      });
      this.client.on("end", () => {
        this.ready = false;
      });

      void this.client.connect().catch((err) => {
        this.logger.warn(
          `Redis connect failed; Redis-backed features will use fallbacks: ${err.message}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Redis init failed; Redis-backed features will use fallbacks: ${(err as Error).message}`,
      );
      this.client = null;
      this.ready = false;
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    } finally {
      this.client = null;
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready && this.client !== null;
  }

  getClient(): Redis | null {
    return this.isReady() ? this.client : null;
  }

  async get(key: string): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      return await client.get(key);
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
    const client = this.getClient();
    if (!client) return false;

    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await client.set(key, payload, "EX", ttlSeconds);
      } else {
        await client.set(key, payload);
      }
      return true;
    } catch (err) {
      this.logger.warn(`Redis set failed for ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async incr(key: string): Promise<number | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      return await client.incr(key);
    } catch (err) {
      this.logger.warn(`Redis incr failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }
}
