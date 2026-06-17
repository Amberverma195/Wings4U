import "server-only";

import type { ApiEnvelope } from "@wings4u/contracts";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import type { MenuResponse } from "@/lib/types";
import {
  CATALOG_MENU_TAG,
  CATALOG_WING_FLAVOURS_TAG,
  catalogMenuLocationTag,
  catalogWingFlavoursLocationTag,
} from "./cache-tags";

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
      },
      next: {
        tags,
        revalidate: false,
      },
    });

    if (!response.ok) {
      return null;
    }

    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

export async function getCachedMenu(
  locationId: string = DEFAULT_LOCATION_ID,
  fulfillmentType: CatalogFulfillmentType = "PICKUP",
  scheduledFor?: string,
): Promise<MenuResponse | null> {
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

export async function getCachedWingFlavours(
  locationId: string = DEFAULT_LOCATION_ID,
): Promise<WingFlavourApiRow[] | null> {
  const tags = [CATALOG_WING_FLAVOURS_TAG, catalogWingFlavoursLocationTag(locationId)];

  return fetchCatalogJson<WingFlavourApiRow[]>(
    "/api/v1/menu/wing-flavours",
    locationId,
    tags,
  );
}
