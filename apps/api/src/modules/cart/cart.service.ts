import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { formatUsdFromCents } from "../../common/utils/money";
import { assertDeliveryAvailable } from "../../common/utils/delivery-availability";
import { PrismaService } from "../../database/prisma.service";
import {
  assertCustomerMayUseDelivery,
  documentFuturePrepaymentPolicy,
  getDeliveryEligibilityForCustomer,
} from "../customers/no-show-policy";
import { RewardsService } from "../rewards/rewards.service";
import { PromotionsService } from "../promotions/promotions.service";
import {
  type RemovedIngredientInput,
  type PricingPolicy,
  computePricing as computePricingShared,
  getBuilderPriceDelta,
  parseRemovedIngredients,
  getSaladCustomization,
} from "../shared/pricing";
import {
  assertLocationOpenForFulfillment,
  assertMenuItemOrderable,
  assertModifierOptionAllowedForItem,
  assertWingFlavoursOrderable,
  collectScheduleViolation,
  collectWingFlavourRefs,
  getScheduleContext,
  loadWingFlavourMapForRefs,
  throwScheduleViolations,
} from "../shared/order-validation";

type CartItemInput = {
  menu_item_id: string;
  quantity: number;
  modifier_selections?: { modifier_option_id: string }[];
  removed_ingredients?: RemovedIngredientInput[];
  special_instructions?: string;
  builder_payload?: Record<string, unknown>;
};

