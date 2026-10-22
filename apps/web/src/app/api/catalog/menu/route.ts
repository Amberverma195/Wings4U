import { NextResponse } from "next/server";
import { getCachedMenu } from "@/lib/catalog/server-catalog";
import {
  normalizeCatalogScheduledFor,
  parseCatalogLocationId,
} from "@/lib/catalog/catalog-route-params";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
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
}
