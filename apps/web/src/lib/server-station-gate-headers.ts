import "server-only";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";

const SIGNED_CLIENT_IP_HEADER = "x-w4u-client-ip";
const SIGNED_CLIENT_IP_SIGNATURE_HEADER = "x-w4u-client-ip-signature";

function firstHeaderIp(value: string | null): string | null {
  const candidate = value?.split(",")[0]?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

function signClientIp(clientIp: string): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(clientIp).digest("hex");
}

function resolveIncomingClientIp(requestHeaders: Headers): string | null {
  // Vercel overwrites this ingress header. Outside Vercel no caller header
  // is signed: local/direct deployments must configure a trusted ingress first.
  if (process.env.VERCEL !== "1") return null;
  return firstHeaderIp(requestHeaders.get("x-vercel-forwarded-for"));
}

/** Lets the API attribute server-side proxied calls to the visitor, not the Vercel egress IP. */
export function buildSignedClientIpHeaders(requestHeaders: Headers): Record<string, string> {
  const clientIp = resolveIncomingClientIp(requestHeaders);
  const signature = clientIp ? signClientIp(clientIp) : null;
  return clientIp && signature
    ? {
        [SIGNED_CLIENT_IP_HEADER]: clientIp,
        [SIGNED_CLIENT_IP_SIGNATURE_HEADER]: signature,
      }
    : {};
}

export function buildStationGateHeaders(
  requestHeaders: Headers,
  cookieHeader: string,
): Record<string, string> {

  const clientIp = resolveIncomingClientIp(requestHeaders);
  const signature = clientIp ? signClientIp(clientIp) : null;

  return {
    ...(cookieHeader ? { cookie: cookieHeader } : {}),

    ...(clientIp && signature
      ? {
          [SIGNED_CLIENT_IP_HEADER]: clientIp,
          [SIGNED_CLIENT_IP_SIGNATURE_HEADER]: signature,
        }
      : {}),
  };
}
