/**
 * Shared web-side auth helper for route protection.
 *
 * Reads and verifies the `access_token` cookie issued by the API and returns a
 * normalized session shape for Next middleware (Edge runtime) and server
 * components (Node runtime). This is the only source of truth for page-level
 * admin gating.
 *
 * Design notes:
 * - The API signs access tokens with HMAC-SHA256 using the shared `JWT_SECRET`
 *   (see `apps/api/src/common/utils/jwt.ts`). We implement a second verifier
 *   here using Web Crypto so it runs in both Edge middleware and Node server
 *   components without importing the API's Node-only helper.
 * - This helper MUST NOT be treated as authorization. It only decides whether
 *   a PAGE should render; every API endpoint still enforces its own role
 *   guards. See the hardening plan: page access control is navigation control.
 */

export type SessionRole = "CUSTOMER" | "STAFF" | "ADMIN";
export type EmployeeRole = "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";

export interface AccessTokenClaims {
  sub: string;
  role: SessionRole;
  employeeRole?: EmployeeRole;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface WebSession {
  userId: string;
  role: SessionRole;
  employeeRole?: EmployeeRole;
  sessionId: string;
}

/* ------------------------------------------------------------------ */
/*  Base64url helpers (Edge-compatible)                                */
/* ------------------------------------------------------------------ */

/**
 * Return a Uint8Array that is guaranteed to be backed by an `ArrayBuffer`
 * (never a `SharedArrayBuffer`), so it satisfies the `BufferSource` type
 * expected by Web Crypto under `lib: ["dom"]`.
 */
function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function textToBytes(input: string): Uint8Array<ArrayBuffer> {
  const source = new TextEncoder().encode(input);
  const buffer = new ArrayBuffer(source.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(source);
  return bytes;
}

function bytesToText(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/*  JWT verify                                                         */
/* ------------------------------------------------------------------ */

/**
 * Verify a JWT signed with HS256 and return its claims, or `null` if the
 * signature, shape, or expiry check fails.
 *
 * This mirrors `verifyJwt` in the API, but uses Web Crypto so it works in the
 * Edge runtime. Any validation failure returns `null` rather than throwing so
 * callers can treat invalid/expired tokens the same as "signed out".
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64UrlToBytes(signatureB64);
  } catch {
    return null;
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      textToBytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      textToBytes(signingInput),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bytesToText(base64UrlToBytes(payloadB64))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }

  if (
    typeof payload.exp === "number" &&
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.sessionId !== "string"
  ) {
    return null;
  }

  if (
    payload.role !== "CUSTOMER" &&
    payload.role !== "STAFF" &&
    payload.role !== "ADMIN"
  ) {
    return null;
  }

  const claims: AccessTokenClaims = {
    sub: payload.sub,
    role: payload.role,
    sessionId: payload.sessionId,
  };

  if (typeof payload.employeeRole === "string") {
    const er = payload.employeeRole;
    if (
      er === "MANAGER" ||
      er === "CASHIER" ||
      er === "KITCHEN" ||
      er === "DRIVER"
    ) {
      claims.employeeRole = er;
    }
  }

  if (typeof payload.iat === "number") claims.iat = payload.iat;
  if (typeof payload.exp === "number") claims.exp = payload.exp;

  return claims;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolve a normalized session from a raw `access_token` cookie value, or
 * `null` if the token is missing, invalid, or expired.
 *
 * Accepts the raw string (from `cookies().get("access_token")?.value` in
 * server components, or `request.cookies.get("access_token")?.value` in
 * middleware) so this helper works in both runtimes.
 */
export async function resolveSession(
  accessToken: string | undefined | null,
): Promise<WebSession | null> {
  if (!accessToken) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Intentionally fail closed: without a signing secret we cannot verify
    // anything. The API has a dev fallback; the web-side MUST be explicit so
    // production deployments surface configuration errors loudly.
    return null;
  }

  const claims = await verifyAccessToken(accessToken, secret);
  if (!claims) return null;

  return {
    userId: claims.sub,
    role: claims.role,
    employeeRole: claims.employeeRole,
    sessionId: claims.sessionId,
  };
}

export function isAdminSession(session: WebSession | null): boolean {
  return session?.role === "ADMIN";
}
