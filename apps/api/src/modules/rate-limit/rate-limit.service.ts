import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { createHmac } from "crypto";
import type Redis from "ioredis";
import { getJwtSecret } from "../../common/utils/jwt-secret";
import { RedisService } from "../redis/redis.service";
import type { RateLimitPolicy } from "./rate-limit.policies";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

/** Pause Redis attempts after a failure so an outage does not add a connect timeout to every check. */
const REDIS_FAILURE_BACKOFF_MS = 5_000;
const MEMORY_SWEEP_THRESHOLD = 5_000;
const MEMORY_MAX_KEYS = 50_000;

export class RateLimitExceededException extends HttpException {
  constructor(
    readonly retryAfterSeconds: number,
    message: string,
    code = "RATE_LIMITED",
  ) {
    super(
      { code, message, retry_after_seconds: retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function retryAfterSecondsFor(result: Pick<RateLimitResult, "resetAtMs">, now = Date.now()): number {
  return Math.max(1, Math.ceil((result.resetAtMs - now) / 1000));
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `Please try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  const hours = Math.ceil(minutes / 60);
  return `Please try again in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

/**
 * Keyed one-way identifier for limiter keys. Raw emails, phone numbers, IPs,
 * and tokens never appear in Redis; the server secret prevents offline
 * dictionary confirmation of an email from a leaked key name.
 */
export function rateLimitKeyPart(value: string): string {
  return createHmac("sha256", getJwtSecret())
    .update(`w4u-rate-limit:${value}`)
    .digest("hex")
    .slice(0, 32);
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
  private readonly memory = new Map<string, { hits: number[]; expiresAtMs: number }>();
  private readonly slotMemory = new Map<string, Map<string, number>>();
  private redisRetryAtMs = 0;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Sliding-window check. Returns `allowed: false` if the key has already had
   * `limit` hits inside the last `windowMs`. Rejected attempts are not counted.
   */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const result = await this.withRedis((redis) =>
      this.checkRedis(redis, key, limit, windowMs, now, windowStart),
    );
    if (result) return result;
    return this.checkMemory(key, limit, windowMs, now, windowStart);
  }

  /** Same window arithmetic as `check`, without recording a hit. */
  async peek(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const result = await this.withRedis(async (redis) => {
      const results =
        (await redis
          .multi()
          .zremrangebyscore(key, 0, windowStart)
          .zcard(key)
          .zrange(key, 0, 0, "WITHSCORES")
          .exec()) ?? [];
      this.assertRedisResults(results);
      const count = Number(results[1]?.[1] ?? 0);
      const oldest = results[2]?.[1] as string[] | undefined;
      return this.windowResult(count, limit, windowMs, now, oldest?.length === 2 ? Number(oldest[1]) : now);
    });
    if (result) return result;

    const hits = (this.memory.get(key)?.hits ?? []).filter((t) => t > windowStart);
    return this.windowResult(hits.length, limit, windowMs, now, hits[0] ?? now);
  }

  async clear(key: string): Promise<void> {
    this.memory.delete(key);
    await this.withRedis((redis) => redis.del(key));
  }

  /** Records a hit and throws a 429 when the policy is exhausted. */
  async enforce(key: string, policy: RateLimitPolicy, message: string): Promise<void> {
    const result = await this.check(key, policy.limit, policy.windowMs);
    if (!result.allowed) throw this.exceeded(policy, result, message);
  }

  /** Throws a 429 when the policy is exhausted, without recording a hit. */
  async assertAvailable(key: string, policy: RateLimitPolicy, message: string): Promise<void> {
    const result = await this.peek(key, policy.limit, policy.windowMs);
    if (!result.allowed) throw this.exceeded(policy, result, message);
  }

  exceeded(
    policy: RateLimitPolicy,
    result: Pick<RateLimitResult, "resetAtMs">,
    message: string,
  ): RateLimitExceededException {
    const retryAfter = retryAfterSecondsFor(result);
    this.logger.warn(JSON.stringify({ event: "rate_limit.exceeded", policy: policy.name }));
    return new RateLimitExceededException(retryAfter, `${message} ${formatRetryAfter(retryAfter)}`);
  }

  /**
   * Leases one of `max` concurrent slots for `member`. Leases expire after
   * `ttlMs` unless refreshed, so slots held by a crashed process free
   * themselves. Re-acquiring an existing member always succeeds.
   */
  async acquireSlot(key: string, member: string, max: number, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const result = await this.withRedis(async (redis) => {
      const results =
        (await redis
          .multi()
          .zremrangebyscore(key, 0, now)
          .zscore(key, member)
          .zcard(key)
          .zadd(key, expiresAt, member)
          .pexpire(key, ttlMs)
          .exec()) ?? [];
      this.assertRedisResults(results);
      const existed = results[1]?.[1] != null;
      const countBefore = Number(results[2]?.[1] ?? 0);
      if (!existed && countBefore >= max) {
        await redis.zrem(key, member);
        return { acquired: false };
      }
      return { acquired: true };
    });
    if (result) return result.acquired;

    const slots = this.liveSlots(key, now);
    if (!slots.has(member) && slots.size >= max) return false;
    slots.set(member, expiresAt);
    this.slotMemory.set(key, slots);
    return true;
  }

  async releaseSlot(key: string, member: string): Promise<void> {
    const slots = this.slotMemory.get(key);
    slots?.delete(member);
    if (slots?.size === 0) this.slotMemory.delete(key);
    await this.withRedis((redis) => redis.zrem(key, member));
  }

  async refreshSlots(leases: Array<{ key: string; member: string }>, ttlMs: number): Promise<void> {
    if (leases.length === 0) return;
    const expiresAt = Date.now() + ttlMs;
    for (const { key, member } of leases) {
      const slots = this.slotMemory.get(key);
      if (slots?.has(member)) slots.set(member, expiresAt);
    }
    await this.withRedis(async (redis) => {
      const pipe = redis.multi();
      for (const { key, member } of leases) {
        pipe.zadd(key, "XX", expiresAt, member);
        pipe.pexpire(key, ttlMs);
      }
      return pipe.exec();
    });
  }

  private liveSlots(key: string, now: number): Map<string, number> {
    const slots = this.slotMemory.get(key) ?? new Map<string, number>();
    for (const [member, expiresAt] of slots) {
      if (expiresAt <= now) slots.delete(member);
    }
    return slots;
  }

  private async withRedis<T>(operation: (redis: Redis) => Promise<T>): Promise<T | null> {
    if (Date.now() < this.redisRetryAtMs) return null;
    try {
      const result = await this.redisService.withClient(operation);
      // null means Redis is not configured or could not connect.
      if (result === null) this.redisRetryAtMs = Date.now() + REDIS_FAILURE_BACKOFF_MS;
      return result;
    } catch (err) {
      this.redisRetryAtMs = Date.now() + REDIS_FAILURE_BACKOFF_MS;
      this.logger.warn(
        `Redis rate-limit check failed, using in-process fallback`,
      );
      return null;
    }
  }

  private windowResult(
    count: number,
    limit: number,
    windowMs: number,
    now: number,
    oldestMs: number,
  ): RateLimitResult {
    if (count >= limit) {
      return { allowed: false, remaining: 0, resetAtMs: oldestMs + windowMs };
    }
    return { allowed: true, remaining: limit - count, resetAtMs: now + windowMs };
  }

  private assertRedisResults(results: Array<[Error | null, unknown]>): void {
    if (!results.length || results.some(([error]) => error)) throw new Error("Redis transaction failed");
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

    this.assertRedisResults(results);
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
    const arr = (this.memory.get(key)?.hits ?? []).filter((t) => t > windowStart);
    if (arr.length >= limit) {
      this.memory.set(key, { hits: arr, expiresAtMs: arr[arr.length - 1] + windowMs });
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: arr[0] + windowMs,
      };
    }
    arr.push(now);
    this.memory.delete(key);
    this.memory.set(key, { hits: arr, expiresAtMs: now + windowMs });
    if (this.memory.size > MEMORY_SWEEP_THRESHOLD) this.sweepMemory(now);
    return {
      allowed: true,
      remaining: Math.max(0, limit - arr.length),
      resetAtMs: now + windowMs,
    };
  }

  private sweepMemory(now: number): void {
    for (const [k, entry] of this.memory) {
      if (entry.expiresAtMs <= now) this.memory.delete(k);
    }
    // Map iteration is insertion order and hits re-insert their key, so this
    // drops the least recently used windows first.
    for (const k of this.memory.keys()) {
      if (this.memory.size <= MEMORY_MAX_KEYS) break;
      this.memory.delete(k);
    }
  }
}
