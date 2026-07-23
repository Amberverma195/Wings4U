import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { getJwtSecret } from "./jwt-secret";

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "localhost"]);
const SIGNED_CLIENT_IP_HEADER = "x-w4u-client-ip";
const SIGNED_CLIENT_IP_SIGNATURE_HEADER = "x-w4u-client-ip-signature";
const RAILWAY_PRIVATE_PROXY_CIDR = "100.64.0.0/10";

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

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function isValidIpLiteral(value: string | null | undefined): boolean {
  const normalized = normalizeIpCandidate(value);
  return !!normalized && isIP(normalized) !== 0;
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

  return normalizeIpCandidate(entry)?.toLowerCase() === ip.toLowerCase();
}

function trustedProxyRanges(): string[] {
  return (process.env.TRUSTED_PROXY_IP_RANGES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.length > 0 &&
        (entry.includes("/") ? isValidCidr(entry) : isValidIpLiteral(entry)),
    );
}

function isTrustedProxyIp(ip: string, ranges: string[]): boolean {
  return ranges.some((entry) => matchesEntry(ip, entry));
}

function verifySignedClientIp(ip: string, signature: string): boolean {
  if (!isValidIpLiteral(ip) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = createHmac("sha256", getJwtSecret()).update(ip).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function extractSignedClientIp(req: Pick<Request, "headers">): string | null {
  const clientIp = normalizeIpCandidate(
    firstHeaderValue(req.headers[SIGNED_CLIENT_IP_HEADER]),
  );
  const signature = firstHeaderValue(
    req.headers[SIGNED_CLIENT_IP_SIGNATURE_HEADER],
  )?.trim();

  if (!clientIp || !signature) return null;
  return verifySignedClientIp(clientIp, signature) ? clientIp : null;
}

export const MAX_TRUSTED_IP_RANGES = 3;

export function normalizeTrustedIpRanges(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_TRUSTED_IP_RANGES) break;
  }

  return result;
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
  return isValidIpLiteral(normalized);
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

  return allowedRanges.some((entry) => matchesEntry(normalizedIp, entry));
}

export function extractClientIp(
  req: Pick<Request, "headers"> &
    Partial<Pick<Request, "ip" | "socket">>,
): string {
  const signedClientIp = extractSignedClientIp(req);
  if (signedClientIp) return signedClientIp;

  const peerIp =
    normalizeIpCandidate(req.ip) ??
    normalizeIpCandidate(req.socket?.remoteAddress) ??
    "";
  const proxyRanges = trustedProxyRanges();
  if (!peerIp || !isTrustedProxyIp(peerIp, proxyRanges)) {
    return peerIp;
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const chain = forwarded
      .split(",")
      .map((candidate) => normalizeIpCandidate(candidate))
      .filter(
        (candidate): candidate is string =>
          !!candidate && isValidIpLiteral(candidate),
      );
    // Railway controls the leftmost X-Forwarded-For value. Its CDN hop IPs are
    // not stable, so trust that value only after validating the private peer.
    if (matchesEntry(peerIp, RAILWAY_PRIVATE_PROXY_CIDR) && chain[0]) {
      return chain[0];
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const candidate = chain[index]!;
      if (!isTrustedProxyIp(candidate, proxyRanges)) return candidate;
    }
    if (chain[0]) return chain[0];
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") {
    const normalized = normalizeIpCandidate(realIp);
    if (normalized) return normalized;
  }

  return peerIp;
}
