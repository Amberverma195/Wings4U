import { Injectable } from "@nestjs/common";
import { isWithinLondon } from "./delivery-area";
import {
  GOOGLE_ROUTES_TIMEOUT_MS,
  GOOGLE_ROUTES_URL,
  RESTAURANT_ORIGIN,
} from "./delivery-pricing.constants";

export type GoogleRoutesFailure =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "UNROUTABLE"
  | "OUTSIDE_CITY"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE";

const API_STATUSES = ["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED",
  "DEADLINE_EXCEEDED", "UNAVAILABLE", "INTERNAL", "NOT_FOUND", "FAILED_PRECONDITION", "UNKNOWN"] as const;
const API_REASONS = ["API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED",
  "SERVICE_DISABLED", "BILLING_DISABLED", "CONSUMER_INVALID", "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"] as const;
export const GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES = 16 * 1024;
type ResponseIssue = "invalid_json" | "invalid_envelope" | "invalid_distance" | "missing_destination_location"
  | "error_body_too_large" | "unreadable_error_body";
export type GoogleRoutesDiagnostics = Readonly<{
  httpStatus?: number;
  apiStatus?: typeof API_STATUSES[number];
  errorReason?: typeof API_REASONS[number];
  responseIssue?: ResponseIssue;
}>;

/** Bound decoded stream bytes before JSON parsing; Content-Length is only an early rejection hint. */
async function readErrorBody(response: Response): Promise<{ body?: unknown; responseIssue?: ResponseIssue }> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    return { responseIssue: "error_body_too_large" };
  }
  if (!response.body) return { responseIssue: "invalid_json" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      bytes += value.byteLength;
      if (bytes > GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { responseIssue: "error_body_too_large" };
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bounded = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { bounded.set(chunk, offset); offset += chunk.byteLength; }
  try { return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bounded)) }; }
  catch { return { responseIssue: "invalid_json" }; }
}

/** Only fixed enums/numeric status survive; never messages, metadata, addresses or keys. */
function errorDiagnostics(httpStatus: number, body: unknown): GoogleRoutesDiagnostics {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") return { httpStatus };
  const { status, details } = error as { status?: unknown; details?: unknown };
  const apiStatus = API_STATUSES.find(value => value === status);
  const info = Array.isArray(details) ? details.find(detail => detail && typeof detail === "object" &&
    detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.domain === "googleapis.com") : null;
  const errorReason = API_REASONS.find(value => value === info?.reason);
  return { httpStatus, ...(apiStatus ? { apiStatus } : {}), ...(errorReason ? { errorReason } : {}) };
}

export class GoogleRoutesClientError extends Error {
  constructor(
    readonly reason: GoogleRoutesFailure,
    message: string,
    readonly diagnostics: GoogleRoutesDiagnostics = {},
  ) {
    super(message);
    this.name = "GoogleRoutesClientError";
  }
}

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: unknown;
    legs?: Array<{ endLocation?: { latLng?: { latitude?: unknown; longitude?: unknown } } }>;
  }>;
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
    let httpStatus: number | undefined;

    try {
      const response = await fetch(GOOGLE_ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.legs.endLocation.latLng",
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
      httpStatus = response.status;

      if (!response.ok) {
        let parsed: Awaited<ReturnType<typeof readErrorBody>>;
        try { parsed = await readErrorBody(response); } catch {
          if (controller.signal.aborted) throw new Error("aborted");
          parsed = { responseIssue: "unreadable_error_body" };
        }
        const diagnostics = { ...errorDiagnostics(response.status, parsed.body),
          ...(parsed.responseIssue ? { responseIssue: parsed.responseIssue } : {}) };
        if (response.status === 429 || (response.status < 500 &&
            (diagnostics.errorReason === "QUOTA_EXCEEDED" || diagnostics.errorReason === "RATE_LIMIT_EXCEEDED"))) {
          throw new GoogleRoutesClientError("RATE_LIMITED", "Google Routes rate limit reached", diagnostics);
        }
        if (response.status === 401 || response.status === 403 || (response.status < 500 && diagnostics.errorReason &&
            diagnostics.errorReason !== "QUOTA_EXCEEDED" && diagnostics.errorReason !== "RATE_LIMIT_EXCEEDED")) {
          throw new GoogleRoutesClientError(
            "NOT_CONFIGURED",
            "Google Routes credentials were rejected",
            diagnostics,
          );
        }
        if (response.status >= 500) {
          throw new GoogleRoutesClientError(
            "PROVIDER_ERROR",
            "Google Routes service error",
            diagnostics,
          );
        }
        throw new GoogleRoutesClientError(
          "INVALID_REQUEST",
          "Google Routes rejected the request",
          diagnostics,
        );
      }

      let body: ComputeRoutesResponse;
      try {
        body = (await response.json()) as ComputeRoutesResponse;
      } catch {
        if (controller.signal.aborted) throw new Error("aborted");
        throw new GoogleRoutesClientError(
          "MALFORMED_RESPONSE",
          "Google Routes returned invalid JSON",
          { httpStatus: response.status, responseIssue: "invalid_json" },
        );
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new GoogleRoutesClientError("MALFORMED_RESPONSE", "Google Routes returned an invalid response",
          { httpStatus: response.status, responseIssue: "invalid_envelope" });
      }
      // Protobuf JSON omits empty repeated fields, so {} also means no route.
      if (!Object.prototype.hasOwnProperty.call(body, "routes") ||
          (Array.isArray(body.routes) && body.routes.length === 0)) {
        throw new GoogleRoutesClientError(
          "UNROUTABLE",
          "Google Routes found no driving route",
          { httpStatus },
        );
      }
      const route = Array.isArray(body?.routes) ? body.routes[0] : undefined;
      const distance = route?.distanceMeters;
      if (
        typeof distance !== "number" ||
        !Number.isInteger(distance) ||
        distance < 0
      ) {
        throw new GoogleRoutesClientError(
          "MALFORMED_RESPONSE",
          "Google Routes response did not contain a valid distance",
          { httpStatus: response.status, responseIssue: "invalid_distance" },
        );
      }

      // Use the provider's routed destination, never customer-supplied coordinates
      // or the editable city label, for municipal eligibility.
      const endpoint = route?.legs?.[0]?.endLocation?.latLng;
      if (typeof endpoint?.latitude !== "number" ||
          typeof endpoint.longitude !== "number" ||
          !Number.isFinite(endpoint.latitude) || !Number.isFinite(endpoint.longitude) ||
          Math.abs(endpoint.latitude) > 90 || Math.abs(endpoint.longitude) > 180) {
        throw new GoogleRoutesClientError("MALFORMED_RESPONSE", "Google Routes omitted the destination location",
          { httpStatus: response.status, responseIssue: "missing_destination_location" });
      }
      if (!isWithinLondon(endpoint.latitude, endpoint.longitude)) {
        throw new GoogleRoutesClientError("OUTSIDE_CITY", "The routed destination is outside London, Ontario", { httpStatus });
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
          { httpStatus },
        );
      }
      throw new GoogleRoutesClientError(
        "PROVIDER_ERROR",
        "Google Routes request failed",
        { httpStatus },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
