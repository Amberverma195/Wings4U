import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdminSession, resolveSession } from "@/lib/auth-session";
import { allCatalogTagsForLocation } from "@/lib/catalog/cache-tags";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

type RevalidateBody = {
  locationId?: string;
  secret?: string;
};

async function isAuthorized(request: Request, body: RevalidateBody): Promise<boolean> {
  const configuredSecret = process.env.CATALOG_REVALIDATION_SECRET?.trim();
  const headerSecret = request.headers.get("x-revalidate-secret")?.trim();
  const bodySecret = body.secret?.trim();

  if (configuredSecret && (headerSecret === configuredSecret || bodySecret === configuredSecret)) {
    return true;
  }

  const cookieStore = await cookies();
  const session = await resolveSession(cookieStore.get("access_token")?.value);
  return isAdminSession(session);
}

export async function POST(request: Request) {
  let body: RevalidateBody = {};
  try {
    body = (await request.json()) as RevalidateBody;
  } catch {
    body = {};
  }

  if (!(await isAuthorized(request, body))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locationId = body.locationId?.trim() || DEFAULT_LOCATION_ID;
  const tags = allCatalogTagsForLocation(locationId);

  for (const tag of tags) {
    revalidateTag(tag);
  }

  return NextResponse.json({
    revalidated: true,
    tags,
    locationId,
    at: new Date().toISOString(),
  });
}
