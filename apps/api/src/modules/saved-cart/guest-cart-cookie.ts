import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { GUEST_CART_TTL_MS } from "./saved-cart.types";

export const GUEST_CART_COOKIE = "w4u_guest_cart";

/** Hex-encoded 32-byte token. 64 chars, URL-safe, cryptographically random. */
export function mintGuestToken(): string {
  return randomBytes(32).toString("hex");
}

export function readGuestToken(req: Request): string | null {
  const raw = req.cookies?.[GUEST_CART_COOKIE];
  if (typeof raw !== "string") return null;
  // Sanity check: reject anything not a 64-char hex string so a tampered
  // cookie can never be used as a DB lookup key.
  if (!/^[0-9a-f]{64}$/.test(raw)) return null;
  return raw;
}

export function setGuestTokenCookie(res: Response, token: string): void {
  res.cookie(GUEST_CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_CART_TTL_MS,
  });
}

export function clearGuestTokenCookie(res: Response): void {
  res.clearCookie(GUEST_CART_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
