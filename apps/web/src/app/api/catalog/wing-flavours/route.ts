import { NextResponse } from "next/server";
import { getCachedWingFlavours } from "@/lib/catalog/server-catalog";
import { parseCatalogLocationId } from "@/lib/catalog/catalog-route-params";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = parseCatalogLocationId(searchParams.get("location_id"));
  if (!locationId) {
    return NextResponse.json({ error: "location_id is invalid" }, { status: 400 });
  }
  const flavours = await getCachedWingFlavours(locationId);

  if (!flavours) {
    return NextResponse.json({ error: "Failed to load wing flavours" }, { status: 502 });
  }

  return NextResponse.json({ data: flavours });
}
