import type Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { RateLimiterService } from "./rate-limit.service";

describe("RateLimiterService", () => {
  it("enforces the limit through Redis", async () => {
    let count = 0;
    const redis = {
      multi: jest.fn(() => {
        const pipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          pexpire: jest.fn().mockReturnThis(),
          exec: jest.fn(async () => {
            const countBefore = count;
            count += 1;
            return [
              [null, 0],
              [null, countBefore],
              [null, 1],
              [null, 1],
            ];
          }),
        };
        return pipeline;
      }),
      zrem: jest.fn(async () => {
        count -= 1;
        return 1;
      }),
      zrange: jest.fn().mockResolvedValue([String(Date.now()), String(Date.now())]),
    };
    const redisService = {
      withClient: jest.fn(
        async (operation: (client: Redis) => Promise<unknown>) =>
          operation(redis as unknown as Redis),
      ),
    };
    const service = new RateLimiterService(
      redisService as unknown as RedisService,
    );

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(service.check("delivery:test", 12, 900_000)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(service.check("delivery:test", 12, 900_000)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(redisService.withClient).toHaveBeenCalledTimes(13);
  });

  it("uses the in-memory fallback when Redis is unavailable", async () => {
    const redisService = {
      withClient: jest.fn().mockRejectedValue(new Error("redis unavailable")),
    };
    const service = new RateLimiterService(
      redisService as unknown as RedisService,
    );

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(service.check("delivery:test", 12, 900_000)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(service.check("delivery:test", 12, 900_000)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});

describe("Distributed outage and recovery boundaries", () => {
  afterEach(() => jest.useRealTimers());
  it("keeps independent per-process limits during an outage and resumes shared enforcement on recovery", async () => {
    jest.useFakeTimers(); let online = false, count = 0;
    const redis: any = { multi: () => {
      const pipe: any = { zremrangebyscore: () => pipe, zcard: () => pipe, zadd: () => pipe, pexpire: () => pipe,
        exec: async () => [[null, 0], [null, count++], [null, 1], [null, 1]] };
      return pipe;
    }, zrem: async () => { count--; }, zrange: async () => ["member", String(Date.now())] };
    const withClient = jest.fn(async operation => online ? operation(redis) : null);
    const a = new RateLimiterService({ withClient } as never), b = new RateLimiterService({ withClient } as never);
    expect((await a.check("shared", 1, 60000)).allowed).toBe(true);
    expect((await b.check("shared", 1, 60000)).allowed).toBe(true);
    expect((await a.check("shared", 1, 60000)).allowed).toBe(false);
    expect(withClient).toHaveBeenCalledTimes(2);
    online = true; jest.advanceTimersByTime(5001);
    // Outage hits are not replayed to Redis; document this window explicitly.
    expect((await a.check("shared", 1, 60000)).allowed).toBe(true);
    expect((await b.check("shared", 1, 60000)).allowed).toBe(false);
  });
  it("treats per-command Redis transaction errors as outages rather than empty counters", async () => {
    const redis: any = { multi: () => {
      const pipe: any = { zremrangebyscore: () => pipe, zcard: () => pipe, zadd: () => pipe, pexpire: () => pipe,
        exec: async () => [[new Error("READONLY"), null], [null, 0], [null, 1], [null, 1]] };
      return pipe;
    } };
    const withClient = jest.fn(async operation => operation(redis));
    const limiter = new RateLimiterService({ withClient } as never);
    expect((await limiter.check("key", 1, 60000)).allowed).toBe(true);
    expect((await limiter.check("key", 1, 60000)).allowed).toBe(false);
    expect(withClient).toHaveBeenCalledTimes(1);
  });
});
