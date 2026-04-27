import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type HeatLevel = "MILD" | "MEDIUM" | "HOT" | "DRY_RUB" | "PLAIN";

type ExtractedMenu = {
  meta: {
    version: 1;
    source_docx: string;
    extracted_at: string;
  };
  location: {
    address_line_1: string;
    city: string;
    province_code: string;
    postal_code: string;
    phone_number: string;
  };
  categories: Array<{
    name: string;
    slug: string;
    sort_order: number;
    items: Array<{
      name: string;
      slug: string;
      description?: string;
      base_price_cents: number;
      schedules?: Array<{ day_of_week: number; time_from: string; time_to: string }>;
      size_options?: Array<{ name: string; slug: string; price_delta_cents: number }>;
      pop_options?: string[];
      builder_type?: string;
    }>;
  }>;
  wing_pricing: Array<{
    weight_lb: number;
    required_flavour_count: number;
    price_cents: number;
  }>;
  wing_combo_pricing: Array<{
    weight_lb: number;
    price_cents: number;
    description?: string;
  }>;
  wing_flavours: Array<{
    name: string;
    slug: string;
    heat_level: HeatLevel;
    is_plain?: boolean;
  }>;
  notes: Record<string, unknown>;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(scriptDir, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(scriptDir, "../.env"), override: false, quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to run the menu import.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

function usageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      "Usage: tsx prisma/import-menu.ts [--json <path>] [--location-code <code>] [--confirm-reset]",
      "Defaults:",
      "  --json Docs/menu/wings4u-menu.v1.json",
      "  --location-code LON01",
      "Safety:",
      "  Set env WINGS4U_CONFIRM_MENU_RESET=YES or pass --confirm-reset.",
    ].join("\n"),
  );
  process.exit(code);
}

