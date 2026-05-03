import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { formatUsdFromCents } from "../../common/utils/money";
import { allocateNextOrderNumber } from "../../database/order-number";
import { lockAndReadWalletBalanceCents } from "../../database/wallet-row-lock";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  assertCustomerMayUseDelivery,
  documentFuturePrepaymentPolicy,
  getDeliveryEligibilityForCustomer,
} from "../customers/no-show-policy";
import {
  RewardsService,
  STAMPS_PER_REWARD,
  summarizeWingsInCart,
} from "../rewards/rewards.service";
import { PromotionsService } from "../promotions/promotions.service";
import {
  type RemovedIngredientInput,
  type SaladCustomizationInput,
  type PricingPolicy,
  computePricing,
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

type PlaceOrderParams = {
  userId: string;
  locationId: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  items: Array<{
    menuItemId: string;
    quantity: number;
    modifierSelections?: Array<{ modifierOptionId: string }>;
    removedIngredients?: RemovedIngredientInput[];
    specialInstructions?: string;
    builderPayload?: Record<string, unknown>;
  }>;
  scheduledFor?: string;
  contactlessPref?: string;
  driverTipCents?: number;
  walletAppliedCents?: number;
  specialInstructions?: string;
  idempotencyKey: string;
  addressSnapshotJson?: Record<string, unknown>;
  isStudentOrder?: boolean;
  studentIdSnapshot?: string;
  /**
   * When true, redeem the customer's wings-rewards stamp card for a free
   * pound of wings. Re-validated server-side against the DB stamp balance
   * and the cart contents; 422 if not eligible.
   */
  applyWingsReward?: boolean;
  promoCode?: string;
};

function getRemovedIngredientsFromInput(params: {
  removedIngredients?: RemovedIngredientInput[];
  builderPayload?: Record<string, unknown>;
}): RemovedIngredientInput[] {
  if (params.removedIngredients?.length) {
    return params.removedIngredients;
  }

  const builderPayload = params.builderPayload;
  if (!builderPayload || builderPayload.builder_type !== "ITEM_CUSTOMIZATION") {
    return [];
  }

  const removedIngredients = builderPayload.removed_ingredients;
  if (!Array.isArray(removedIngredients)) {
    return [];
  }

  return removedIngredients.filter((ingredient): ingredient is RemovedIngredientInput => {
    if (!ingredient || typeof ingredient !== "object") return false;
    const candidate = ingredient as RemovedIngredientInput;
    return typeof candidate.id === "string" && typeof candidate.name === "string";
  });
}

function serializeOrder(order: Record<string, unknown>) {
  const o = order as Record<string, unknown> & {
    orderNumber: bigint;
    orderItems?: Record<string, unknown>[];
    statusEvents?: Record<string, unknown>[];
  };

  const items = (o.orderItems ?? []).map((item: Record<string, unknown>) => ({
    id: item.id,
    order_id: item.orderId,
    menu_item_id: item.menuItemId,
    line_no: item.lineNo,
    product_name_snapshot: item.productNameSnapshot,
    category_name_snapshot: item.categoryNameSnapshot,
    builder_type: item.builderType,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    line_discount_cents: item.lineDiscountCents,
    line_total_cents: item.lineTotalCents,
    special_instructions: item.specialInstructions,
    builder_payload_json: item.builderPayloadJson,
    modifiers: ((item.modifiers as Record<string, unknown>[]) ?? []).map(
      (mod: Record<string, unknown>) => ({
        id: mod.id,
        modifier_group_id: mod.modifierGroupId,
        modifier_option_id: mod.modifierOptionId,
        modifier_group_name_snapshot: mod.modifierGroupNameSnapshot,
        modifier_name_snapshot: mod.modifierNameSnapshot,
        modifier_kind: mod.modifierKind,
        quantity: mod.quantity,
        price_delta_cents: mod.priceDeltaCents,
        sort_order: mod.sortOrder,
      }),
    ),
    flavours: ((item.flavours as Record<string, unknown>[]) ?? []).map(
      (fl: Record<string, unknown>) => ({
        id: fl.id,
        wing_flavour_id: fl.wingFlavourId,
        flavour_name_snapshot: fl.flavourNameSnapshot,
        heat_level_snapshot: fl.heatLevelSnapshot,
        slot_no: fl.slotNo,
        flavour_role: fl.flavourRole,
        placement: fl.placement,
        sort_order: fl.sortOrder,
      }),
    ),
  }));

  const statusEvents = (o.statusEvents ?? []).map((event: Record<string, unknown>) => ({
    id: event.id,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    event_type: event.eventType,
    actor_user_id: event.actorUserId,
    reason_text: event.reasonText,
    created_at: event.createdAt,
  }));

  return {
    id: o.id,
    location_id: o.locationId,
    customer_user_id: o.customerUserId,
    order_number: Number(o.orderNumber),
    order_source: o.orderSource,
    fulfillment_type: o.fulfillmentType,
    status: o.status,
    contactless_pref: o.contactlessPref,
    scheduled_for: o.scheduledFor,
    placed_at: o.placedAt,
    accepted_at: o.acceptedAt,
    ready_at: o.readyAt,
    completed_at: o.completedAt,
    cancelled_at: o.cancelledAt,
    customer_name_snapshot: o.customerNameSnapshot,
    customer_phone_snapshot: o.customerPhoneSnapshot,
    customer_email_snapshot: o.customerEmailSnapshot,
    address_snapshot_json: o.addressSnapshotJson,
    item_subtotal_cents: o.itemSubtotalCents,
    item_discount_total_cents: o.itemDiscountTotalCents,
    order_discount_total_cents: o.orderDiscountTotalCents,
    discounted_subtotal_cents: o.discountedSubtotalCents,
    taxable_subtotal_cents: o.taxableSubtotalCents,
    tax_cents: o.taxCents,
    tax_rate_bps: o.taxRateBps,
    delivery_fee_cents: o.deliveryFeeCents,
    driver_tip_cents: o.driverTipCents,
    wallet_applied_cents: o.walletAppliedCents,
    final_payable_cents: o.finalPayableCents,
    payment_status_summary: o.paymentStatusSummary,
    customer_order_notes: o.customerOrderNotes,
    special_instructions: o.customerOrderNotes,
    estimated_ready_at: o.estimatedReadyAt,
    estimated_window_min_minutes: o.estimatedWindowMinMinutes,
    estimated_window_max_minutes: o.estimatedWindowMaxMinutes,
    student_discount_requested: o.studentDiscountRequested,
    cancel_allowed_until: o.cancelAllowedUntil ?? null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    items,
    status_events: statusEvents,
  };
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly rewardsService: RewardsService,
    private readonly promotionsService: PromotionsService,
  ) {}

  async placeOrder(params: PlaceOrderParams) {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const existingKey = await tx.checkoutIdempotencyKey.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existingKey) {
        if (existingKey.orderId) {
          return existingKey.orderId;
        }
        throw new ConflictException("Checkout already in progress for this idempotency key");
      }

      await tx.checkoutIdempotencyKey.create({
        data: {
          idempotencyKey: params.idempotencyKey,
          userId: params.userId,
          locationId: params.locationId,
          requestFingerprint: params.idempotencyKey,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          isActive: true,
          displayName: true,
        },
      });
      if (!user || !user.isActive) {
        throw new NotFoundException("User not found or inactive");
      }
      const identities = await tx.userIdentity.findMany({
        where: { userId: params.userId },
        orderBy: { isPrimary: "desc" },
        select: {
          phoneE164: true,
          emailNormalized: true,
          isPrimary: true,
        },
      });
      const customerName = user.displayName;
      const customerPhone =
        identities.find((identity) => identity.phoneE164)?.phoneE164 ?? "";
      const customerEmail =
        identities.find((identity) => identity.emailNormalized)?.emailNormalized ??
        null;

      const location = await tx.location.findUnique({
        where: { id: params.locationId },
        select: {
          id: true,
          isActive: true,
          timezoneName: true,
        },
      });
      if (!location || !location.isActive) {
        throw new NotFoundException("Location not found or inactive");
      }
      const settings = await tx.locationSettings.findUnique({
        where: { locationId: params.locationId },
      });
      if (!settings) {
        throw new NotFoundException("Location settings not found");
      }
      if (params.fulfillmentType === "DELIVERY") {
        const deliveryEligibility = await getDeliveryEligibilityForCustomer(
          tx,
          params.locationId,
          params.userId,
          settings.prepaymentThresholdNoShows,
        );
        documentFuturePrepaymentPolicy();
        assertCustomerMayUseDelivery(deliveryEligibility);

        // PRD §8: delivery postal code must be in allowed_postal_codes (when
        // configured). Empty list = zone enforcement disabled. Normalize to
        // uppercase, no-whitespace for Canadian-style comparison.
        const allowedPostals = Array.isArray(settings.allowedPostalCodes)
          ? (settings.allowedPostalCodes as unknown[]).filter(
              (v): v is string => typeof v === "string",
            )
          : [];
        if (allowedPostals.length > 0) {
          const addr = params.addressSnapshotJson as
            | Record<string, unknown>
            | undefined;
          const rawPostal =
            (typeof addr?.postal_code === "string" && addr.postal_code) ||
            (typeof addr?.postalCode === "string" && addr.postalCode) ||
            "";
          const normalize = (p: string) =>
            p.replace(/\s+/g, "").toUpperCase();
          const normalized = normalize(rawPostal);
          const allowedNormalized = allowedPostals.map(normalize);
          if (!normalized || !allowedNormalized.includes(normalized)) {
            throw new UnprocessableEntityException({
              message: `Delivery is not available to postal code "${rawPostal || "unknown"}"`,
              field: "address_snapshot_json.postal_code",
            });
          }
        }
      }
      const scheduledReference = params.scheduledFor
        ? new Date(params.scheduledFor)
        : new Date();

      // PRD §8: minimum lead time. Scheduled orders cannot be placed for a
      // time earlier than now + default prep time (busy-mode aware).
      if (params.scheduledFor) {
        const minLeadMinutes =
          settings.busyModeEnabled && settings.busyModePrepTimeMinutes
            ? settings.busyModePrepTimeMinutes
            : settings.defaultPrepTimeMinutes;
        const earliestAllowed = new Date(
          Date.now() + minLeadMinutes * 60 * 1000,
        );
        if (scheduledReference < earliestAllowed) {
          throw new UnprocessableEntityException({
            message: `Scheduled time must be at least ${minLeadMinutes} minutes from now`,
            field: "scheduled_for",
          });
        }
      }

      const saladMenuItemIds = params.items
        .map((item) => getSaladCustomization(item.builderPayload)?.saladMenuItemId ?? null)
        .filter((menuItemId): menuItemId is string => Boolean(menuItemId));
      const menuItemIds = Array.from(
        new Set([...params.items.map((item) => item.menuItemId), ...saladMenuItemIds]),
      );
      const rawMenuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds }, locationId: params.locationId },
        select: {
          id: true,
          categoryId: true,
          name: true,
          slug: true,
          basePriceCents: true,
          isAvailable: true,
          archivedAt: true,
          allowedFulfillmentType: true,
          builderType: true,
          requiresSpecialInstructions: true,
        },
      });
      const categoryIds = Array.from(
        new Set(rawMenuItems.map((menuItem) => menuItem.categoryId)),
      );
      const categories =
        categoryIds.length > 0
          ? await tx.menuCategory.findMany({
              where: { id: { in: categoryIds } },
              select: { id: true, name: true, slug: true },
            })
          : [];
      const modifierGroups =
        menuItemIds.length > 0
          ? await tx.menuItemModifierGroup.findMany({
              where: { menuItemId: { in: menuItemIds } },
              select: {
                menuItemId: true,
                modifierGroupId: true,
              },
            })
          : [];
      const schedules =
        menuItemIds.length > 0
          ? await tx.menuItemSchedule.findMany({
              where: { menuItemId: { in: menuItemIds } },
              select: {
                menuItemId: true,
                dayOfWeek: true,
                timeFrom: true,
                timeTo: true,
              },
            })
          : [];
      const removableIngredients =
        menuItemIds.length > 0
          ? await tx.removableIngredient.findMany({
              where: { menuItemId: { in: menuItemIds } },
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                menuItemId: true,
                name: true,
                sortOrder: true,
              },
            })
          : [];
      const categoryMap = new Map(categories.map((category) => [category.id, category]));
      const modifierGroupsByMenuItem = new Map<string, Array<{ modifierGroupId: string }>>();
      for (const group of modifierGroups) {
        const existing = modifierGroupsByMenuItem.get(group.menuItemId) ?? [];
        existing.push({ modifierGroupId: group.modifierGroupId });
        modifierGroupsByMenuItem.set(group.menuItemId, existing);
      }
      const schedulesByMenuItem = new Map<
        string,
        Array<{ dayOfWeek: number; timeFrom: Date; timeTo: Date }>
      >();
      for (const schedule of schedules) {
        const existing = schedulesByMenuItem.get(schedule.menuItemId) ?? [];
        existing.push({
          dayOfWeek: schedule.dayOfWeek,
          timeFrom: schedule.timeFrom,
          timeTo: schedule.timeTo,
        });
        schedulesByMenuItem.set(schedule.menuItemId, existing);
      }
      const removableIngredientsByMenuItem = new Map<
        string,
        Array<{ id: string; name: string; sortOrder: number }>
      >();
      for (const ingredient of removableIngredients) {
        const existing = removableIngredientsByMenuItem.get(ingredient.menuItemId) ?? [];
        existing.push({
          id: ingredient.id,
          name: ingredient.name,
          sortOrder: ingredient.sortOrder,
        });
        removableIngredientsByMenuItem.set(ingredient.menuItemId, existing);
      }
      const menuItems = rawMenuItems.map((menuItem) => {
        const category = categoryMap.get(menuItem.categoryId);
        if (!category) {
          throw new NotFoundException(`Category not found for menu item ${menuItem.id}`);
        }
        return {
          ...menuItem,
          category,
          modifierGroups: modifierGroupsByMenuItem.get(menuItem.id) ?? [],
          schedules: schedulesByMenuItem.get(menuItem.id) ?? [],
          removableIngredients: removableIngredientsByMenuItem.get(menuItem.id) ?? [],
        };
      });
      const menuItemMap = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));

      const allOptionIds = params.items.flatMap(
        (item) => {
          const standardOpts = item.modifierSelections?.map((selection) => selection.modifierOptionId) ?? [];
          const saladOpts = getSaladCustomization(item.builderPayload)?.modifierOptionIds ?? [];
          return [...standardOpts, ...saladOpts];
        }
      );
      const rawModifierOptions =
        allOptionIds.length > 0
          ? await tx.modifierOption.findMany({
              where: { id: { in: allOptionIds }, isActive: true },
              select: {
                id: true,
                modifierGroupId: true,
                name: true,
                priceDeltaCents: true,
              },
            })
          : [];
      const modifierGroupIds = Array.from(
        new Set(rawModifierOptions.map((option) => option.modifierGroupId)),
      );
      const modifierOptionGroups =
        modifierGroupIds.length > 0
          ? await tx.modifierGroup.findMany({
              where: { id: { in: modifierGroupIds } },
              select: {
                id: true,
                name: true,
              },
            })
          : [];
      const modifierOptionGroupMap = new Map(
        modifierOptionGroups.map((group) => [group.id, group]),
      );
      const modifierOptions = rawModifierOptions.map((option) => {
        const modifierGroup = modifierOptionGroupMap.get(option.modifierGroupId);
        if (!modifierGroup) {
          throw new NotFoundException(
            `Modifier group not found for option ${option.id}`,
          );
        }
        return {
          ...option,
          modifierGroup,
        };
      });
      const optionMap = new Map(modifierOptions.map((option) => [option.id, option]));

      const scheduleViolationIds: string[] = [];
      const lunchScheduleViolationIds: string[] = [];
      const timezone = location.timezoneName ?? "America/Toronto";
      const scheduleContext = getScheduleContext(scheduledReference, timezone);

      await assertLocationOpenForFulfillment({
        db: tx,
        locationId: params.locationId,
        fulfillmentType: params.fulfillmentType,
        context: scheduleContext,
      });

      const wingFlavourRefs = params.items.flatMap((item) =>
        collectWingFlavourRefs(item.builderPayload),
      );
      const wingFlavourMap = await loadWingFlavourMapForRefs({
        db: tx,
        locationId: params.locationId,
        refs: wingFlavourRefs,
      });

      let itemSubtotalCents = 0;
      const lineItems: {
        menuItemId: string;
        productNameSnapshot: string;
        categoryNameSnapshot: string;
        builderType: string | null;
        quantity: number;
        unitPriceCents: number;
        lineTotalCents: number;
        specialInstructions: string | null;
        builderPayload: Record<string, unknown> | null;
        modifiers: {
          modifierGroupId: string | null;
          modifierOptionId: string | null;
          modifierGroupNameSnapshot: string;
          modifierNameSnapshot: string;
          modifierKind: string;
          priceDeltaCents: number;
          sortOrder: number;
        }[];
      }[] = [];

      for (const cartItem of params.items) {
        const menuItem = menuItemMap.get(cartItem.menuItemId);
        if (!menuItem) {
          throw new UnprocessableEntityException({
            message: `Menu item ${cartItem.menuItemId} not found at this location`,
            field: "items",
          });
        }
        // PRD §8 precedence: soft-deleted / archived items must be rejected
        // before the is_available check so the error is accurate and explicit.
        assertMenuItemOrderable({
          menuItem,
          fulfillmentType: params.fulfillmentType,
          specialInstructions: cartItem.specialInstructions,
        });
        collectScheduleViolation(
          menuItem,
          scheduleContext,
          scheduleViolationIds,
          lunchScheduleViolationIds,
        );

        const removedIngredients = getRemovedIngredientsFromInput({
          removedIngredients: cartItem.removedIngredients,
          builderPayload: cartItem.builderPayload,
        });
        const saladCustomization = getSaladCustomization(cartItem.builderPayload);
        const allowedIngredientMap = new Map(
          menuItem.removableIngredients.map((ingredient) => [ingredient.id, ingredient]),
        );
        const validatedRemovedIngredients = removedIngredients.map((ingredient) => {
          const match = allowedIngredientMap.get(ingredient.id);
          if (!match) {
            throw new UnprocessableEntityException({
              message: `Ingredient removal \"${ingredient.name}\" is not valid for ${menuItem.name}`,
              field: "items",
            });
          }
          return { id: match.id, name: match.name };
        });

        const validatedSaladRemovedIngredients: RemovedIngredientInput[] = [];
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
            fulfillmentType: params.fulfillmentType,
            label: "Salad",
          });
          collectScheduleViolation(
            saladMenuItem,
            scheduleContext,
            scheduleViolationIds,
            lunchScheduleViolationIds,
          );

          const allowedSaladIngredientMap = new Map(
            saladMenuItem.removableIngredients.map((ingredient) => [ingredient.id, ingredient]),
          );
          for (const ingredient of saladCustomization.removedIngredients) {
            const match = allowedSaladIngredientMap.get(ingredient.id);
            if (!match) {
              throw new UnprocessableEntityException({
                message: `Ingredient removal \"${ingredient.name}\" is not valid for ${saladMenuItem.name}`,
                field: "items",
              });
            }
            validatedSaladRemovedIngredients.push({ id: match.id, name: match.name });
          }

          const selectedModifierIds = new Set(
            cartItem.modifierSelections?.map((selection) => selection.modifierOptionId) ?? [],
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
                message: `Modifier option ${optionId} must also be present on the order line`,
                field: "items",
              });
            }
          }
        }

        assertWingFlavoursOrderable({
          builderPayload: cartItem.builderPayload,
          wingFlavourMap,
        });

        let modifierTotalCents = getBuilderPriceDelta(cartItem.builderPayload);
        const modifiers: (typeof lineItems)[number]["modifiers"] = [];
        const saladModifierOptionIds = new Set(
          saladCustomization?.modifierOptionIds ?? [],
        );

        if (cartItem.modifierSelections) {
          for (let selectionIndex = 0; selectionIndex < cartItem.modifierSelections.length; selectionIndex++) {
            const selection = cartItem.modifierSelections[selectionIndex];
            const option = optionMap.get(selection.modifierOptionId);
            if (!option) {
              throw new UnprocessableEntityException({
                message: `Modifier option ${selection.modifierOptionId} not found or inactive`,
                field: "items",
              });
            }
            if (!saladModifierOptionIds.has(selection.modifierOptionId)) {
              assertModifierOptionAllowedForItem({ option, menuItem });
            }
            modifierTotalCents += option.priceDeltaCents;
            modifiers.push({
              modifierGroupId: option.modifierGroupId,
              modifierOptionId: option.id,
              modifierGroupNameSnapshot: option.modifierGroup.name,
              modifierNameSnapshot: option.name,
              modifierKind: "ADDON",
              priceDeltaCents: option.priceDeltaCents,
              sortOrder: selectionIndex,
            });
          }
        }

        validatedRemovedIngredients.forEach((ingredient, index) => {
          modifiers.push({
            modifierGroupId: null,
            modifierOptionId: null,
            modifierGroupNameSnapshot: "Ingredient removal",
            modifierNameSnapshot: ingredient.name,
            modifierKind: "REMOVE_INGREDIENT",
            priceDeltaCents: 0,
            sortOrder: modifiers.length + index,
          });
        });
        validatedSaladRemovedIngredients.forEach((ingredient, index) => {
          modifiers.push({
            modifierGroupId: null,
            modifierOptionId: null,
            modifierGroupNameSnapshot: "Ingredient removal",
            modifierNameSnapshot: ingredient.name,
            modifierKind: "REMOVE_INGREDIENT",
            priceDeltaCents: 0,
            sortOrder: modifiers.length + index,
          });
        });

        const bp = cartItem.builderPayload as Record<string, unknown> | undefined;
        const builderType =
          typeof bp?.builder_type === "string" ? bp.builder_type : null;
        /** Keep full structured payloads for kitchen / reorder; do not collapse to ITEM_CUSTOMIZATION when removals exist. */
        const normalizedBuilderPayload: Record<string, unknown> | null =
          builderType === "WINGS" || builderType === "WING_COMBO" || builderType === "LUNCH_SPECIAL"
            ? (bp ?? null)
            : builderType === "ITEM_CUSTOMIZATION" || validatedRemovedIngredients.length > 0
              ? {
                  builder_type: "ITEM_CUSTOMIZATION",
                  removed_ingredients: validatedRemovedIngredients,
                }
              : (bp ?? null);

        const unitPriceCents = menuItem.basePriceCents + modifierTotalCents;
        const lineTotalCents = unitPriceCents * cartItem.quantity;
        itemSubtotalCents += lineTotalCents;

        lineItems.push({
          menuItemId: menuItem.id,
          productNameSnapshot: menuItem.name,
          categoryNameSnapshot: menuItem.category.name,
          builderType:
            typeof normalizedBuilderPayload?.builder_type === "string"
              ? String(normalizedBuilderPayload.builder_type)
              : menuItem.builderType,
          quantity: cartItem.quantity,
          unitPriceCents,
          lineTotalCents,
          specialInstructions: cartItem.specialInstructions ?? null,
          builderPayload: normalizedBuilderPayload,
          modifiers,
        });
      }

      throwScheduleViolations({
        scheduleViolationIds,
        lunchScheduleViolationIds,
        timezone,
      });

      let deliveryFeeCents = 0;
      if (params.fulfillmentType === "DELIVERY") {
        if (
          settings.minimumDeliverySubtotalCents > 0 &&
          itemSubtotalCents < settings.minimumDeliverySubtotalCents
        ) {
          const shortfallCents = settings.minimumDeliverySubtotalCents - itemSubtotalCents;
          throw new UnprocessableEntityException({
            message: `Minimum subtotal for delivery is ${formatUsdFromCents(settings.minimumDeliverySubtotalCents)}. Add ${formatUsdFromCents(shortfallCents)} more for delivery.`,
            field: "fulfillment_type",
          });
        }
        const waived =
          settings.freeDeliveryThresholdCents != null &&
          itemSubtotalCents >= settings.freeDeliveryThresholdCents;
        deliveryFeeCents = waived ? 0 : settings.deliveryFeeCents;
      }

      const driverTipCents = params.driverTipCents ?? 0;
      const walletAppliedCents = params.walletAppliedCents ?? 0;

      const policy: PricingPolicy = {
        taxRateBps: settings.taxRateBps,
        taxDeliveryFee: settings.taxDeliveryFee,
        taxTip: settings.taxTip,
        discountsReduceTaxableBase: settings.discountsReduceTaxableBase,
      };

      if (params.promoCode?.trim() && params.applyWingsReward) {
        throw new UnprocessableEntityException({
          message: "Only one deal can be applied at a time",
          field: "promo_code",
        });
      }

      // Wings-rewards: validate redemption server-side and compute the
      // cheapest-1lb discount. This MUST happen in-transaction so the stamp
      // balance read is consistent with the decrement we apply below — any
      // interleaved redemption would either make this read find <8 stamps
      // (and 422) or be serialized after our commit. No external service
      // call here; just math over the already-built `lineItems`.
      let wingsRewardDiscountCents = 0;
      if (params.applyWingsReward) {
        const stampSummary = await tx.customerWingsRewards.findUnique({
          where: { customerUserId: params.userId },
          select: { availableStamps: true },
        });
        if ((stampSummary?.availableStamps ?? 0) < STAMPS_PER_REWARD) {
          throw new UnprocessableEntityException({
            message: "Not enough wings-rewards stamps to redeem free wings",
            field: "apply_wings_reward",
          });
        }

        const wingsSummary = summarizeWingsInCart(
          lineItems.map((line) => ({
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: line.lineTotalCents,
            builderPayload: line.builderPayload,
          })),
        );
        if (wingsSummary.poundsInCart < 1) {
          throw new UnprocessableEntityException({
            message:
              "Add at least 1lb of wings to the cart to redeem the free-wings reward",
            field: "apply_wings_reward",
          });
        }
        wingsRewardDiscountCents = wingsSummary.cheapestPerLbCents;
      }

      let appliedPromoCode: string | undefined = undefined;
      const appliedPromoCodes: string[] = [];
      let promoDiscountCents = 0;
      const promoRedemptions: Array<{
        promoId: string;
        discountAmountCents: number;
      }> = [];
      const promoPricingLines = lineItems.map((line) => ({
        menuItemId: line.menuItemId,
        categoryId: menuItemMap.get(line.menuItemId)?.categoryId ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        modifierOptionIds: line.modifiers
          .map((modifier) => modifier.modifierOptionId)
          .filter((id): id is string => Boolean(id)),
        builderPayload: line.builderPayload,
      }));

      const promoCodeIsFirstOrderDeal =
        await this.promotionsService.isFirstOrderDealPublicCode({
          client: tx,
          locationId: params.locationId,
          code: params.promoCode,
        });
      if (
        promoCodeIsFirstOrderDeal &&
        !(await this.promotionsService.isFirstOrderCustomer({
          client: tx,
          userId: params.userId,
        }))
      ) {
        throw new UnprocessableEntityException({
          message: "Invalid Coupon",
          field: "promo_code",
        });
      }

      if (params.promoCode && !promoCodeIsFirstOrderDeal) {
        const promoApplication = await this.promotionsService.evaluatePromo({
          client: tx,
          locationId: params.locationId,
          code: params.promoCode,
          userId: params.userId,
          itemSubtotalCents,
          deliveryFeeCents,
          fulfillmentType: params.fulfillmentType,
          lines: promoPricingLines,
        });

        appliedPromoCodes.push(promoApplication.promoCode);
        promoDiscountCents = promoApplication.discountCents;
        promoRedemptions.push({
          promoId: promoApplication.promoId,
          discountAmountCents: promoApplication.redemptionValueCents,
        });
        if (promoApplication.waivesDelivery) {
          deliveryFeeCents = 0;
        }
      }

      const firstOrderDeal = await this.promotionsService.evaluateFirstOrderDeal({
        client: tx,
        locationId: params.locationId,
        userId: params.userId,
        itemSubtotalCents,
        deliveryFeeCents,
        fulfillmentType: params.fulfillmentType,
        existingDiscountCents: wingsRewardDiscountCents + promoDiscountCents,
        explicitlyOptedIn: promoCodeIsFirstOrderDeal,
      });
      if (firstOrderDeal) {
        appliedPromoCodes.push(firstOrderDeal.promoCode);
        promoDiscountCents += firstOrderDeal.discountCents;
        promoRedemptions.push(...firstOrderDeal.redemptions);
        if (firstOrderDeal.waivesDelivery) {
          deliveryFeeCents = 0;
        }
      }

      appliedPromoCode = appliedPromoCodes.length
        ? appliedPromoCodes.join(", ")
        : undefined;

      const pricing = computePricing(
        {
          itemSubtotalCents,
          itemDiscountTotalCents: wingsRewardDiscountCents,
          orderDiscountTotalCents: promoDiscountCents,
          deliveryFeeCents,
          driverTipCents,
          walletAppliedCents,
        },
        policy,
      );

      const orderNumber = await allocateNextOrderNumber(tx, params.locationId);

      const prepMinutes =
        settings.busyModeEnabled && settings.busyModePrepTimeMinutes
          ? settings.busyModePrepTimeMinutes
          : settings.defaultPrepTimeMinutes;
      const scheduledFor = params.scheduledFor
        ? new Date(params.scheduledFor)
        : new Date(Date.now() + prepMinutes * 60 * 1000);

      const windowMin =
        params.fulfillmentType === "DELIVERY"
          ? settings.defaultDeliveryMinMinutes
          : settings.defaultPickupMinMinutes;
      const windowMax =
        params.fulfillmentType === "DELIVERY"
          ? settings.defaultDeliveryMaxMinutes
          : settings.defaultPickupMaxMinutes;

      const estimatedReadyAt = new Date(Date.now() + prepMinutes * 60 * 1000);

      const pricingSnapshot = {
        item_subtotal_cents: pricing.itemSubtotalCents,
        item_discount_total_cents: pricing.itemDiscountTotalCents,
        order_discount_total_cents: pricing.orderDiscountTotalCents,
        discounted_subtotal_cents: pricing.discountedSubtotalCents,
        taxable_subtotal_cents: pricing.taxableSubtotalCents,
        tax_cents: pricing.taxCents,
        tax_rate_bps: settings.taxRateBps,
        delivery_fee_cents: pricing.deliveryFeeCents,
        driver_tip_cents: pricing.driverTipCents,
        wallet_applied_cents: pricing.walletAppliedCents,
        final_payable_cents: pricing.finalPayableCents,
        applied_promo_code: appliedPromoCode,
        promo_discount_cents: promoDiscountCents,
      };

      const cancelAllowedUntil = new Date(Date.now() + 2 * 60 * 1000);

      // PRD §8: wallet credit deduction must be row-locked and atomic with
      // order creation. Pre-check balance here (SELECT FOR UPDATE), debit
      // after order.create so the ledger row carries the orderId. Because
      // this all runs in the same $transaction, a failure anywhere below
      // rolls back the debit. The row lock held to COMMIT prevents concurrent
      // checkouts from double-spending the same balance.
      if (walletAppliedCents > 0) {
        const currentBalance = await lockAndReadWalletBalanceCents(
          tx,
          params.userId,
        );
        if (currentBalance < walletAppliedCents) {
          throw new UnprocessableEntityException({
            message: "Insufficient wallet balance",
            field: "wallet_applied_cents",
          });
        }
      }

      const createdOrder = await tx.order.create({
        data: {
          locationId: params.locationId,
          customerUserId: params.userId,
          orderNumber,
          orderSource: "ONLINE",
          fulfillmentType: params.fulfillmentType,
          status: "PLACED",
          cancelAllowedUntil,
          contactlessPref: params.contactlessPref
            ? (params.contactlessPref as "HAND_TO_ME" | "LEAVE_AT_DOOR" | "CALL_ON_ARRIVAL" | "TEXT_ON_ARRIVAL")
            : null,
          scheduledFor,
          placedAt: new Date(),
          customerNameSnapshot: customerName,
          customerPhoneSnapshot: customerPhone,
          customerEmailSnapshot: customerEmail,
          addressSnapshotJson: params.addressSnapshotJson
            ? (params.addressSnapshotJson as unknown as Parameters<typeof tx.order.create>[0]["data"]["addressSnapshotJson"])
            : undefined,
          pricingSnapshotJson: pricingSnapshot,
          itemSubtotalCents: pricing.itemSubtotalCents,
          itemDiscountTotalCents: pricing.itemDiscountTotalCents,
          orderDiscountTotalCents: pricing.orderDiscountTotalCents,
          discountedSubtotalCents: pricing.discountedSubtotalCents,
          taxableSubtotalCents: pricing.taxableSubtotalCents,
          taxCents: pricing.taxCents,
          taxRateBps: settings.taxRateBps,
          taxDeliveryFeeApplied: settings.taxDeliveryFee,
          taxTipApplied: settings.taxTip,
          deliveryFeeCents: pricing.deliveryFeeCents,
          driverTipCents: pricing.driverTipCents,
          walletAppliedCents: pricing.walletAppliedCents,
          finalPayableCents: pricing.finalPayableCents,
          paymentStatusSummary: "UNPAID",
          customerOrderNotes: params.specialInstructions ?? null,
          estimatedReadyAt,
          estimatedWindowMinMinutes: windowMin,
          estimatedWindowMaxMinutes: windowMax,
          busyModeExtraMinutesApplied: settings.busyModeEnabled ? (prepMinutes - settings.defaultPrepTimeMinutes) : 0,
          studentDiscountRequested: params.isStudentOrder ?? false,
        },
        select: { id: true },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: createdOrder.id,
          locationId: params.locationId,
          toStatus: "PLACED",
          eventType: "CHECKOUT",
          actorUserId: params.userId,
        },
      });

      const createdOrderItems: Array<{ id: string }> = [];
      for (let index = 0; index < lineItems.length; index++) {
        const line = lineItems[index];
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            lineNo: index + 1,
            menuItemId: line.menuItemId,
            productNameSnapshot: line.productNameSnapshot,
            categoryNameSnapshot: line.categoryNameSnapshot,
            builderType: line.builderType,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: line.lineTotalCents,
            specialInstructions: line.specialInstructions,
            builderPayloadJson:
              line.builderPayload as Parameters<typeof tx.orderItem.create>[0]["data"]["builderPayloadJson"],
          },
          select: { id: true },
        });
        createdOrderItems.push(orderItem);

        for (const modifier of line.modifiers) {
          await tx.orderItemModifier.create({
            data: {
              orderItemId: orderItem.id,
              modifierGroupId: modifier.modifierGroupId,
              modifierOptionId: modifier.modifierOptionId,
              modifierGroupNameSnapshot: modifier.modifierGroupNameSnapshot,
              modifierNameSnapshot: modifier.modifierNameSnapshot,
              modifierKind: modifier.modifierKind,
              priceDeltaCents: modifier.priceDeltaCents,
              sortOrder: modifier.sortOrder,
            },
          });
        }
      }

      for (let index = 0; index < lineItems.length; index++) {
        const line = lineItems[index];
        const builderPayload = line.builderPayload;
        if (!builderPayload || (line.builderType !== "WINGS" && line.builderType !== "WING_COMBO")) {
          continue;
        }

        const orderItem = createdOrderItems[index];
        if (!orderItem) continue;

        const wingType = String(builderPayload.wing_type ?? "BONE_IN");
        const preparation = String(builderPayload.preparation ?? "BREADED");
        const weightLb = Number(builderPayload.weight_lb ?? 1);
        const flavourSlots = (builderPayload.flavour_slots ?? []) as Array<{
          slot_no: number;
          wing_flavour_id: string;
          flavour_name: string;
          placement: string;
        }>;
        const saucingMethod = builderPayload.saucing_method
          ? String(builderPayload.saucing_method)
          : null;
        const extraFlavour = builderPayload.extra_flavour as
          | { wing_flavour_id: string; flavour_name: string; placement: string }
          | undefined;

        await tx.orderItemWingConfig.create({
          data: {
            orderItemId: orderItem.id,
            wingType: wingType as "BONE_IN" | "BONELESS",
            preparation: preparation as "BREADED" | "NON_BREADED",
            weightLb,
            requiredFlavourCount: flavourSlots.length,
            saucingMethod,
            extraFlavourAdded: !!extraFlavour,
          },
        });

        for (const slot of flavourSlots) {
          const f = wingFlavourMap.get(slot.wing_flavour_id);
          await tx.orderItemFlavour.create({
            data: {
              orderItemId: orderItem.id,
              slotNo: slot.slot_no,
              flavourRole: "STANDARD",
              wingFlavourId: slot.wing_flavour_id,
              flavourNameSnapshot: f ? f.name : slot.flavour_name,
              heatLevelSnapshot: f ? f.heatLevel : "",
              placement: (slot.placement ?? "ON_WINGS") as "ON_WINGS" | "ON_SIDE" | "MIXED",
              sortOrder: slot.slot_no,
            },
          });
        }

        if (extraFlavour) {
          const f = wingFlavourMap.get(extraFlavour.wing_flavour_id);
          await tx.orderItemFlavour.create({
            data: {
              orderItemId: orderItem.id,
              slotNo: 99,
              flavourRole: "EXTRA",
              wingFlavourId: extraFlavour.wing_flavour_id,
              flavourNameSnapshot: f ? f.name : extraFlavour.flavour_name,
              heatLevelSnapshot: f ? f.heatLevel : "",
              placement: (extraFlavour.placement ?? "ON_SIDE") as "ON_WINGS" | "ON_SIDE" | "MIXED",
              sortOrder: 99,
            },
          });
        }
      }

      // PRD §8: debit wallet inside the same transaction as order creation.
      // The row lock taken above is still held; decrement + ledger row here
      // are atomic with order.create (rolls back together on any error).
      if (walletAppliedCents > 0) {
        const updatedWallet = await tx.customerWallet.update({
          where: { customerUserId: params.userId },
          data: { balanceCents: { decrement: walletAppliedCents } },
        });
        await tx.customerCreditLedger.create({
          data: {
            customerUserId: params.userId,
            amountCents: -walletAppliedCents,
            balanceAfterCents: updatedWallet.balanceCents,
            entryType: "CREDIT_USED",
            reasonText: "Applied at checkout",
            orderId: createdOrder.id,
            createdByUserId: params.userId,
          },
        });
      }

      // Wings-rewards redemption: decrement 8 stamps + write REDEEMED ledger
      // row in the same transaction as order.create so the stamp debit
      // rolls back with any later failure. We already validated eligibility
      // above; the service method re-reads the balance for a final
      // defense-in-depth check.
      if (params.applyWingsReward) {
        await this.rewardsService.redeemForOrderInTransaction(
          tx,
          params.userId,
          createdOrder.id,
        );
      }

      for (const redemption of promoRedemptions) {
        await tx.promoRedemption.create({
          data: {
            promoCodeId: redemption.promoId,
            orderId: createdOrder.id,
            customerUserId: params.userId,
            discountAmountCents: redemption.discountAmountCents,
          },
        });
        await tx.promoCode.update({
          where: { id: redemption.promoId },
          data: { usageCount: { increment: 1 } },
        });
      }

      await tx.checkoutIdempotencyKey.update({
        where: { idempotencyKey: params.idempotencyKey },
        data: { orderId: createdOrder.id },
      });

      return createdOrder.id;
    });

    const serialized = await this.getOrderById(orderId);

    this.realtime.emitOrderEvent(
      params.locationId,
      serialized.id as string,
      "order.placed",
      {
        order_id: serialized.id,
        order_number: serialized.order_number,
        status: serialized.status,
        fulfillment_type: serialized.fulfillment_type,
        estimated_ready_at: serialized.estimated_ready_at,
      },
    );

    return serialized;
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: { include: { modifiers: true, flavours: true }, orderBy: { lineNo: "asc" } },
        statusEvents: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }
    return serializeOrder(order as unknown as Record<string, unknown>);
  }
}
