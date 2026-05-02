import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import {
  FIRST_ORDER_DEAL_CODE_PREFIX,
  FIRST_ORDER_DEAL_KINDS,
  firstOrderDealCode,
  type FirstOrderDealKind,
} from "../promotions/first-order-deal";

export type CreateUpdatePromoPayload = {
  code: string;
  name: string;
  discountType: "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";
  discountValue: number;
  minSubtotalCents: number;
  startsAt?: Date;
  endsAt?: Date;
  isOneTimePerCustomer: boolean;
  isActive: boolean;
  bxgyRule?: {
    qualifyingProductId?: string;
    qualifyingCategoryId?: string;
    requiredQty: number;
    rewardProductId?: string;
    rewardCategoryId?: string;
    rewardQty: number;
    rewardRule: string;
  };
  productTargets?: string[];
  categoryTargets?: string[];
};

export type FirstOrderDealPayload = {
  enabled: boolean;
  freeDelivery: boolean;
  percentOff?: number | null;
  fixedAmountCents?: number | null;
};

function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

function firstOrderDealName(kind: FirstOrderDealKind): string {
  if (kind === "FREE_DELIVERY") return "First order free delivery";
  if (kind === "PERCENT") return "First order percent off";
  return "First order fixed amount off";
}

@Injectable()
export class AdminPromosService {
  constructor(private readonly prisma: PrismaService) {}

  private validatePromoPayload(data: CreateUpdatePromoPayload) {
    const startsAt = data.startsAt ? new Date(data.startsAt) : null;
    const endsAt = data.endsAt ? new Date(data.endsAt) : null;

    if (startsAt && endsAt && startsAt > endsAt) {
      throw new BadRequestException("Promo end date must be after the start date");
    }

    if (data.discountType === "PERCENT" && (data.discountValue < 0 || data.discountValue > 100)) {
      throw new BadRequestException("Percent promos must be between 0 and 100");
    }

    if (data.discountType === "BXGY") {
      if (!data.bxgyRule) {
        throw new BadRequestException("Buy X Get Y promos require a reward rule");
      }
      if (data.bxgyRule.requiredQty < 1 || data.bxgyRule.rewardQty < 1) {
        throw new BadRequestException("Buy X Get Y quantities must be at least 1");
      }
    }
  }

  async listPromos(locationId: string) {
    return this.prisma.promoCode.findMany({
      where: {
        locationId,
        archivedAt: null,
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
      },
      orderBy: { createdAt: "desc" },
      include: {
        bxgyRule: true,
        productTargets: true,
        categoryTargets: true,
        redemptions: {
          select: { id: true },
        },
      },
    });
  }

  async getPromo(locationId: string, id: string) {
    const promo = await this.prisma.promoCode.findFirst({
      where: {
        id,
        locationId,
        archivedAt: null,
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
      },
      include: {
        bxgyRule: true,
        productTargets: true,
        categoryTargets: true,
      },
    });
    if (!promo) throw new NotFoundException("Promo code not found");
    return promo;
  }

