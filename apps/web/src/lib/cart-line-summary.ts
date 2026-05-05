import {
  displayModifierGroupName,
  getCartItemRemovedIngredients,
  sidePopComboDisplayLines,
} from "@/lib/cart-item-utils";
import type { CartItem, ItemCustomizationPayload, LunchSpecialPayload, WingBuilderPayload } from "@/lib/types";

/** Matches wing-builder `parseMaxFlavours` using cart line `name` only. */
function parseMaxFlavoursFromName(name: string): number {
  const text = name;
  if (/75\s*Wings/i.test(text) || /100\s*Wings/i.test(text)) return 5;
  const m = text.match(/(\d+)\s*Flavours?/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

function formatSizeLb(weight: number): string {
  return Number.isInteger(weight) ? `${weight}LB` : `${weight}LB`;
}

/** Party packs use wing count in the cart, not internal 1LB weight. */
function partyPackSizeDisplayLine(item: CartItem): string | null {
  const slug = item.menu_item_slug?.trim();
  if (slug === "party-100-wings") return "size: 100 wings";
  if (slug === "party-75-wings") return "size: 75 wings";
  const n = item.name.trim();
  if (/^100\s+Wings/i.test(n)) return "size: 100 wings";
  if (/^75\s+Wings/i.test(n)) return "size: 75 wings";
  return null;
}

function wingPreparationLabel(payload: WingBuilderPayload): string {
  if (payload.wing_type === "BONELESS") return "Breaded-Boneless";
  if (payload.preparation === "BREADED") return "House Breaded Bone-In";
  return "Non-Breaded Bone-In";
}

/** Menu modifier option that duplicates the structured Preparation Type line — omit from tail. */
function wingModifierOptionIsDuplicateOfPrepLine(
  optionName: string,
  payload: WingBuilderPayload,
): boolean {
  if (
    payload.wing_type === "BONELESS" &&
    /boneless/i.test(optionName.trim())
  ) {
    return true;
  }
  const prep = wingPreparationLabel(payload);
  return optionName.trim().toLowerCase() === prep.toLowerCase();
}

const SAUCING_METHOD_LABELS: Record<string, string> = {
  HALF_HALF: "Half and half",
  HALF_AND_HALF: "Half and half",
  MIXED: "Mixed together",
  SIDE: "Sauce on the side",
  SPLIT_EVENLY: "Split evenly",
  ALL_MIXED: "All mixed together",
  TWO_MIXED_ONE_SIDE: "Two mixed on wings, one on the side",
  TELL_US_HOW: "Tell us how",
};

function saucingMethodLabel(value: string | undefined): string | null {
  if (!value) return null;
  return (
    SAUCING_METHOD_LABELS[value] ??
    value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function extraPlacementLine(placement: string): string {
  if (placement === "ON_SIDE") return "On the side";
  if (placement === "MIXED") return "Mixed";
  if (placement === "ON_WINGS") return "On wings";
  return placement.replace(/_/g, " ");
}

/**
 * Lines describing how sauces are applied (after "Sauce 1", "Sauce 2", … names only).
 */
function buildSaucingSummaryLines(payload: WingBuilderPayload): string[] {
  const method = payload.saucing_method;
  if (!method) return [];

  const sortedSlots = [...payload.flavour_slots].sort((a, b) => a.slot_no - b.slot_no);
  const names = sortedSlots.map((s) => (s.flavour_name?.trim() ? s.flavour_name : "Plain"));
  const n = names.length;
  const sideSlot = payload.side_flavour_slot_no ?? null;
  const sideName =
    sideSlot != null && sideSlot >= 1 && sideSlot <= n ? names[sideSlot - 1] : null;

  switch (method) {
    case "ON_WINGS":
      return n <= 1 ? ["Saucing method: Tossed on wings"] : [];
    case "ON_SIDE":
      return n <= 1 ? ["Saucing method: On the side"] : [];
    case "HALF_HALF":
      return ["Saucing method: Half and half"];
    case "MIXED":
      return ["Saucing method: Mixed together"];
    case "SIDE":
      return sideName
        ? [`On the side: ${sideName}`]
        : ["Saucing method: Sauce on the side"];
    case "ALL_MIXED":
      return ["Saucing method: All mixed together"];
    case "SPLIT_EVENLY":
      return ["Saucing method: Split evenly"];
    case "TWO_MIXED_ONE_SIDE": {
      const out: string[] = ["Saucing method: Two mixed on wings"];
      if (sideName) out.push(`On the side: ${sideName}`);
      return out;
    }
    case "TELL_US_HOW":
      return ["Saucing method: Tell us how"];
    default: {
      const label = saucingMethodLabel(method);
      return label ? [`Saucing method: ${label}`] : [];
    }
  }
}

/** Wings-4-U Special is always 2 lb wings; payload may still say 1 from older clients. */
function displayWingWeightLb(item: CartItem, payload: WingBuilderPayload): number {
  if (item.name === "Wings-4-U Special") return 2;
  return payload.weight_lb;
}

/**
 * Structured kitchen-facing lines for wing / wing-combo builder lines.
 */
function buildWingSummaryLines(item: CartItem): string[] {
  const payload = item.builder_payload as WingBuilderPayload;
  const lines: string[] = [];

  const partySize = partyPackSizeDisplayLine(item);
  lines.push(
    partySize ?? `size: ${formatSizeLb(displayWingWeightLb(item, payload))}`,
  );
  lines.push(`Preparation Type: ${wingPreparationLabel(payload)}`);

  const maxSlots = Math.max(
    parseMaxFlavoursFromName(item.name),
    payload.flavour_slots.length,
    payload.flavour_slots.reduce((m, s) => Math.max(m, s.slot_no), 0),
  );

  const sortedSlots = [...payload.flavour_slots].sort((a, b) => a.slot_no - b.slot_no);
  for (let i = 0; i < maxSlots; i++) {
    const slot = sortedSlots[i];
    const sauceName = slot?.flavour_name?.trim() ? slot.flavour_name : "Plain";
    lines.push(`Sauce ${i + 1}: ${sauceName}`);
  }

  lines.push(...buildSaucingSummaryLines(payload));

  if (payload.extra_flavour) {
    lines.push(
      `Extra Sauce: ${payload.extra_flavour.flavour_name} — ${extraPlacementLine(payload.extra_flavour.placement)}`,
    );
  }

  return lines;
}

/** Party 5-flavour note — rendered after Side lines so Extra Sauce stays next to Side. */
function buildWingSaucingCustomerNoteLines(item: CartItem): string[] {
  const payload = item.builder_payload as WingBuilderPayload | undefined;
  const note = payload?.saucing_customer_note?.trim();
  return note ? [`Saucing note: ${note}`] : [];
}

/**
 * Wings-4-U Special has no Small/Large Side modifier; fries + mozz are fixed on the combo.
 * Show a Side line after Extra Sauce so the cart matches what they get.
 */
function bundledSideLineWhenNoSideModifier(
  item: CartItem,
  sideLinesFromModifiers: string[],
): string[] {
  if (sideLinesFromModifiers.length > 0) return [];
  if (item.name !== "Wings-4-U Special") return [];
  return ["Side: Large fries + 4 mozz. sticks (included)"];
}

/**
 * Size choice for customizable items (e.g. poutine) — group is often "{Item} Size" → "Size" after strip.
 */
function isItemCustomizationSizeGroup(itemName: string, groupName: string): boolean {
  const shown = displayModifierGroupName(itemName, groupName.trim());
  if (/^size$/i.test(shown)) return true;
  if (/\bExtras\b/i.test(shown)) return false;
  if (/\bAdd-?ons?\b/i.test(shown)) return false;
  return /\bSize\b/i.test(shown);
}

type ItemCustomizationModifierBuckets = { sizeLines: string[]; extraLines: string[] };

/** Modifiers split so cart can show Size → No: → Extras / add-ons. */
function bucketItemCustomizationModifiers(item: CartItem): ItemCustomizationModifierBuckets {
  const sizeLines: string[] = [];
  const extraLines: string[] = [];
  for (const modifier of item.modifier_selections) {
    if (shouldSkipWingModifierForSummary(modifier, null, null)) {
      continue;
    }
    const g = modifier.group_name.trim();
    const o = modifier.option_name.trim();
    if (!g || !o) continue;
    const line = `${displayModifierGroupName(item.name, g)}: ${o}${
      g === "Open Food" && modifier.price_delta_cents > 0
        ? ` (+$${(modifier.price_delta_cents / 100).toFixed(2)})`
        : ""
    }`;
    if (isItemCustomizationSizeGroup(item.name, g)) {
      sizeLines.push(line);
    } else {
      extraLines.push(line);
    }
  }
  return { sizeLines, extraLines };
}

/** One line per modifier: `Group name: Option` (non–wing-builder flows). */
function linesFromLabeledModifiers(
  item: CartItem,
  wingPayloadForMods: WingBuilderPayload | null,
  selectedSaladName: string | null | undefined,
): string[] {
  const out: string[] = [];
  for (const modifier of item.modifier_selections) {
    if (shouldSkipWingModifierForSummary(modifier, wingPayloadForMods, selectedSaladName)) {
      continue;
    }
    const g = modifier.group_name;
    const o = modifier.option_name;
    const priceSuffix =
      g === "Open Food" && modifier.price_delta_cents > 0
        ? ` (+$${(modifier.price_delta_cents / 100).toFixed(2)})`
        : "";
    out.push(`${displayModifierGroupName(item.name, g)}: ${o}${priceSuffix}`);
  }
  return out;
}

function shouldSkipWingModifierForSummary(
  modifier: { group_name: string; option_name: string },
  wingPayloadForMods: WingBuilderPayload | null,
  selectedSaladName: string | null | undefined,
): boolean {
  if (/^Flavour /i.test(modifier.group_name)) return true;
  if (selectedSaladName && modifier.option_name === selectedSaladName) return true;
  if (
    wingPayloadForMods &&
    wingModifierOptionIsDuplicateOfPrepLine(modifier.option_name, wingPayloadForMods)
  ) {
    return true;
  }
  return false;
}

function isSideModifierGroup(groupName: string): boolean {
  return /^(Small|Large) Side\b/i.test(groupName.trim());
}

function isDrinkModifierGroup(groupName: string): boolean {
  const g = groupName.trim();
  return (
    /^Drink\s+\d/i.test(g) ||
    /^Pop\s+\d/i.test(g) ||
    g === "Pop Type"
  );
}

/** `side: option (size)` — group is e.g. Small Side, Large Side 1. */
function formatSideCartLine(groupName: string, optionName: string): string {
  const g = groupName.trim();
  const o = optionName.trim();
  let sizeLabel: string;
  if (/^Small Side/i.test(g)) sizeLabel = "small";
  else if (/^Large Side 1$/i.test(g)) sizeLabel = "large";
  else if (/^Large Side 2$/i.test(g)) sizeLabel = "large 2";
  else sizeLabel = g;
  return `Side: ${o} (${sizeLabel})`;
}

function modifierSlotOrder(groupName: string): number {
  const m = groupName.match(/(\d+)/);
  return m ? Number.parseInt(m[1] ?? "0", 10) : 0;
}

type WingModifierBuckets = { sideLines: string[]; extraLines: string[]; drinkLines: string[] };

/**
 * Splits wing/combo modifier rows into side / extras (salad, dips, add-ons, …) / drinks
 * for a fixed cart display order.
 */
function bucketWingModifiersForDisplay(
  item: CartItem,
  wingPayloadForMods: WingBuilderPayload | null,
  selectedSaladName: string | null | undefined,
): WingModifierBuckets {
  const sideLines: string[] = [];
  const extraLines: string[] = [];
  const drinkRows: Array<{ line: string; order: number }> = [];

  for (const modifier of item.modifier_selections) {
    if (shouldSkipWingModifierForSummary(modifier, wingPayloadForMods, selectedSaladName)) {
      continue;
    }
    const g = modifier.group_name.trim();
    const o = modifier.option_name.trim();
    if (!g || !o) continue;

    if (isSideModifierGroup(g)) {
      sideLines.push(formatSideCartLine(g, o));
    } else if (isDrinkModifierGroup(g)) {
      drinkRows.push({ line: `${g}: ${o}`, order: modifierSlotOrder(g) });
    } else {
      const priceSuffix =
        g === "Open Food" && modifier.price_delta_cents > 0
          ? ` (+$${(modifier.price_delta_cents / 100).toFixed(2)})`
          : "";
      extraLines.push(
        `${displayModifierGroupName(item.name, g)}: ${o}${priceSuffix}`,
      );
    }
  }

  drinkRows.sort((a, b) => a.order - b.order);
  return {
    sideLines,
    extraLines,
    drinkLines: drinkRows.map((d) => d.line),
  };
}

/** `No:` lines — lunch reads payload; other types use cart line + ITEM_CUSTOMIZATION payload. */
function buildRemovedLines(item: CartItem): string[] {
  if (item.builder_payload?.builder_type === "LUNCH_SPECIAL") {
    const payload = item.builder_payload as LunchSpecialPayload;
    return payload.removed_ingredients.map((r) => `No: ${r.name}`);
  }
  return getCartItemRemovedIngredients(item).map((r) => `No: ${r.name}`);
}

/**
 * Human-readable summary lines for a cart line (cart page, checkout order summary, etc.).
 * ITEM_CUSTOMIZATION: size → removed (No:) → other modifiers → combo / side+pop (when present).
 * Wings: wing summary → sides → notes → removals → extras → drinks.
 * Default: removed → modifiers.
 */
export function buildLineSummary(item: CartItem): string[] {
  const lines: string[] = [];
  const removedLines = buildRemovedLines(item);

  const selectedSaladName =
    item.builder_payload?.builder_type === "WINGS" ||
    item.builder_payload?.builder_type === "WING_COMBO"
      ? (item.builder_payload as WingBuilderPayload).salad_customization?.salad_name
      : null;
  const wingPayloadForMods =
    item.builder_payload?.builder_type === "WINGS" ||
    item.builder_payload?.builder_type === "WING_COMBO"
      ? (item.builder_payload as WingBuilderPayload)
      : null;

  if (item.builder_payload?.builder_type === "LUNCH_SPECIAL") {
    const payload = item.builder_payload as LunchSpecialPayload;
    lines.push(payload.child_name);
    lines.push(...removedLines);
    for (const a of payload.child_addons) {
      lines.push(`Add-on: ${a.name}`);
    }
    lines.push(...linesFromLabeledModifiers(item, null, null));
    return lines;
  }

  if (item.builder_payload?.builder_type === "ITEM_CUSTOMIZATION") {
    const payload = item.builder_payload as ItemCustomizationPayload;
    const { sizeLines, extraLines } = bucketItemCustomizationModifiers(item);
    lines.push(...sizeLines);
    lines.push(...removedLines);
    lines.push(...extraLines);
    if (payload.side_pop_bundle) {
      lines.push(...sidePopComboDisplayLines(payload.side_pop_bundle));
    }
    return lines;
  }

  if (item.builder_payload?.builder_type === "WINGS" || item.builder_payload?.builder_type === "WING_COMBO") {
    const buckets = bucketWingModifiersForDisplay(item, wingPayloadForMods, selectedSaladName);
    const wingPayload = wingPayloadForMods;
    const saladName = wingPayload?.salad_customization?.salad_name?.trim();

    lines.push(...buildWingSummaryLines(item));
    lines.push(...buckets.sideLines);
    lines.push(...bundledSideLineWhenNoSideModifier(item, buckets.sideLines));
    lines.push(...buildWingSaucingCustomerNoteLines(item));

    if (item.name === "Wings-4-U Special" && saladName) {
      lines.push(`Small salad: ${saladName}`);
      for (const r of wingPayload!.salad_customization!.removed_ingredients ?? []) {
        lines.push(`No: ${r.name}`);
      }
      for (const r of item.removed_ingredients ?? []) {
        lines.push(`No: ${r.name}`);
      }
    } else {
      lines.push(...removedLines);
    }

    lines.push(...buckets.extraLines);
    lines.push(...buckets.drinkLines);
    return lines;
  }

  lines.push(...removedLines);
  lines.push(...linesFromLabeledModifiers(item, null, null));
  return lines;
}

/** All summary lines render as structured rows (category left, selection right); no pill row. */
export function splitSummaryForDisplay(lines: string[]): { description: string[] } {
  return { description: lines };
}
