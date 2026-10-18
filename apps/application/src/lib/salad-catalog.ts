/**
 * salad-catalog.ts
 *
 * Helpers for child salad selection and customization in the Wings-4-U Special.
 * Ported 1:1 from `apps/web/src/lib/salad-catalog.ts` and `apps/web/src/components/wings-builder.tsx`.
 */
import type { MenuItem } from './types';

const SALAD_SELECTION_TO_SLUG: Record<string, string> = {
  'garden salad': 'garden-salad',
  'caesar salad': 'caesar-salad',
  'greek salad': 'greek-salad',
  'horiatiki salad': 'horiatiki-salad',
  'buffalo chicken salad': 'buffalo-chicken-salad',
};

export function normalizeSaladSelection(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function saladSlugForSelectionName(selectionName: string): string | null {
  const normalized = normalizeSaladSelection(selectionName);
  return SALAD_SELECTION_TO_SLUG[normalized] ?? null;
}

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
      group.context_key === 'size' &&
      group.options.some(
        (option) => normalizeSaladSelection(option.name) === normalizedSize,
      ),
  );
}

export const WINGS_SPECIAL_SALAD_SIZE_LABEL = 'Small';

export function normalizeSaladAddonDisplayLabel(
  displayLabel: string | undefined,
  name: string,
): string {
  const raw = (displayLabel ?? name).trim();
  return raw === 'Salad extras' ? 'Additional ingredients' : raw;
}


export { embeddedSaladCatalog } from '@wings4u/customization';
