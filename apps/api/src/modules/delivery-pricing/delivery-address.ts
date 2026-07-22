import { createHash } from "node:crypto";
import { UnprocessableEntityException } from "@nestjs/common";

const CANADIAN_POSTAL_CODE_RE =
  /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\s?\d[ABCEGHJ-NPRSTVWXYZ]\d$/i;
const CANADIAN_FSA_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]$/i;

export const DELIVERY_ADDRESS_LIMITS = {
  line1: 120,
  city: 80,
  postalCode: 16,
} as const;

export type NormalizedDeliveryAddress = {
  line1: string;
  city: "London";
  postalCode: string;
};

function collapseWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeCanadianPostalCode(value: string): string {
  const compact = collapseWhitespace(value).replace(/\s/g, "").toUpperCase();
  return compact.length === 6
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : compact;
}

export function isValidCanadianPostalCode(value: string): boolean {
  return CANADIAN_POSTAL_CODE_RE.test(collapseWhitespace(value));
}

export function normalizeDeliveryAddress(value: unknown): NormalizedDeliveryAddress {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const line1 =
    typeof candidate.line1 === "string" ? collapseWhitespace(candidate.line1) : "";
  const city =
    typeof candidate.city === "string" ? collapseWhitespace(candidate.city) : "";
  const rawPostal =
    typeof candidate.postal_code === "string"
      ? candidate.postal_code
      : typeof candidate.postalCode === "string"
        ? candidate.postalCode
        : "";

  if (!line1 || line1.length > DELIVERY_ADDRESS_LIMITS.line1) {
    throw new UnprocessableEntityException({
      code: "INVALID_DELIVERY_ADDRESS",
      message: `Address line 1 is required and must be at most ${DELIVERY_ADDRESS_LIMITS.line1} characters`,
      field: "address_snapshot_json.line1",
    });
  }
  if (!city || city.length > DELIVERY_ADDRESS_LIMITS.city) {
    throw new UnprocessableEntityException({
      code: "INVALID_DELIVERY_ADDRESS",
      message: `City is required and must be at most ${DELIVERY_ADDRESS_LIMITS.city} characters`,
      field: "address_snapshot_json.city",
    });
  }
  if (city.toLocaleLowerCase("en-CA") !== "london") {
    throw new UnprocessableEntityException({
      code: "DELIVERY_CITY_UNAVAILABLE",
      message: "Delivery is only available within London, Ontario",
      field: "address_snapshot_json.city",
    });
  }
  if (
    !rawPostal ||
    collapseWhitespace(rawPostal).length > 7 ||
    !isValidCanadianPostalCode(rawPostal)
  ) {
    throw new UnprocessableEntityException({
      code: "INVALID_DELIVERY_POSTAL_CODE",
      message: "Enter a valid Canadian postal code",
      field: "address_snapshot_json.postal_code",
    });
  }

  return {
    line1,
    city: "London",
    postalCode: normalizeCanadianPostalCode(rawPostal),
  };
}

export function getAddressFingerprint(address: NormalizedDeliveryAddress): string {
  const canonical = JSON.stringify({
    line1: collapseWhitespace(address.line1).toLocaleUpperCase("en-CA"),
    city: address.city.toLocaleUpperCase("en-CA"),
    postal_code: address.postalCode.replace(/\s/g, "").toUpperCase(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function formatGoogleDestination(address: NormalizedDeliveryAddress): string {
  return `${address.line1}, ${address.city}, ON ${address.postalCode}, Canada`;
}

function normalizeAllowedPostalEntry(value: string): string {
  return collapseWhitespace(value).replace(/\s/g, "").toUpperCase();
}

function readAllowedPostalEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeAllowedPostalCodes(value: unknown): string[] {
  const entries = readAllowedPostalEntries(value);
  if (!entries) {
    throw new Error("Allowed postal codes must be an array");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new Error("Allowed postal codes must contain only strings");
    }
    const compact = normalizeAllowedPostalEntry(entry);
    const validFsa = compact.length === 3 && CANADIAN_FSA_RE.test(compact);
    const validPostal =
      compact.length === 6 && CANADIAN_POSTAL_CODE_RE.test(compact);
    if (!validFsa && !validPostal) {
      throw new Error(`Invalid Canadian postal zone "${entry}"`);
    }
    const canonical =
      compact.length === 6
        ? `${compact.slice(0, 3)} ${compact.slice(3)}`
        : compact;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return normalized;
}

export function isPostalCodeAllowed(
  postalCode: string,
  allowedPostalCodes: unknown,
): boolean {
  const entries = readAllowedPostalEntries(allowedPostalCodes);
  if (entries?.length === 0) {
    return true;
  }
  if (!entries) return false;

  const normalizedPostal = normalizeAllowedPostalEntry(postalCode);
  return entries.some((entry) => {
    if (typeof entry !== "string") return false;
    const normalizedEntry = normalizeAllowedPostalEntry(entry);
    if (normalizedEntry.length === 3 && CANADIAN_FSA_RE.test(normalizedEntry)) {
      return normalizedPostal.startsWith(normalizedEntry);
    }
    return (
      normalizedEntry.length === 6 &&
      CANADIAN_POSTAL_CODE_RE.test(normalizedEntry) &&
      normalizedPostal === normalizedEntry
    );
  });
}

export function assertPostalCodeAllowed(
  postalCode: string,
  allowedPostalCodes: unknown,
): void {
  if (!isPostalCodeAllowed(postalCode, allowedPostalCodes)) {
    throw new UnprocessableEntityException({
      code: "DELIVERY_POSTAL_CODE_UNAVAILABLE",
      message: `Delivery is not available to postal code "${postalCode}"`,
      field: "address_snapshot_json.postal_code",
    });
  }
}
