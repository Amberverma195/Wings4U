import { cents } from "./format";
import type {
  CartBuilderPayload,
  CartItem,
  ItemCustomizationPayload,
  LunchSpecialPayload,
  RemovedIngredientSelection,
  WingBuilderPayload,
} from "./types";

/** Matches `item-customization-overlay` bundle note prefix (legacy lines in special_instructions). */
export const SIDE_POP_BUNDLE_NOTE_PREFIX = "Add-on: Small fries + pop";

/** Remove the serialized side+pop upgrade paragraph; combo is shown from builder_payload. */
export function stripSidePopBundleNoteFromInstructions(text: string): string {
  if (!text.trim()) return "";
  return text
    .split(/\n\n+/)
    .filter((para) => !para.trim().startsWith(SIDE_POP_BUNDLE_NOTE_PREFIX))
    .join("\n\n")
    .trim();
}

function lunchAutoInstructionSegments(
  itemName: string,
  payload: LunchSpecialPayload,
): string[] {
  const segments = [`Lunch ${itemName}: ${payload.child_name}`];
  if (payload.removed_ingredients.length > 0) {
    segments.push(`No: ${payload.removed_ingredients.map((r) => r.name).join(", ")}`);
  }
  if (payload.child_addons.length > 0) {
    segments.push(`Add: ${payload.child_addons.map((a) => a.name).join(", ")}`);
  }
  return segments;
}

/**
 * Customer-facing instruction text.
 * Lunch specials store an auto-generated kitchen summary in `special_instructions`;
 * hide that generated prefix on customer surfaces and only show the user-entered tail.
 */
export function getCustomerVisibleInstructions(
  item: Pick<CartItem, "name" | "special_instructions" | "builder_payload">,
): string {
  const cleaned = stripSidePopBundleNoteFromInstructions(item.special_instructions ?? "");
  if (!cleaned) return "";
  if (item.builder_payload?.builder_type !== "LUNCH_SPECIAL") {
    return cleaned;
  }

  const expectedSegments = lunchAutoInstructionSegments(
    item.name,
    item.builder_payload as LunchSpecialPayload,
  );
  const actualSegments = cleaned
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);

  while (expectedSegments.length > 0 && actualSegments.length > 0) {
    if (actualSegments[0] !== expectedSegments[0]) break;
    actualSegments.shift();
    expectedSegments.shift();
  }

  return actualSegments.join(" | ").trim();
}

/** Cart summary lines for the small side + pop upgrade (matches overlay copy). */
export function sidePopComboDisplayLines(bundle: {
  price_cents: number;
  side_label: string;
  pop_label: string;
}): string[] {
  return [
    `Combo: Small fries + pop (+${cents(bundle.price_cents)})`,
    `Side: ${bundle.side_label}`,
    `Pop: ${bundle.pop_label}`,
  ];
}

export const EXTRA_FLAVOUR_PRICE_CENTS = 100;

export function getRemovedIngredientsFromBuilderPayload(
  payload?: CartBuilderPayload,
): RemovedIngredientSelection[] {
  if (!payload || payload.builder_type !== "ITEM_CUSTOMIZATION") {
    return [];
  }

  return (payload as ItemCustomizationPayload).removed_ingredients ?? [];
}

/**
 * Removals to send on cart quote / checkout API requests: **parent menu line only**.
 * Wing salad removals stay in `builder_payload.salad_customization` and are validated
 * separately on the server — do not merge them here (that caused false 422s for
 * Wings-4-U Special when "No: Bacon" was only on the salad).
 * For cart display ("No:" lines including salad), use {@link getCartItemRemovedIngredients}.
 */
export function getRemovedIngredientsForApi(
  item: Pick<CartItem, "removed_ingredients" | "builder_payload">,
): RemovedIngredientSelection[] {
  if (item.removed_ingredients?.length) {
    return item.removed_ingredients;
  }
  return getRemovedIngredientsFromBuilderPayload(item.builder_payload);
}

export function getBuilderPriceDelta(payload?: CartBuilderPayload): number {
  if (!payload) return 0;
  if (payload.builder_type === "ITEM_CUSTOMIZATION") {
    const bundle = (payload as ItemCustomizationPayload).side_pop_bundle;
    return bundle?.price_cents ?? 0;
  }
  if (payload.builder_type === "LUNCH_SPECIAL") {
    // Lunch specials park child-item add-ons in the payload (not in
    // modifier_selections, since the API would reject those option ids on
    // the lunch row), so they need to be added back to the line price here.
    return payload.child_addons.reduce(
      (sum, addon) => sum + addon.price_delta_cents,
      0,
    );
  }
  return payload.extra_flavour ? EXTRA_FLAVOUR_PRICE_CENTS : 0;
}

function removedIngredientsFromWingSalad(
  payload?: CartBuilderPayload,
): RemovedIngredientSelection[] {
  if (
    !payload ||
    (payload.builder_type !== "WINGS" && payload.builder_type !== "WING_COMBO")
  ) {
    return [];
  }
  return (payload as WingBuilderPayload).salad_customization?.removed_ingredients ?? [];
}

export function getCartItemRemovedIngredients(
  item: Pick<CartItem, "removed_ingredients" | "builder_payload">,
): RemovedIngredientSelection[] {
  const fromLine = item.removed_ingredients?.length
    ? item.removed_ingredients
    : getRemovedIngredientsFromBuilderPayload(item.builder_payload);

  const fromSalad = removedIngredientsFromWingSalad(item.builder_payload);
  if (fromSalad.length === 0) return fromLine;

  const seen = new Set(fromLine.map((r) => r.id));
  const merged = [...fromLine];
  for (const r of fromSalad) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  return merged;
}

export function getCartItemUnitPrice(
  item: Pick<CartItem, "base_price_cents" | "modifier_selections" | "builder_payload">,
) {
  const modifierTotal = item.modifier_selections.reduce(
    (sum, selection) => sum + selection.price_delta_cents,
    0,
  );

  return item.base_price_cents + modifierTotal + getBuilderPriceDelta(item.builder_payload);
}

/**
 * Modifier groups from the API are often labeled "{Item name} Extras"; cart/checkout already
 * show the line title, so strip that repeated prefix for display.
 */
export function displayModifierGroupName(itemName: string, groupName: string): string {
  const g = groupName.trim();
  const name = itemName.trim();
  if (!name) return g;
  const prefix = `${name} `;
  if (g.startsWith(prefix)) {
    return g.slice(prefix.length).trim() || g;
  }
  return g;
}

/** Splits `Label: value` so labels stay light and values use accent (matches cart line rows). */
export function splitCartDescLine(line: string): { label: string; value: string } | null {
  const idx = line.indexOf(": ");
  if (idx === -1) return null;
  return {
    label: line.slice(0, idx + 2),
    value: line.slice(idx + 2).trim(),
  };
}
