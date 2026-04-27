import type { Request } from "express";

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeIpCandidate(ip: string | null | undefined): string | null {
  if (typeof ip !== "string") return null;
  let value = ip.trim();
  if (!value) return null;

  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket > 0) {
      value = value.slice(1, closingBracket);
    }
  }

  if (value.startsWith("::ffff:")) {
    value = value.slice(7);
  }

  if (
    value.includes(".") &&
    value.includes(":") &&
    value.indexOf(":") === value.lastIndexOf(":")
  ) {
    value = value.split(":")[0] ?? value;
  }

  return value.trim() || null;
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let num = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
    num = (num * 256 + octet) >>> 0;
  }
  return num;
}

function isValidCidr(entry: string): boolean {
  const [base, prefixText] = entry.split("/");
  const prefix = parseInt(prefixText, 10);
  return (
    ipv4ToNumber(base) !== null &&
    Number.isFinite(prefix) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

function matchesEntry(ip: string, entry: string): boolean {
  if (entry.includes("/")) {
    if (!isValidCidr(entry)) return false;
    const [base, prefixText] = entry.split("/");
    const ipNum = ipv4ToNumber(ip);
    const baseNum = ipv4ToNumber(base);
    const prefix = parseInt(prefixText, 10);
    if (ipNum === null || baseNum === null) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (baseNum & mask);
  }

  return normalizeIpCandidate(entry) === ip;
}

export function normalizeTrustedIpRanges(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized) continue;
    return [normalized];
  }

  return [];
}

export function isLocalhostIp(ip: string | null | undefined): boolean {
  const normalized = normalizeIpCandidate(ip);
  if (!normalized) return false;
  return LOOPBACK_IPS.has(normalized.toLowerCase());
}

export function isValidTrustedIpEntry(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (isLocalhostIp(normalized)) return false;
  if (normalized.includes("/")) return isValidCidr(normalized);
  return ipv4ToNumber(normalizeIpCandidate(normalized) ?? "") !== null;
}

export function isAllowedStoreIp(
  clientIp: string | null | undefined,
  rawAllowedRanges: unknown,
): boolean {
  const normalizedIp = normalizeIpCandidate(clientIp);
  if (!normalizedIp) return false;
  if (isLocalhostIp(normalizedIp)) return true;

  const allowedRanges = normalizeTrustedIpRanges(rawAllowedRanges);
  if (allowedRanges.length === 0) return false;

  return matchesEntry(normalizedIp, allowedRanges[0]!);
}

export function extractClientIp(
  req: Pick<Request, "headers" | "ip">,
): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const firstIp = forwarded.split(",")[0]?.trim();
    const normalized = normalizeIpCandidate(firstIp);
    if (normalized) return normalized;
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") {
    const normalized = normalizeIpCandidate(realIp);
    if (normalized) return normalized;
  }

  return normalizeIpCandidate(req.ip) ?? "";
}
