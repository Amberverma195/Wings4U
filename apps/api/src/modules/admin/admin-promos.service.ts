import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

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

function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
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
      where: { locationId, archivedAt: null },
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
      where: { id, locationId, archivedAt: null },
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
      where: { id, locationId, archivedAt: null },
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
      where: { id, locationId },
      data: { archivedAt: new Date(), isActive: false },
    });
  }
}
