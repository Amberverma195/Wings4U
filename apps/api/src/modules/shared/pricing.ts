/**
 * Shared pricing computation and menu-validation helpers.
 *
 * Extracted from cart.service.ts and checkout.service.ts so both modules
 * share the same source of truth.  Any new validation rule added here
 * automatically applies to both quote-time AND checkout-time.
 *
 * PRD §8 / §16-17 parity requirement:
 *   "Any rule enforced at quote time should have a matching server path
 *    in checkout.service.ts."
 */

// ────────────────────────  Types  ────────────────────────

export type PricingInput = {
  itemSubtotalCents: number;
  itemDiscountTotalCents: number;
  orderDiscountTotalCents: number;
  deliveryFeeCents: number;
  driverTipCents: number;
  walletAppliedCents: number;
};

export type PricingPolicy = {
  taxRateBps: number;
  taxDeliveryFee: boolean;
  taxTip: boolean;
  discountsReduceTaxableBase: boolean;
};

export type PricingResult = {
  itemSubtotalCents: number;
  itemDiscountTotalCents: number;
  orderDiscountTotalCents: number;
  discountedSubtotalCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  driverTipCents: number;
  walletAppliedCents: number;
  finalPayableCents: number;
};

export type RemovedIngredientInput = {
  id: string;
  name: string;
};

export type SaladCustomizationInput = {
  saladMenuItemId: string;
  removedIngredients: RemovedIngredientInput[];
  modifierOptionIds: string[];
};

// ────────────────────────  Constants  ────────────────────────

export const EXTRA_FLAVOUR_PRICE_CENTS = 100;
export const BONELESS_WINGS_UPCHARGE_CENTS = 100;
export const LUNCH_WINDOW_LABEL = "11 AM - 3 PM";
export const LUNCH_SPECIAL_SCHEDULE_CONFLICT_CODE = "LUNCH_SPECIAL_SCHEDULE_CONFLICT";
export const LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE =
  "Lunch specials are available 11 AM - 3 PM. Change your scheduled time or remove lunch items from your cart.";

// ────────────────────────  Functions  ────────────────────────

export function computePricing(input: PricingInput, policy: PricingPolicy): PricingResult {
  const discountedSubtotalCents =
    input.itemSubtotalCents - input.itemDiscountTotalCents - input.orderDiscountTotalCents;
  const taxableBase = policy.discountsReduceTaxableBase
    ? discountedSubtotalCents
    : input.itemSubtotalCents;
  const deliveryTaxable = policy.taxDeliveryFee ? input.deliveryFeeCents : 0;
  const tipTaxable = policy.taxTip ? input.driverTipCents : 0;
  const taxableSubtotalCents = Math.max(0, taxableBase + deliveryTaxable + tipTaxable);
  const taxCents = Math.max(0, Math.round((taxableSubtotalCents * policy.taxRateBps) / 10_000));
  const finalPayableCents = Math.max(
    0,
    discountedSubtotalCents +
      input.deliveryFeeCents +
      input.driverTipCents +
      taxCents -
      input.walletAppliedCents,
  );

  return {
    itemSubtotalCents: input.itemSubtotalCents,
    itemDiscountTotalCents: input.itemDiscountTotalCents,
    orderDiscountTotalCents: input.orderDiscountTotalCents,
    discountedSubtotalCents: Math.max(0, discountedSubtotalCents),
    taxableSubtotalCents,
    taxCents,
    deliveryFeeCents: input.deliveryFeeCents,
    driverTipCents: input.driverTipCents,
    walletAppliedCents: input.walletAppliedCents,
    finalPayableCents,
  };
}

export function getLocationLocalDate(referenceDate: Date, locationTz: string): Date {
  let localStr: string;
  try {
    localStr = referenceDate.toLocaleString("en-US", { timeZone: locationTz });
  } catch {
    localStr = referenceDate.toLocaleString("en-US");
  }
  return new Date(localStr);
}

