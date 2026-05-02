import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { formatUsdFromCents } from "../../common/utils/money";
import { PrismaService } from "../../database/prisma.service";
import {
  FIRST_ORDER_DEAL_CODE_PREFIX,
  FIRST_ORDER_DEAL_KINDS,
  firstOrderDealCode,
  isFirstOrderDealCode,
  normalizeFirstOrderDealPublicCode,
} from "./first-order-deal";

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

export type EvaluatedFirstOrderDeal = {
  promoCode: string;
  discountCents: number;
  waivesDelivery: boolean;
  redemptions: Array<{
    promoId: string;
    discountAmountCents: number;
  }>;
};

type PromoWithRelations = Prisma.PromoCodeGetPayload<{
  include: {
    bxgyRule: true;
  };
}>;

type FirstOrderPromoRow = Prisma.PromoCodeGetPayload<Record<string, never>>;

function getFirstOrderDealPublicCode(
  rulePayloadJson: unknown,
): string | undefined {
  if (!rulePayloadJson || typeof rulePayloadJson !== "object") {
    return undefined;
  }
  const payload = rulePayloadJson as { publicCode?: unknown };
  return typeof payload.publicCode === "string" ? payload.publicCode : undefined;
}

function getFirstOrderDealPublicCodeFromPromos(
  promos: FirstOrderPromoRow[],
): string {
  return normalizeFirstOrderDealPublicCode(
    promos
      .map((promo) => getFirstOrderDealPublicCode(promo.rulePayloadJson))
      .find((code): code is string => Boolean(code)),
  );
}

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