function getRemovedIngredients(cartItem: CartItemInput): RemovedIngredientInput[] {
  if (cartItem.removed_ingredients?.length) {
    return cartItem.removed_ingredients;
  }

  const payload = cartItem.builder_payload;
  if (!payload || payload.builder_type !== "ITEM_CUSTOMIZATION") {
    return [];
  }

  const removedIngredients = payload.removed_ingredients;
  if (!Array.isArray(removedIngredients)) {
    return [];
  }

  return removedIngredients
    .filter((ingredient): ingredient is RemovedIngredientInput => {
      if (!ingredient || typeof ingredient !== "object") return false;
      const candidate = ingredient as RemovedIngredientInput;
      return typeof candidate.id === "string" && typeof candidate.name === "string";
    });
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewardsService: RewardsService,
    private readonly promotionsService: PromotionsService,
  ) {}

  async computeQuote(
    locationId: string,
    fulfillmentType: "PICKUP" | "DELIVERY",
    items: CartItemInput[],
    promoCode?: string,
    driverTipCents = 0,
    walletAppliedCents = 0,
    scheduledFor?: string,
    userId?: string,
    applyWingsReward?: boolean,
  ) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
    });
    if (!settings) {
      throw new NotFoundException("Location settings not found");
    }

    const location = await this.prisma.location.findUnique({ where: { id: locationId } });

    const saladMenuItemIds = items
      .map((item) => getSaladCustomization(item.builder_payload)?.saladMenuItemId ?? null)
      .filter((menuItemId): menuItemId is string => Boolean(menuItemId));
    const menuItemIds = Array.from(
      new Set([...items.map((item) => item.menu_item_id), ...saladMenuItemIds]),
    );
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, locationId },
      include: {
        category: true,
        schedules: true,
        modifierGroups: {
          select: { modifierGroupId: true },
        },
        removableIngredients: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    const menuItemMap = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));

    const allOptionIds = items.flatMap(
      (item) => {
        const standardOpts = item.modifier_selections?.map((selection) => selection.modifier_option_id) ?? [];
        const saladOpts = getSaladCustomization(item.builder_payload)?.modifierOptionIds ?? [];
        return [...standardOpts, ...saladOpts];
      }
    );
    const modifierOptions = allOptionIds.length > 0
      ? await this.prisma.modifierOption.findMany({
          where: { id: { in: allOptionIds }, isActive: true },
        })
      : [];
    const optionMap = new Map(modifierOptions.map((option) => [option.id, option]));

    const lineDetails: {
      menu_item_id: string;
      name: string;
      quantity: number;
      unit_price_cents: number;
      modifier_total_cents: number;
      line_total_cents: number;
      special_instructions: string | null;
    }[] = [];

    let itemSubtotalCents = 0;
    const scheduleViolationIds: string[] = [];
    const lunchScheduleViolationIds: string[] = [];
    const timezone = location?.timezoneName ?? "America/Toronto";
    const scheduleReference = scheduledFor ? new Date(scheduledFor) : new Date();
    const scheduleContext = getScheduleContext(scheduleReference, timezone);

    await assertLocationOpenForFulfillment({
      db: this.prisma,
      locationId,
      fulfillmentType,
      context: scheduleContext,
    });
    if (fulfillmentType === "DELIVERY") {
      assertDeliveryAvailable({
        settings,
        timezone,
        referenceDate: scheduleReference,
      });
    }

    const wingFlavourRefs = items.flatMap((item) =>
      collectWingFlavourRefs(item.builder_payload),
    );
    const wingFlavourMap = await loadWingFlavourMapForRefs({
      db: this.prisma,
      locationId,
      refs: wingFlavourRefs,
    });

    for (const cartItem of items) {
      const menuItem = menuItemMap.get(cartItem.menu_item_id);
      if (!menuItem) {
        throw new UnprocessableEntityException({
          message: `Menu item ${cartItem.menu_item_id} not found at this location`,
          field: "items",
        });
      }
      assertMenuItemOrderable({
        menuItem,
        fulfillmentType,
        specialInstructions: cartItem.special_instructions,
      });
      collectScheduleViolation(
        menuItem,
        scheduleContext,
        scheduleViolationIds,
        lunchScheduleViolationIds,
      );

      const removedIngredients = getRemovedIngredients(cartItem);
      const saladCustomization = getSaladCustomization(cartItem.builder_payload);
      const allowedIngredientIds = new Set(menuItem.removableIngredients.map((ingredient) => ingredient.id));
      for (const ingredient of removedIngredients) {
        if (!allowedIngredientIds.has(ingredient.id)) {
          throw new UnprocessableEntityException({
            message: `Ingredient removal \"${ingredient.name}\" is not valid for ${menuItem.name}`,
            field: "items",
          });
        }
      }

      if (saladCustomization) {
        const saladMenuItem = menuItemMap.get(saladCustomization.saladMenuItemId);
        if (!saladMenuItem) {
          throw new UnprocessableEntityException({
            message: `Salad menu item ${saladCustomization.saladMenuItemId} not found at this location`,
            field: "items",
          });
        }
        assertMenuItemOrderable({
          menuItem: saladMenuItem,
          fulfillmentType,
          label: "Salad",
        });
        collectScheduleViolation(
          saladMenuItem,
          scheduleContext,
          scheduleViolationIds,
          lunchScheduleViolationIds,
        );
        for (const optId of saladCustomization.modifierOptionIds) {
          const opt = optionMap.get(optId);
          if (!opt) {
            throw new UnprocessableEntityException({
              message: `A selected salad option is no longer available.`,
              field: "items",
            });
          }
        }

        const allowedSaladIngredientIds = new Set(
          saladMenuItem.removableIngredients.map((ingredient) => ingredient.id),
        );
        for (const ingredient of saladCustomization.removedIngredients) {
          if (!allowedSaladIngredientIds.has(ingredient.id)) {
            throw new UnprocessableEntityException({
              message: `Ingredient removal \"${ingredient.name}\" is not valid for ${saladMenuItem.name}`,
              field: "items",
            });
          }
        }

        const selectedModifierIds = new Set(
          cartItem.modifier_selections?.map((selection) => selection.modifier_option_id) ??
            [],
        );
        const allowedSaladGroupIds = new Set(
          saladMenuItem.modifierGroups.map((group) => group.modifierGroupId),
        );
        for (const optionId of saladCustomization.modifierOptionIds) {
          const option = optionMap.get(optionId);
          if (!option || !allowedSaladGroupIds.has(option.modifierGroupId)) {
            throw new UnprocessableEntityException({
              message: `Modifier option ${optionId} is not valid for ${saladMenuItem.name}`,
              field: "items",
            });
          }
          if (!selectedModifierIds.has(optionId)) {
            throw new UnprocessableEntityException({
              message: `Modifier option ${optionId} must also be present on the cart line`,
              field: "items",
            });
          }
        }
      }

      assertWingFlavoursOrderable({
        builderPayload: cartItem.builder_payload,
        wingFlavourMap,
      });

      let modifierTotalCents = getBuilderPriceDelta(cartItem.builder_payload);
      const saladModifierOptionIds = new Set(
        saladCustomization?.modifierOptionIds ?? [],
      );
      if (cartItem.modifier_selections) {
        for (const selection of cartItem.modifier_selections) {
          const option = optionMap.get(selection.modifier_option_id);
          if (!option) {
            throw new UnprocessableEntityException({
              message: `Modifier option ${selection.modifier_option_id} not found or inactive`,
              field: "items",
            });
          }
          if (!saladModifierOptionIds.has(selection.modifier_option_id)) {
            assertModifierOptionAllowedForItem({ option, menuItem });
          }
          modifierTotalCents += option.priceDeltaCents;
        }
      }

      const unitPriceCents = menuItem.basePriceCents + modifierTotalCents;
      const lineTotalCents = unitPriceCents * cartItem.quantity;
      itemSubtotalCents += lineTotalCents;

      lineDetails.push({
        menu_item_id: menuItem.id,
        name: menuItem.name,
        quantity: cartItem.quantity,
        unit_price_cents: unitPriceCents,
        modifier_total_cents: modifierTotalCents,
        line_total_cents: lineTotalCents,
        special_instructions: cartItem.special_instructions ?? null,
      });
    }

    throwScheduleViolations({
      scheduleViolationIds,
      lunchScheduleViolationIds,
      timezone,
    });

    let deliveryFeeCents = 0;
    let deliveryFeeStatedCents = 0;
    let deliveryFeeWaived = false;
    if (fulfillmentType === "DELIVERY") {
      const deliveryEligibility = await getDeliveryEligibilityForCustomer(
        this.prisma,
        locationId,
        userId,
        settings.prepaymentThresholdNoShows,
      );
      documentFuturePrepaymentPolicy();
      assertCustomerMayUseDelivery(deliveryEligibility);

      deliveryFeeStatedCents = settings.deliveryFeeCents;
      if (settings.minimumDeliverySubtotalCents > 0 && itemSubtotalCents < settings.minimumDeliverySubtotalCents) {
        const shortfallCents = settings.minimumDeliverySubtotalCents - itemSubtotalCents;
        throw new UnprocessableEntityException({
          message: `Minimum subtotal for delivery is ${formatUsdFromCents(settings.minimumDeliverySubtotalCents)}. Add ${formatUsdFromCents(shortfallCents)} more for delivery.`,
          field: "fulfillment_type",
        });
      }

      const waived =
        settings.freeDeliveryThresholdCents != null &&
        itemSubtotalCents >= settings.freeDeliveryThresholdCents;
      deliveryFeeWaived = waived;
      deliveryFeeCents = waived ? 0 : settings.deliveryFeeCents;
    }

    const policy: PricingPolicy = {
      taxRateBps: settings.taxRateBps,
      taxDeliveryFee: settings.taxDeliveryFee,
      taxTip: settings.taxTip,
      discountsReduceTaxableBase: settings.discountsReduceTaxableBase,
    };

    if (promoCode?.trim() && applyWingsReward) {
      throw new UnprocessableEntityException({
        message: "Only one deal can be applied at a time",
        field: "promo_code",
      });
    }

    // Wings-rewards preview: if the signed-in customer ticked "apply free
    // wings" on the cart, re-validate eligibility against their current
    // stamp balance + cart contents and fold the cheapest-1lb discount
    // into `itemDiscountTotalCents`. Always return the eligibility object
    // so the UI can show a clear "Not eligible" message instead of
    // silently ignoring a non-applicable reward.
    const wingsLines = lineDetails.map((line, idx) => ({
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineTotalCents: line.line_total_cents,
      builderPayload: items[idx].builder_payload ?? null,
    }));
    const wingsEligibility = await this.rewardsService.computeEligibility(
      userId,
      wingsLines,
    );
    const applyWingsDiscount = Boolean(applyWingsReward) && wingsEligibility.eligible;
    const wingsDiscountCents = applyWingsDiscount
      ? wingsEligibility.freeWingsDiscountCents
      : 0;

    let appliedPromoCode: string | undefined = undefined;
    const appliedPromoCodes: string[] = [];
    let promoDiscountCents = 0;
    const promoPricingLines = lineDetails.map((line, index) => ({
      menuItemId: line.menu_item_id,
      categoryId: menuItemMap.get(line.menu_item_id)?.categoryId ?? null,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      modifierOptionIds:
        items[index].modifier_selections?.map(
          (selection) => selection.modifier_option_id,
        ) ?? [],
      builderPayload: items[index].builder_payload ?? null,
    }));

    const promoCodeIsFirstOrderDeal =
      await this.promotionsService.isFirstOrderDealPublicCode({
        locationId,
        code: promoCode,
      });
    if (
      promoCodeIsFirstOrderDeal &&
      !(await this.promotionsService.isFirstOrderCustomer({ userId }))
    ) {
      throw new UnprocessableEntityException({
        message: "Invalid Coupon",
        field: "promo_code",
      });
    }

    if (promoCode && !promoCodeIsFirstOrderDeal) {
      const promoApplication = await this.promotionsService.evaluatePromo({
        locationId,
        code: promoCode,
        userId,
        itemSubtotalCents,
        deliveryFeeCents,
        fulfillmentType,
        lines: promoPricingLines,
      });

      appliedPromoCodes.push(promoApplication.promoCode);
      promoDiscountCents = promoApplication.discountCents;
      if (promoApplication.waivesDelivery) {
        deliveryFeeWaived = true;
        deliveryFeeCents = 0;
      }
    }

    const firstOrderDeal = await this.promotionsService.evaluateFirstOrderDeal({
      locationId,
      userId,
      itemSubtotalCents,
      deliveryFeeCents,
      fulfillmentType,
      existingDiscountCents: wingsDiscountCents + promoDiscountCents,
      explicitlyOptedIn: promoCodeIsFirstOrderDeal,
    });
    if (firstOrderDeal) {
      appliedPromoCodes.push(firstOrderDeal.promoCode);
      promoDiscountCents += firstOrderDeal.discountCents;
      if (firstOrderDeal.waivesDelivery) {
        deliveryFeeWaived = true;
        deliveryFeeCents = 0;
      }
    }

    appliedPromoCode = appliedPromoCodes.length
      ? appliedPromoCodes.join(", ")
      : undefined;

    const breakdown = computePricingShared(
      {
        itemSubtotalCents,
        itemDiscountTotalCents: wingsDiscountCents,
        orderDiscountTotalCents: promoDiscountCents,
        deliveryFeeCents,
        driverTipCents,
        walletAppliedCents,
      },
      policy,
    );

    return {
      item_subtotal_cents: breakdown.itemSubtotalCents,
      item_discount_total_cents: breakdown.itemDiscountTotalCents,
      order_discount_total_cents: breakdown.orderDiscountTotalCents,
      discounted_subtotal_cents: breakdown.discountedSubtotalCents,
      taxable_subtotal_cents: breakdown.taxableSubtotalCents,
      tax_cents: breakdown.taxCents,
      delivery_fee_cents: breakdown.deliveryFeeCents,
      driver_tip_cents: breakdown.driverTipCents,
      wallet_applied_cents: breakdown.walletAppliedCents,
      final_payable_cents: breakdown.finalPayableCents,
      delivery_fee_stated_cents: deliveryFeeStatedCents,
      delivery_fee_waived: deliveryFeeWaived,
      applied_promo_code: appliedPromoCode,
      promo_discount_cents: promoDiscountCents,
      lines: lineDetails,
      wings_reward: {
        available_stamps: wingsEligibility.availableStamps,
        pounds_in_cart: Number(wingsEligibility.poundsInCart.toFixed(2)),
        eligible: wingsEligibility.eligible,
        applied: applyWingsDiscount,
        discount_cents: wingsDiscountCents,
        not_eligible_reason: wingsEligibility.notEligibleReason,
      },
    };
  }
}
