import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const seedDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(seedDir, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(seedDir, "../.env"), override: false, quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to run the builder sync script.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

const SIDE_OPTIONS = ["Fries", "Onion Rings", "Wedges", "Coleslaw"] as const;
const POP_OPTIONS = [
  "Pepsi",
  "Diet Pepsi",
  "Pepsi Zero",
  "Coke",
  "Diet Coke",
  "Coke Zero",
  "Mountain Dew",
  "Diet Mountain Dew",
] as const;
const COMBO_DRINK_OPTIONS = ["Water", "Energy Drink", ...POP_OPTIONS] as const;
const WINGS_SPECIAL_SALAD_SIZE_LABEL = "Small";
const WINGS_SPECIAL_SALAD_OPTION_ORDER = [
  "Garden Salad",
  "Caesar Salad",
  "Greek Salad",
  "Horiatiki Salad",
  "Buffalo Chicken Salad",
] as const;

function normalizeIngredientText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addonOptionsFromRemovableIngredients(
  ingredients: string[],
  priceCents = 50,
): Array<{ name: string; price: number; scopeIngredientName: string }> {
  return ingredients.map((ing) => ({
    name: `Extra ${ing}`,
    price: priceCents,
    scopeIngredientName: ing,
  }));
}

const VEGGIE_BURGER_REMOVABLES = [
  "Sriracha Mayo",
  "Lettuce",
  "Red Onion",
  "Tomato",
  "Signature Sauce",
];
const CHICKEN_BURGER_REMOVABLES = [
  "Sriracha Mayo",
  "Lettuce",
  "Red Onion",
  "Tomato",
  "Thai Sauce",
];
const BUFFALO_BURGER_REMOVABLES = ["Sriracha Mayo", "Lettuce", "Red Onion", "Tomato"];

function menuItemSupportsSize(
  item: {
    modifierGroups: Array<{
      contextKey: string | null;
      modifierGroup: {
        contextKey: string | null;
        options: Array<{ name: string }>;
      };
    }>;
  },
  sizeLabel: string,
) {
  const normalizedSize = normalizeIngredientText(sizeLabel);
  return item.modifierGroups.some((mappedGroup) => {
    const contextKey = mappedGroup.contextKey ?? mappedGroup.modifierGroup.contextKey;
    if (contextKey !== "size") return false;
    return mappedGroup.modifierGroup.options.some(
      (option) => normalizeIngredientText(option.name) === normalizedSize,
    );
  });
}

const BURGER_SLUGS = [
  "veggie-burger",
  "chicken-burger",
  "buffalo-chicken-burger",
] as const;
const WRAP_SLUGS = [
  "veggie-wrap",
  "chicken-caesar-wrap",
  "buffalo-chicken-wrap",
  "garden-chicken-wrap",
  "greek-chicken-wrap",
] as const;
const POUTINE_SLUGS = [
  "regular-poutine",
  "bacon-poutine",
  "buffalo-chicken-poutine",
  "butter-chicken-poutine",
] as const;
const SPECIALTY_FRY_SLUGS = [
  "cajun-lemon-pepper-fries",
  "creamy-dill-fries",
  "gar-par-fries",
  "spicy-gar-par-fries",
  "gar-par-onion-rings",
  "spicy-gar-par-onion-rings",
  "gar-par-wedges",
  "spicy-gar-par-wedges",
  "greek-fries",
  "chilli-cheese-fries",
] as const;

const COMBO_SPECS = [
  {
    slug: "combo-1lb",
    description: "1 small side + 1 pop",
    flavourCount: 1 as const,
    sideGroups: ["Small Side"],
    drinkCount: 1,
  },
  {
    slug: "combo-1.5lb",
    description: "1 large side + 1 pop",
    flavourCount: 1 as const,
    sideGroups: ["Large Side 1"],
    drinkCount: 1,
  },
  {
    slug: "combo-2lb",
    description: "1 large side + 2 pops",
    flavourCount: 1 as const,
    sideGroups: ["Large Side 1"],
    drinkCount: 2,
  },
  {
    slug: "combo-3lb",
    description: "2 large sides + 3 pops",
    flavourCount: 2 as const,
    sideGroups: ["Large Side 1", "Large Side 2"],
    drinkCount: 3,
  },
  {
    slug: "combo-5lb",
    description: "2 large sides + 5 pops",
    flavourCount: 3 as const,
    sideGroups: ["Large Side 1", "Large Side 2"],
    drinkCount: 5,
  },
] as const;

const SCOPED_ADDON_SPECS = {
  "veggie-burger": {
    groupName: "Veggie Burger Extras",
    displayLabel: "Veggie Burger extras",
    options: addonOptionsFromRemovableIngredients(VEGGIE_BURGER_REMOVABLES),
  },
  "chicken-burger": {
    groupName: "Chicken Burger Extras",
    displayLabel: "Chicken Burger extras",
    options: addonOptionsFromRemovableIngredients(CHICKEN_BURGER_REMOVABLES),
  },
  "buffalo-chicken-burger": {
    groupName: "Buffalo Chicken Burger Extras",
    displayLabel: "Buffalo Chicken Burger extras",
    options: addonOptionsFromRemovableIngredients(BUFFALO_BURGER_REMOVABLES),
  },
  "veggie-wrap": {
    groupName: "Veggie Wrap Extras",
    displayLabel: "Veggie Wrap extras",
    options: [
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
      { name: "Add Feta", price: 150 },
      { name: "Add Avocado", price: 200 },
    ],
  },
  "chicken-caesar-wrap": {
    groupName: "Chicken Caesar Wrap Extras",
    displayLabel: "Chicken Caesar Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Parm Cheese", price: 100, scopeIngredientName: "Parm Cheese" },
      { name: "Extra Caesar Dressing", price: 50, scopeIngredientName: "Caesar Dressing" },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "buffalo-chicken-wrap": {
    groupName: "Buffalo Chicken Wrap Extras",
    displayLabel: "Buffalo Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Sriracha Mayo", price: 50, scopeIngredientName: "Sriracha Mayo" },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
  "garden-chicken-wrap": {
    groupName: "Garden Chicken Wrap Extras",
    displayLabel: "Garden Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
  "greek-chicken-wrap": {
    groupName: "Greek Chicken Wrap Extras",
    displayLabel: "Greek Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
      { name: "Extra Greek Dressing", price: 50, scopeIngredientName: "Greek Dressing" },
      { name: "Add Olives", price: 100, scopeIngredientName: "Black Olives" },
    ],
  },
  "regular-poutine": {
    groupName: "Regular Poutine Extras",
    displayLabel: "Regular Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
    ],
  },
  "bacon-poutine": {
    groupName: "Bacon Poutine Extras",
    displayLabel: "Bacon Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Bacon", price: 150, scopeIngredientName: "Bacon" },
    ],
  },
  "buffalo-chicken-poutine": {
    groupName: "Buffalo Chicken Poutine Extras",
    displayLabel: "Buffalo Chicken Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Buffalo Chicken", price: 250, scopeIngredientName: "Buffalo Chicken" },
    ],
  },
  "butter-chicken-poutine": {
    groupName: "Butter Chicken Poutine Extras",
    displayLabel: "Butter Chicken Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Butter Chicken", price: 250, scopeIngredientName: "Butter Chicken" },
    ],
  },
  "cajun-lemon-pepper-fries": {
    groupName: "Cajun Lemon Pepper Fries Extras",
    displayLabel: "Cajun Lemon Pepper Fries extras",
    options: [
      { name: "Extra Cajun Seasoning", price: 50, scopeIngredientName: "Cajun Seasoning" },
      { name: "Extra Lemon Pepper", price: 50, scopeIngredientName: "Lemon Pepper" },
      { name: "Extra Cheese", price: 100 },
    ],
  },
  "creamy-dill-fries": {
    groupName: "Creamy Dill Fries Extras",
    displayLabel: "Creamy Dill Fries extras",
    options: [
      { name: "Extra Creamy Dill Sauce", price: 50, scopeIngredientName: "Creamy Dill Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "gar-par-fries": {
    groupName: "Gar-Par Fries Extras",
    displayLabel: "Gar-Par Fries extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-fries": {
    groupName: "Spicy Gar-Par Fries Extras",
    displayLabel: "Spicy Gar-Par Fries extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
  "gar-par-onion-rings": {
    groupName: "Gar-Par Onion Rings Extras",
    displayLabel: "Gar-Par Onion Rings extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-onion-rings": {
    groupName: "Spicy Gar-Par Onion Rings Extras",
    displayLabel: "Spicy Gar-Par Onion Rings extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
  "gar-par-wedges": {
    groupName: "Gar-Par Wedges Extras",
    displayLabel: "Gar-Par Wedges extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-wedges": {
    groupName: "Spicy Gar-Par Wedges Extras",
    displayLabel: "Spicy Gar-Par Wedges extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
  "greek-fries": {
    groupName: "Greek Fries Extras",
    displayLabel: "Greek Fries extras",
    options: [
      { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
      { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
      { name: "Add Olives", price: 100 },
    ],
  },
  "chilli-cheese-fries": {
    groupName: "Chilli Cheese Fries Extras",
    displayLabel: "Chilli Cheese Fries extras",
    options: [
      { name: "Extra Chilli", price: 100, scopeIngredientName: "Red Meat Chilli" },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese" },
      { name: "Add Jalapenos", price: 100 },
    ],
  },
} as const;

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1]!;
  }
  return fallback;
}

async function ensureGroup(params: {
  locationId: string;
  name: string;
  displayLabel: string;
  selectionMode: string;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  sortOrder: number;
  contextKey: string | null;
}) {
  const existing = await prisma.modifierGroup.findFirst({
    where: {
      locationId: params.locationId,
      name: params.name,
      archivedAt: null,
    },
  });

  if (existing) {
    return prisma.modifierGroup.update({
      where: { id: existing.id },
      data: {
        displayLabel: params.displayLabel,
        selectionMode: params.selectionMode,
        minSelect: params.minSelect,
        maxSelect: params.maxSelect,
        isRequired: params.isRequired,
        sortOrder: params.sortOrder,
        contextKey: params.contextKey,
        archivedAt: null,
      },
    });
  }

  return prisma.modifierGroup.create({
    data: {
      locationId: params.locationId,
      name: params.name,
      displayLabel: params.displayLabel,
      selectionMode: params.selectionMode,
      minSelect: params.minSelect,
      maxSelect: params.maxSelect,
      isRequired: params.isRequired,
      sortOrder: params.sortOrder,
      contextKey: params.contextKey,
    },
  });
}

async function ensureGroupOptions(
  modifierGroupId: string,
  options: Array<{
    name: string;
    priceDeltaCents: number;
    sortOrder: number;
    linkedFlavourId?: string | null;
    addonMatchNormalized?: string | null;
  }>,
) {
  for (const option of options) {
    const existing = await prisma.modifierOption.findFirst({
      where: { modifierGroupId, name: option.name },
    });

    if (existing) {
      await prisma.modifierOption.update({
        where: { id: existing.id },
        data: {
          priceDeltaCents: option.priceDeltaCents,
          sortOrder: option.sortOrder,
          isActive: true,
          linkedFlavourId: option.linkedFlavourId ?? existing.linkedFlavourId,
          addonMatchNormalized:
            option.addonMatchNormalized ?? existing.addonMatchNormalized,
        },
      });
      continue;
    }

    await prisma.modifierOption.create({
      data: {
        modifierGroupId,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        sortOrder: option.sortOrder,
        linkedFlavourId: option.linkedFlavourId ?? null,
        addonMatchNormalized: option.addonMatchNormalized ?? null,
      },
    });
  }
}

async function ensureAddonGroup(
  locationId: string,
  name: string,
  displayLabel: string,
  options: Array<{
    name: string;
    price: number;
    scopeIngredientName?: string;
  }>,
) {
  const group = await ensureGroup({
    locationId,
    name,
    displayLabel,
    selectionMode: "MULTI",
    minSelect: 0,
    maxSelect: options.length,
    isRequired: false,
    sortOrder: 30,
    contextKey: "addon",
  });

  await ensureGroupOptions(
    group.id,
    options.map((option, index) => ({
      name: option.name,
      priceDeltaCents: option.price,
      sortOrder: index + 1,
      addonMatchNormalized: option.scopeIngredientName
        ? normalizeIngredientText(option.scopeIngredientName)
        : null,
    })),
  );

  return group;
}

async function attachGroup(
  menuItemId: string,
  modifierGroupId: string,
  sortOrder: number,
  contextKey: string | null,
) {
  return prisma.menuItemModifierGroup.upsert({
    where: {
      menuItemId_modifierGroupId: {
        menuItemId,
        modifierGroupId,
      },
    },
    update: { sortOrder, contextKey },
    create: { menuItemId, modifierGroupId, sortOrder, contextKey },
  });
}

async function attachGroupToSlugs(
  locationId: string,
  slugs: readonly string[],
  modifierGroupId: string,
  sortOrder: number,
) {
  const items = await prisma.menuItem.findMany({
    where: { locationId, slug: { in: [...slugs] } },
    select: { id: true, slug: true },
  });

  for (const item of items) {
    await attachGroup(item.id, modifierGroupId, sortOrder, "addon");
  }
}

async function main() {
  const locationCode = readArg("--location-code", "LON01");
  const location = await prisma.location.findUnique({
    where: { code: locationCode },
    select: { id: true },
  });

  if (!location) {
    throw new Error(`Location ${locationCode} not found.`);
  }

  await prisma.modifierOption.updateMany({
    where: {
      name: {
        in: ["Add Jalapeños", "Add JalapeÃ±os"],
      },
    },
    data: { name: "Add Jalapenos" },
  });

  const wingFlavours = await prisma.wingFlavour.findMany({
    where: { locationId: location.id, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const wingTypeGroup = await ensureGroup({
    locationId: location.id,
    name: "Wing Type",
    displayLabel: "Choose Your Wing Type",
    selectionMode: "SINGLE",
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    sortOrder: 1,
    contextKey: null,
  });
  await ensureGroupOptions(wingTypeGroup.id, [
    { name: "House Breaded Bone-In", priceDeltaCents: 0, sortOrder: 1 },
    { name: "Non-Breaded Bone-In", priceDeltaCents: 0, sortOrder: 2 },
    { name: "Boneless", priceDeltaCents: 0, sortOrder: 3 },
  ]);

  const flavourSlotGroups = [];
  for (let slot = 1; slot <= 3; slot++) {
    const group = await ensureGroup({
      locationId: location.id,
      name: `Flavour ${slot}`,
      displayLabel: `Choose Flavour ${slot}`,
      selectionMode: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      sortOrder: 1 + slot,
      contextKey: null,
    });
    await ensureGroupOptions(
      group.id,
      wingFlavours.map((flavour, index) => ({
        name: flavour.name,
        priceDeltaCents: 0,
        sortOrder: index + 1,
        linkedFlavourId: flavour.id,
      })),
    );
    flavourSlotGroups.push(group);
  }

  const extrasGroup = await ensureGroup({
    locationId: location.id,
    name: "Extras",
    displayLabel: "Add Extras",
    selectionMode: "MULTI",
    minSelect: 0,
    maxSelect: 5,
    isRequired: false,
    sortOrder: 20,
    contextKey: "addon",
  });
  await ensureGroupOptions(extrasGroup.id, [
    { name: "Extra Sauce", priceDeltaCents: 50, sortOrder: 1 },
    { name: "Ranch Dip", priceDeltaCents: 100, sortOrder: 2 },
    { name: "Blue Cheese Dip", priceDeltaCents: 100, sortOrder: 3 },
    { name: "Chipotle Dip", priceDeltaCents: 100, sortOrder: 4 },
  ]);

  const popTypeGroup = await ensureGroup({
    locationId: location.id,
    name: "Pop Type",
    displayLabel: "Choose Your Pop",
    selectionMode: "SINGLE",
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    sortOrder: 1,
    contextKey: "drink",
  });
  await ensureGroupOptions(
    popTypeGroup.id,
    POP_OPTIONS.map((option, index) => ({
      name: option,
      priceDeltaCents: 0,
      sortOrder: index + 1,
    })),
  );

  const sideGroups = {
    "Small Side": await ensureGroup({
      locationId: location.id,
      name: "Small Side",
      displayLabel: "Choose Small Side",
      selectionMode: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      sortOrder: 10,
      contextKey: "side",
    }),
    "Large Side 1": await ensureGroup({
      locationId: location.id,
      name: "Large Side 1",
      displayLabel: "Choose Large Side 1",
      selectionMode: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      sortOrder: 11,
      contextKey: "side",
    }),
    "Large Side 2": await ensureGroup({
      locationId: location.id,
      name: "Large Side 2",
      displayLabel: "Choose Large Side 2",
      selectionMode: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      sortOrder: 12,
      contextKey: "side",
    }),
  } as const;

  for (const group of Object.values(sideGroups)) {
    await ensureGroupOptions(
      group.id,
      SIDE_OPTIONS.map((option, index) => ({
        name: option,
        priceDeltaCents: 0,
        sortOrder: index + 1,
      })),
    );
  }

  const drinkGroups = [];
  for (let slot = 1; slot <= 5; slot++) {
    const group = await ensureGroup({
      locationId: location.id,
      name: `Drink ${slot}`,
      displayLabel: `Choose Drink ${slot}`,
      selectionMode: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      sortOrder: 20 + slot,
      contextKey: "drink",
    });
    await ensureGroupOptions(
      group.id,
      COMBO_DRINK_OPTIONS.map((option, index) => ({
        name: option,
        priceDeltaCents: 0,
        sortOrder: index + 1,
      })),
    );
    drinkGroups.push(group);
  }

  const saladTypeGroup = await ensureGroup({
    locationId: location.id,
    name: "Salad",
    displayLabel: "Choose Your Salad",
    selectionMode: "SINGLE",
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    sortOrder: 8,
    contextKey: "salad",
  });

  const wingsSpecialSaladItems = await prisma.menuItem.findMany({
    where: {
      locationId: location.id,
      archivedAt: null,
      category: { slug: "salads" },
    },
    include: {
      modifierGroups: {
        include: {
          modifierGroup: {
            include: {
              options: true,
            },
          },
        },
      },
    },
  });

  const wingsSpecialSaladOptionNames = wingsSpecialSaladItems
    .filter((item) => menuItemSupportsSize(item, WINGS_SPECIAL_SALAD_SIZE_LABEL))
    .map((item) => item.name)
    .sort((left, right) => {
      const leftIndex = WINGS_SPECIAL_SALAD_OPTION_ORDER.indexOf(left as (typeof WINGS_SPECIAL_SALAD_OPTION_ORDER)[number]);
      const rightIndex = WINGS_SPECIAL_SALAD_OPTION_ORDER.indexOf(right as (typeof WINGS_SPECIAL_SALAD_OPTION_ORDER)[number]);
      const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex;
      }
      return left.localeCompare(right);
    });

  await ensureGroupOptions(
    saladTypeGroup.id,
    wingsSpecialSaladOptionNames.map((name, index) => ({
      name,
      priceDeltaCents: 0,
      sortOrder: index + 1,
    })),
  );

  if (wingsSpecialSaladOptionNames.length > 0) {
    await prisma.modifierOption.deleteMany({
      where: {
        modifierGroupId: saladTypeGroup.id,
        name: { notIn: wingsSpecialSaladOptionNames },
      },
    });
  } else {
    await prisma.modifierOption.deleteMany({
      where: { modifierGroupId: saladTypeGroup.id },
    });
  }

  const wingsSpecialItem = await prisma.menuItem.findFirst({
    where: { locationId: location.id, slug: "wings-4u-special" },
    select: { id: true },
  });
  if (wingsSpecialItem) {
    await attachGroup(wingsSpecialItem.id, saladTypeGroup.id, 8, "salad");
  }

  for (const [slug, spec] of Object.entries(SCOPED_ADDON_SPECS)) {
    const group = await ensureAddonGroup(
      location.id,
      spec.groupName,
      spec.displayLabel,
      [...spec.options],
    );

    const item = await prisma.menuItem.findFirst({
      where: { locationId: location.id, slug },
      select: { id: true },
    });

    if (!item) continue;

    await prisma.menuItemModifierGroup.deleteMany({
      where: { menuItemId: item.id, contextKey: "addon" },
    });

    await attachGroup(item.id, group.id, 10, "addon");
  }

  for (const spec of COMBO_SPECS) {
    const item = await prisma.menuItem.findFirst({
      where: { locationId: location.id, slug: spec.slug },
      select: { id: true },
    });
    if (!item) continue;

    const desiredGroups = [
      { groupId: wingTypeGroup.id, sortOrder: 1, contextKey: null as string | null },
      ...flavourSlotGroups.slice(0, spec.flavourCount).map((group, index) => ({
        groupId: group.id,
        sortOrder: 2 + index,
        contextKey: null as string | null,
      })),
      ...spec.sideGroups.map((name, index) => ({
        groupId: sideGroups[name as keyof typeof sideGroups].id,
        sortOrder: 5 + index,
        contextKey: "side" as const,
      })),
      ...drinkGroups.slice(0, spec.drinkCount).map((group, index) => ({
        groupId: group.id,
        sortOrder: 7 + index,
        contextKey: "drink" as const,
      })),
      { groupId: extrasGroup.id, sortOrder: 20, contextKey: "addon" as const },
    ];

    await prisma.menuItemModifierGroup.deleteMany({
      where: { menuItemId: item.id },
    });

    for (const group of desiredGroups) {
      await prisma.menuItemModifierGroup.create({
        data: {
          menuItemId: item.id,
          modifierGroupId: group.groupId,
          sortOrder: group.sortOrder,
          contextKey: group.contextKey,
        },
      });
    }

    await prisma.menuItem.update({
      where: { id: item.id },
      data: { description: spec.description, builderType: "WING_COMBO" },
    });
  }

  await prisma.menuItem.updateMany({
    where: { locationId: location.id, slug: "combo-4lb" },
    data: { archivedAt: new Date() },
  });

  const WING_FLOWS_WITHOUT_ADDON_GROUP = [
    "wings-1lb",
    "wings-1.5lb",
    "wings-2lb",
    "wings-3lb",
    "wings-4lb",
    "wings-5lb",
    "wings-4u-special",
  ] as const;

  for (const slug of WING_FLOWS_WITHOUT_ADDON_GROUP) {
    const poundItem = await prisma.menuItem.findFirst({
      where: { locationId: location.id, slug },
      select: { id: true },
    });
    if (!poundItem) continue;

    await prisma.menuItemModifierGroup.deleteMany({
      where: {
        menuItemId: poundItem.id,
        modifierGroupId: extrasGroup.id,
      },
    });
  }

  console.log(`Builder configuration synced for ${locationCode}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