function serializeFirstOrderDealPromo(
  locationId: string,
  promos: FirstOrderPromoRow[],
) {
  const byCode = new Map(
    promos.map((promo) => [promo.code.toUpperCase(), promo]),
  );
  const orderedPromos = FIRST_ORDER_DEAL_KINDS.map((kind) =>
    byCode.get(firstOrderDealCode(locationId, kind)),
  ).filter((promo): promo is FirstOrderPromoRow => Boolean(promo));

  if (orderedPromos.length === 0) {
    return null;
  }

  const freeDelivery = orderedPromos.find(
    (promo) => promo.discountType === "FREE_DELIVERY",
  );
  const percent = orderedPromos.find(
    (promo) => promo.discountType === "PERCENT",
  );
  const fixed = orderedPromos.find(
    (promo) => promo.discountType === "FIXED_AMOUNT",
  );
  const benefitParts = [
    freeDelivery ? "Free delivery" : null,
    percent ? `${Number(percent.discountValue)}% off` : null,
    fixed
      ? `${formatUsdFromCents(Math.round(Number(fixed.discountValue)))} off`
      : null,
  ].filter((part): part is string => Boolean(part));
  const primary = percent ?? fixed ?? freeDelivery ?? orderedPromos[0];

  return {
    id: `first-order-deal:${locationId}`,
    code: getFirstOrderDealPublicCodeFromPromos(orderedPromos),
    name: "First order deal",
    discountType: primary.discountType,
    discountValue: Number(primary.discountValue),
    minSubtotalCents: 0,
    endsAt: null,
    startsAt: null,
    isOneTimePerCustomer: true,
    eligibleFulfillmentType: "BOTH",
    bxgyRule: null,
    autoApply: true,
    benefitSummary: benefitParts.join(" + "),
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

  async getActivePromos(locationId: string, userId?: string) {
    const now = new Date();
    const promos = await this.prisma.promoCode.findMany({
      where: {
        ...buildActivePromoWhere(now),
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
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

    const serializedPromos = promos.map((promo) => serializePromo(promo));
    if (!userId) {
      return serializedPromos;
    }

    const priorOrderCount = await this.prisma.order.count({
      where: {
        customerUserId: userId,
        status: { not: "CANCELLED" },
      },
    });
    if (priorOrderCount > 0) {
      return serializedPromos;
    }

    const firstOrderPromos = await this.prisma.promoCode.findMany({
      where: {
        code: {
          in: FIRST_ORDER_DEAL_KINDS.map((kind) =>
            firstOrderDealCode(locationId, kind),
          ),
        },
        ...buildActivePromoWhere(now),
        locationId,
      },
    });
    const firstOrderDeal = serializeFirstOrderDealPromo(
      locationId,
      firstOrderPromos,
    );

    return firstOrderDeal
      ? [firstOrderDeal, ...serializedPromos]
      : serializedPromos;
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
    if (isFirstOrderDealCode(code)) {
      throw new UnprocessableEntityException({
        message: "Invalid or expired promo code",
        field: "promo_code",
      });
    }

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

  async isFirstOrderDealPublicCode(params: {
    client?: DbClient;
    locationId: string;
    code?: string | null;
  }): Promise<boolean> {
    const code = params.code?.trim().toUpperCase();
    if (!code || isFirstOrderDealCode(code)) {
      return false;
    }

    const client = params.client ?? this.prisma;
    const promos = await client.promoCode.findMany({
      where: {
        code: {
          in: FIRST_ORDER_DEAL_KINDS.map((kind) =>
            firstOrderDealCode(params.locationId, kind),
          ),
        },
        locationId: params.locationId,
        ...buildActivePromoWhere(new Date()),
      },
    });

    return code === getFirstOrderDealPublicCodeFromPromos(promos);
  }

  async isFirstOrderCustomer(params: {
    client?: DbClient;
    userId?: string;
  }): Promise<boolean> {
    if (!params.userId) {
      return false;
    }

    const client = params.client ?? this.prisma;
    const priorOrderCount = await client.order.count({
      where: {
        customerUserId: params.userId,
        status: { not: "CANCELLED" },
      },
    });

    return priorOrderCount === 0;
  }

  async evaluateFirstOrderDeal(params: {
    client?: DbClient;
    locationId: string;
    userId?: string;
    itemSubtotalCents: number;
    deliveryFeeCents: number;
    fulfillmentType: "PICKUP" | "DELIVERY";
    existingDiscountCents?: number;
  }): Promise<EvaluatedFirstOrderDeal | null> {
    const client = params.client ?? this.prisma;
    const isFirstOrderCustomer = await this.isFirstOrderCustomer({
      client,
      userId: params.userId,
    });
    if (!isFirstOrderCustomer) {
      return null;
    }

    const promos = await client.promoCode.findMany({
      where: {
        code: {
          in: FIRST_ORDER_DEAL_KINDS.map((kind) =>
            firstOrderDealCode(params.locationId, kind),
          ),
        },
        ...buildActivePromoWhere(new Date()),
        locationId: params.locationId,
      },
    });
    if (promos.length === 0) {
      return null;
    }

    let remainingDiscountableCents = Math.max(
      0,
      params.itemSubtotalCents - (params.existingDiscountCents ?? 0),
    );
    let discountCents = 0;
    let waivesDelivery = false;
    const redemptions: EvaluatedFirstOrderDeal["redemptions"] = [];

    for (const promo of promos) {
      if (
        promo.eligibleFulfillmentType !== "BOTH" &&
        promo.eligibleFulfillmentType !== params.fulfillmentType
      ) {
        continue;
      }

      if (promo.discountType === "FREE_DELIVERY") {
        if (params.fulfillmentType !== "DELIVERY" || params.deliveryFeeCents <= 0) {
          continue;
        }
        waivesDelivery = true;
        redemptions.push({
          promoId: promo.id,
          discountAmountCents: params.deliveryFeeCents,
        });
        continue;
      }

      let candidateDiscountCents = 0;
      if (promo.discountType === "PERCENT") {
        candidateDiscountCents = Math.floor(
          params.itemSubtotalCents * (Number(promo.discountValue) / 100),
        );
      } else if (promo.discountType === "FIXED_AMOUNT") {
        candidateDiscountCents = Math.round(Number(promo.discountValue));
      }

      if (promo.maxDiscountCents != null) {
        candidateDiscountCents = Math.min(
          candidateDiscountCents,
          promo.maxDiscountCents,
        );
      }

      const appliedDiscountCents = Math.min(
        Math.max(0, candidateDiscountCents),
        remainingDiscountableCents,
      );
      if (appliedDiscountCents <= 0) {
        continue;
      }

      remainingDiscountableCents -= appliedDiscountCents;
      discountCents += appliedDiscountCents;
      redemptions.push({
        promoId: promo.id,
        discountAmountCents: appliedDiscountCents,
      });
    }

    if (discountCents <= 0 && !waivesDelivery) {
      return null;
    }

    return {
      promoCode: getFirstOrderDealPublicCodeFromPromos(promos),
      discountCents,
      waivesDelivery,
      redemptions,
    };
  }
}
