import type { MenuItem } from "./types";

/** Slug patterns for items that should always open an overlay even when they have no modifiers. */
const ALWAYS_OPEN_OVERLAY_SLUGS = [
  /tender/i,
];

/**
 * Items that must use the customization overlay even if the catalog payload
 * is missing modifier rows (e.g. DB not re-seeded). After `prisma db seed`,
 * these still match normal rules — this is a safety net.
 */
function slugForcesCustomizationOverlay(slug: string): boolean {
  if (!slug) return false;
  if (slug.startsWith("tenders-")) return true;
  if (slug === "chicken-loaded-fries" || slug === "bacon-loaded-fries") return true;
  return false;
}

/**
 * Lunch specials that route through the dedicated LunchSpecialBuilder so the
 * customer can pick a child burger / wrap and customize it. lunch-5-wings is
 * intentionally NOT in this list — it goes through the WingsBuilder via its
 * builder_type === "WINGS".
 */
const LUNCH_SPECIAL_BUILDER_SLUGS = ["lunch-burger", "lunch-wrap"];

export function isWingBuilderItem(item: MenuItem) {
  return item.builder_type === "WINGS";
}

export function isComboBuilderItem(item: MenuItem) {
  return item.builder_type === "WING_COMBO";
}

export function isLunchSpecialBuilderItem(item: MenuItem) {
  return LUNCH_SPECIAL_BUILDER_SLUGS.includes(item.slug);
}

/** Items that must always show the customization/modal overlay (e.g. tenders with dips). */
export function shouldAlwaysOpenOverlay(item: MenuItem) {
  return ALWAYS_OPEN_OVERLAY_SLUGS.some((pattern) => pattern.test(item.slug) || pattern.test(item.name));
}

export function shouldUseCustomizationOverlay(item: MenuItem) {
  if (isWingBuilderItem(item) || isComboBuilderItem(item) || isLunchSpecialBuilderItem(item)) {
    return false;
  }

  if (slugForcesCustomizationOverlay(item.slug)) {
    return true;
  }

  return (
    item.removable_ingredients.length > 0 ||
    item.modifier_groups.length > 0 ||
    item.requires_special_instructions ||
    shouldAlwaysOpenOverlay(item)
  );
}

export function canQuickAddMenuItem(item: MenuItem) {
  return (
    !isWingBuilderItem(item) &&
    !isComboBuilderItem(item) &&
    !isLunchSpecialBuilderItem(item) &&
    !shouldUseCustomizationOverlay(item)
  );
}