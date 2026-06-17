import { NextResponse } from "next/server";
import { getCachedWingFlavours } from "@/lib/catalog/server-catalog";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id")?.trim() || DEFAULT_LOCATION_ID;
  const flavours = await getCachedWingFlavours(locationId);

  if (!flavours) {
    return NextResponse.json({ error: "Failed to load wing flavours" }, { status: 502 });
  }

  return NextResponse.json({ data: flavours });
}
