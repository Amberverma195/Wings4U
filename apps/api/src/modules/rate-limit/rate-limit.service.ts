import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { apiEnvironment } from "../../config/env";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

/**
 * Sliding-window rate limiter.
 *
 * Uses Redis (ZSET) when REDIS_URL is configured and reachable. Falls back to
 * an in-process Map when Redis is unavailable — dev and tests run without
 * Redis, and a single API process remains correctly limited. In a
 * multi-process deployment without Redis the limit becomes per-process only,
 * which is an explicit fail-open tradeoff.
 */
@Injectable()
export class RateLimiterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private redis: Redis | null = null;
  private redisReady = false;
  private readonly memory = new Map<string, number[]>();

  onModuleInit() {
    const url = apiEnvironment.redisUrl;
    if (!url) {
      this.logger.log("REDIS_URL not set — using in-process rate limiter");
      return;
    }

    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redis.on("ready", () => {
        this.redisReady = true;
        this.logger.log("Redis rate limiter connected");
      });
      this.redis.on("error", (err) => {
        if (this.redisReady) this.logger.warn(`Redis error: ${err.message}`);
        this.redisReady = false;
      });
      this.redis.on("end", () => {
        this.redisReady = false;
      });
      void this.redis.connect().catch((err) => {
        this.logger.warn(
          `Redis connect failed, falling back to in-process limiter: ${err.message}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Redis init failed, falling back to in-process limiter: ${(err as Error).message}`,
      );
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
      this.redis = null;
      this.redisReady = false;
    }
  }

  /**
   * Sliding-window check. Returns `allowed: false` if the key has already had
   * `limit` hits inside the last `windowMs`.
   */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (this.redis && this.redisReady) {
      try {
        return await this.checkRedis(key, limit, windowMs, now, windowStart);
      } catch (err) {
        this.logger.warn(
          `Redis rate-limit check failed, using in-process fallback: ${(err as Error).message}`,
        );
      }
    }

    return this.checkMemory(key, limit, windowMs, now, windowStart);
  }

  private async checkRedis(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    windowStart: number,
  ): Promise<RateLimitResult> {
    const redis = this.redis!;
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

    const pipe = redis.multi();
    pipe.zremrangebyscore(key, 0, windowStart);
    pipe.zcard(key);
    pipe.zadd(key, now, member);
    pipe.pexpire(key, windowMs);
    const results = (await pipe.exec()) ?? [];

    const countBefore = Number(results[1]?.[1] ?? 0);
    if (countBefore >= limit) {
      await redis.zrem(key, member);
      const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestMs = oldest.length === 2 ? Number(oldest[1]) : now;
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: oldestMs + windowMs,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - countBefore - 1),
      resetAtMs: now + windowMs,
    };
  }

  private checkMemory(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    windowStart: number,
  ): RateLimitResult {
    const arr = (this.memory.get(key) ?? []).filter((t) => t > windowStart);
    if (arr.length >= limit) {
      this.memory.set(key, arr);
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: arr[0] + windowMs,
      };
    }
    arr.push(now);
    this.memory.set(key, arr);
    if (this.memory.size > 5000) {
      // keep footprint bounded in long-lived dev processes
      for (const [k, v] of this.memory) {
        if (v.length === 0 || v[v.length - 1] < windowStart) this.memory.delete(k);
      }
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - arr.length),
      resetAtMs: now + windowMs,
    };
  }
}
