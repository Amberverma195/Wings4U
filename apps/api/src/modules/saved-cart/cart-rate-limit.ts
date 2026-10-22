import type { Request } from "express";
import { extractClientIp } from "../../common/utils/store-ip";
import { rateLimitKeyPart } from "../rate-limit/rate-limit.service";
import { readGuestToken } from "./guest-cart-cookie";

/**
 * Stable limiter identities for cart traffic. A guest without a cart cookie
 * has no identity yet: the token minted for their first save is new on every
 * cookieless request, so it must not become a limiter key. Those requests
 * are bounded by the IP budget only.
 */
export function cartRequesterLimiterKeys(req: Request): {
  ip: string;
  identity: string | null;
} {
  const ip = rateLimitKeyPart(`ip:${extractClientIp(req) || "unknown"}`);
  if (req.user?.userId) {
    return { ip, identity: `user:${rateLimitKeyPart(`user:${req.user.userId}`)}` };
  }
  const guestToken = readGuestToken(req);
  if (guestToken) {
    return { ip, identity: `guest:${rateLimitKeyPart(`guest:${guestToken}`)}` };
  }
  return { ip, identity: null };
}
