import { apiEnvironment } from "../../config/env";
import { RedisService } from "./redis.service";

type FakeRedisInstance = {
  status: string;
  connect: jest.Mock;
  get: jest.Mock;
  quit: jest.Mock;
};

const mockRedisInstances: FakeRedisInstance[] = [];
let mockConnectError: Error | null = null;

jest.mock("ioredis", () => {
  class FakeRedis {
    status = "wait";
    readonly connect = jest.fn(async () => {
      if (mockConnectError) throw mockConnectError;
      this.status = "ready";
    });
    readonly get = jest.fn(async () => "cached");
    readonly set = jest.fn(async () => "OK");
    readonly incr = jest.fn(async () => 1);
    readonly quit = jest.fn(async () => {
      this.status = "end";
      return "OK";
    });
    readonly disconnect = jest.fn(() => {
      this.status = "end";
    });
    readonly on = jest.fn(() => this);
    readonly removeAllListeners = jest.fn(() => this);

    constructor() {
      mockRedisInstances.push(this);
    }
  }

  return {
    __esModule: true,
    default: FakeRedis,
  };
});

describe("RedisService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRedisInstances.length = 0;
    mockConnectError = null;
    (apiEnvironment as any).redisUrl = "redis://test";
    (apiEnvironment as any).redisIdleDisconnectMs = 1_000;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not connect during module initialization", () => {
    const service = new RedisService();
    service.onModuleInit();

    expect(mockRedisInstances).toHaveLength(0);
  });

  it("shares the first connection across concurrent operations", async () => {
    const service = new RedisService();

    await Promise.all([service.get("one"), service.get("two")]);

    expect(mockRedisInstances).toHaveLength(1);
    expect(mockRedisInstances[0].connect).toHaveBeenCalledTimes(1);
    expect(mockRedisInstances[0].get).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it("disconnects after idle and reconnects on the next command", async () => {
    const service = new RedisService();
    await service.get("one");

    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockRedisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(service.isReady()).toBe(false);

    await service.get("two");
    expect(mockRedisInstances).toHaveLength(2);
    await service.onModuleDestroy();
  });

  it("returns a fallback value when the first connection fails", async () => {
    mockConnectError = new Error("unavailable");
    const service = new RedisService();

    await expect(service.get("one")).resolves.toBeNull();

    expect(mockRedisInstances).toHaveLength(1);
    expect(mockRedisInstances[0].connect).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });
});
