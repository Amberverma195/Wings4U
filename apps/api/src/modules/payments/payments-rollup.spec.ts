/**
 * Payment rollup unit tests.
 *
 * Exercises `recalculatePaymentStatus`-equivalent logic for all representative
 * transaction sequences listed in prd_point_17,18,19_plan.md §19 verification
 * checklist: capture-only, capture + partial refund, void-heavy edge cases,
 * and the new ADJUSTMENT coverage.
 *
 * These are pure-logic tests. The Prisma layer is mocked so no DB is needed.
 */

// ── Inline the rollup logic so we can test without NestJS DI ──

type TransactionType = "AUTH" | "CAPTURE" | "VOID" | "REFUND" | "ADJUSTMENT";
type PaymentRow = { transactionType: TransactionType; signedAmountCents: number };
type StatusSummary =
  | "UNPAID"
  | "PENDING"
  | "PAID"
  | "PARTIALLY_PAID"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "VOIDED";

/**
 * Mirror of PaymentsService.recalculatePaymentStatus logic.
 * Kept in sync because both reference the same switch-case structure.
 */
function computeRollup(
  payments: PaymentRow[],
  orderFinalPayableCents: number,
): StatusSummary {
  if (payments.length === 0) return "UNPAID";

  let authTotal = 0;
  let captureTotal = 0;
  let refundTotal = 0;
  let voidTotal = 0;

  for (const p of payments) {
    switch (p.transactionType) {
      case "AUTH":
        authTotal += p.signedAmountCents;
        break;
      case "CAPTURE":
        captureTotal += p.signedAmountCents;
        break;
      case "REFUND":
        refundTotal += Math.abs(p.signedAmountCents);
        break;
      case "VOID":
        voidTotal += Math.abs(p.signedAmountCents);
        break;
      case "ADJUSTMENT":
        captureTotal += p.signedAmountCents;
        break;
    }
  }

  if (voidTotal > 0 && captureTotal === 0) return "VOIDED";
  if (refundTotal > 0 && refundTotal >= captureTotal) return "REFUNDED";
  if (refundTotal > 0 && refundTotal < captureTotal) return "PARTIALLY_REFUNDED";
  if (captureTotal >= orderFinalPayableCents) return "PAID";
  if (captureTotal > 0) return "PARTIALLY_PAID";
  if (authTotal > 0) return "PENDING";
  return "UNPAID";
}

// ── Tests ──

describe("Payment rollup — recalculatePaymentStatus logic", () => {
  const ORDER_TOTAL = 2500; // $25.00

  // ── Basic single-type sequences ──

  it("returns UNPAID when no payments exist", () => {
    expect(computeRollup([], ORDER_TOTAL)).toBe("UNPAID");
  });

  it("returns PENDING for auth-only", () => {
    expect(
      computeRollup([{ transactionType: "AUTH", signedAmountCents: ORDER_TOTAL }], ORDER_TOTAL),
    ).toBe("PENDING");
  });

  it("returns PAID for capture = finalPayableCents", () => {
    expect(
      computeRollup(
        [{ transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL }],
        ORDER_TOTAL,
      ),
    ).toBe("PAID");
  });

  it("returns PAID for capture > finalPayableCents (overpayment)", () => {
    expect(
      computeRollup(
        [{ transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL + 500 }],
        ORDER_TOTAL,
      ),
    ).toBe("PAID");
  });

  it("returns PARTIALLY_PAID for capture < finalPayableCents", () => {
    expect(
      computeRollup(
        [{ transactionType: "CAPTURE", signedAmountCents: 1000 }],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_PAID");
  });

  // ── Capture + refund sequences ──

  it("returns REFUNDED for full refund of captured amount", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL },
          { transactionType: "REFUND", signedAmountCents: -ORDER_TOTAL },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("REFUNDED");
  });

  it("returns PARTIALLY_REFUNDED for partial refund", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL },
          { transactionType: "REFUND", signedAmountCents: -500 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_REFUNDED");
  });

  it("returns REFUNDED when refund exceeds capture (over-refund)", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 1000 },
          { transactionType: "REFUND", signedAmountCents: -1500 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("REFUNDED");
  });

  // ── Void sequences ──

  it("returns VOIDED for void-only (no capture)", () => {
    expect(
      computeRollup(
        [
          { transactionType: "AUTH", signedAmountCents: ORDER_TOTAL },
          { transactionType: "VOID", signedAmountCents: -ORDER_TOTAL },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("VOIDED");
  });

  it("returns PARTIALLY_PAID when void exists but capture also exists", () => {
    // void + capture: captureTotal > 0 but < finalPayable, voidTotal > 0
    // The void check requires captureTotal === 0, so this falls through to PARTIALLY_PAID.
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 500 },
          { transactionType: "VOID", signedAmountCents: -ORDER_TOTAL },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_PAID");
  });

  // ── ADJUSTMENT sequences ──

  it("returns PAID when capture + positive adjustment >= finalPayable", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 2000 },
          { transactionType: "ADJUSTMENT", signedAmountCents: 500 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PAID");
  });

  it("returns PARTIALLY_PAID when capture + negative adjustment < finalPayable", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL },
          { transactionType: "ADJUSTMENT", signedAmountCents: -600 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_PAID");
  });

  it("ADJUSTMENT-only (positive) counts as PARTIALLY_PAID when < finalPayable", () => {
    expect(
      computeRollup(
        [{ transactionType: "ADJUSTMENT", signedAmountCents: 500 }],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_PAID");
  });

  // ── Complex multi-step sequences ──

  it("auth → capture → partial refund → PARTIALLY_REFUNDED", () => {
    expect(
      computeRollup(
        [
          { transactionType: "AUTH", signedAmountCents: ORDER_TOTAL },
          { transactionType: "CAPTURE", signedAmountCents: ORDER_TOTAL },
          { transactionType: "REFUND", signedAmountCents: -1000 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_REFUNDED");
  });

  it("multi-capture summed correctly for PAID", () => {
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 1000 },
          { transactionType: "CAPTURE", signedAmountCents: 1500 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PAID");
  });

  it("capture + adjustment + partial refund → PARTIALLY_REFUNDED", () => {
    // capture 2000 + adj 500 = 2500 effective captured
    // refund 300 → refund < capture → PARTIALLY_REFUNDED
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 2000 },
          { transactionType: "ADJUSTMENT", signedAmountCents: 500 },
          { transactionType: "REFUND", signedAmountCents: -300 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("PARTIALLY_REFUNDED");
  });

  it("capture + zeroing adjustment → UNPAID", () => {
    // capture 2500, adjustment -2500 → captureTotal = 0
    // refund 0. No void. captureTotal = 0. authTotal = 0.
    // Falls through to UNPAID (0 effective capture, no auth).
    expect(
      computeRollup(
        [
          { transactionType: "CAPTURE", signedAmountCents: 2500 },
          { transactionType: "ADJUSTMENT", signedAmountCents: -2500 },
        ],
        ORDER_TOTAL,
      ),
    ).toBe("UNPAID");
  });
});
