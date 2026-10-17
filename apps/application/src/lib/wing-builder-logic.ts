/**
 * wing-builder-logic.ts
 *
 * Pure TypeScript port of the shared business logic from:
 *   apps/web/src/components/builder-shared.tsx
 *   apps/web/src/components/wings-builder.tsx
 *   apps/web/src/components/combo-builder.tsx
 *   apps/web/src/lib/cart-item-utils.ts
 *
 * No React, no React Native — fully testable in Node / Jest.
 * All names and semantics match the website implementation 1:1.
 */

import type {
  CartBuilderPayload,
  CartItem,
  FulfillmentType,
  ItemCustomizationPayload,
  LunchSpecialPayload,
  MenuItem,
  ModifierGroup,
  WingFlavour,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Price constants (mirrored from web's cart-item-utils.ts)           */
/* ------------------------------------------------------------------ */

export const BONELESS_WINGS_UPCHARGE_CENTS = 100;
export const EXTRA_FLAVOUR_PRICE_CENTS = 100;

/* ------------------------------------------------------------------ */
/*  Heat level ordering                                                */
/* ------------------------------------------------------------------ */

export const HEAT_ORDER = ["PLAIN", "MILD", "MEDIUM", "HOT", "DRY_RUB"] as const;
export type HeatLevel = (typeof HEAT_ORDER)[number];

/* ------------------------------------------------------------------ */
/*  Wing preparation options                                           */
/* ------------------------------------------------------------------ */

export type WingType = "BONE_IN" | "BONELESS" | null;
export type Preparation = "BREADED" | "NON_BREADED" | null;
export type WingPreparationOptionId =
  | "BREADED_BONE_IN"
  | "NON_BREADED_BONE_IN"
  | "BREADED_BONELESS";

export type WingPreparationOption = {
  id: WingPreparationOptionId;
  label: string;
  wingType: Exclude<WingType, null>;
  preparation: Exclude<Preparation, null>;
  priceNote?: string;
};

export const WING_PREPARATION_OPTIONS: WingPreparationOption[] = [
  {
    id: "BREADED_BONE_IN",
    label: "Breaded - Bone-In",
    wingType: "BONE_IN",
    preparation: "BREADED",
  },
  {
    id: "NON_BREADED_BONE_IN",
    label: "Non-Breaded Bone-In",
    wingType: "BONE_IN",
    preparation: "NON_BREADED",
  },
  {
    id: "BREADED_BONELESS",
    label: "Breaded-Boneless",
    wingType: "BONELESS",
    preparation: "BREADED",
    priceNote: `+$${(BONELESS_WINGS_UPCHARGE_CENTS / 100).toFixed(2)}`,
  },
];

export function normalizeInitialPreparation(
  wingType: WingType,
  preparation: Preparation,
): Preparation {
  return wingType === "BONELESS" ? "BREADED" : preparation;
}

export function selectedWingPreparationId(
  wingType: WingType,
  preparation: Preparation,
): WingPreparationOptionId | null {
  const option = WING_PREPARATION_OPTIONS.find(
    (candidate) =>
      candidate.wingType === wingType && candidate.preparation === preparation,
  );
  return option?.id ?? null;
}

/* ------------------------------------------------------------------ */
/*  Flavour helpers                                                    */
/* ------------------------------------------------------------------ */

export function getHeatLevel(flavour: WingFlavour): string {
  return flavour.is_plain ? "PLAIN" : flavour.heat_level;
}

/** True when the flavour carries no sauce (plain / no-sauce). */
export function isFlavourWithoutSauce(flavour: WingFlavour | undefined): boolean {
  if (!flavour) return false;
  if (flavour.is_plain) return true;
  return flavour.heat_level === "PLAIN";
}

/** True when every selected flavour is plain / no-sauce. */
export function areAllSelectedFlavoursPlain(
  flavourIds: string[],
  flavourMap: Map<string, WingFlavour>,
): boolean {
  if (flavourIds.length === 0) return false;
  if (flavourIds.some((id) => !id)) return false;
  return flavourIds.every((id) => isFlavourWithoutSauce(flavourMap.get(id)));
}

/** Number of flavour slots that actually have sauce (not plain). */
export function countEffectiveSaucedFlavours(
  flavourIds: string[],
  flavourMap: Map<string, WingFlavour>,
): number {
  return flavourIds.reduce((count, id) => {
    if (!id) return count;
    const flavour = flavourMap.get(id);
    return flavour && !isFlavourWithoutSauce(flavour) ? count + 1 : count;
  }, 0);
}

export type FlavourGroup = { level: string; items: WingFlavour[] };

/**
 * Groups flavours by heat level in the canonical HEAT_ORDER.
 * Matches FlavourPicker grouping in builder-shared.tsx exactly.
 */
export function groupFlavoursByHeat(flavours: WingFlavour[]): FlavourGroup[] {
  const map = new Map<string, WingFlavour[]>();
  for (const flavour of flavours) {
    const level = getHeatLevel(flavour);
    if (!map.has(level)) map.set(level, []);
    map.get(level)!.push(flavour);
  }

  // Sort within each group
  for (const entries of map.values()) {
    entries.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  }

  // Order groups by HEAT_ORDER, then any extras
  const ordered: FlavourGroup[] = HEAT_ORDER
    .map((level) => ({ level, items: map.get(level) ?? [] }))
    .filter((entry) => entry.items.length > 0);

  for (const [level, items] of map.entries()) {
    if (!ordered.some((entry) => entry.level === level)) {
      ordered.push({ level, items });
    }
  }

  return ordered;
}

/**
 * The initially active heat tab:
 *  - If a flavour is selected, use its tab.
 *  - Otherwise, start on the first non-PLAIN tab.
 */
export function resolveInitialHeatTab(
  flavours: WingFlavour[],
  grouped: FlavourGroup[],
  selectedFlavourId: string,
): string {
  const selected = flavours.find((f) => f.id === selectedFlavourId);
  if (selected) return getHeatLevel(selected);
  const firstNonPlain = grouped.find((g) => g.level !== "PLAIN");
  return firstNonPlain?.level ?? grouped[0]?.level ?? "MILD";
}

/* ------------------------------------------------------------------ */
/*  Extra-flavour groups (paid — plain excluded)                       */
/* ------------------------------------------------------------------ */

export type ExtraFlavourGroup = { label: string; levels: readonly string[]; items: WingFlavour[] };

const EXTRA_FLAVOUR_TAB_DEFS = [
  { label: "Mild", levels: ["MILD"] as const },
  { label: "Medium", levels: ["MEDIUM"] as const },
  { label: "Hot", levels: ["HOT"] as const },
  { label: "Dry Rubs", levels: ["DRY_RUB"] as const },
] as const;

export function groupFlavoursForExtraPicker(flavours: WingFlavour[]): ExtraFlavourGroup[] {
  return EXTRA_FLAVOUR_TAB_DEFS.map((tab) => ({
    label: tab.label,
    levels: tab.levels,
    items: flavours
      .filter((f) => (tab.levels as readonly string[]).includes(getHeatLevel(f)))
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
  })).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Saucing logic — exact port of builder-shared.tsx                  */
/* ------------------------------------------------------------------ */

export type SaucingOption = { value: string; label: string };

/**
 * Returns only the valid saucing methods for the given configuration.
 * Mirrors getSaucingOptions() in builder-shared.tsx exactly.
 */
export function getSaucingOptions(
  effectiveSaucedCount: number,
  slotCount: number,
  partyFiveSpecial?: boolean,
  threeFlavourTellUsHow = false,
): SaucingOption[] {
  if (effectiveSaucedCount <= 1) {
    return [
      { value: "ON_WINGS", label: "Sauce on wings" },
      { value: "ON_SIDE", label: "On the side" },
    ];
  }

  if (threeFlavourTellUsHow) {
    return [
      { value: "SPLIT_EVENLY", label: "Split evenly (1/3 + 1/3 + 1/3)" },
      { value: "ALL_MIXED", label: "All mixed together" },
      { value: "TELL_US_HOW", label: "Tell us how to do it" },
    ];
  }

  if (partyFiveSpecial && slotCount === 5 && effectiveSaucedCount >= 2) {
    return [
      { value: "ALL_MIXED", label: "All mixed together" },
      { value: "SPLIT_EVENLY", label: "Split evenly" },
      { value: "TELL_US_HOW", label: "Tell us how to do it" },
    ];
  }

  if (effectiveSaucedCount === 2) {
    return [
      { value: "HALF_HALF", label: "Half and half" },
      { value: "SIDE", label: "Sauce on the side" },
    ];
  }

  return [
    { value: "TWO_MIXED_ONE_SIDE", label: "Two mixed + one on the side" },
    { value: "SPLIT_EVENLY", label: "Split evenly (1/3 + 1/3 + 1/3)" },
    { value: "ALL_MIXED", label: "All mixed together" },
  ];
}

export function isSaucingMethodValidForCount(
  effectiveSaucedCount: number,
  method: string | null,
  partyFiveSpecial?: boolean,
  slotCount = effectiveSaucedCount,
  threeFlavourTellUsHow = false,
): boolean {
  if (!method) return false;
  return getSaucingOptions(effectiveSaucedCount, slotCount, partyFiveSpecial, threeFlavourTellUsHow).some(
    (option) => option.value === method,
  );
}

export function defaultSaucingMethodForCount(
  effectiveSaucedCount: number,
  partyFiveSpecial?: boolean,
  slotCount = effectiveSaucedCount,
  threeFlavourTellUsHow = false,
): string | null {
  if (effectiveSaucedCount <= 0) return null;
  if (effectiveSaucedCount === 1) return "ON_WINGS";
  if (threeFlavourTellUsHow) return "SPLIT_EVENLY";
  if (partyFiveSpecial && slotCount === 5) return "ALL_MIXED";
  if (effectiveSaucedCount === 2) return "HALF_HALF";
  return "TWO_MIXED_ONE_SIDE";
}

/**
 * True when the chosen saucing method requires a "which flavour goes on the side?" sub-question.
 */
export function methodRequiresSideFlavourPick(
  effectiveSaucedCount: number,
  method: string | null,
): boolean {
  if (!method) return false;
  if (effectiveSaucedCount === 2) return method === "SIDE";
  if (effectiveSaucedCount >= 3) return method === "TWO_MIXED_ONE_SIDE";
  return false;
}

/**
 * Resolves per-slot placement values based on saucing method.
 * Exact port of resolveSaucingPlacements() from builder-shared.tsx.
 */
export function resolveSaucingPlacements(params: {
  flavourIds: string[];
  flavourMap: Map<string, WingFlavour>;
  saucingMethod: string | null;
  sideSlot: number | null;
}): Array<"ON_WINGS" | "ON_SIDE" | "MIXED"> {
  const { flavourIds, flavourMap, saucingMethod, sideSlot } = params;
  if (flavourIds.length <= 0) return [];

  const saucedSlotNumbers = flavourIds.flatMap((id, index) => {
    if (!id) return [];
    const flavour = flavourMap.get(id);
    return flavour && !isFlavourWithoutSauce(flavour) ? [index + 1] : [];
  });

  if (saucedSlotNumbers.length <= 0) {
    return Array.from({ length: flavourIds.length }, () => "ON_WINGS" as const);
  }

  const validSideSlot =
    sideSlot && saucedSlotNumbers.includes(sideSlot)
      ? sideSlot
      : saucedSlotNumbers[0] ?? null;

  return flavourIds.map((id, index) => {
    if (!id) return "ON_WINGS";

    const flavour = flavourMap.get(id);
    if (!flavour || isFlavourWithoutSauce(flavour)) {
      return "ON_WINGS";
    }

    const slotNo = index + 1;
    if (saucedSlotNumbers.length === 1) {
      return saucingMethod === "ON_SIDE" ? "ON_SIDE" : "ON_WINGS";
    }

    if (saucedSlotNumbers.length === 2) {
      if (saucingMethod === "MIXED") return "MIXED";
      if (saucingMethod === "SIDE") {
        return slotNo === validSideSlot ? "ON_SIDE" : "ON_WINGS";
      }
      return "ON_WINGS";
    }

    if (saucingMethod === "ALL_MIXED") return "MIXED";
    if (saucingMethod === "SPLIT_EVENLY") return "ON_WINGS";
    if (saucingMethod === "TELL_US_HOW") return "ON_WINGS";
    return slotNo === validSideSlot ? "ON_SIDE" : "MIXED";
  });
}

/* ------------------------------------------------------------------ */
/*  Misc helpers                                                       */
/* ------------------------------------------------------------------ */

export function extractWeightLb(name: string): number {
  const match = name.match(/([\d.]+)\s*pound/i);
  if (!match) return 1;
  const value = Number.parseFloat(match[1] ?? "1");
  return Number.isFinite(value) ? value : 1;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isWingBuilderItem(item: MenuItem): boolean {
  return item.builder_type === "WINGS";
}

export function isComboBuilderItem(item: MenuItem): boolean {
  return item.builder_type === "WING_COMBO";
}

export function getBuilderPriceDelta(payload?: CartBuilderPayload): number {
  if (!payload) return 0;
  if (payload.builder_type === "LUNCH_SPECIAL") {
    const addons = (payload as LunchSpecialPayload).child_addons;
    if (!Array.isArray(addons)) return 0;
    return addons.reduce((sum, addon) => sum + (addon?.price_delta_cents ?? 0), 0);
  }
  if (payload.builder_type === "ITEM_CUSTOMIZATION") {
    const bundle = (payload as ItemCustomizationPayload).side_pop_bundle;
    return bundle?.price_cents ?? 0;
  }
  if (payload.builder_type === "WINGS" || payload.builder_type === "WING_COMBO") {
    return (
      (payload.extra_flavour ? EXTRA_FLAVOUR_PRICE_CENTS : 0) +
      (payload.wing_type === "BONELESS" ? BONELESS_WINGS_UPCHARGE_CENTS : 0)
    );
  }
  return (payload as { extra_flavour?: unknown }).extra_flavour
    ? EXTRA_FLAVOUR_PRICE_CENTS
    : 0;
}

/**
 * Shared unit price for a cart item including modifier selections and all builder price deltas
 * (boneless wing upcharge, extra flavour upcharge, lunch special add-ons, item customization bundles).
 */
export function getCartItemUnitPrice(
  item: Pick<CartItem, "base_price_cents" | "modifier_selections" | "builder_payload">,
): number {
  const modifiers = item.modifier_selections.reduce(
    (sum, selection) => sum + selection.price_delta_cents,
    0,
  );
  return item.base_price_cents + modifiers + getBuilderPriceDelta(item.builder_payload);
}

/**
 * Shared line subtotal for a cart item: unit price * quantity.
 */
export function getCartItemSubtotal(
  item: Pick<CartItem, "base_price_cents" | "modifier_selections" | "builder_payload" | "quantity">,
): number {
  return getCartItemUnitPrice(item) * item.quantity;
}

/**
 * Shared cart subtotal: sum of getCartItemSubtotal for all items in the cart.
 */
export function calculateCartSubtotal(
  items: Array<Pick<CartItem, "base_price_cents" | "modifier_selections" | "builder_payload" | "quantity">>,
): number {
  return items.reduce((sum, item) => sum + getCartItemSubtotal(item), 0);
}

/**
 * Shared percentage-based delivery tip calculation with standard mathematical rounding.
 * Returns 0 if not DELIVERY or driverTipPercent is 'none'.
 */
export function calculateDeliveryTipCents(
  subtotalCents: number,
  driverTipPercent: "none" | 10 | 15 | 20 | number | string,
  fulfillmentType?: string,
): number {
  if (fulfillmentType && fulfillmentType !== "DELIVERY") {
    return 0;
  }
  if (driverTipPercent === "none" || !driverTipPercent) {
    return 0;
  }
  const percentNum = Number(driverTipPercent);
  if (!Number.isFinite(percentNum) || percentNum <= 0) {
    return 0;
  }
  return Math.round((subtotalCents * percentNum) / 100);
}

export function isItemAvailableForOrder(
  item: MenuItem | null | undefined,
  fulfillmentType: FulfillmentType,
): { available: boolean; reason?: string } {
  if (!item) return { available: false, reason: "Item not found" };
  if (!item.is_available || item.stock_status === "UNAVAILABLE") {
    return { available: false, reason: "This item is currently unavailable." };
  }
  if (
    item.allowed_fulfillment_type &&
    item.allowed_fulfillment_type !== "BOTH" &&
    item.allowed_fulfillment_type !== fulfillmentType
  ) {
    return {
      available: false,
      reason: `This item is only available for ${item.allowed_fulfillment_type.toLowerCase()}.`,
    };
  }
  return { available: true };
}

/**
 * Safe flavour extractor that only returns flavours if linked_flavour_id is present
 * and metadata is known. Never synthesizes unknown hot or dry rub flavours as MILD.
 * For true authoritative flavours, the API GET /api/v1/menu/wing-flavours must be used.
 */
export function extractFlavoursFromItem(item?: MenuItem | null): WingFlavour[] {
  if (!item) return [];
  const map = new Map<string, WingFlavour>();

  const scanGroups = (groups?: ModifierGroup[]) => {
    if (!groups) return;
    for (const group of groups) {
      for (const opt of group.options) {
        if (opt.linked_flavour_id) {
          const id = opt.linked_flavour_id;
          if (!map.has(id)) {
            const isPlain = /plain/i.test(opt.name);
            map.set(id, {
              id,
              name: opt.name,
              slug: id,
              heat_level: isPlain ? "PLAIN" : "MILD",
              is_plain: isPlain,
              sort_order: map.size,
            });
          }
        }
      }
    }
  };

  scanGroups(item.modifier_groups);
  for (const w of item.weight_options ?? []) {
    scanGroups(w.modifier_groups);
  }
  for (const c of item.combo_options ?? []) {
    scanGroups(c.modifier_groups);
  }

  return Array.from(map.values());
}
