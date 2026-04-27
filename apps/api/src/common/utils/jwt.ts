import { createHmac, timingSafeEqual } from "crypto";

const HEADER_B64 = base64UrlEncode(
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
);

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${HEADER_B64}.${payloadB64}`;
  const signature = sign(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export function verifyJwt<T = Record<string, unknown>>(
  token: string,
  secret: string
): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = sign(signingInput, secret);

  const sigBuf = base64UrlDecode(signatureB64);
  const expBuf = base64UrlDecode(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(
      base64UrlDecode(payloadB64).toString("utf8")
    ) as Record<string, unknown>;

    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload as T;
  } catch {
    return null;
  }
}
