import { menuCardDescriptionForItem } from "@/lib/menu-item-description";
import type { MenuCategory, MenuItem, ModifierGroup } from "@/lib/types";

/**
 * Canonical strip order (matches `categoryDefs` in prisma seed). Used so the
 * horizontal category row stays consistent even if API `sort_order` drifts.
 */
const MENU_CATEGORY_SLUG_ORDER: string[] = [
  "lunch-specials",
  "wings",
  "wing-combos",
  "burgers",
  "tenders",
  "wraps",
  "salads",
  "poutines-and-sides",
  "specialty-fries",
  "appetizers",
  "breads",
  "specials",
  "party-specials",
  "drinks",
  "dessert",
  "dips",
];

export function sortMenuCategories(categories: MenuCategory[]): MenuCategory[] {
  return [...categories].sort((a, b) => {
    const ai = MENU_CATEGORY_SLUG_ORDER.indexOf(a.slug);
    const bi = MENU_CATEGORY_SLUG_ORDER.indexOf(b.slug);
    const aKey = ai === -1 ? 1000 + a.sort_order : ai;
    const bKey = bi === -1 ? 1000 + b.sort_order : bi;
    if (aKey !== bKey) return aKey - bKey;
    return a.sort_order - b.sort_order;
  });
}

type BaseDisplayMenuItem = {
  key: string;
  displayName: string;
  displayDescription: string | null;
  displayPriceCents: number;
  showStartingAt: boolean;
  cartMenuItemIds: string[];
  stockStatus: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
};

export type LegacySizeChoice = {
  item: MenuItem;
  label: string;
};

export type LegacySizePickerGroup = {
  key: string;
  displayName: string;
  displayDescription: string | null;
  options: LegacySizeChoice[];
};

export type DisplayMenuItem =
  | (BaseDisplayMenuItem & {
      kind: "item";
      item: MenuItem;
    })
  | (BaseDisplayMenuItem & {
      kind: "legacy-group";
      group: LegacySizePickerGroup;
    });

export type DisplayMenuCategory = Omit<MenuCategory, "items"> & {
  items: DisplayMenuItem[];
};

/**
 * Stable id for a client-only Salads row when the menu API omits the `salads`
 * category (common if the database was seeded before salads existed).
 */
export const SYNTHETIC_SALADS_CATEGORY_ID = "00000000-0000-4000-8000-0000000000ad";

/**
 * Ensures **Salads** appears in the sticky category strip after Wraps and before
 * Poutines & Sides even when the backend does not return a `salads` category yet.
 */
export function ensureSaladsCategoryInDisplay(
  categories: DisplayMenuCategory[],
): DisplayMenuCategory[] {
  if (categories.some((c) => c.slug === "salads")) {
    return categories;
  }

  const synthetic: DisplayMenuCategory = {
    id: SYNTHETIC_SALADS_CATEGORY_ID,
    name: "Salads",
    slug: "salads",
    sort_order: 7,
    items: [],
  };

  const wrapsIdx = categories.findIndex((c) => c.slug === "wraps");
  const poutinesIdx = categories.findIndex((c) => c.slug === "poutines-and-sides");
  const insertAt =
    wrapsIdx >= 0 ? wrapsIdx + 1 : poutinesIdx >= 0 ? poutinesIdx : categories.length;

  const next = [...categories];
  next.splice(insertAt, 0, synthetic);
  return next;
}

type DisplayMenuItemWithOrder = DisplayMenuItem & { orderIndex: number };

type LegacyGroupSeed = {
  key: string;
  displayName: string;
  orderIndex: number;
  items: Array<{
    item: MenuItem;
    sizeLabel: string;
  }>;
};

const APPETIZER_CATEGORY_SLUGS = new Set(["appetizers", "appetizers-extras"]);
const LEGACY_GROUPABLE_CATEGORY_SLUGS = new Set([
  "poutines-and-sides",
  "poutines-sides",
  "breads",
]);