export function isLunchSpecialMenuItem(menuItem: {
  slug?: string | null;
  category?: { slug?: string | null } | null;
}): boolean {
  return (
    (menuItem.slug?.startsWith("lunch-") ?? false) ||
    menuItem.category?.slug === "lunch-specials"
  );
}

export function buildScheduleViolationBody(params: {
  affectedItemIds: string[];
  timezone: string;
  lunchOnly: boolean;
}) {
  const { affectedItemIds, timezone, lunchOnly } = params;

  if (lunchOnly) {
    return {
      error: LUNCH_SPECIAL_SCHEDULE_CONFLICT_CODE,
      code: LUNCH_SPECIAL_SCHEDULE_CONFLICT_CODE,
      message: LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE,
      affected_item_ids: affectedItemIds,
      schedule_window: {
        time_from: "11:00",
        time_to: "15:00",
        label: LUNCH_WINDOW_LABEL,
        timezone,
      },
    };
  }

  return {
    error: "SCHEDULE_VIOLATION",
    code: "SCHEDULE_VIOLATION",
    message: "One or more items are not available at the selected time.",
    affected_item_ids: affectedItemIds,
    timezone,
  };
}

export function getBuilderPriceDelta(builderPayload?: Record<string, unknown>): number {
  if (!builderPayload) return 0;
  if (builderPayload.builder_type === "LUNCH_SPECIAL") {
    const addons = builderPayload.child_addons;
    if (!Array.isArray(addons)) return 0;
    let sum = 0;
    for (const row of addons) {
      if (row && typeof row === "object" && "price_delta_cents" in row) {
        const n = Number((row as { price_delta_cents: unknown }).price_delta_cents);
        if (Number.isFinite(n)) sum += n;
      }
    }
    return sum;
  }
  if (builderPayload.builder_type === "ITEM_CUSTOMIZATION") {
    const bundle = builderPayload.side_pop_bundle;
    if (bundle && typeof bundle === "object" && "price_cents" in bundle) {
      const n = Number((bundle as { price_cents: unknown }).price_cents);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }
  const extraFlavour = builderPayload.extra_flavour;
  const extraFlavourCents =
    extraFlavour && typeof extraFlavour === "object" ? EXTRA_FLAVOUR_PRICE_CENTS : 0;
  if (
    builderPayload.builder_type === "WINGS" ||
    builderPayload.builder_type === "WING_COMBO"
  ) {
    return (
      extraFlavourCents +
      (builderPayload.wing_type === "BONELESS" ? BONELESS_WINGS_UPCHARGE_CENTS : 0)
    );
  }
  return extraFlavourCents;
}

export function parseRemovedIngredients(value: unknown): RemovedIngredientInput[] {
  if (!Array.isArray(value)) return [];

  return value.filter((ingredient): ingredient is RemovedIngredientInput => {
    if (!ingredient || typeof ingredient !== "object") return false;
    const candidate = ingredient as RemovedIngredientInput;
    return typeof candidate.id === "string" && typeof candidate.name === "string";
  });
}

export function getSaladCustomization(
  builderPayload?: Record<string, unknown>,
): SaladCustomizationInput | null {
  if (
    !builderPayload ||
    (builderPayload.builder_type !== "WINGS" &&
      builderPayload.builder_type !== "WING_COMBO")
  ) {
    return null;
  }

  const raw = builderPayload.salad_customization;
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as {
    salad_menu_item_id?: unknown;
    removed_ingredients?: unknown;
    modifier_selections?: unknown;
  };
  if (typeof candidate.salad_menu_item_id !== "string") {
    return null;
  }

  const modifierOptionIds = Array.isArray(candidate.modifier_selections)
    ? candidate.modifier_selections
        .map((selection) => {
          if (!selection || typeof selection !== "object") return null;
          const optionId = (selection as { modifier_option_id?: unknown }).modifier_option_id;
          return typeof optionId === "string" ? optionId : null;
        })
        .filter((optionId): optionId is string => Boolean(optionId))
    : [];

  return {
    saladMenuItemId: candidate.salad_menu_item_id,
    removedIngredients: parseRemovedIngredients(candidate.removed_ingredients),
    modifierOptionIds,
  };
}
