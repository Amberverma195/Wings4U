import { CatalogRateLimitError } from "@/lib/catalog/server-catalog";
import { validCatalogQuery } from "@/lib/catalog/catalog-route-params";
import { NextResponse } from "next/server";
import { getCachedMenu } from "@/lib/catalog/server-catalog";
import {
  normalizeCatalogScheduledFor,
  parseCatalogLocationId,
} from "@/lib/catalog/catalog-route-params";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!validCatalogQuery(searchParams, ["location_id","fulfillment_type","scheduled_for"])) {
    return NextResponse.json({ error: "Invalid catalog query parameters" }, { status: 400 });
  }
  try {
    const locationId = parseCatalogLocationId(searchParams.get("location_id"));
    const fulfillmentType = searchParams.get("fulfillment_type");
    const scheduledFor = normalizeCatalogScheduledFor(searchParams.get("scheduled_for"));

    if (!locationId) {
      return NextResponse.json({ error: "location_id is invalid" }, { status: 400 });
    }

    if (fulfillmentType !== "PICKUP" && fulfillmentType !== "DELIVERY") {
      return NextResponse.json(
        { error: "fulfillment_type must be PICKUP or DELIVERY" },
        { status: 400 },
      );
    }

    if (!scheduledFor.ok) {
      return NextResponse.json(
        { error: "scheduled_for must be a valid date" },
        { status: 400 },
      );
    }

    const menu = await getCachedMenu(locationId, fulfillmentType, scheduledFor.value);

    if (!menu) {
      return NextResponse.json({ error: "Failed to load menu" }, { status: 502 });
    }

    return NextResponse.json({ data: menu });
  } catch (error) {
    if (error instanceof CatalogRateLimitError) return NextResponse.json({ error: error.message },
      { status: 429, headers: { "Retry-After": error.retryAfter, "Cache-Control": "no-store" } });
    throw error;
  }
}