/** Menu cards: show "Sizes: …" without dollar amounts; prices stay in builders / footer. */
const POUTINES_SIDES_SIZE_LABELS_ONLY_SLUGS = new Set([
  "poutines-and-sides",
  "poutines-sides",
  "breads",
]);

/**
 * Phase 8: items that should NOT render as their own menu card. They live
 * on the catalog so price/availability come from the same source of truth,
 * but they surface in the UI as a category-level note instead. The note
 * copy lives in `menu-page.tsx :: categoryNoteForSlug`.
 */
const CATEGORY_NOTE_ONLY_ITEM_SLUGS = new Set([
  "wrap-side-add",
  "burger-side-add",
]);

function normalizeCopy(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinDescriptionParts(parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => normalizeCopy(part))
    .filter((part): part is string => Boolean(part));

  return normalized.length > 0 ? normalized.join(" · ") : null;
}

function normalizeSizeToken(token: string): string {
  return token.replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function findSizeGroup(item: MenuItem): ModifierGroup | null {
  return item.modifier_groups.find((group) => group.context_key === "size") ?? null;
}

function summarizeSizeGroup(item: MenuItem): string | null {
  const sizeGroup = findSizeGroup(item);
  if (!sizeGroup || sizeGroup.options.length === 0) return null;

  const labels = sizeGroup.options.map(
    (option) =>
      `${normalizeSizeToken(option.name)} ${formatPrice(item.base_price_cents + option.price_delta_cents)}`,
  );
  return labels.length > 0 ? `Sizes: ${labels.join(", ")}` : null;
}

function summarizeSizeGroupLabelsOnly(item: MenuItem): string | null {
  const sizeGroup = findSizeGroup(item);
  if (!sizeGroup || sizeGroup.options.length === 0) return null;

  const labels = sizeGroup.options.map((option) => normalizeSizeToken(option.name));
  return labels.length > 0 ? `Sizes: ${labels.join(", ")}` : null;
}

function extractAppetizerQuantity(name: string) {
  const match = /^(.*?)\s*\((\d+\s*pc\.?)\)\s*$/i.exec(name);
  if (!match) return null;

  return {
    displayName: match[1].trim(),
    quantityLabel: normalizeSizeToken(match[2]),
  };
}

function parseLegacySplitItem(categorySlug: string, itemName: string) {
  if (!LEGACY_GROUPABLE_CATEGORY_SLUGS.has(categorySlug)) {
    return null;
  }

  if (categorySlug === "breads") {
    const breadsMatch = /^(.*?)\s*\(([^)]+)\)\s*[–-]\s*(.+?)\s*$/u.exec(itemName);
    if (!breadsMatch) return null;

    const prefix = breadsMatch[1].trim();
    const sizeLabel = normalizeSizeToken(breadsMatch[2]);
    const suffix = breadsMatch[3].trim();
    const displayName = `${prefix} - ${suffix}`;

    return {
      key: `legacy:${categorySlug}:${displayName.toLowerCase()}`,
      displayName,
      sizeLabel,
    };
  }

  const genericMatch = /^(.*?)\s*\(([^)]+)\)\s*$/u.exec(itemName);
  if (!genericMatch) return null;

  const displayName = genericMatch[1].trim();
  const sizeLabel = normalizeSizeToken(genericMatch[2]);

  return {
    key: `legacy:${categorySlug}:${displayName.toLowerCase()}`,
    displayName,
    sizeLabel,
  };
}

