import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { RedisService } from "../redis/redis.service";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

/**
 * Sliding-window rate limiter.
 *
 * Uses Redis (ZSET) when REDIS_URL is configured and reachable. Falls back to
 * an in-process Map when Redis is unavailable. In a multi-process deployment
 * without Redis the limit becomes per-process only, which is an explicit
 * fail-open tradeoff.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly memory = new Map<string, number[]>();

  constructor(private readonly redisService: RedisService) {}

  /**
   * Sliding-window check. Returns `allowed: false` if the key has already had
   * `limit` hits inside the last `windowMs`.
   */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redis = this.redisService.getClient();

    if (redis) {
      try {
        return await this.checkRedis(redis, key, limit, windowMs, now, windowStart);
      } catch (err) {
        this.logger.warn(
          `Redis rate-limit check failed, using in-process fallback: ${(err as Error).message}`,
        );
      }
    }

    return this.checkMemory(key, limit, windowMs, now, windowStart);
  }

  private async checkRedis(
    redis: Redis,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    windowStart: number,
  ): Promise<RateLimitResult> {
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
