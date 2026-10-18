import type { MenuItem } from "./types";

import { normalizeSaladSelection, saladSlugForSelectionName } from '@wings4u/customization';
export { normalizeSaladSelection, saladSlugForSelectionName, WINGS_SPECIAL_SALAD_SIZE_LABEL } from '@wings4u/customization';

export function findSaladMenuItemForSelection(
  saladItems: MenuItem[],
  selectionName: string,
): MenuItem | null {
  const slug = saladSlugForSelectionName(selectionName);
  if (!slug) return null;
  return saladItems.find((item) => item.slug === slug) ?? null;
}

export function saladItemSupportsSize(
  saladItem: MenuItem,
  sizeLabel: string,
): boolean {
  const normalizedSize = normalizeSaladSelection(sizeLabel);
  return saladItem.modifier_groups.some(
    (group) =>
      group.context_key === "size" &&
      group.options.some(
        (option) => normalizeSaladSelection(option.name) === normalizedSize,
      ),
  );
}


/** Legacy DB rows used "Salad extras"; map to current menu copy. */
export function normalizeSaladAddonDisplayLabel(
  displayLabel: string | undefined,
  name: string,
): string {
  const raw = (displayLabel ?? name).trim();
  return raw === "Salad extras" ? "Additional ingredients" : raw;
}

export { embeddedSaladCatalog } from '@wings4u/customization';
