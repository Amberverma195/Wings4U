import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type SourceMenu = {
  categories: Array<{
    slug: string;
    items: Array<{
      name: string;
      description?: string;
    }>;
  }>;
};

type LegacySizeItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePriceCents: number;
  isAvailable: boolean;
  isPopular: boolean;
  allowedFulfillmentType: string;
  builderType: string | null;
  requiresSpecialInstructions: boolean;
};

type LegacySizeGroup = {
  categoryId: string;
  categorySlug: string;
  displayName: string;
  items: Array<{
    item: LegacySizeItem;
    sizeLabel: string;
  }>;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(scriptDir, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(scriptDir, "../.env"), override: false, quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to normalize legacy menu sizes.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

const TARGET_CATEGORY_SLUGS = ["poutines-and-sides", "poutines-sides", "breads"] as const;

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeSizeToken(token: string): string {
  return token.replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function normalizeAppetizerKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\(\d+\s*pc\.?\)\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractAppetizerQuantityLabel(name: string): string | null {
  const match = /\((\d+\s*pc\.?)\)/i.exec(name);
  if (!match) return null;
  return normalizeSizeToken(match[1]);
}

function parseLegacySplitName(categorySlug: string, itemName: string) {
  if (categorySlug === "breads") {
    const breadsMatch = /^(.*?)\s*\(([^)]+)\)\s*[–-]\s*(.+?)\s*$/u.exec(itemName);
    if (!breadsMatch) return null;

    return {
      displayName: `${breadsMatch[1].trim()} - ${breadsMatch[3].trim()}`,
      sizeLabel: normalizeSizeToken(breadsMatch[2]),
    };
  }

  const genericMatch = /^(.*?)\s*\(([^)]+)\)\s*$/u.exec(itemName);
  if (!genericMatch) return null;

  return {
    displayName: genericMatch[1].trim(),
    sizeLabel: normalizeSizeToken(genericMatch[2]),
  };
}

function buildAppetizerDescriptionMap(): Map<string, string> {
  const jsonPath = path.resolve(scriptDir, "../../../Docs/menu/wings4u-menu.v1.json");
  const sourceMenu = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as SourceMenu;
  const sourceCategory = sourceMenu.categories.find((category) => category.slug === "appetizers-extras");
  const descriptionMap = new Map<string, string>();

  for (const item of sourceCategory?.items ?? []) {
    if (/garlic bread/i.test(item.name)) continue;

    const quantityLabel = extractAppetizerQuantityLabel(item.name);
    const description = item.description?.trim() ?? "";
    const combinedDescription = [quantityLabel, description].filter(Boolean).join(" · ");
    if (!combinedDescription) continue;

    descriptionMap.set(normalizeAppetizerKey(item.name), combinedDescription);
  }

  return descriptionMap;
}

async function main() {
  const location = await prisma.location.findUnique({ where: { code: "LON01" } });
  if (!location) {
    throw new Error("Location LON01 not found.");
  }

  const orderCount = await prisma.order.count({ where: { locationId: location.id } });
  if (orderCount > 0) {
    throw new Error(`Refusing to normalize menu because ${orderCount} orders exist for LON01.`);
  }

  const categories = await prisma.menuCategory.findMany({
    where: {
      locationId: location.id,
      slug: { in: [...TARGET_CATEGORY_SLUGS] },
    },
    include: {
      menuItems: {
        orderBy: [{ name: "asc" }],
        include: {
          modifierGroups: {
            include: {
              modifierGroup: {
                include: {
                  options: {
                    orderBy: { sortOrder: "asc" },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const legacyGroups = new Map<string, LegacySizeGroup>();

  for (const category of categories) {
    for (const item of category.menuItems) {
      const hasRealSizeGroup = item.modifierGroups.some(
        (relation) => relation.modifierGroup.contextKey === "size",
      );
      if (hasRealSizeGroup) continue;

      const parsed = parseLegacySplitName(category.slug, item.name);
      if (!parsed) continue;

      const key = `${category.id}:${parsed.displayName.toLowerCase()}`;
      const existing = legacyGroups.get(key);
      if (existing) {
        existing.items.push({
          item: {
            id: item.id,
            name: item.name,
            slug: item.slug,
            description: item.description,
            basePriceCents: item.basePriceCents,
            isAvailable: item.isAvailable,
            isPopular: item.isPopular,
            allowedFulfillmentType: item.allowedFulfillmentType,
            builderType: item.builderType,
            requiresSpecialInstructions: item.requiresSpecialInstructions,
          },
          sizeLabel: parsed.sizeLabel,
        });
        continue;
      }

      legacyGroups.set(key, {
        categoryId: category.id,
        categorySlug: category.slug,
        displayName: parsed.displayName,
        items: [
          {
            item: {
              id: item.id,
              name: item.name,
              slug: item.slug,
              description: item.description,
              basePriceCents: item.basePriceCents,
              isAvailable: item.isAvailable,
              isPopular: item.isPopular,
              allowedFulfillmentType: item.allowedFulfillmentType,
              builderType: item.builderType,
              requiresSpecialInstructions: item.requiresSpecialInstructions,
            },
            sizeLabel: parsed.sizeLabel,
          },
        ],
      });
    }
  }

  const appetizerDescriptionMap = buildAppetizerDescriptionMap();
  const appetizerCategory = await prisma.menuCategory.findFirst({
    where: {
      locationId: location.id,
      slug: { in: ["appetizers", "appetizers-extras"] },
    },
    include: {
      menuItems: true,
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const group of legacyGroups.values()) {
      if (group.items.length < 2) continue;

      const sortedOptions = [...group.items].sort(
        (left, right) => left.item.basePriceCents - right.item.basePriceCents,
      );
      const baseItem = sortedOptions[0].item;
      const normalizedSlug = slugify(group.displayName);

      await tx.menuItem.deleteMany({
        where: {
          locationId: location.id,
          categoryId: group.categoryId,
          slug: normalizedSlug,
          name: group.displayName,
        },
      });

      const normalizedItem = await tx.menuItem.create({
        data: {
          locationId: location.id,
          categoryId: group.categoryId,
          name: group.displayName,
          slug: normalizedSlug,
          description: baseItem.description,
          basePriceCents: baseItem.basePriceCents,
          allowedFulfillmentType: baseItem.allowedFulfillmentType,
          isAvailable: sortedOptions.every((option) => option.item.isAvailable),
          isPopular: sortedOptions.some((option) => option.item.isPopular),
          builderType: baseItem.builderType,
          requiresSpecialInstructions: baseItem.requiresSpecialInstructions,
        },
      });

      const sizeGroup = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: `${group.displayName} Size`,
          displayLabel: "Choose Size",
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 1,
          contextKey: "size",
        },
      });

      for (const [index, option] of sortedOptions.entries()) {
        await tx.modifierOption.create({
          data: {
            modifierGroupId: sizeGroup.id,
            name: option.sizeLabel,
            priceDeltaCents: option.item.basePriceCents - baseItem.basePriceCents,
            isDefault: index === 0,
            isActive: true,
            sortOrder: index + 1,
          },
        });
      }

      await tx.menuItemModifierGroup.create({
        data: {
          menuItemId: normalizedItem.id,
          modifierGroupId: sizeGroup.id,
          sortOrder: 1,
          contextKey: "size",
        },
      });

      await tx.menuItem.deleteMany({
        where: {
          id: {
            in: sortedOptions.map((option) => option.item.id),
          },
        },
      });
    }

    if (appetizerCategory) {
      for (const item of appetizerCategory.menuItems) {
        if (item.description?.trim()) continue;

        const description = appetizerDescriptionMap.get(normalizeAppetizerKey(item.name));
        if (!description) continue;

        await tx.menuItem.update({
          where: { id: item.id },
          data: {
            description,
          },
        });
      }
    }
  });

  const normalizedSummary = [...legacyGroups.values()]
    .filter((group) => group.items.length >= 2)
    .map((group) => `${group.categorySlug}: ${group.displayName}`)
    .sort();

  // eslint-disable-next-line no-console
  console.log(
    normalizedSummary.length > 0
      ? `Normalized ${normalizedSummary.length} legacy size groups for LON01:\n- ${normalizedSummary.join("\n- ")}`
      : "No legacy size-split groups found for LON01.",
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
