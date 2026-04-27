import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

/** Stamps required to unlock one "1lb of wings free" reward. */
export const STAMPS_PER_REWARD = 8;

/** Ledger entry types persisted to `customer_wings_stamp_ledger.entry_type`. */
const LEDGER_ENTRY = {
  EARNED: "EARNED",
  REDEEMED: "REDEEMED",
} as const;

type TxClient = Prisma.TransactionClient | PrismaClient;

/** Minimal cart-line shape we need to evaluate wings-reward eligibility. */
export interface WingsCartLine {
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  builderPayload?: Record<string, unknown> | null;
}

export interface WingsRewardEligibility {
  /** True iff user has >=8 available stamps AND cart has >=1lb of wings. */
  eligible: boolean;
  availableStamps: number;
  /** Pounds of wings detected in the cart (sum over wing lines). */
  poundsInCart: number;
  /** Discount in cents for a single free pound (price of the cheapest per-lb wing line). */
  freeWingsDiscountCents: number;
  /**
   * Human-readable reason when !eligible — surfaced to the client so the
   * cart modal can show something like "Add 1lb of wings to use this reward".
   */
  notEligibleReason:
    | null
    | "NOT_SIGNED_IN"
    | "NOT_ENOUGH_STAMPS"
    | "NO_WINGS_IN_CART";
}

function isWingsLine(payload?: Record<string, unknown> | null): boolean {
  const t = payload?.builder_type;
  return t === "WINGS" || t === "WING_COMBO";
}

function extractWeightLb(payload?: Record<string, unknown> | null): number {
  const raw = payload?.weight_lb;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return 0;
}

/**
 * Compute, from a set of cart lines, how many pounds of wings they represent
 * and the cheapest per-lb price. The per-lb price is used to discount exactly
 * one pound when the free-wings reward is applied — we always discount the
 * cheapest pound so the user never overpays for the redemption.
 */
export function summarizeWingsInCart(lines: WingsCartLine[]): {
  poundsInCart: number;
  cheapestPerLbCents: number;
} {
  let totalPounds = 0;
  let cheapestPerLbCents = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    if (!isWingsLine(line.builderPayload)) continue;
    const weightLb = extractWeightLb(line.builderPayload);
    if (weightLb <= 0 || line.quantity <= 0) continue;

    totalPounds += weightLb * line.quantity;

    // unit price is for (1 line item) which contains `weightLb` pounds.
    const perLb = line.unitPriceCents / weightLb;
    if (perLb < cheapestPerLbCents) cheapestPerLbCents = perLb;
  }

  return {
    poundsInCart: totalPounds,
    cheapestPerLbCents:
      cheapestPerLbCents === Number.POSITIVE_INFINITY
        ? 0
        : Math.round(cheapestPerLbCents),
  };
}

