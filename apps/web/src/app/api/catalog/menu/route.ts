import { NextResponse } from "next/server";
import { getCachedMenu } from "@/lib/catalog/server-catalog";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id")?.trim() || DEFAULT_LOCATION_ID;
  const fulfillmentType = searchParams.get("fulfillment_type");
  const scheduledFor = searchParams.get("scheduled_for")?.trim() || undefined;

  if (fulfillmentType !== "PICKUP" && fulfillmentType !== "DELIVERY") {
    return NextResponse.json(
      { error: "fulfillment_type must be PICKUP or DELIVERY" },
      { status: 400 },
    );
  }

  const menu = await getCachedMenu(locationId, fulfillmentType, scheduledFor);

  if (!menu) {
    return NextResponse.json({ error: "Failed to load menu" }, { status: 502 });
  }

  return NextResponse.json({ data: menu });
}
