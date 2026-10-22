import "server-only";

import { createHmac } from "node:crypto";
import type { ApiEnvelope } from "@wings4u/contracts";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import type { MenuResponse } from "@/lib/types";
import {
  CATALOG_MENU_TAG,
  CATALOG_WING_FLAVOURS_TAG,
  catalogMenuLocationTag,
  catalogWingFlavoursLocationTag,
} from "./cache-tags";

export class CatalogRateLimitError extends Error {
  constructor(readonly retryAfter: string) { super("Too many menu requests"); }
}

type CatalogFulfillmentType = "PICKUP" | "DELIVERY";

type WingFlavourApiRow = {
  id: string;
  name: string;
  slug: string;
  heat_level: string;
  is_plain?: boolean;
  sort_order: number;
};

function getServerApiBase(): string {
  const configured = (
    process.env.INTERNAL_API_URL?.trim() ||
    process.env.API_PROXY_TARGET?.trim() ||
    ""
  ).replace(/\/$/, "");
  if (configured) {
    return configured.startsWith("http") ? configured : `http://${configured}`;
  }

  return "http://127.0.0.1:3001";
}

/**
 * Constant per deployment, so it does not fragment the fetch cache key. The
 * API gives these cached server fetches a shared server budget instead of
 * the per-IP budget of the Vercel egress address.
 */
function catalogServerHeaders(): Record<string, string> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return {};
  return {
    "x-w4u-catalog-server": createHmac("sha256", secret).update("w4u-catalog-server:v1").digest("hex"),
  };
}

function canonicalCatalogLocation(value: string): string {
  return value.length === 36 ? value.toLowerCase() : value.toUpperCase();
}

function scheduleMinuteBucket(scheduledFor?: string): string {
  if (!scheduledFor) {
    return "now";
  }

  const parsed = Date.parse(scheduledFor);
  if (!Number.isFinite(parsed)) {
    return "now";
  }

  return String(Math.floor(parsed / 60_000));
}

async function fetchCatalogJson<T>(
  path: string,
  locationId: string,
  tags: string[],
): Promise<T | null> {
  try {
    const response = await fetch(`${getServerApiBase()}${path}`, {
      cache: "force-cache",
      headers: {
        "X-Location-Id": locationId,
        Accept: "application/json",
        "X-W4U-Catalog-Format": "customization-v2",
        ...catalogServerHeaders(),
      },
      next: {
        tags,
        // Explicit admin tag invalidation is immediate when configured; this
        // bound also refreshes catalogs when the revalidation callback is absent.
        revalidate: 30,
      },
    });

    if (response.status === 429) throw new CatalogRateLimitError(response.headers.get("retry-after") || "60");
    if (!response.ok) {
      return null;
    }

    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data ?? null;
  } catch (error) {
    if (error instanceof CatalogRateLimitError) throw error;
    return null;
  }
}

export async function getCachedMenu(
  locationId: string = DEFAULT_LOCATION_ID,
  fulfillmentType: CatalogFulfillmentType = "PICKUP",
  scheduledFor?: string,
): Promise<MenuResponse | null> {
  locationId = canonicalCatalogLocation(locationId);
  const query = new URLSearchParams({
    location_id: locationId,
    fulfillment_type: fulfillmentType,
  });

  if (scheduledFor) {
    query.set("scheduled_for", scheduledFor);
  }

  const tags = [
    CATALOG_MENU_TAG,
    catalogMenuLocationTag(locationId),
    `${CATALOG_MENU_TAG}:${fulfillmentType}`,
    `${CATALOG_MENU_TAG}:${scheduleMinuteBucket(scheduledFor)}`,
  ];

  return fetchCatalogJson<MenuResponse>(`/api/v1/menu?${query.toString()}`, locationId, tags);
}

export async function getCachedWingFlavours(locationId: string = DEFAULT_LOCATION_ID,): Promise<WingFlavourApiRow[] | null> {
  locationId = canonicalCatalogLocation(locationId);
  const tags = [CATALOG_WING_FLAVOURS_TAG, catalogWingFlavoursLocationTag(locationId)];

  return fetchCatalogJson<WingFlavourApiRow[]>(
    "/api/v1/menu/wing-flavours",
    locationId,
    tags,
  );
}