@Injectable()
export class RewardsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the user's current stamps summary (creating the row if missing). */
  async getSummary(userId: string) {
    return this.prisma.customerWingsRewards.upsert({
      where: { customerUserId: userId },
      update: {},
      create: { customerUserId: userId },
    });
  }

  /** Paginated ledger of stamp earn/redeem events for the profile UI. */
  async getLedger(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 100);

    const entries = await this.prisma.customerWingsStampLedger.findMany({
      where: { customerUserId: userId },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        order: {
          select: { id: true, orderNumber: true, fulfillmentType: true },
        },
      },
    });

    const hasMore = entries.length > take;
    const page = hasMore ? entries.slice(0, take) : entries;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { entries: page, next_cursor: nextCursor };
  }

  /**
   * Compute wings-reward eligibility + discount preview for the given cart.
   * Pure read — safe to call from /cart/quote. `userId` undefined -> not signed in.
   */
  async computeEligibility(
    userId: string | undefined,
    lines: WingsCartLine[],
  ): Promise<WingsRewardEligibility> {
    const { poundsInCart, cheapestPerLbCents } = summarizeWingsInCart(lines);

    if (!userId) {
      return {
        eligible: false,
        availableStamps: 0,
        poundsInCart,
        freeWingsDiscountCents: 0,
        notEligibleReason: "NOT_SIGNED_IN",
      };
    }

    const summary = await this.getSummary(userId);
    const availableStamps = summary.availableStamps;

    if (availableStamps < STAMPS_PER_REWARD) {
      return {
        eligible: false,
        availableStamps,
        poundsInCart,
        freeWingsDiscountCents: 0,
        notEligibleReason: "NOT_ENOUGH_STAMPS",
      };
    }

    if (poundsInCart < 1) {
      return {
        eligible: false,
        availableStamps,
        poundsInCart,
        freeWingsDiscountCents: 0,
        notEligibleReason: "NO_WINGS_IN_CART",
      };
    }

    return {
      eligible: true,
      availableStamps,
      poundsInCart,
      freeWingsDiscountCents: cheapestPerLbCents,
      notEligibleReason: null,
    };
  }

  /**
   * Atomically redeem 8 stamps and create a REDEEMED ledger row pointing at
   * `orderId`. Called from inside the checkout transaction. Re-validates
   * balance against a fresh read to avoid races: if the user somehow lost
   * stamps between quote and checkout (e.g. concurrent redemption), fail
   * closed with a 422 so the client can show a clear message.
   */
  async redeemForOrderInTransaction(
    tx: TxClient,
    userId: string,
    orderId: string,
  ): Promise<void> {
    const existingRedemption = await tx.customerWingsStampLedger.findFirst({
      where: {
        orderId,
        entryType: LEDGER_ENTRY.REDEEMED,
      },
      select: { id: true },
    });
    if (existingRedemption) return;

    await tx.customerWingsRewards.upsert({
      where: { customerUserId: userId },
      update: {},
      create: { customerUserId: userId },
    });

    // Conditional decrement keeps the balance from ever going negative when
    // two checkout attempts race the same 8-stamp card.
    const debitResult = await tx.customerWingsRewards.updateMany({
      where: {
        customerUserId: userId,
        availableStamps: { gte: STAMPS_PER_REWARD },
      },
      data: {
        availableStamps: { decrement: STAMPS_PER_REWARD },
        lifetimeRedemptions: { increment: 1 },
      },
    });

    if (debitResult.count === 0) {
      throw new UnprocessableEntityException({
        message: "Not enough stamps to redeem free wings reward",
        field: "apply_wings_reward",
      });
    }

    const updated = await tx.customerWingsRewards.findUniqueOrThrow({
      where: { customerUserId: userId },
      select: { availableStamps: true },
    });

    await tx.customerWingsStampLedger.create({
      data: {
        customerUserId: userId,
        orderId,
        entryType: LEDGER_ENTRY.REDEEMED,
        deltaStamps: -STAMPS_PER_REWARD,
        balanceAfterStamps: updated.availableStamps,
        poundsAwarded: null,
        reasonText: "Redeemed 1lb of wings free",
      },
    });
  }

  /**
   * Accrue stamps for a newly completed order (status -> DELIVERED or PICKED_UP).
   *
   * Stamping rules:
   *   - 1 stamp per whole pound of wings (`floor(sum(weight_lb * quantity))`
   *     across wing lines).
   *   - `availableStamps` is capped at `STAMPS_PER_REWARD` (8). Extra paid
   *     pounds are recorded in the ledger reason text, but the redeemable
   *     balance itself does not stockpile past one reward.
   *   - Idempotent: skipped if a ledger row of type EARNED already exists
   *     for `orderId`. The DB also backs this with a unique
   *     `(order_id, entry_type)` constraint so a replay cannot double-credit.
   *
   * Must run inside the caller's transaction so status + stamps are atomic.
   */
  async accrueForOrderInTransaction(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerUserId: true,
        orderItems: {
          select: {
            quantity: true,
            builderType: true,
            builderPayloadJson: true,
          },
        },
      },
    });

    if (!order) return;

    const existing = await tx.customerWingsStampLedger.findFirst({
      where: {
        orderId: order.id,
        entryType: LEDGER_ENTRY.EARNED,
      },
      select: { id: true },
    });
    if (existing) return;

    const poundsExact = order.orderItems.reduce((acc, item) => {
      if (item.builderType !== "WINGS" && item.builderType !== "WING_COMBO") {
        return acc;
      }
      const payload = item.builderPayloadJson as Record<string, unknown> | null;
      const weightLb = extractWeightLb(payload);
      return acc + weightLb * item.quantity;
    }, 0);

    // If this order also redeemed a free-wings reward (1lb for 8 stamps),
    // that 1lb was not paid for by the customer, so it must not accrue new
    // stamps. Otherwise a customer on 8 stamps could redeem 1lb and
    // immediately earn a stamp back — trivially farming the program.
    //
    //   cart = 1lb wings + redeem  -> 1 - 1 = 0lb -> 0 stamps
    //   cart = 2lb wings + redeem  -> 2 - 1 = 1lb -> 1 stamp
    //   cart = 3.5lb wings + redeem -> 3.5 - 1 = 2.5lb -> floor = 2 stamps
    //
    // We look this up from the ledger (same transaction) rather than from
    // a new order column so there's one source of truth: the REDEEMED row
    // is written by `redeemForOrderInTransaction` in the same tx as
    // order.create, so it's guaranteed visible here when relevant.
    const redeemedEntry = await tx.customerWingsStampLedger.findFirst({
      where: { orderId: order.id, entryType: LEDGER_ENTRY.REDEEMED },
      select: { id: true },
    });
    const freePounds = redeemedEntry ? 1 : 0;
    const payablePounds = Math.max(0, poundsExact - freePounds);

    const stampsEarned = Math.floor(payablePounds);
    if (stampsEarned <= 0) return;

    // Cap balance at the redemption target (8). Earning a 9th+ pound
    // before redeeming does NOT accrue — the customer must redeem first.
    // This is the product-team decision; if you want to allow stockpiling
    // multiple rewards, raise this cap and the ledger `reason_text` below
    // will note how many stamps were skipped.
    const MAX_BALANCE = STAMPS_PER_REWARD;

    const summary = await tx.customerWingsRewards.upsert({
      where: { customerUserId: order.customerUserId },
      update: {},
      create: { customerUserId: order.customerUserId },
    });

    const room = Math.max(0, MAX_BALANCE - summary.availableStamps);
    const stampsToCredit = Math.min(stampsEarned, room);

    const updated = await tx.customerWingsRewards.update({
      where: { customerUserId: order.customerUserId },
      data: {
        availableStamps: { increment: stampsToCredit },
        lifetimeStamps: { increment: stampsEarned },
      },
    });

    // `poundsAwarded` reflects the paid pounds that generated these stamps,
    // not the raw cart weight, so the profile ledger reads correctly when a
    // redemption was also applied on the same order (e.g. "Earned 1 stamp
    // for 1.00lb of wings" on a 2lb-with-redeem order).
    const redeemedNote = redeemedEntry ? " (1lb redeemed, not counted)" : "";
    await tx.customerWingsStampLedger.create({
      data: {
        customerUserId: order.customerUserId,
        orderId: order.id,
        entryType: LEDGER_ENTRY.EARNED,
        deltaStamps: stampsToCredit,
        balanceAfterStamps: updated.availableStamps,
        poundsAwarded: payablePounds,
        reasonText:
          stampsToCredit < stampsEarned
            ? `Earned ${stampsEarned} stamps (${stampsToCredit} credited, ${stampsEarned - stampsToCredit} skipped — balance cap)${redeemedNote}`
            : `Earned ${stampsEarned} stamp${stampsEarned === 1 ? "" : "s"} for ${payablePounds.toFixed(2)}lb of wings${redeemedNote}`,
      },
    });
  }
}
