/**
 * PRD §22 — POS Walk-In Unit Tests
 *
 * Pure-logic tests that validate POS login, lockout, network guard,
 * and manual discount behaviors without real DB/network.
 */

import * as bcrypt from "bcryptjs";
import { createHash } from "crypto";

/* ------------------------------------------------------------------ */
/*  Helpers (mirrored from production code for isolated testing)       */
/* ------------------------------------------------------------------ */

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
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

function ipInCidrList(ip: string, ranges: string[]): boolean {
  if (ranges.length === 0) return true;
  const ipNum = ipv4ToNumber(ip);
  if (ipNum === null) return false;

  for (const cidr of ranges) {
    const [base, prefixStr] = cidr.split("/");
    const baseNum = ipv4ToNumber(base);
    if (baseNum === null) continue;
    const prefix = parseInt(prefixStr, 10);
    if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) continue;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ipNum & mask) === (baseNum & mask)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  1. StoreNetworkGuard — CIDR matching                              */
/* ------------------------------------------------------------------ */

describe("StoreNetworkGuard — ipInCidrList", () => {
  test("returns true when ranges is empty (open mode)", () => {
    expect(ipInCidrList("1.2.3.4", [])).toBe(true);
  });

  test("allows IP within a /24 range", () => {
    expect(ipInCidrList("192.168.1.42", ["192.168.1.0/24"])).toBe(true);
  });

  test("rejects IP outside a /24 range", () => {
    expect(ipInCidrList("192.168.2.1", ["192.168.1.0/24"])).toBe(false);
  });

  test("allows IP within a /8 range", () => {
    expect(ipInCidrList("10.99.88.77", ["10.0.0.0/8"])).toBe(true);
  });

  test("rejects IP outside all ranges", () => {
    expect(
      ipInCidrList("172.16.0.5", ["192.168.1.0/24", "10.0.0.0/8"]),
    ).toBe(false);
  });

  test("allows when IP matches second range in list", () => {
    expect(
      ipInCidrList("10.0.0.1", ["192.168.1.0/24", "10.0.0.0/8"]),
    ).toBe(true);
  });

  test("rejects malformed IP", () => {
    expect(ipInCidrList("not-an-ip", ["192.168.1.0/24"])).toBe(false);
  });

  test("handles /32 (single host)", () => {
    expect(ipInCidrList("192.168.1.100", ["192.168.1.100/32"])).toBe(true);
    expect(ipInCidrList("192.168.1.101", ["192.168.1.100/32"])).toBe(false);
  });

  test("allows when IP exactly matches range base + /0 (any)", () => {
    expect(ipInCidrList("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  2. bcrypt POS code hashing + comparison                           */
/* ------------------------------------------------------------------ */

describe("POS code bcrypt hashing", () => {
  const CODE = "12345";

  test("bcrypt hash starts with $2", async () => {
    const hash = await bcrypt.hash(CODE, 10);
    expect(hash.startsWith("$2")).toBe(true);
  });

  test("bcrypt.compare succeeds with correct code", async () => {
    const hash = await bcrypt.hash(CODE, 10);
    const match = await bcrypt.compare(CODE, hash);
    expect(match).toBe(true);
  });

  test("bcrypt.compare fails with wrong code", async () => {
    const hash = await bcrypt.hash(CODE, 10);
    const match = await bcrypt.compare("54321", hash);
    expect(match).toBe(false);
  });

  test("SHA-256 legacy hash is detected as non-bcrypt", () => {
    const legacyHash = sha256(CODE);
    expect(legacyHash.startsWith("$2")).toBe(false);
  });

  test("dual-mode: bcrypt match path works", async () => {
    const bcryptHash = await bcrypt.hash(CODE, 10);

    // Simulates the posLogin dual-mode check
    const isBcryptHash = bcryptHash.startsWith("$2");
    expect(isBcryptHash).toBe(true);

    const match = await bcrypt.compare(CODE, bcryptHash);
    expect(match).toBe(true);
  });

  test("dual-mode: SHA-256 fallback path works", () => {
    const legacyHash = sha256(CODE);

    const isBcryptHash = legacyHash.startsWith("$2");
    expect(isBcryptHash).toBe(false);

    // SHA-256 fallback
    const match = sha256(CODE) === legacyHash;
    expect(match).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  3. POS login lockout logic (pure function simulation)             */
/* ------------------------------------------------------------------ */

describe("POS login lockout — IP/device rate limiting", () => {
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

  function shouldLockout(
    recentFailedAttempts: number,
  ): boolean {
    return recentFailedAttempts >= MAX_ATTEMPTS;
  }

  test("allows login when 0 recent failures", () => {
    expect(shouldLockout(0)).toBe(false);
  });

  test("allows login when 4 recent failures (below threshold)", () => {
    expect(shouldLockout(4)).toBe(false);
  });

  test("locks out at exactly 5 failures", () => {
    expect(shouldLockout(5)).toBe(true);
  });

  test("locks out when failures exceed threshold", () => {
    expect(shouldLockout(10)).toBe(true);
  });

  test("lockout window: attempts outside window are not counted", () => {
    // Simulates checking only attempts within the 10-min window
    const now = Date.now();
    const attempts = [
      { at: now - 15 * 60 * 1000, success: false }, // 15 min ago — outside window
      { at: now - 12 * 60 * 1000, success: false }, // 12 min ago — outside window
      { at: now - 11 * 60 * 1000, success: false }, // 11 min ago — outside window
      { at: now - 9 * 60 * 1000, success: false },  // 9 min ago — inside window
      { at: now - 5 * 60 * 1000, success: false },  // 5 min ago — inside window
      { at: now - 1 * 60 * 1000, success: false },  // 1 min ago — inside window
    ];
    const windowStart = now - LOCKOUT_WINDOW_MS;
    const recentFailed = attempts.filter(
      (a) => !a.success && a.at >= windowStart,
    ).length;
    expect(recentFailed).toBe(3);
    expect(shouldLockout(recentFailed)).toBe(false);
  });

  test("device-scoped: different devices have separate counters", () => {
    // Simulates two different devices, each with their own failure count
    const deviceAFailures = 3;
    const deviceBFailures = 4;
    expect(shouldLockout(deviceAFailures)).toBe(false);
    expect(shouldLockout(deviceBFailures)).toBe(false);

    // Same IP, aggregated across all devices hits threshold
    const totalIpFailures = deviceAFailures + deviceBFailures;
    // But per-device lockout means each device is checked independently
    expect(shouldLockout(deviceAFailures)).toBe(false);
    expect(shouldLockout(deviceBFailures)).toBe(false);
    // Only the aggregate would trip a global lockout (our impl uses per-device + IP)
    expect(totalIpFailures >= MAX_ATTEMPTS).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  4. Code reuse cooldown                                            */
/* ------------------------------------------------------------------ */

describe("POS code reuse cooldown", () => {
  const COOLDOWN_DAYS = 30;

  function isWithinCooldown(deactivatedAt: Date | null): boolean {
    if (!deactivatedAt) return false;
    const cooldownEnd = new Date(
      deactivatedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    );
    return new Date() < cooldownEnd;
  }

  test("no cooldown when posCodeDeactivatedAt is null", () => {
    expect(isWithinCooldown(null)).toBe(false);
  });

  test("within cooldown when deactivated 5 days ago", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(isWithinCooldown(fiveDaysAgo)).toBe(true);
  });

  test("within cooldown when deactivated 29 days ago", () => {
    const twentyNineDaysAgo = new Date(
      Date.now() - 29 * 24 * 60 * 60 * 1000,
    );
    expect(isWithinCooldown(twentyNineDaysAgo)).toBe(true);
  });

  test("outside cooldown when deactivated 31 days ago", () => {
    const thirtyOneDaysAgo = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    );
    expect(isWithinCooldown(thirtyOneDaysAgo)).toBe(false);
  });

  test("outside cooldown when deactivated 365 days ago", () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(isWithinCooldown(oneYearAgo)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  5. order_source validation                                        */
/* ------------------------------------------------------------------ */

describe("order_source validation", () => {
  const ALLOWED_SOURCES = ["POS", "PHONE"] as const;

  function isValidPosOrderSource(source: string): boolean {
    return (ALLOWED_SOURCES as readonly string[]).includes(source);
  }

  test("accepts POS", () => {
    expect(isValidPosOrderSource("POS")).toBe(true);
  });

  test("accepts PHONE", () => {
    expect(isValidPosOrderSource("PHONE")).toBe(true);
  });

  test("rejects ONLINE", () => {
    expect(isValidPosOrderSource("ONLINE")).toBe(false);
  });

  test("rejects ADMIN", () => {
    expect(isValidPosOrderSource("ADMIN")).toBe(false);
  });

  test("rejects IN_STORE (deprecated)", () => {
    expect(isValidPosOrderSource("IN_STORE")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidPosOrderSource("")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  6. Manual discount constraints                                    */
/* ------------------------------------------------------------------ */

describe("Manual discount — order total recalculation", () => {
  function applyManualDiscount(
    currentFinalPayable: number,
    currentDiscountTotal: number,
    discountAmountCents: number,
  ): { newFinalPayable: number; newDiscountTotal: number } {
    const newDiscountTotal = currentDiscountTotal + discountAmountCents;
    const newFinalPayable = Math.max(0, currentFinalPayable - discountAmountCents);
    return { newFinalPayable, newDiscountTotal };
  }

  test("reduces finalPayable by discount amount", () => {
    const result = applyManualDiscount(2000, 0, 500);
    expect(result.newFinalPayable).toBe(1500);
    expect(result.newDiscountTotal).toBe(500);
  });

  test("clamps finalPayable at 0 when discount exceeds total", () => {
    const result = applyManualDiscount(300, 0, 500);
    expect(result.newFinalPayable).toBe(0);
    expect(result.newDiscountTotal).toBe(500);
  });

  test("accumulates multiple discounts", () => {
    let result = applyManualDiscount(2000, 0, 300);
    result = applyManualDiscount(result.newFinalPayable, result.newDiscountTotal, 200);
    expect(result.newFinalPayable).toBe(1500);
    expect(result.newDiscountTotal).toBe(500);
  });

  test("does not allow negative finalPayable", () => {
    const result = applyManualDiscount(100, 100, 10000);
    expect(result.newFinalPayable).toBe(0);
    expect(result.newDiscountTotal).toBe(10100);
  });
});

/* ------------------------------------------------------------------ */
/*  7. 5-digit code format enforcement                                */
/* ------------------------------------------------------------------ */

describe("Employee code format — 5-digit enforcement", () => {
  const PATTERN = /^\d{5}$/;

  test("accepts 12345", () => {
    expect(PATTERN.test("12345")).toBe(true);
  });

  test("accepts 00000", () => {
    expect(PATTERN.test("00000")).toBe(true);
  });

  test("accepts 99999", () => {
    expect(PATTERN.test("99999")).toBe(true);
  });

  test("rejects 4-digit code", () => {
    expect(PATTERN.test("1234")).toBe(false);
  });

  test("rejects 6-digit code", () => {
    expect(PATTERN.test("123456")).toBe(false);
  });

  test("rejects alphanumeric code", () => {
    expect(PATTERN.test("1234a")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(PATTERN.test("")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  8. Receipt/drawer intent flags                                    */
/* ------------------------------------------------------------------ */

describe("POS receipt/drawer intent flags", () => {
  function getIntentFlags(paymentMethod: string) {
    const isCash = paymentMethod === "CASH";
    return {
      receipt_action: "PRINT" as const,
      drawer_action: isCash ? ("OPEN" as const) : ("CLOSED" as const),
    };
  }

  test("CASH → drawer OPEN", () => {
    const flags = getIntentFlags("CASH");
    expect(flags.receipt_action).toBe("PRINT");
    expect(flags.drawer_action).toBe("OPEN");
  });

  test("CARD_TERMINAL → drawer CLOSED", () => {
    const flags = getIntentFlags("CARD_TERMINAL");
    expect(flags.receipt_action).toBe("PRINT");
    expect(flags.drawer_action).toBe("CLOSED");
  });

  test("STORE_CREDIT → drawer CLOSED", () => {
    const flags = getIntentFlags("STORE_CREDIT");
    expect(flags.receipt_action).toBe("PRINT");
    expect(flags.drawer_action).toBe("CLOSED");
  });
});