function makeDisplayMenuItem(
  item: MenuItem,
  categorySlug: string,
  orderIndex: number,
): DisplayMenuItemWithOrder {
  const sizeGroup = findSizeGroup(item);
  const sizeSummary =
    categorySlug === "salads"
      ? null
      : POUTINES_SIDES_SIZE_LABELS_ONLY_SLUGS.has(categorySlug)
        ? summarizeSizeGroupLabelsOnly(item)
        : summarizeSizeGroup(item);
  const appetizerQuantity = APPETIZER_CATEGORY_SLUGS.has(categorySlug)
    ? extractAppetizerQuantity(item.name)
    : null;

  const displayName = appetizerQuantity?.displayName ?? item.name;
  const displayDescription = joinDescriptionParts([
    sizeSummary,
    appetizerQuantity?.quantityLabel,
    menuCardDescriptionForItem(item),
  ]);

  const showStartingAt =
    categorySlug === "salads"
      ? Boolean(sizeGroup && sizeGroup.options.length > 1)
      : Boolean(sizeSummary);

  return {
    kind: "item",
    key: item.id,
    orderIndex,
    item,
    displayName,
    displayDescription,
    displayPriceCents: item.base_price_cents,
    stockStatus: item.stock_status,
    showStartingAt,
    cartMenuItemIds: [item.id],
  };
}

export function buildDisplayMenuCategories(categories: MenuCategory[]): DisplayMenuCategory[] {
  return categories.map((category) => {
    const legacyGroups = new Map<string, LegacyGroupSeed>();
    const preparedItems: DisplayMenuItemWithOrder[] = [];

    category.items.forEach((item, orderIndex) => {
      // Phase 8: skip items that should only surface as a category-level note.
      if (CATEGORY_NOTE_ONLY_ITEM_SLUGS.has(item.slug)) {
        return;
      }

      if (findSizeGroup(item)) {
        preparedItems.push(makeDisplayMenuItem(item, category.slug, orderIndex));
        return;
      }

      const parsedLegacySplit = parseLegacySplitItem(category.slug, item.name);
      if (!parsedLegacySplit) {
        preparedItems.push(makeDisplayMenuItem(item, category.slug, orderIndex));
        return;
      }

      const existing = legacyGroups.get(parsedLegacySplit.key);
      if (existing) {
        existing.items.push({ item, sizeLabel: parsedLegacySplit.sizeLabel });
        return;
      }

      legacyGroups.set(parsedLegacySplit.key, {
        key: parsedLegacySplit.key,
        displayName: parsedLegacySplit.displayName,
        orderIndex,
        items: [{ item, sizeLabel: parsedLegacySplit.sizeLabel }],
      });
    });

    for (const legacyGroup of legacyGroups.values()) {
      if (legacyGroup.items.length < 2) {
        for (const groupedItem of legacyGroup.items) {
          preparedItems.push(
            makeDisplayMenuItem(groupedItem.item, category.slug, legacyGroup.orderIndex),
          );
        }
        continue;
      }

      const sortedOptions = [...legacyGroup.items].sort(
        (left, right) => left.item.base_price_cents - right.item.base_price_cents,
      );

      const description = joinDescriptionParts([
        `Sizes: ${sortedOptions.map((option) => option.sizeLabel).join(", ")}`,
        ...Array.from(
          new Set(
            sortedOptions
              .map((option) => normalizeCopy(option.item.description))
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      ]);

      preparedItems.push({
        kind: "legacy-group",
        key: legacyGroup.key,
        orderIndex: legacyGroup.orderIndex,
        displayName: legacyGroup.displayName,
        displayDescription: description,
        displayPriceCents: sortedOptions[0]?.item.base_price_cents ?? 0,
        stockStatus: sortedOptions.every(o => o.item.stock_status === "UNAVAILABLE") ? "UNAVAILABLE" : sortedOptions.some(o => o.item.stock_status === "LOW_STOCK") ? "LOW_STOCK" : "NORMAL",
        showStartingAt: true,
        cartMenuItemIds: sortedOptions.map((option) => option.item.id),
        group: {
          key: legacyGroup.key,
          displayName: legacyGroup.displayName,
          displayDescription: description,
          options: sortedOptions.map((option) => ({
            item: option.item,
            label: option.sizeLabel,
          })),
        },
      });
    }

    const items = preparedItems
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map(({ orderIndex: _orderIndex, ...item }) => item);

    return {
      ...category,
      items,
    };
  });
}
