import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { assertDeliveryAvailable } from "../../common/utils/delivery-availability";
import { PrismaService } from "../../database/prisma.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { RedisService } from "../redis/redis.service";
import {
  assertLocationOpenForFulfillment,
  getScheduleContext,
} from "../shared/order-validation";
import {
  assertPostalCodeAllowed,
  formatGoogleDestination,
  getAddressFingerprint,
  normalizeDeliveryAddress,
} from "./delivery-address";
import {
  DELIVERY_BASE_FEE_CENTS,
  DELIVERY_PRICING_RULE_VERSION,
  DELIVERY_QUOTE_GLOBAL_BURST_LIMIT,
  DELIVERY_QUOTE_GLOBAL_BURST_WINDOW_MS,
  DELIVERY_QUOTE_GLOBAL_RATE_LIMIT,
  DELIVERY_QUOTE_LIFETIME_MS,
  DELIVERY_QUOTE_RATE_WINDOW_MS,
  DELIVERY_ROUTE_CACHE_TTL_SECONDS,
  DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES,
  calculateDeliveryFeeCents,
  isDeliveryDistancePricingEnabled,
} from "./delivery-pricing.constants";
import {
  type DeliveryQuotePayload,
  DeliveryQuoteTokenService,
} from "./delivery-quote-token.service";
import {
  GoogleRoutesClient,
  GoogleRoutesClientError,
} from "./google-routes.client";

type CreateDeliveryQuoteParams = {
  locationId: string;
  addressSnapshotJson: unknown;
  scheduledFor?: string;
};

export type DeliveryQuoteResponse = {
  delivery_quote_token: string;
  delivery_fee_cents: number;
  expires_at: string;
  attribution: "Google Maps" | null;
};

/** Cached derived quote only - never address or exact distance. */
type CachedRouteResult =
  | { within_delivery_radius: true; delivery_fee_cents: number }
  | { within_delivery_radius: false };

type LocalRouteCacheEntry = {
  expiresAt: number;
  value: CachedRouteResult;
};

