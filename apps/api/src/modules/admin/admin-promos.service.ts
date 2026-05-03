import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import {
  FIRST_ORDER_DEAL_CODE_PREFIX,
  FIRST_ORDER_DEAL_KINDS,
  firstOrderDealCode,
  isFirstOrderDealCode,
  normalizeFirstOrderDealPublicCode,
  type FirstOrderDealKind,
} from "../promotions/first-order-deal";
import {
  readBxgyExtras,
  withBxgyExtras,
  type BxgyExtras,
  type BxgySizeFilter,
} from "../promotions/bxgy-rule-payload";

export type CreateUpdateBxgySizeInput = {
  kind: "weight_lb" | "modifier_option";
  weightLb?: number | null;
  modifierOptionId?: string | null;
  label?: string | null;
};

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
  eligibleFulfillmentType?: "BOTH" | "PICKUP" | "DELIVERY";
  bxgyRule?: {
    qualifyingProductId?: string;
    qualifyingCategoryId?: string;
    requiredQty: number;
    rewardProductId?: string;
    rewardCategoryId?: string;
    rewardQty: number;
    rewardRule: string;
    qualifyingSize?: CreateUpdateBxgySizeInput | null;
    rewardSize?: CreateUpdateBxgySizeInput | null;
    qualifyingLabel?: string | null;
    rewardLabel?: string | null;
  };
  productTargets?: string[];
  categoryTargets?: string[];
};

