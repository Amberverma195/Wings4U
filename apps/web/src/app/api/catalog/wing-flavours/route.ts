import { CatalogRateLimitError } from "@/lib/catalog/server-catalog";
import { validCatalogQuery } from "@/lib/catalog/catalog-route-params";
import { NextResponse } from "next/server";
import { getCachedWingFlavours } from "@/lib/catalog/server-catalog";
import { parseCatalogLocationId } from "@/lib/catalog/catalog-route-params";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!validCatalogQuery(searchParams, ["location_id"])) {
    return NextResponse.json({ error: "Invalid catalog query parameters" }, { status: 400 });
  }
  try {
    const locationId = parseCatalogLocationId(searchParams.get("location_id"));
    if (!locationId) {
      return NextResponse.json({ error: "location_id is invalid" }, { status: 400 });
    }
    const flavours = await getCachedWingFlavours(locationId);

    if (!flavours) {
      return NextResponse.json({ error: "Failed to load wing flavours" }, { status: 502 });
    }

    return NextResponse.json({ data: flavours });
  } catch (error) {
    if (error instanceof CatalogRateLimitError) return NextResponse.json({ error: error.message },
      { status: 429, headers: { "Retry-After": error.retryAfter, "Cache-Control": "no-store" } });
    throw error;
  }
}