function toInt(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function main() {
  const argv = process.argv.slice(2);

  let jsonPath = "Docs/menu/wings4u-menu.v1.json";
  let locationCode = "LON01";
  let confirmReset = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      jsonPath = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (a === "--location-code") {
      locationCode = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (a === "--confirm-reset") {
      confirmReset = true;
      continue;
    }
    if (a === "-h" || a === "--help") usageAndExit(0);
  }

  confirmReset = confirmReset || process.env.WINGS4U_CONFIRM_MENU_RESET === "YES";
  if (!confirmReset) {
    throw new Error(
      "Refusing to run destructive menu reset. Set WINGS4U_CONFIRM_MENU_RESET=YES or pass --confirm-reset.",
    );
  }

  const menu = JSON.parse(fs.readFileSync(path.resolve(jsonPath), "utf8")) as ExtractedMenu;
  if (!menu?.meta || menu.meta.version !== 1) {
    throw new Error("Unsupported menu JSON format.");
  }

  const location = await prisma.location.findUnique({ where: { code: locationCode } });
  if (!location) {
    throw new Error(`Location not found for code ${locationCode}`);
  }

  const existingOrders = await prisma.order.count({ where: { locationId: location.id } });
  if (existingOrders > 0) {
    throw new Error(
      `Cannot hard-delete menu: ${existingOrders} orders exist for location ${locationCode}. Use archive mode instead.`,
    );
  }

  const comboUpgradePriceCents = toInt(menu.notes?.combo_upgrade_price_cents, 499);
  const extraFlavourPriceCents = toInt(menu.notes?.extra_flavour_price_cents, 100);

  await prisma.$transaction(async (tx) => {
    // 1) Update location contact info to match doc.
    await tx.location.update({
      where: { id: location.id },
      data: {
        addressLine1: menu.location.address_line_1,
        city: menu.location.city,
        provinceCode: menu.location.province_code,
        postalCode: menu.location.postal_code,
        phoneNumber: menu.location.phone_number,
      },
    });

    // 2) Hard delete old menu rows (safe only because we gated on zero orders).
    await tx.menuItem.deleteMany({ where: { locationId: location.id } });
    await tx.menuCategory.deleteMany({ where: { locationId: location.id } });
    await tx.modifierGroup.deleteMany({ where: { locationId: location.id } });
    await tx.wingFlavour.deleteMany({ where: { locationId: location.id } });

    // 3) Create categories.
    const cats = [...menu.categories].sort((a, b) => a.sort_order - b.sort_order);
    const catBySlug = new Map<string, { id: string; slug: string; name: string }>();

    for (const c of cats) {
      const created = await tx.menuCategory.create({
        data: {
          locationId: location.id,
          name: c.name,
          slug: c.slug,
          sortOrder: c.sort_order,
          isActive: true,
        },
      });
      catBySlug.set(created.slug, { id: created.id, slug: created.slug, name: created.name });
    }

    const getCatId = (slug: string) => {
      const c = catBySlug.get(slug);
      if (!c) throw new Error(`Missing category ${slug} in DB import step.`);
      return c.id;
    };

    // 4) Create non-wing items from JSON.
    const createdItemsBySlug = new Map<string, { id: string; name: string }>();
    for (const c of cats) {
      const categoryId = getCatId(c.slug);
      for (const item of c.items) {
        const created = await tx.menuItem.create({
          data: {
            locationId: location.id,
            categoryId,
            name: item.name,
            slug: item.slug,
            description: item.description ?? null,
            basePriceCents: item.base_price_cents,
            allowedFulfillmentType: "BOTH",
            isAvailable: true,
            builderType: item.builder_type ?? null,
          },
        });
        createdItemsBySlug.set(created.slug, { id: created.id, name: created.name });

        // Schedules (e.g. lunch specials 11 AM - 3 PM)
        if (item.schedules?.length) {
          for (const sched of item.schedules) {
            await tx.menuItemSchedule.create({
              data: {
                menuItemId: created.id,
                dayOfWeek: sched.day_of_week,
                timeFrom: sched.time_from + ":00",
                timeTo: sched.time_to + ":00",
              },
            });
          }
        }

        // Size options (e.g. Small/Large poutines, 4pc/8pc breads)
        if (item.size_options?.length) {
          const sizeGroup = await tx.modifierGroup.create({
            data: {
              locationId: location.id,
              name: `${item.name} Size`,
              displayLabel: "Choose Size",
              selectionMode: "SINGLE",
              minSelect: 1,
              maxSelect: 1,
              isRequired: true,
              sortOrder: 1,
              contextKey: "size",
            },
          });
          for (const [idx, opt] of item.size_options.entries()) {
            await tx.modifierOption.create({
              data: {
                modifierGroupId: sizeGroup.id,
                name: opt.name,
                priceDeltaCents: opt.price_delta_cents,
                isDefault: idx === 0,
                isActive: true,
                sortOrder: idx + 1,
              },
            });
          }
          await tx.menuItemModifierGroup.create({
            data: { menuItemId: created.id, modifierGroupId: sizeGroup.id, sortOrder: 1 },
          });
        }

        // Pop options (e.g. Coke, Diet Coke, Dew)
        if (item.pop_options?.length) {
          const popGroup = await tx.modifierGroup.create({
            data: {
              locationId: location.id,
              name: "Pop Type",
              displayLabel: "Choose Your Pop",
              selectionMode: "SINGLE",
              minSelect: 1,
              maxSelect: 1,
              isRequired: true,
              sortOrder: 1,
            },
          });
          for (const [idx, opt] of item.pop_options.entries()) {
            await tx.modifierOption.create({
              data: {
                modifierGroupId: popGroup.id,
                name: opt,
                priceDeltaCents: 0,
                isDefault: idx === 0,
                isActive: true,
                sortOrder: idx + 1,
              },
            });
          }
          await tx.menuItemModifierGroup.create({
            data: { menuItemId: created.id, modifierGroupId: popGroup.id, sortOrder: 2 },
          });
        }
      }
    }

    // 5) Create wing flavours.
    await tx.wingFlavour.createMany({
      data: menu.wing_flavours.map((f, idx) => ({
        locationId: location.id,
        name: f.name,
        slug: f.slug,
        heatLevel: f.heat_level,
        sortOrder: idx + 1,
        isPlain: f.is_plain ?? false,
        isActive: true,
      })),
    });

    const wingFlavours = await tx.wingFlavour.findMany({
      where: { locationId: location.id },
      select: { id: true, slug: true, name: true },
    });
    const wingFlavourIdBySlug = new Map(wingFlavours.map((f) => [f.slug, f.id] as const));

    // 6) Create wing builder items.
    const wingsItem = await tx.menuItem.create({
      data: {
        locationId: location.id,
        categoryId: getCatId("wings"),
        name: "Wings",
        slug: "wings",
        description:
          "House breaded bone-in, non-breaded bone-in, or boneless. Pricing is by weight. Extra flavour +$1.00.",
        basePriceCents: 1299,
        allowedFulfillmentType: "BOTH",
        isAvailable: true,
        isPopular: true,
        builderType: "WINGS",
      },
    });

    const wingComboItem = await tx.menuItem.create({
      data: {
        locationId: location.id,
        categoryId: getCatId("wing-combos"),
        name: "Wing Combo",
        slug: "wing-combo",
        description:
          "Includes side (fries, onion rings, wedges, or coleslaw) and pop. Pricing is by weight.",
        basePriceCents: 1799,
        allowedFulfillmentType: "BOTH",
        isAvailable: true,
        builderType: "WING_COMBO",
      },
    });

    // 7) Create modifier groups.
    const wingTypeGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Wing Type",
        displayLabel: "Choose Wing Type",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 1,
      },
    });

    const wingWeightGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Wing Weight",
        displayLabel: "Choose Weight",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 2,
      },
    });

    const wingComboWeightGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Wing Combo Weight",
        displayLabel: "Choose Weight",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 3,
      },
    });

    const flavoursGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Flavours",
        displayLabel: "Choose Flavours",
        selectionMode: "MULTI",
        minSelect: 1,
        maxSelect: 3,
        isRequired: true,
        sortOrder: 4,
      },
    });

    const comboSideGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Combo Side",
        displayLabel: "Choose Side",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 5,
      },
    });

    const comboUpgradeGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Combo Upgrade",
        displayLabel: `Make it a combo (+$${(comboUpgradePriceCents / 100).toFixed(2)})`,
        selectionMode: "SINGLE",
        minSelect: 0,
        maxSelect: 1,
        isRequired: false,
        sortOrder: 6,
      },
    });

    // 8) Create modifier options.
    await tx.modifierOption.createMany({
      data: [
        { modifierGroupId: wingTypeGroup.id, name: "House Breaded Bone-In", sortOrder: 1, isDefault: true },
        { modifierGroupId: wingTypeGroup.id, name: "Non-Breaded Bone-In", sortOrder: 2 },
        { modifierGroupId: wingTypeGroup.id, name: "Boneless", sortOrder: 3 },
      ].map((o) => ({
        modifierGroupId: o.modifierGroupId,
        name: o.name,
        priceDeltaCents: 0,
        isDefault: o.isDefault ?? false,
        isActive: true,
        sortOrder: o.sortOrder,
      })),
    });

    // Wing weight options (delta vs base 12.99)
    const wingBase = 1299;
    const wingOptions = [...menu.wing_pricing]
      .sort((a, b) => a.weight_lb - b.weight_lb)
      .map((r, idx) => ({
        modifierGroupId: wingWeightGroup.id,
        name: `${r.weight_lb} lb (${r.required_flavour_count} flavour${r.required_flavour_count === 1 ? "" : "s"})`,
        priceDeltaCents: r.price_cents - wingBase,
        sortOrder: idx + 1,
      }));

    await tx.modifierOption.createMany({
      data: wingOptions.map((o) => ({
        modifierGroupId: o.modifierGroupId,
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
        isDefault: o.sortOrder === 1,
        isActive: true,
        sortOrder: o.sortOrder,
      })),
    });

    // Wing combo weight options (delta vs base 17.99)
    const comboBase = 1799;
    const comboOptions = [...menu.wing_combo_pricing]
      .sort((a, b) => a.weight_lb - b.weight_lb)
      .map((r, idx) => ({
        modifierGroupId: wingComboWeightGroup.id,
        name: `${r.weight_lb} lb`,
        priceDeltaCents: r.price_cents - comboBase,
        sortOrder: idx + 1,
      }));

    await tx.modifierOption.createMany({
      data: comboOptions.map((o) => ({
        modifierGroupId: o.modifierGroupId,
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
        isDefault: o.sortOrder === 1,
        isActive: true,
        sortOrder: o.sortOrder,
      })),
    });

    // Combo side options
    await tx.modifierOption.createMany({
      data: [
        { name: "Fries", sortOrder: 1 },
        { name: "Onion Rings", sortOrder: 2 },
        { name: "Wedges", sortOrder: 3 },
        { name: "Coleslaw", sortOrder: 4 },
      ].map((o) => ({
        modifierGroupId: comboSideGroup.id,
        name: o.name,
        priceDeltaCents: 0,
        isDefault: o.sortOrder === 1,
        isActive: true,
        sortOrder: o.sortOrder,
      })),
    });

    // Flavour options (linked to wing_flavours)
    await tx.modifierOption.createMany({
      data: menu.wing_flavours.map((f, idx) => ({
        modifierGroupId: flavoursGroup.id,
        name: f.name,
        priceDeltaCents: 0,
        isDefault: false,
        isActive: true,
        sortOrder: idx + 1,
        linkedFlavourId: wingFlavourIdBySlug.get(f.slug) ?? null,
      })),
    });

    await tx.modifierOption.create({
      data: {
        modifierGroupId: flavoursGroup.id,
        name: "Extra Flavour (+$1.00)",
        priceDeltaCents: extraFlavourPriceCents,
        isDefault: false,
        isActive: true,
        sortOrder: menu.wing_flavours.length + 1,
      },
    });

    // Combo upgrade options: apply to burgers and wraps.
    await tx.modifierOption.createMany({
      data: [
        { name: "Combo: Fries + Pop", sortOrder: 1 },
        { name: "Combo: Onion Rings + Pop", sortOrder: 2 },
        { name: "Combo: Wedges + Pop", sortOrder: 3 },
        { name: "Combo: Coleslaw + Pop", sortOrder: 4 },
      ].map((o) => ({
        modifierGroupId: comboUpgradeGroup.id,
        name: o.name,
        priceDeltaCents: comboUpgradePriceCents,
        isDefault: false,
        isActive: true,
        sortOrder: o.sortOrder,
      })),
    });

    // 9) Link modifier groups to items.
    await tx.menuItemModifierGroup.createMany({
      data: [
        { menuItemId: wingsItem.id, modifierGroupId: wingTypeGroup.id, sortOrder: 1 },
        { menuItemId: wingsItem.id, modifierGroupId: wingWeightGroup.id, sortOrder: 2 },
        { menuItemId: wingsItem.id, modifierGroupId: flavoursGroup.id, sortOrder: 3 },
        { menuItemId: wingComboItem.id, modifierGroupId: wingTypeGroup.id, sortOrder: 1 },
        { menuItemId: wingComboItem.id, modifierGroupId: wingComboWeightGroup.id, sortOrder: 2 },
        { menuItemId: wingComboItem.id, modifierGroupId: comboSideGroup.id, sortOrder: 3 },
        { menuItemId: wingComboItem.id, modifierGroupId: flavoursGroup.id, sortOrder: 4 },
      ],
    });

    const burgerItemIds = [...createdItemsBySlug.values()]
      .filter((i) => /Burger/i.test(i.name))
      .map((i) => i.id);
    const wrapItemIds = [...createdItemsBySlug.values()]
      .filter((i) => /Wrap/i.test(i.name))
      .map((i) => i.id);

    await tx.menuItemModifierGroup.createMany({
      data: [...burgerItemIds, ...wrapItemIds].map((id) => ({
        menuItemId: id,
        modifierGroupId: comboUpgradeGroup.id,
        sortOrder: 99,
      })),
      skipDuplicates: true,
    });

    // 10) Create shared Pop Type group for lunch specials
    const lunchItemSlugs = menu.categories
      .find((c) => c.slug === "lunch-specials")
      ?.items.filter((i) => i.schedules?.length)
      .map((i) => i.slug) ?? [];

    if (lunchItemSlugs.length > 0) {
      const lunchPopGroup = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: "Pop Type",
          displayLabel: "Choose Your Pop",
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 1,
        },
      });
      for (const [idx, opt] of (["Coke", "Diet Coke", "Dew"] as const).entries()) {
        await tx.modifierOption.create({
          data: {
            modifierGroupId: lunchPopGroup.id,
            name: opt,
            priceDeltaCents: 0,
            isDefault: idx === 0,
            isActive: true,
            sortOrder: idx + 1,
          },
        });
      }
      for (const slug of lunchItemSlugs) {
        const item = createdItemsBySlug.get(slug);
        if (item) {
          await tx.menuItemModifierGroup.create({
            data: { menuItemId: item.id, modifierGroupId: lunchPopGroup.id, sortOrder: 1 },
          });
        }
      }
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Menu import complete for location ${locationCode}.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });