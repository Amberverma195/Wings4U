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

export function normalizeIngredientText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferOptionSizeScope(
  optionName: string,
  normalizedSizeNames: string[],
): string | null {
  if (normalizedSizeNames.length === 0) return null;
  const normalizedOption = normalizeIngredientText(optionName);
  for (const sizeName of normalizedSizeNames) {
    const pattern = new RegExp(`(^|\\s)${escapeRegex(sizeName)}($|\\s)`);
    if (pattern.test(normalizedOption)) {
      return sizeName;
    }
  }
  return null;
}

const ADDON_OPTION_STOP_WORDS = new Set([
  'add',
  'extra',
  'on',
  'the',
  'side',
  'optional',
  'with',
]);

const ALWAYS_SHOW_ADDON_TOKENS = new Set([
  'bacon',
  'avocado',
  'jalapeno',
  'jalapenos',
  'olive',
  'olives',
  'chicken',
  'beef',
  'pulled',
  'butter',
  'cheese',
  'curds',
  'gravy',
  'sauce',
  'ranch',
  'mayo',
  'dressing',
  'tzatziki',
  'feta',
  'oil',
]);

export function getAddonMeaningfulTokens(value: string): string[] {
  return normalizeIngredientText(value)
    .replace(/\bon the side\b/g, ' ')
    .split(' ')
    .filter((token) => token && !ADDON_OPTION_STOP_WORDS.has(token));
}

export function optionMatchesAnyIngredient(
  optionName: string,
  normalizedIngredientNames: string[],
): boolean {
  if (normalizedIngredientNames.length === 0) return true;
  const normalizedOption = normalizeIngredientText(optionName)
    .replace(/\bon the side\b/g, ' ')
    .trim();
  const tokens = getAddonMeaningfulTokens(optionName);

  if (!normalizedOption || tokens.length === 0) {
    return true;
  }

  if (
    normalizedIngredientNames.some(
      (ingredient) =>
        ingredient === normalizedOption ||
        ingredient.includes(normalizedOption) ||
        normalizedOption.includes(ingredient),
    )
  ) {
    return true;
  }

  if (
    normalizedIngredientNames.some((ingredient) =>
      tokens.every((token) => ingredient.includes(token)),
    )
  ) {
    return true;
  }

  return (
    normalizedOption.startsWith('add ') ||
    tokens.some((token) => ALWAYS_SHOW_ADDON_TOKENS.has(token))
  );
}

export function shouldRenderAddonOption(params: {
  optionName: string;
  addonMatchNormalized?: string | null;
  normalizedIngredientNames: string[];
  isSelected: boolean;
  normalizedSizeNames: string[];
  selectedSizeNames: string[];
}): boolean {
  if (params.isSelected) return true;

  const sizeScope = inferOptionSizeScope(
    params.optionName,
    params.normalizedSizeNames,
  );
  if (sizeScope && params.selectedSizeNames.length > 0) {
    return params.selectedSizeNames.includes(sizeScope);
  }

  if (params.addonMatchNormalized === '__always__') {
    return true;
  }
  if (params.addonMatchNormalized) {
    return params.normalizedIngredientNames.includes(params.addonMatchNormalized);
  }

  return optionMatchesAnyIngredient(
    params.optionName,
    params.normalizedIngredientNames,
  );
}
