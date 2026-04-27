import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { formatUsdFromCents } from "../../common/utils/money";
import { PrismaService } from "../../database/prisma.service";

type DbClient = Prisma.TransactionClient | PrismaClient | PrismaService;

export type PromoPricingLine = {
  menuItemId: string;
  categoryId: string | null;
  quantity: number;
  unitPriceCents: number;
};

export type EvaluatedPromo = {
  promoId: string;
  promoCode: string;
  discountCents: number;
  redemptionValueCents: number;
  waivesDelivery: boolean;
};

type PromoWithRelations = Prisma.PromoCodeGetPayload<{
  include: {
    bxgyRule: true;
  };
}>;

function buildActivePromoWhere(now: Date): Prisma.PromoCodeWhereInput {
  return {
    archivedAt: null,
    isActive: true,
    AND: [
      {
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      },
      {
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
    ],
  };
}

function serializePromo(promo: PromoWithRelations) {
  return {
    id: promo.id,
    code: promo.code,
    name: promo.name,
    discountType: promo.discountType,
    discountValue: Number(promo.discountValue),
    minSubtotalCents: promo.minSubtotalCents,
    endsAt: promo.endsAt,
    startsAt: promo.startsAt,
    isOneTimePerCustomer: promo.isOneTimePerCustomer,
    eligibleFulfillmentType: promo.eligibleFulfillmentType,
    bxgyRule: promo.bxgyRule
      ? {
          qualifyingProductId: promo.bxgyRule.qualifyingProductId,
          qualifyingCategoryId: promo.bxgyRule.qualifyingCategoryId,
          requiredQty: promo.bxgyRule.requiredQty,
          rewardProductId: promo.bxgyRule.rewardProductId,
          rewardCategoryId: promo.bxgyRule.rewardCategoryId,
          rewardQty: promo.bxgyRule.rewardQty,
          rewardRule: promo.bxgyRule.rewardRule,
          maxUsesPerOrder: promo.bxgyRule.maxUsesPerOrder,
        }
      : null,
  };
}

function lineMatchesTarget(
  line: PromoPricingLine,
  productId?: string | null,
  categoryId?: string | null,
): boolean {
  if (productId) return line.menuItemId === productId;
  if (categoryId) return line.categoryId === categoryId;
  return true;
}

function computeBxgyDiscountCents(
  promo: PromoWithRelations,
  lines: PromoPricingLine[],
): number {
  const rule = promo.bxgyRule;
  if (!rule) return 0;

  const requiredQty = Math.max(1, rule.requiredQty);
  const rewardQty = Math.max(1, rule.rewardQty);
  const maxUsesPerOrder =
    rule.maxUsesPerOrder > 0 ? rule.maxUsesPerOrder : Number.MAX_SAFE_INTEGER;

  let totalQualifyingUnits = 0;
  const rewardUnits: Array<{ unitPriceCents: number; isQualifying: boolean }> =
    [];

  for (const line of lines) {
    const isQualifying = lineMatchesTarget(
      line,
      rule.qualifyingProductId,
      rule.qualifyingCategoryId,
    );
    const isReward = lineMatchesTarget(
      line,
      rule.rewardProductId,
      rule.rewardCategoryId,
    );

    if (isQualifying) {
      totalQualifyingUnits += line.quantity;
    }

    if (isReward) {
      for (let index = 0; index < line.quantity; index++) {
        rewardUnits.push({
          unitPriceCents: line.unitPriceCents,
          isQualifying,
        });
      }
    }
  }

  const maxUses = Math.min(
    Math.floor(totalQualifyingUnits / requiredQty),
    Math.floor(rewardUnits.length / rewardQty),
    maxUsesPerOrder,
  );
  if (maxUses <= 0) return 0;

  rewardUnits.sort((a, b) => {
    if (a.isQualifying !== b.isQualifying) {
      return Number(a.isQualifying) - Number(b.isQualifying);
    }
    return a.unitPriceCents - b.unitPriceCents;
  });

  for (let uses = maxUses; uses >= 1; uses--) {
    const rewardUnitsNeeded = uses * rewardQty;
    const chosenRewardUnits = rewardUnits.slice(0, rewardUnitsNeeded);
    const qualifyingUnitsConsumed = chosenRewardUnits.filter(
      (unit) => unit.isQualifying,
    ).length;
    const remainingQualifyingUnits =
      totalQualifyingUnits - qualifyingUnitsConsumed;

    if (remainingQualifyingUnits < uses * requiredQty) {
      continue;
    }

    return chosenRewardUnits.reduce(
      (sum, unit) => sum + unit.unitPriceCents,
      0,
    );
  }

  return 0;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivePromos(locationId: string) {
    const now = new Date();
    const promos = await this.prisma.promoCode.findMany({
      where: {
        ...buildActivePromoWhere(now),
        OR: [
          { locationId },
          { scopeType: "GLOBAL", locationId: null },
        ],
      },
      include: {
        bxgyRule: true,
      },
      orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
    });

    return promos.map((promo) => serializePromo(promo));
  }

  async evaluatePromo(params: {
    client?: DbClient;
    locationId: string;
    code: string;
    userId?: string;
    itemSubtotalCents: number;
    deliveryFeeCents: number;
    fulfillmentType: "PICKUP" | "DELIVERY";
    lines: PromoPricingLine[];
  }): Promise<EvaluatedPromo> {
    const client = params.client ?? this.prisma;
    const code = params.code.trim().toUpperCase();
    const promo = await client.promoCode.findFirst({
      where: {
        code,
        ...buildActivePromoWhere(new Date()),
        OR: [
          { locationId: params.locationId },
          { scopeType: "GLOBAL", locationId: null },
        ],
      },
      include: {
        bxgyRule: true,
      },
    });

    if (!promo) {
      throw new UnprocessableEntityException({
        message: "Invalid or expired promo code",
        field: "promo_code",
      });
    }

    if (
      promo.eligibleFulfillmentType !== "BOTH" &&
      promo.eligibleFulfillmentType !== params.fulfillmentType
    ) {
      throw new UnprocessableEntityException({
        message:
          promo.eligibleFulfillmentType === "DELIVERY"
            ? "This promo code is only valid for delivery orders"
            : "This promo code is only valid for pickup orders",
        field: "promo_code",
      });
    }

    if (promo.usageLimitTotal != null && promo.usageLimitTotal > 0) {
      const totalUsageCount = await client.promoRedemption.count({
        where: { promoCodeId: promo.id },
      });
      if (totalUsageCount >= promo.usageLimitTotal) {
        throw new UnprocessableEntityException({
          message: "This promo code has reached its usage limit",
          field: "promo_code",
        });
      }
    }

    const perCustomerLimit = promo.isOneTimePerCustomer
      ? 1
      : promo.usageLimitPerCustomer;
    if (perCustomerLimit != null && perCustomerLimit > 0 && params.userId) {
      const usage = await client.promoRedemption.count({
        where: {
          promoCodeId: promo.id,
          customerUserId: params.userId,
        },
      });
      if (usage >= perCustomerLimit) {
        throw new UnprocessableEntityException({
          message:
            perCustomerLimit === 1
              ? "This promo code can only be used once"
              : `This promo code can only be used ${perCustomerLimit} times per customer`,
          field: "promo_code",
        });
      }
    }

    if (promo.isFirstOrderOnly && params.userId) {
      const priorOrderCount = await client.order.count({
        where: {
          customerUserId: params.userId,
          status: { not: "CANCELLED" },
        },
      });
      if (priorOrderCount > 0) {
        throw new UnprocessableEntityException({
          message: "This promo code is only valid on a first order",
          field: "promo_code",
        });
      }
    }

    if (
      promo.minSubtotalCents > 0 &&
      params.itemSubtotalCents < promo.minSubtotalCents
    ) {
      throw new UnprocessableEntityException({
        message: `Minimum order of ${formatUsdFromCents(promo.minSubtotalCents)} required for this promo`,
        field: "promo_code",
      });
    }

    let discountCents = 0;
    let redemptionValueCents = 0;
    let waivesDelivery = false;

    if (promo.discountType === "PERCENT") {
      discountCents = Math.floor(
        params.itemSubtotalCents * (Number(promo.discountValue) / 100),
      );
      redemptionValueCents = discountCents;
    } else if (promo.discountType === "FIXED_AMOUNT") {
      discountCents = Math.min(
        params.itemSubtotalCents,
        Math.round(Number(promo.discountValue)),
      );
      redemptionValueCents = discountCents;
    } else if (promo.discountType === "FREE_DELIVERY") {
      if (params.fulfillmentType !== "DELIVERY") {
        throw new UnprocessableEntityException({
          message: "This promo code is only valid for delivery orders",
          field: "promo_code",
        });
      }
      if (params.deliveryFeeCents <= 0) {
        throw new UnprocessableEntityException({
          message: "Delivery is already free for this order",
          field: "promo_code",
        });
      }
      waivesDelivery = true;
      redemptionValueCents = params.deliveryFeeCents;
    } else if (promo.discountType === "BXGY") {
      discountCents = computeBxgyDiscountCents(promo, params.lines);
      if (discountCents <= 0) {
        throw new UnprocessableEntityException({
          message:
            "Cart does not meet requirements for this Buy X Get Y promo",
          field: "promo_code",
        });
      }
      redemptionValueCents = discountCents;
    }

    if (promo.maxDiscountCents != null) {
      discountCents = Math.min(discountCents, promo.maxDiscountCents);
      redemptionValueCents = Math.min(
        redemptionValueCents,
        promo.maxDiscountCents,
      );
    }

    return {
      promoId: promo.id,
      promoCode: promo.code,
      discountCents,
      redemptionValueCents,
      waivesDelivery,
    };
  }
}