export type FirstOrderDealPayload = {
  couponCode?: string | null;
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

function getFirstOrderDealPublicCode(
  rulePayloadJson: unknown,
): string | undefined {
  if (!rulePayloadJson || typeof rulePayloadJson !== "object") {
    return undefined;
  }
  const payload = rulePayloadJson as { publicCode?: unknown };
  return typeof payload.publicCode === "string" ? payload.publicCode : undefined;
}

type ItemForSize = {
  builderType: string | null;
  modifierGroups: Array<{
    contextKey?: string | null;
    modifierGroup?: {
      contextKey?: string | null;
      options?: Array<{
        id: string;
        name: string;
        priceDeltaCents?: number;
      }>;
    };
  }>;
};

function extractWingWeightLbFromName(name: string): number {
  const wingsMatch = name.match(/(\d+)\s*wings/i);
  if (wingsMatch) {
    const wingCount = Number.parseInt(wingsMatch[1] ?? "", 10);
    return Number.isFinite(wingCount)
      ? Number((wingCount / 15).toFixed(2))
      : 0;
  }

  const poundsMatch = name.match(/([\d.]+)\s*pound/i);
  if (!poundsMatch) return 0;
  const weight = Number.parseFloat(poundsMatch[1] ?? "");
  return Number.isFinite(weight) ? weight : 0;
}

function getSizeContextOptions(item: ItemForSize) {
  const sizeGroup = item.modifierGroups.find((link) => {
    const context = link.contextKey ?? link.modifierGroup?.contextKey ?? null;
    return context === "size";
  });
  return sizeGroup?.modifierGroup?.options ?? [];
}

function itemHasMultipleSizes(item: ItemForSize): boolean {
  if (item.builderType === "WINGS" || item.builderType === "WING_COMBO") {
    return true;
  }
  return getSizeContextOptions(item).length >= 2;
}

type SerializedSize =
  | {
      kind: "weight_lb";
      weightLb: number;
      label: string;
      menuItemId: string;
    }
  | {
      kind: "modifier_option";
      modifierOptionId: string;
      label: string;
      priceDeltaCents: number;
    };

function collectItemSizes(
  item: ItemForSize & { id: string; name: string },
): SerializedSize[] {
  if (item.builderType === "WINGS" || item.builderType === "WING_COMBO") {
    const weightLb = extractWingWeightLbFromName(item.name) || 1;
    return [
      {
        kind: "weight_lb",
        weightLb,
        label: `${weightLb}lb`,
        menuItemId: item.id,
      },
    ];
  }

  return getSizeContextOptions(item).map((option) => ({
    kind: "modifier_option" as const,
    modifierOptionId: option.id,
    label: option.name,
    priceDeltaCents: option.priceDeltaCents ?? 0,
  }));
}

function normalizeBxgySize(
  input: CreateUpdateBxgySizeInput | null | undefined,
): BxgySizeFilter | null {
  if (!input) return null;

  if (input.kind === "weight_lb") {
    const weightLb = Number(input.weightLb);
    if (!Number.isFinite(weightLb) || weightLb <= 0) return null;
    return {
      kind: "weight_lb",
      weightLb,
      label: input.label?.trim() || `${weightLb}lb`,
    };
  }

  if (input.kind === "modifier_option") {
    if (!input.modifierOptionId) return null;
    return {
      kind: "modifier_option",
      modifierOptionId: input.modifierOptionId,
      label: input.label?.trim() || "Selected size",
    };
  }

  return null;
}

function buildBxgyExtras(
  bxgyRule: CreateUpdatePromoPayload["bxgyRule"],
): BxgyExtras | null {
  if (!bxgyRule) return null;

  const qualifyingSize = normalizeBxgySize(bxgyRule.qualifyingSize);
  const rewardSize = normalizeBxgySize(bxgyRule.rewardSize);
  const qualifyingLabel =
    bxgyRule.qualifyingLabel?.trim() || qualifyingSize?.label || null;
  const rewardLabel =
    bxgyRule.rewardLabel?.trim() || rewardSize?.label || null;

  if (!qualifyingSize && !rewardSize && !qualifyingLabel && !rewardLabel) {
    return null;
  }

  return {
    qualifyingSize,
    rewardSize,
    labels: {
      qualifying: qualifyingLabel,
      reward: rewardLabel,
    },
  };
}

function serializePromoForAdmin<
  T extends {
    rulePayloadJson: unknown;
    bxgyRule:
      | null
      | {
          qualifyingProductId: string | null;
          qualifyingCategoryId: string | null;
          requiredQty: number;
          rewardProductId: string | null;
          rewardCategoryId: string | null;
          rewardQty: number;
          rewardRule: string;
          maxUsesPerOrder: number;
        };
  },
>(promo: T) {
  const extras = readBxgyExtras(promo.rulePayloadJson);
  return {
    ...promo,
    bxgyRule: promo.bxgyRule
      ? {
          ...promo.bxgyRule,
          qualifyingSize: extras.qualifyingSize,
          rewardSize: extras.rewardSize,
          qualifyingLabel: extras.labels.qualifying,
          rewardLabel: extras.labels.reward,
        }
      : null,
  };
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
      if (
        data.bxgyRule.qualifyingSize &&
        !normalizeBxgySize(data.bxgyRule.qualifyingSize)
      ) {
        throw new BadRequestException("Choose a valid qualifying size");
      }
      if (
        data.bxgyRule.rewardSize &&
        !normalizeBxgySize(data.bxgyRule.rewardSize)
      ) {
        throw new BadRequestException("Choose a valid reward size");
      }
    }
  }

  private resolveEligibleFulfillmentType(
    data: CreateUpdatePromoPayload,
  ): "BOTH" | "PICKUP" | "DELIVERY" {
    if (data.discountType === "FREE_DELIVERY") return "DELIVERY";
    return data.eligibleFulfillmentType ?? "BOTH";
  }

  async listPromos(locationId: string) {
    const promos = await this.prisma.promoCode.findMany({
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
    return promos.map((promo) => serializePromoForAdmin(promo));
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
    return serializePromoForAdmin(promo);
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

    const eligibleFulfillmentType = this.resolveEligibleFulfillmentType(data);
    const bxgyExtras =
      data.discountType === "BXGY" ? buildBxgyExtras(data.bxgyRule) : null;
    const rulePayloadJson = withBxgyExtras(
      {},
      bxgyExtras,
    ) as Prisma.InputJsonValue;

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
          eligibleFulfillmentType,
          rulePayloadJson,
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

    const eligibleFulfillmentType = this.resolveEligibleFulfillmentType(data);
    const bxgyExtras =
      data.discountType === "BXGY" ? buildBxgyExtras(data.bxgyRule) : null;
    const rulePayloadJson = withBxgyExtras(
      promo.rulePayloadJson,
      bxgyExtras,
    ) as Prisma.InputJsonValue;

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
          eligibleFulfillmentType,
          rulePayloadJson,
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

  async listTargetCategories(locationId: string) {
    const categories = await this.prisma.menuCategory.findMany({
      where: { locationId, archivedAt: null, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        menuItems: {
          where: {
            archivedAt: null,
            isAvailable: true,
            isHidden: false,
          },
          select: {
            id: true,
            builderType: true,
            modifierGroups: {
              select: {
                contextKey: true,
                modifierGroup: {
                  select: {
                    contextKey: true,
                    options: {
                      where: { isActive: true },
                      select: {
                        id: true,
                        name: true,
                        priceDeltaCents: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return categories
      .filter((category) => category.menuItems.length > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        itemCount: category.menuItems.length,
        hasMultiSizeItems: category.menuItems.some((item) =>
          itemHasMultipleSizes(item),
        ),
      }));
  }

  async listTargetCategoryItems(locationId: string, categoryId: string) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, locationId, archivedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) throw new NotFoundException("Menu category not found");

    const items = await this.prisma.menuItem.findMany({
      where: {
        locationId,
        categoryId,
        archivedAt: null,
        isAvailable: true,
        isHidden: false,
      },
      orderBy: [{ name: "asc" }],
      include: {
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      builderType: item.builderType,
      sizes: collectItemSizes(item),
    }));
  }

  async listTargetItemSizes(locationId: string, itemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: itemId,
        locationId,
        archivedAt: null,
        isAvailable: true,
        isHidden: false,
      },
      include: {
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("Menu item not found");

    return {
      id: item.id,
      name: item.name,
      builderType: item.builderType,
      sizes: collectItemSizes(item),
    };
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
    const publicCode = normalizeFirstOrderDealPublicCode(
      getFirstOrderDealPublicCode(
        freeDelivery?.rulePayloadJson ??
          percent?.rulePayloadJson ??
          fixed?.rulePayloadJson,
      ),
    );

    return {
      couponCode: publicCode,
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
    const publicCode = normalizeFirstOrderDealPublicCode(data.couponCode);
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
    if (!/^[A-Z0-9_-]{3,32}$/.test(publicCode)) {
      throw new BadRequestException(
        "First-order coupon code must be 3-32 letters, numbers, underscores, or dashes",
      );
    }
    if (isFirstOrderDealCode(publicCode)) {
      throw new BadRequestException("Choose a customer-facing coupon code");
    }
    const conflictingPromo = await this.prisma.promoCode.findFirst({
      where: {
        code: publicCode,
        archivedAt: null,
        NOT: { code: { startsWith: FIRST_ORDER_DEAL_CODE_PREFIX } },
      },
      select: { id: true },
    });
    if (conflictingPromo) {
      throw new BadRequestException("Coupon code already exists");
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
          rulePayloadJson: { publicCode },
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
