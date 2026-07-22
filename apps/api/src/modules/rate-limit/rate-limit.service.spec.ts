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