  async createPromo(locationId: string, data: CreateUpdatePromoPayload) {
    this.validatePromoPayload(data);

    const normalizedCode = normalizePromoCode(data.code);
    const existing = await this.prisma.promoCode.findUnique({
      where: { code: normalizedCode },
    });
    if (existing) {
      throw new BadRequestException("Promo code already exists");
    }

    return this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.create({
        data: {
          code: normalizedCode,
          name: data.name,
          discountType: data.discountType,
          discountValue: data.discountValue,
          minSubtotalCents: data.minSubtotalCents,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          isOneTimePerCustomer: data.isOneTimePerCustomer,
          isActive: data.isActive,
          locationId,
          scopeType: "LOCATION_SCOPED",
        },
      });

      if (data.bxgyRule && data.discountType === "BXGY") {
        await tx.promoBxgyRule.create({
          data: {
            promoCodeId: promo.id,
            qualifyingProductId: data.bxgyRule.qualifyingProductId,
            qualifyingCategoryId: data.bxgyRule.qualifyingCategoryId,
            requiredQty: data.bxgyRule.requiredQty,
            rewardProductId: data.bxgyRule.rewardProductId,
            rewardCategoryId: data.bxgyRule.rewardCategoryId,
            rewardQty: data.bxgyRule.rewardQty,
            rewardRule: data.bxgyRule.rewardRule,
          },
        });
      }

      if (data.productTargets?.length) {
        await tx.promoCodeProductTarget.createMany({
          data: data.productTargets.map((menuItemId) => ({
            promoCodeId: promo.id,
            menuItemId,
          })),
        });
      }

      if (data.categoryTargets?.length) {
        await tx.promoCodeCategoryTarget.createMany({
          data: data.categoryTargets.map((menuCategoryId) => ({
            promoCodeId: promo.id,
            menuCategoryId,
          })),
        });
      }

      return promo;
    });
  }

  async updatePromo(locationId: string, id: string, data: CreateUpdatePromoPayload) {
    this.validatePromoPayload(data);

    const promo = await this.prisma.promoCode.findFirst({
      where: {
        id,
        locationId,
        archivedAt: null,
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
      },
    });
    if (!promo) throw new NotFoundException("Promo code not found");

    const normalizedCode = normalizePromoCode(data.code);
    const conflictingPromo = await this.prisma.promoCode.findFirst({
      where: {
        code: normalizedCode,
        id: { not: id },
      },
      select: { id: true },
    });
    if (conflictingPromo) {
      throw new BadRequestException("Promo code already exists");
    }

    return this.prisma.$transaction(async (tx) => {
      if (data.isActive && !promo.isActive) {
        // Re-activating: reset usage so every customer can use it again.
        await tx.promoRedemption.deleteMany({
          where: { promoCodeId: id },
        });
      }

      const updated = await tx.promoCode.update({
        where: { id },
        data: {
          code: normalizedCode,
          name: data.name,
          discountType: data.discountType,
          discountValue: data.discountValue,
          minSubtotalCents: data.minSubtotalCents,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          isOneTimePerCustomer: data.isOneTimePerCustomer,
          isActive: data.isActive,
          scopeType: "LOCATION_SCOPED",
          usageCount: data.isActive && !promo.isActive ? 0 : undefined,
        },
      });

      await tx.promoBxgyRule.deleteMany({ where: { promoCodeId: id } });
      if (data.discountType === "BXGY" && data.bxgyRule) {
        await tx.promoBxgyRule.create({
          data: {
            promoCodeId: id,
            qualifyingProductId: data.bxgyRule.qualifyingProductId,
            qualifyingCategoryId: data.bxgyRule.qualifyingCategoryId,
            requiredQty: data.bxgyRule.requiredQty,
            rewardProductId: data.bxgyRule.rewardProductId,
            rewardCategoryId: data.bxgyRule.rewardCategoryId,
            rewardQty: data.bxgyRule.rewardQty,
            rewardRule: data.bxgyRule.rewardRule,
          },
        });
      }

      await tx.promoCodeProductTarget.deleteMany({ where: { promoCodeId: id } });
      if (data.productTargets?.length) {
        await tx.promoCodeProductTarget.createMany({
          data: data.productTargets.map((menuItemId) => ({
            promoCodeId: id,
            menuItemId,
          })),
        });
      }

      await tx.promoCodeCategoryTarget.deleteMany({ where: { promoCodeId: id } });
      if (data.categoryTargets?.length) {
        await tx.promoCodeCategoryTarget.createMany({
          data: data.categoryTargets.map((menuCategoryId) => ({
            promoCodeId: id,
            menuCategoryId,
          })),
        });
      }

      return updated;
    });
  }

  async deletePromo(locationId: string, id: string) {
    return this.prisma.promoCode.updateMany({
      where: {
        id,
        locationId,
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
      },
      data: { archivedAt: new Date(), isActive: false },
    });
  }

  async getFirstOrderDeal(locationId: string) {
    const promos = await this.prisma.promoCode.findMany({
      where: {
        locationId,
        code: {
          in: FIRST_ORDER_DEAL_KINDS.map((kind) =>
            firstOrderDealCode(locationId, kind),
          ),
        },
      },
    });
    const byCode = new Map(promos.map((promo) => [promo.code.toUpperCase(), promo]));
    const freeDelivery = byCode.get(
      firstOrderDealCode(locationId, "FREE_DELIVERY"),
    );
    const percent = byCode.get(firstOrderDealCode(locationId, "PERCENT"));
    const fixed = byCode.get(firstOrderDealCode(locationId, "FIXED_AMOUNT"));

    return {
      enabled: promos.some((promo) => promo.archivedAt == null && promo.isActive),
      freeDelivery: Boolean(freeDelivery && freeDelivery.archivedAt == null),
      percentOff:
        percent && percent.archivedAt == null
          ? Number(percent.discountValue)
          : null,
      fixedAmountCents:
        fixed && fixed.archivedAt == null
          ? Math.round(Number(fixed.discountValue))
          : null,
    };
  }

  async updateFirstOrderDeal(locationId: string, data: FirstOrderDealPayload) {
    const percentOff =
      data.percentOff == null ? null : Number(data.percentOff);
    const fixedAmountCents =
      data.fixedAmountCents == null ? null : Math.round(Number(data.fixedAmountCents));
    const hasPercent = percentOff != null && percentOff > 0;
    const hasFixed = fixedAmountCents != null && fixedAmountCents > 0;
    const hasAnyDeal = Boolean(data.freeDelivery) || hasPercent || hasFixed;

    if (data.enabled && !hasAnyDeal) {
      throw new BadRequestException("Select at least one first-order deal");
    }
    if (hasPercent && (percentOff <= 0 || percentOff > 100)) {
      throw new BadRequestException("First-order percent must be between 1 and 100");
    }
    if (fixedAmountCents != null && fixedAmountCents < 0) {
      throw new BadRequestException("First-order dollar discount cannot be negative");
    }

    const desired = new Map<
      FirstOrderDealKind,
      { selected: boolean; discountValue: number }
    >([
      ["FREE_DELIVERY", { selected: Boolean(data.freeDelivery), discountValue: 0 }],
      ["PERCENT", { selected: hasPercent, discountValue: percentOff ?? 0 }],
      ["FIXED_AMOUNT", { selected: hasFixed, discountValue: fixedAmountCents ?? 0 }],
    ]);

    await this.prisma.$transaction(async (tx) => {
      for (const kind of FIRST_ORDER_DEAL_KINDS) {
        const config = desired.get(kind)!;
        const code = firstOrderDealCode(locationId, kind);
        const existing = await tx.promoCode.findUnique({ where: { code } });
        const isActive = data.enabled && config.selected;

        if (!existing && !config.selected) {
          continue;
        }

        const promoData = {
          name: firstOrderDealName(kind),
          discountType:
            kind === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : kind,
          discountValue: config.discountValue,
          minSubtotalCents: 0,
          startsAt: null,
          endsAt: null,
          isOneTimePerCustomer: false,
          isFirstOrderOnly: true,
          isActive,
          archivedAt: config.selected ? null : new Date(),
          eligibleFulfillmentType:
            kind === "FREE_DELIVERY" ? "DELIVERY" : "BOTH",
          locationId,
          scopeType: "LOCATION_SCOPED",
        } as const;

        if (existing) {
          await tx.promoCode.update({
            where: { id: existing.id },
            data: promoData,
          });
        } else {
          await tx.promoCode.create({
            data: {
              code,
              ...promoData,
            },
          });
        }
      }
    });

    return this.getFirstOrderDeal(locationId);
  }
}
