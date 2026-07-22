import { Injectable } from "@nestjs/common";
import {
  GOOGLE_ROUTES_TIMEOUT_MS,
  GOOGLE_ROUTES_URL,
  RESTAURANT_ORIGIN,
} from "./delivery-pricing.constants";

export type GoogleRoutesFailure =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "UNROUTABLE"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE";

export class GoogleRoutesClientError extends Error {
  constructor(
    readonly reason: GoogleRoutesFailure,
    message: string,
  ) {
    super(message);
    this.name = "GoogleRoutesClientError";
  }
}

type ComputeRoutesResponse = {
  routes?: Array<{ distanceMeters?: unknown }>;
};

@Injectable()
export class GoogleRoutesClient {
  async computeDrivingDistanceMetres(destination: string): Promise<number> {
    const apiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY?.trim();
    if (!apiKey) {
      throw new GoogleRoutesClientError(
        "NOT_CONFIGURED",
        "Google Routes is not configured",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_ROUTES_TIMEOUT_MS);

    try {
      const response = await fetch(GOOGLE_ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: RESTAURANT_ORIGIN,
            },
          },
          destination: { address: destination },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          computeAlternativeRoutes: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new GoogleRoutesClientError(
            "NOT_CONFIGURED",
            "Google Routes credentials were rejected",
          );
        }
        if (response.status === 429) {
          throw new GoogleRoutesClientError(
            "RATE_LIMITED",
            "Google Routes rate limit reached",
          );
        }
        if (response.status >= 500) {
          throw new GoogleRoutesClientError(
            "PROVIDER_ERROR",
            "Google Routes service error",
          );
        }
        throw new GoogleRoutesClientError(
          "UNROUTABLE",
          "Google Routes rejected the destination",
        );
      }

      let body: ComputeRoutesResponse;
      try {
        body = (await response.json()) as ComputeRoutesResponse;
      } catch {
        throw new GoogleRoutesClientError(
          "MALFORMED_RESPONSE",
          "Google Routes returned invalid JSON",
        );
      }

      const distance = body.routes?.[0]?.distanceMeters;
      if (body.routes?.length === 0) {
        throw new GoogleRoutesClientError(
          "UNROUTABLE",
          "Google Routes found no driving route",
        );
      }
      if (
        typeof distance !== "number" ||
        !Number.isInteger(distance) ||
        distance < 0
      ) {
        throw new GoogleRoutesClientError(
          "MALFORMED_RESPONSE",
          "Google Routes response did not contain a valid distance",
        );
      }

      return distance;
    } catch (error) {
      if (error instanceof GoogleRoutesClientError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new GoogleRoutesClientError(
          "TIMEOUT",
          "Google Routes request timed out",
        );
      }
      throw new GoogleRoutesClientError(
        "PROVIDER_ERROR",
        "Google Routes request failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
