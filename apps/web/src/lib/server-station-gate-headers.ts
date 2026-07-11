import "server-only";
import { createHmac } from "node:crypto";

const SIGNED_CLIENT_IP_HEADER = "x-w4u-client-ip";
const SIGNED_CLIENT_IP_SIGNATURE_HEADER = "x-w4u-client-ip-signature";

function firstHeaderIp(value: string | null): string | null {
  const candidate = value?.split(",")[0]?.trim();
  return candidate || null;
}

function signClientIp(clientIp: string): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(clientIp).digest("hex");
}

function resolveIncomingClientIp(requestHeaders: Headers): string | null {
  return (
    firstHeaderIp(requestHeaders.get("x-forwarded-for")) ??
    firstHeaderIp(requestHeaders.get("x-real-ip")) ??
    firstHeaderIp(requestHeaders.get("x-vercel-forwarded-for")) ??
    firstHeaderIp(requestHeaders.get("cf-connecting-ip")) ??
    firstHeaderIp(requestHeaders.get("true-client-ip"))
  );
}

export function buildStationGateHeaders(
  requestHeaders: Headers,
  cookieHeader: string,
): Record<string, string> {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const clientIp = resolveIncomingClientIp(requestHeaders);
  const signature = clientIp ? signClientIp(clientIp) : null;

  return {
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    ...(realIp ? { "x-real-ip": realIp } : {}),
    ...(clientIp && signature
      ? {
          [SIGNED_CLIENT_IP_HEADER]: clientIp,
          [SIGNED_CLIENT_IP_SIGNATURE_HEADER]: signature,
        }
      : {}),
  };
}
