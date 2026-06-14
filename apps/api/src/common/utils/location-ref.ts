import { UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

export const LOCATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCATION_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/i;
const DEFAULT_LOCATION_CODE = "LON01";
const DEFAULT_LOCATION_PLACEHOLDER_UUID =
  "00000000-0000-4000-8000-000000000000";

export function isLocationUuid(value: string): boolean {
  return LOCATION_UUID_RE.test(value);
}

export function normalizeLocationRef(value: string): string {
  return value.trim();
}

export function isLocationRef(value: string): boolean {
  const normalized = normalizeLocationRef(value);
  return isLocationUuid(normalized) || LOCATION_CODE_RE.test(normalized);
}

export async function resolveLocationRef(
  prisma: PrismaService,
  value: string,
): Promise<string | null> {
  const normalized = normalizeLocationRef(value);
  if (!normalized || !isLocationRef(normalized)) return null;
  if (isLocationUuid(normalized)) {
    if (normalized.toLowerCase() !== DEFAULT_LOCATION_PLACEHOLDER_UUID) {
      return normalized;
    }
  }

  const location = await prisma.location.findUnique({
    where: {
      code: isLocationUuid(normalized)
        ? DEFAULT_LOCATION_CODE
        : normalized.toUpperCase(),
    },
    select: { id: true, isActive: true },
  });

  if (!location?.isActive) return null;
  return location.id;
}

export function assertRequestLocationMatches(
  candidate: string,
  req: { locationId?: string; locationRef?: string },
): string {
  const normalized = normalizeLocationRef(candidate);
  if (normalized !== req.locationId && normalized !== req.locationRef) {
    throw new UnprocessableEntityException({
      message: "location_id must match X-Location-Id",
      field: "location_id",
    });
  }
  if (!req.locationId) {
    throw new UnprocessableEntityException({
      message: "X-Location-Id header is required",
      field: "X-Location-Id",
    });
  }
  return req.locationId;
}