@Injectable()
export class DeliveryPricingService {
  private readonly logger = new Logger(DeliveryPricingService.name);
  private readonly inFlight = new Map<string, Promise<number>>();
  private readonly localRouteCache = new Map<string, LocalRouteCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleRoutes: GoogleRoutesClient,
    private readonly tokens: DeliveryQuoteTokenService,
    private readonly redis: RedisService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async createQuote(
    params: CreateDeliveryQuoteParams,
  ): Promise<DeliveryQuoteResponse> {
    const address = normalizeDeliveryAddress(params.addressSnapshotJson);
    const fingerprint = getAddressFingerprint(address);
    const referenceDate = this.parseReferenceDate(params.scheduledFor);

    const [location, settings] = await Promise.all([
      this.prisma.location.findUnique({
        where: { id: params.locationId },
        select: { id: true, isActive: true, timezoneName: true },
      }),
      this.prisma.locationSettings.findUnique({
        where: { locationId: params.locationId },
      }),
    ]);

    if (!location || !location.isActive) {
      throw new NotFoundException("Location not found or inactive");
    }
    if (!settings) {
      throw new NotFoundException("Location settings not found");
    }

    const timezone = location.timezoneName ?? "America/Toronto";
    assertDeliveryAvailable({ settings, timezone, referenceDate });
    await assertLocationOpenForFulfillment({
      db: this.prisma,
      locationId: params.locationId,
      fulfillmentType: "DELIVERY",
      context: getScheduleContext(referenceDate, timezone),
    });
    assertPostalCodeAllowed(address.postalCode, settings.allowedPostalCodes);

    if (!isDeliveryDistancePricingEnabled()) {
      return this.buildQuoteResponse({
        locationId: params.locationId,
        fingerprint,
        feeCents: DELIVERY_BASE_FEE_CENTS,
        useDistanceSignature: false,
      });
    }

    const startedAt = Date.now();
    try {
      const cached = await this.getCachedRouteResult(
        params.locationId,
        fingerprint,
      );
      if (cached) {
        if (!cached.within_delivery_radius) {
          throw new UnprocessableEntityException({
            code: "DELIVERY_OUTSIDE_RADIUS",
            message:
              "This address is outside our 20 km delivery area. Please choose pickup.",
            field: "address_snapshot_json",
          });
        }
        return this.buildQuoteResponse({
          locationId: params.locationId,
          fingerprint,
          feeCents: cached.delivery_fee_cents,
          useDistanceSignature: true,
        });
      }

      const distanceMetres = await this.getSharedDistance(
        params.locationId,
        fingerprint,
        formatGoogleDestination(address),
      );
      const feeCents = calculateDeliveryFeeCents(distanceMetres);
      if (feeCents == null) {
        await this.setCachedRouteResult(params.locationId, fingerprint, {
          within_delivery_radius: false,
        });
        this.logger.warn(
          JSON.stringify({
            event: "delivery_route.outside_radius",
            provider: "google_routes",
            location_id: params.locationId,
            fingerprint_prefix: fingerprint.slice(0, 12),
            latency_ms: Date.now() - startedAt,
          }),
        );
        throw new UnprocessableEntityException({
          code: "DELIVERY_OUTSIDE_RADIUS",
          message:
            "This address is outside our 20 km delivery area. Please choose pickup.",
          field: "address_snapshot_json",
        });
      }

      await this.setCachedRouteResult(params.locationId, fingerprint, {
        within_delivery_radius: true,
        delivery_fee_cents: feeCents,
      });

      this.logger.log(
        JSON.stringify({
          event: "delivery_route.success",
          provider: "google_routes",
          location_id: params.locationId,
          fingerprint_prefix: fingerprint.slice(0, 12),
          calculated_fee_cents: feeCents,
          latency_ms: Date.now() - startedAt,
        }),
      );
      return this.buildQuoteResponse({
        locationId: params.locationId,
        fingerprint,
        feeCents,
        useDistanceSignature: true,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const reason =
        error instanceof GoogleRoutesClientError ? error.reason : "PROVIDER_ERROR";
      this.logger.warn(
        JSON.stringify({
          event: "delivery_route.failure",
          provider: "google_routes",
          provider_result: reason.toLowerCase(),
          location_id: params.locationId,
          fingerprint_prefix: fingerprint.slice(0, 12),
          latency_ms: Date.now() - startedAt,
        }),
      );

      if (
        error instanceof GoogleRoutesClientError &&
        error.reason === "UNROUTABLE"
      ) {
        throw new UnprocessableEntityException({
          code: "DELIVERY_ADDRESS_UNROUTABLE",
          message:
            "We could not find a driving route to this address. Edit the address or choose pickup.",
          field: "address_snapshot_json",
        });
      }
      throw new ServiceUnavailableException({
        code: "DELIVERY_QUOTE_PROVIDER_UNAVAILABLE",
        message:
          "Delivery could not be confirmed right now. Please retry or choose pickup.",
      });
    }
  }

  private parseReferenceDate(scheduledFor?: string): Date {
    if (!scheduledFor) return new Date();
    const date = new Date(scheduledFor);
    if (Number.isNaN(date.getTime())) {
      throw new UnprocessableEntityException({
        code: "INVALID_SCHEDULED_TIME",
        message: "scheduled_for must be a valid ISO timestamp",
        field: "scheduled_for",
      });
    }
    return date;
  }

  private routeCacheKey(locationId: string, fingerprint: string): string {
    return `wings4u:delivery-route:v${DELIVERY_PRICING_RULE_VERSION}:${locationId}:${fingerprint}`;
  }

  private getLocalRouteResult(key: string): CachedRouteResult | null {
    const local = this.localRouteCache.get(key);
    if (!local) return null;
    if (local.expiresAt <= Date.now()) {
      this.localRouteCache.delete(key);
      return null;
    }

    this.localRouteCache.delete(key);
    this.localRouteCache.set(key, local);
    return local.value;
  }

  private setLocalRouteResult(key: string, value: CachedRouteResult): void {
    const now = Date.now();
    for (const [cachedKey, entry] of this.localRouteCache) {
      if (entry.expiresAt <= now) {
        this.localRouteCache.delete(cachedKey);
      }
    }

    this.localRouteCache.delete(key);
    while (
      this.localRouteCache.size >= DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.localRouteCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.localRouteCache.delete(oldestKey);
    }

    this.localRouteCache.set(key, {
      expiresAt: now + DELIVERY_ROUTE_CACHE_TTL_SECONDS * 1_000,
      value,
    });
  }

  private async getCachedRouteResult(
    locationId: string,
    fingerprint: string,
  ): Promise<CachedRouteResult | null> {
    const key = this.routeCacheKey(locationId, fingerprint);
    const local = this.getLocalRouteResult(key);
    if (local) return local;

    const cached = await this.redis.getJson<CachedRouteResult>(key);
    if (!cached || typeof cached.within_delivery_radius !== "boolean") {
      return null;
    }
    if (
      cached.within_delivery_radius &&
      (!Number.isInteger(cached.delivery_fee_cents) ||
        cached.delivery_fee_cents < 0)
    ) {
      return null;
    }

    this.setLocalRouteResult(key, cached);
    return cached;
  }

  private async setCachedRouteResult(
    locationId: string,
    fingerprint: string,
    value: CachedRouteResult,
  ): Promise<void> {
    const key = this.routeCacheKey(locationId, fingerprint);
    this.setLocalRouteResult(key, value);
    await this.redis.setJson(key, value, DELIVERY_ROUTE_CACHE_TTL_SECONDS);
  }

  private getSharedDistance(
    locationId: string,
    fingerprint: string,
    destination: string,
  ): Promise<number> {
    const key = `${locationId}:${fingerprint}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = this.fetchDistanceWithinProviderBudget(destination);
    this.inFlight.set(key, request);
    void request.finally(() => {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key);
      }
    }).catch(() => undefined);
    return request;
  }

  private async fetchDistanceWithinProviderBudget(
    destination: string,
  ): Promise<number> {
    const globalBurstLimit = await this.rateLimiter.check(
      "rate-limit:delivery-quote:global:burst",
      DELIVERY_QUOTE_GLOBAL_BURST_LIMIT,
      DELIVERY_QUOTE_GLOBAL_BURST_WINDOW_MS,
    );
    if (!globalBurstLimit.allowed) {
      this.throwQuoteRateLimited();
    }

    const globalLimit = await this.rateLimiter.check(
      "rate-limit:delivery-quote:global",
      DELIVERY_QUOTE_GLOBAL_RATE_LIMIT,
      DELIVERY_QUOTE_RATE_WINDOW_MS,
    );
    if (!globalLimit.allowed) {
      this.throwQuoteRateLimited();
    }

    return this.googleRoutes.computeDrivingDistanceMetres(destination);
  }

  private throwQuoteRateLimited(): never {
    throw new HttpException(
      {
        code: "DELIVERY_QUOTE_RATE_LIMITED",
        message: "Too many delivery estimate attempts. Please try again later.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private buildQuoteResponse(params: {
    locationId: string;
    fingerprint: string;
    feeCents: number;
    useDistanceSignature: boolean;
  }): DeliveryQuoteResponse {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + DELIVERY_QUOTE_LIFETIME_MS;
    const payload: DeliveryQuotePayload = {
      version: DELIVERY_PRICING_RULE_VERSION,
      location_id: params.locationId,
      address_fingerprint: params.fingerprint,
      delivery_fee_cents: params.feeCents,
      within_delivery_radius: true,
      issued_at: issuedAt,
      expires_at: expiresAt,
    };
    const token = params.useDistanceSignature
      ? this.tokens.signDistanceQuote(payload)
      : this.tokens.signFixedQuote(payload);

    return {
      delivery_quote_token: token,
      delivery_fee_cents: params.feeCents,
      expires_at: new Date(expiresAt).toISOString(),
      attribution: params.useDistanceSignature ? "Google Maps" : null,
    };
  }
}
