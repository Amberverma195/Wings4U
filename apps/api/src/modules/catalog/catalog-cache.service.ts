import { Injectable, Logger } from "@nestjs/common";
import { apiEnvironment } from "../../config/env";
import { RedisService } from "../redis/redis.service";
import type {
  CatalogFulfillmentType,
  CatalogMenuBasePayload,
  WingFlavourDto,
} from "./catalog.service";

type CacheLookup<T> = {
  key: string;
  value: T | null;
};

type MenuCacheKeyParams = {
  locationId: string;
  fulfillmentType: CatalogFulfillmentType;
  scheduleReference: Date;
};

const KEY_PREFIX = "wings4u:catalog";
const FALLBACK_VERSION = "0";

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async getMenuBase(
    params: MenuCacheKeyParams,
  ): Promise<CacheLookup<CatalogMenuBasePayload>> {
    const key = await this.menuKey(params);
    return {
      key,
      value: await this.getJson<CatalogMenuBasePayload>(key),
    };
  }

  async setMenuBase(key: string, value: CatalogMenuBasePayload): Promise<void> {
    await this.setJson(key, value, apiEnvironment.catalogMenuCacheTtlSeconds);
  }

  async getWingFlavours(locationId: string): Promise<CacheLookup<WingFlavourDto[]>> {
    const key = await this.wingFlavoursKey(locationId);
    return {
      key,
      value: await this.getJson<WingFlavourDto[]>(key),
    };
  }

  async setWingFlavours(key: string, value: WingFlavourDto[]): Promise<void> {
    await this.setJson(
      key,
      value,
      apiEnvironment.catalogWingFlavoursCacheTtlSeconds,
    );
  }

  async invalidateLocation(locationId: string): Promise<void> {
    try {
      const nextVersion = await this.redis.incr(this.versionKey(locationId));
      if (nextVersion == null && this.redis.isReady()) {
        this.logger.warn(`Catalog cache invalidation failed for location ${locationId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Catalog cache invalidation failed for location ${locationId}: ${(err as Error).message}`,
      );
    }
  }

  private async menuKey(params: MenuCacheKeyParams): Promise<string> {
    const version = await this.locationVersion(params.locationId);
    return [
      KEY_PREFIX,
      "menu",
      params.locationId,
      version,
      params.fulfillmentType,
      this.minuteBucket(params.scheduleReference),
    ].join(":");
  }

  private async wingFlavoursKey(locationId: string): Promise<string> {
    const version = await this.locationVersion(locationId);
    return [KEY_PREFIX, "wing-flavours", locationId, version].join(":");
  }

  private async locationVersion(locationId: string): Promise<string> {
    let value: string | null = null;
    try {
      value = await this.redis.get(this.versionKey(locationId));
    } catch (err) {
      this.logger.warn(
        `Catalog cache version lookup failed for location ${locationId}: ${(err as Error).message}`,
      );
    }
    if (!value) return FALLBACK_VERSION;

    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0
      ? String(parsed)
      : FALLBACK_VERSION;
  }

  private versionKey(locationId: string): string {
    return [KEY_PREFIX, "version", locationId].join(":");
  }

  private minuteBucket(referenceDate: Date): string {
    const ms = referenceDate.getTime();
    return Number.isFinite(ms) ? String(Math.floor(ms / 60_000)) : "invalid";
  }

  private async getJson<T>(key: string): Promise<T | null> {
    try {
      return await this.redis.getJson<T>(key);
    } catch (err) {
      this.logger.warn(`Catalog cache read failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  private async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.setJson(key, value, ttlSeconds);
    } catch (err) {
      this.logger.warn(`Catalog cache write failed for ${key}: ${(err as Error).message}`);
    }
  }
}
