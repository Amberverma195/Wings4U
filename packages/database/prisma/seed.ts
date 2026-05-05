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
  throw new Error("DIRECT_URL or DATABASE_URL is required to run the Prisma seed script.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

/* ================================================================== */
/*  Static data — extracted from the real Wings 4 U menu docx         */
/* ================================================================== */

const WING_FLAVOURS = [
  { name: "No Flavour (Plain)", slug: "no-flavour-plain", heat: "PLAIN" },
  { name: "BBQ", slug: "bbq", heat: "MILD" },
  { name: "Honey Garlic", slug: "honey-garlic", heat: "MILD" },
  { name: "Honey BBQ", slug: "honey-bbq", heat: "MILD" },
  { name: "Honey Dill", slug: "honey-dill", heat: "MILD" },
  { name: "Honey Ranch", slug: "honey-ranch", heat: "MILD" },
  { name: "Honey Smoke", slug: "honey-smoke", heat: "MILD" },
  { name: "Honey Gar-Par", slug: "honey-gar-par", heat: "MILD" },
  { name: "Maple BBQ", slug: "maple-bbq", heat: "MILD" },
  { name: "Maple Bacon", slug: "maple-bacon", heat: "MILD" },
  { name: "Sweet & Sour", slug: "sweet-and-sour", heat: "MILD" },
  { name: "Smoky BBQ", slug: "smoky-bbq", heat: "MILD" },
  { name: "Hickory BBQ", slug: "hickory-bbq", heat: "MILD" },
  { name: "Texas BBQ", slug: "texas-bbq", heat: "MILD" },
  { name: "Apple Butter Mesquite", slug: "apple-butter-mesquite", heat: "MILD" },
  { name: "Garlic Parm (Gar-Par)", slug: "garlic-parm", heat: "MILD" },
  { name: "BBQ Gar-Par", slug: "bbq-gar-par", heat: "MILD" },
  { name: "BBQ Ranch", slug: "bbq-ranch", heat: "MILD" },
  { name: "BBQ Blue Cheese", slug: "bbq-blue-cheese", heat: "MILD" },
  { name: "BBQ Dill", slug: "bbq-dill", heat: "MILD" },
  { name: "BBQ Smokey Ranch", slug: "bbq-smokey-ranch", heat: "MILD" },
  { name: "Creamy Dill / Honey Mustard", slug: "creamy-dill-honey-mustard", heat: "MILD" },
  { name: "Zesty Orange Ginger", slug: "zesty-orange-ginger", heat: "MILD" },
  { name: "Butter Chicken", slug: "butter-chicken", heat: "MILD" },
  { name: "Pineapple Curry", slug: "pineapple-curry", heat: "MILD" },
  { name: "Curry", slug: "curry", heat: "MILD" },
  { name: "Our Signature Sauce", slug: "signature-sauce", heat: "MEDIUM" },
  { name: "Lemon Pepper", slug: "lemon-pepper", heat: "MEDIUM" },
  { name: "Salt & Pepper", slug: "salt-and-pepper", heat: "MEDIUM" },
  { name: "Thai Sweet & Spicy", slug: "thai-sweet-and-spicy", heat: "MEDIUM" },
  { name: "Caribbean Jerk", slug: "caribbean-jerk", heat: "MEDIUM" },
  { name: "Chilli Lime", slug: "chilli-lime", heat: "MEDIUM" },
  { name: "Creamy Cajun", slug: "creamy-cajun", heat: "MEDIUM" },
  { name: "Whisky BBQ", slug: "whisky-bbq", heat: "MEDIUM" },
  { name: "Whisky Ranch", slug: "whisky-ranch", heat: "MEDIUM" },
  { name: "Smoked Tequila Lime", slug: "smoked-tequila-lime", heat: "MEDIUM" },
  { name: "Tequila Ranch", slug: "tequila-ranch", heat: "MEDIUM" },
  { name: "Tangy BBQ (Louis Style)", slug: "tangy-bbq-louis", heat: "MEDIUM" },
  { name: "Buffalo Honey", slug: "buffalo-honey", heat: "MEDIUM" },
  { name: "Buffalo Ranch", slug: "buffalo-ranch", heat: "MEDIUM" },
  { name: "Buffalo Blue", slug: "buffalo-blue", heat: "MEDIUM" },
  { name: "Hot Honey", slug: "hot-honey", heat: "MEDIUM" },
  { name: "Sriracha Lime", slug: "sriracha-lime", heat: "MEDIUM" },
  { name: "Spicy Ranch", slug: "spicy-ranch", heat: "MEDIUM" },
  { name: "Spicy Dill", slug: "spicy-dill", heat: "MEDIUM" },
  { name: "Spicy Gar-Par", slug: "spicy-gar-par", heat: "MEDIUM" },
  { name: "Spicy Honey Mustard", slug: "spicy-honey-mustard", heat: "MEDIUM" },
  { name: "Spicy Lemon Ranch", slug: "spicy-lemon-ranch", heat: "MEDIUM" },
  { name: "Spicy Cajun Ranch", slug: "spicy-cajun-ranch", heat: "MEDIUM" },
  { name: "Hot", slug: "hot", heat: "HOT" },
  { name: "Spicy Buffalo", slug: "spicy-buffalo", heat: "HOT" },
  { name: "Buffalo", slug: "buffalo", heat: "HOT" },
  { name: "Fire & Ice", slug: "fire-and-ice", heat: "HOT" },
  { name: "Jamaican Hot", slug: "jamaican-hot", heat: "HOT" },
  { name: "Hot Dill Pickle", slug: "hot-dill-pickle", heat: "HOT" },
  { name: "Nashville Hot", slug: "nashville-hot", heat: "HOT" },
  { name: "Mango Habanero", slug: "mango-habanero", heat: "HOT" },
  { name: "Mango Chipotle", slug: "mango-chipotle", heat: "HOT" },
  { name: "Habanero Lime", slug: "habanero-lime", heat: "HOT" },
  { name: "Sriracha Chilli", slug: "sriracha-chilli", heat: "HOT" },
  { name: "Spicy Peri-Peri", slug: "spicy-peri-peri", heat: "HOT" },
  { name: "Spicy Island", slug: "spicy-island", heat: "HOT" },
  { name: "Spicy Tandoori", slug: "spicy-tandoori", heat: "HOT" },
  { name: "Suicide", slug: "suicide", heat: "HOT" },
  { name: "Tex-Mex", slug: "tex-mex", heat: "HOT" },
  // Dry rubs — sourced from Docs/menu/wings4u-menu.v1.json. Many of these
  // share a name with a sauce variant above (Buffalo, BBQ, Lemon Pepper…)
  // so the slug carries a `-dry-rub` suffix to keep the unique
  // `(location_id, slug)` constraint happy while letting the dry-rub form
  // appear under its own heat tab in the flavour picker.
  { name: "Cajun", slug: "cajun", heat: "DRY_RUB" },
  { name: "Lemon Pepper", slug: "lemon-pepper-dry-rub", heat: "DRY_RUB" },
  { name: "Salt & Pepper", slug: "salt-and-pepper-dry-rub", heat: "DRY_RUB" },
  { name: "Hot Dill Pickle", slug: "hot-dill-pickle-dry-rub", heat: "DRY_RUB" },
  { name: "Sriracha Lime", slug: "sriracha-lime-dry-rub", heat: "DRY_RUB" },
  { name: "Mango Chipotle", slug: "mango-chipotle-dry-rub", heat: "DRY_RUB" },
  { name: "Caribbean Jerk", slug: "caribbean-jerk-dry-rub", heat: "DRY_RUB" },
  { name: "Spicy Peri-Peri", slug: "spicy-peri-peri-dry-rub", heat: "DRY_RUB" },
  { name: "Garlic Parm", slug: "garlic-parm-dry-rub", heat: "DRY_RUB" },
  { name: "Maple Bacon", slug: "maple-bacon-dry-rub", heat: "DRY_RUB" },
  { name: "Buffalo", slug: "buffalo-dry-rub", heat: "DRY_RUB" },
  { name: "Nashville Hot", slug: "nashville-hot-dry-rub", heat: "DRY_RUB" },
  { name: "Thai Sweet & Spicy", slug: "thai-sweet-and-spicy-dry-rub", heat: "DRY_RUB" },
  { name: "Hot Honey", slug: "hot-honey-dry-rub", heat: "DRY_RUB" },
  { name: "Habanero Lime", slug: "habanero-lime-dry-rub", heat: "DRY_RUB" },
  { name: "BBQ", slug: "bbq-dry-rub", heat: "DRY_RUB" },
  { name: "Spicy Tandoori", slug: "spicy-tandoori-dry-rub", heat: "DRY_RUB" },
  { name: "Tex-Mex", slug: "tex-mex-dry-rub", heat: "DRY_RUB" },
] as const;

const SIDE_OPTIONS = ["Fries", "Onion Rings", "Wedges", "Coleslaw"] as const;

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

/** Paid extras that mirror removable ingredients (same names → addon_match_normalized in DB). */
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

/**
 * Pop options for the Drinks category and any drink slot in a combo.
 * Expanded from the original Coke / Diet Coke / Dew set so customers can pick
 * from the full pop lineup. Add new SKUs here to make them selectable.
 */
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

/**
 * Combined drink options used by combo drink slots.
 * One flat list keeps the picker simple — water/energy/all pops in one place.
 * Energy currently has a single SKU; add more rows here when the catalog grows.
 */
const COMBO_DRINK_OPTIONS = [
  "Water",
  "Energy Drink",
  ...POP_OPTIONS,
] as const;

const DEFAULT_STORE_HOURS = [
  { dayOfWeek: 1, timeFrom: "11:00", timeTo: "01:00" },
  { dayOfWeek: 2, timeFrom: "11:00", timeTo: "01:00" },
  { dayOfWeek: 3, timeFrom: "11:00", timeTo: "01:00" },
  { dayOfWeek: 4, timeFrom: "11:00", timeTo: "01:00" },
  { dayOfWeek: 5, timeFrom: "11:00", timeTo: "02:30" },
  { dayOfWeek: 6, timeFrom: "11:00", timeTo: "02:30" },
  { dayOfWeek: 0, timeFrom: "11:00", timeTo: "01:00" },
] as const;

function timeToUtcDate(value: string): Date {
  const [hourText, minuteText] = value.split(":");
  return new Date(
    Date.UTC(
      1970,
      0,
      1,
      Number.parseInt(hourText ?? "0", 10),
      Number.parseInt(minuteText ?? "0", 10),
      0,
    ),
  );
}

/* ================================================================== */
/*  Seed                                                              */
/* ================================================================== */

async function main() {
  const existing = await prisma.location.findUnique({ where: { code: "LON01" } });
  if (existing) {
    await prisma.locationSettings.update({
      where: { locationId: existing.id },
      data: {
        deliveryFeeCents: 499,
        defaultPrepTimeMinutes: 30,
        defaultPickupMinMinutes: 30,
        defaultPickupMaxMinutes: 40,
        defaultDeliveryMinMinutes: 40,
        defaultDeliveryMaxMinutes: 60,
      },
    });
    const existingStoreHourDays = await prisma.locationHours.findMany({
      where: {
        locationId: existing.id,
        serviceType: "STORE",
      },
      select: { dayOfWeek: true },
    });
    const existingStoreDaySet = new Set(
      existingStoreHourDays.map((hour) => hour.dayOfWeek),
    );
    const missingStoreHours = DEFAULT_STORE_HOURS.filter(
      (hour) => !existingStoreDaySet.has(hour.dayOfWeek),
    );
    if (missingStoreHours.length > 0) {
      await prisma.locationHours.createMany({
        data: missingStoreHours.map((hour) => ({
          locationId: existing.id,
          serviceType: "STORE",
          dayOfWeek: hour.dayOfWeek,
          timeFrom: timeToUtcDate(hour.timeFrom),
          timeTo: timeToUtcDate(hour.timeTo),
          isClosed: false,
        })),
      });
      console.log(`Added ${missingStoreHours.length} default store-hours row(s).`);
    }
    const [
      saladAddonLabelFix,
      jalapenoAddonFix,
      jalapenoPopperAddonFix,
      jalapenoPopperIngredientFix,
      jalapenoPoppersItemFix,
      veggieWrapDescriptionFix,
    ] = await Promise.all([
      prisma.modifierGroup.updateMany({
        where: {
          contextKey: "addon",
          displayLabel: "Salad extras",
        },
        data: { displayLabel: "Additional ingredients" },
      }),
      prisma.modifierOption.updateMany({
        where: {
          name: {
            in: ["Add Jalapeños", "Add JalapeÃ±os"],
          },
        },
        data: { name: "Add Jalapenos" },
      }),
      prisma.modifierOption.updateMany({
        where: {
          name: {
            in: ["Extra Jalapeño Popper", "Extra JalapeÃ±o Popper"],
          },
        },
        data: {
          name: "Extra Jalapeno Popper",
          addonMatchNormalized: normalizeIngredientText("Jalapeno Popper"),
        },
      }),
      prisma.removableIngredient.updateMany({
        where: {
          name: {
            in: ["Jalapeño Popper", "JalapeÃ±o Popper"],
          },
        },
        data: { name: "Jalapeno Popper" },
      }),
      prisma.menuItem.updateMany({
        where: {
          slug: "jalapeno-poppers",
          name: {
            in: ["Jalapeño Poppers (6pc.)", "JalapeÃ±o Poppers (6pc.)"],
          },
        },
        data: { name: "Jalapeno Poppers (6pc.)" },
      }),
      prisma.menuItem.updateMany({
        where: { slug: "veggie-wrap" },
        data: {
          description:
            "Lettuce, red onion, tomato, cauliflower bites, jalapeno popper, cheese blend, roasted garlic, tzatziki",
        },
      }),
    ]);
    if (saladAddonLabelFix.count > 0) {
      console.log(
        `Updated ${saladAddonLabelFix.count} modifier group(s): "Salad extras" → "Additional ingredients".`,
      );
    }
    if (jalapenoAddonFix.count > 0) {
      console.log(
        `Updated ${jalapenoAddonFix.count} modifier option(s): legacy jalapeno add-ons -> "Add Jalapenos".`,
      );
    }
    if (jalapenoPopperAddonFix.count > 0 || jalapenoPopperIngredientFix.count > 0) {
      console.log(
        `Updated jalapeno popper ingredient labels: ${jalapenoPopperAddonFix.count} add-on option(s), ${jalapenoPopperIngredientFix.count} removable ingredient(s).`,
      );
    }
    if (jalapenoPoppersItemFix.count > 0 || veggieWrapDescriptionFix.count > 0) {
      console.log(
        `Updated jalapeno menu text: ${jalapenoPoppersItemFix.count} item name(s), ${veggieWrapDescriptionFix.count} description(s).`,
      );
    }
    console.log(
      "Seed data already exists (location LON01 found). Refreshed delivery fee to $4.99 (499¢). Full seed skipped.",
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // ── 1. Location ──────────────────────────────────────────────────────
    console.log("Creating location LON01…");
    const location = await tx.location.create({
      data: {
        code: "LON01",
        name: "Wings 4 U - London",
        addressLine1: "1544 Dundas Street East",
        city: "London",
        provinceCode: "ON",
        postalCode: "N5W 3C1",
        phoneNumber: "+15194880800",
        timezoneName: "America/Toronto",
      },
    });

    // ── 2. LocationSettings ──────────────────────────────────────────────
    console.log("Creating location settings…");
    await tx.locationSettings.create({
      data: {
        locationId: location.id,
        taxRateBps: 1300,
        taxDeliveryFee: true,
        taxTip: false,
        discountsReduceTaxableBase: true,
        deliveryFeeCents: 499,
        freeDeliveryThresholdCents: 4000,
        minimumDeliverySubtotalCents: 2000,
        defaultPrepTimeMinutes: 30,
        defaultPickupMinMinutes: 30,
        defaultPickupMaxMinutes: 40,
        defaultDeliveryMinMinutes: 40,
        defaultDeliveryMaxMinutes: 60,
        busyModeEnabled: false,
        overdueDeliveryGraceMinutes: 10,
        trustedIpRanges: JSON.stringify(["192.168.1.0/24", "10.0.0.0/8"]),
        allowedPostalCodes: JSON.stringify(["N5W", "N5V", "N5X", "N5Y", "N5Z", "N6A", "N6B", "N6C", "N6E", "N6G", "N6H"]),
      },
    });
    await tx.locationHours.createMany({
      data: DEFAULT_STORE_HOURS.map((hour) => ({
        locationId: location.id,
        serviceType: "STORE",
        dayOfWeek: hour.dayOfWeek,
        timeFrom: timeToUtcDate(hour.timeFrom),
        timeTo: timeToUtcDate(hour.timeTo),
        isClosed: false,
      })),
    });

    // ── 3. Users ─────────────────────────────────────────────────────────
    console.log("Creating users…");
    const adminUser = await tx.user.create({
      data: { role: "ADMIN", displayName: "Admin User", firstName: "Admin", lastName: "User" },
    });
    const managerUser = await tx.user.create({
      data: { role: "STAFF", displayName: "Manager One" },
    });
    const cashierUser = await tx.user.create({
      data: { role: "STAFF", displayName: "Cashier One" },
    });
    const kitchenUser = await tx.user.create({
      data: { role: "STAFF", displayName: "Kitchen One" },
    });
    const driverUser = await tx.user.create({
      data: { role: "STAFF", displayName: "Driver One" },
    });
    const customerUser = await tx.user.create({
      data: { role: "CUSTOMER", displayName: "Jane Doe", firstName: "Jane", lastName: "Doe" },
    });

    // ── 4. UserIdentity (PHONE_OTP) ──────────────────────────────────────
    console.log("Creating user identities…");
    const identities = [
      { userId: adminUser.id, phone: "+15191000001" },
      { userId: managerUser.id, phone: "+15191000002" },
      { userId: cashierUser.id, phone: "+15191000003" },
      { userId: kitchenUser.id, phone: "+15191000006" },
      { userId: driverUser.id, phone: "+15191000004" },
      { userId: customerUser.id, phone: "+15191000005" },
    ] as const;

    for (const { userId, phone } of identities) {
      await tx.userIdentity.create({
        data: {
          userId,
          provider: "PHONE_OTP",
          phoneE164: phone,
          isPrimary: true,
          isVerified: true,
          verifiedAt: new Date(),
        },
      });
    }

    // ── 5. CustomerProfile ───────────────────────────────────────────────
    console.log("Creating customer profile…");
    await tx.customerProfile.create({
      data: { userId: customerUser.id },
    });

    // ── 6. EmployeeProfiles ──────────────────────────────────────────────
    console.log("Creating employee profiles…");
    await tx.employeeProfile.create({
      data: { userId: managerUser.id, locationId: location.id, role: "MANAGER" },
    });
    await tx.employeeProfile.create({
      data: { userId: cashierUser.id, locationId: location.id, role: "CASHIER" },
    });
    await tx.employeeProfile.create({
      data: { userId: kitchenUser.id, locationId: location.id, role: "KITCHEN" },
    });
    await tx.employeeProfile.create({
      data: { userId: driverUser.id, locationId: location.id, role: "DRIVER" },
    });

    // ── 7. AdminLocationAssignment ───────────────────────────────────────
    console.log("Creating admin location assignment…");
    await tx.adminLocationAssignment.create({
      data: { userId: adminUser.id, locationId: location.id, isPrimary: true },
    });

    // ── 8. DriverProfile ─────────────────────────────────────────────────
    console.log("Creating driver profile…");
    await tx.driverProfile.create({
      data: {
        userId: driverUser.id,
        locationId: location.id,
        phoneNumberMirror: "+15191000004",
        availabilityStatus: "OFF_SHIFT",
      },
    });

    // ── 9. CustomerWallet ────────────────────────────────────────────────
    console.log("Creating customer wallet…");
    await tx.customerWallet.create({
      data: { customerUserId: customerUser.id, balanceCents: 0, lifetimeCreditCents: 0 },
    });

    // ── 10. MenuCategories (14 categories, real menu order) ──────────────
    console.log("Creating menu categories…");
    const categoryDefs = [
      { name: "Lunch Specials", slug: "lunch-specials" },
      { name: "Wings", slug: "wings" },
      { name: "Wing Combos", slug: "wing-combos" },
      { name: "Burgers", slug: "burgers" },
      { name: "Tenders", slug: "tenders" },
      { name: "Wraps", slug: "wraps" },
      { name: "Salads", slug: "salads" },
      { name: "Poutines & Sides", slug: "poutines-and-sides" },
      { name: "Specialty Fries", slug: "specialty-fries" },
      { name: "Appetizers", slug: "appetizers" },
      { name: "Breads", slug: "breads" },
      { name: "Specials", slug: "specials" },
      { name: "Party Specials", slug: "party-specials" },
      { name: "Drinks", slug: "drinks" },
      { name: "Dessert", slug: "dessert" },
      { name: "Dips", slug: "dips" },
    ] as const;

    const categories: Record<string, { id: string }> = {};
    for (const [idx, def] of categoryDefs.entries()) {
      categories[def.slug] = await tx.menuCategory.create({
        data: { locationId: location.id, name: def.name, slug: def.slug, sortOrder: idx + 1 },
      });
    }

    const cat = (slug: string) => categories[slug].id;

    // ── 11. WingFlavours ─────────────────────────────────────────────────
    console.log(`Creating wing flavours (${WING_FLAVOURS.length})…`);
    const flavourRows: { id: string; name: string }[] = [];
    for (const [idx, f] of WING_FLAVOURS.entries()) {
      const row = await tx.wingFlavour.create({
        data: {
          locationId: location.id,
          name: f.name,
          slug: f.slug,
          heatLevel: f.heat,
          isPlain: f.heat === "PLAIN",
          sortOrder: idx + 1,
        },
      });
      flavourRows.push({ id: row.id, name: f.name });
    }

    // ── 12. Shared modifier groups ───────────────────────────────────────
    console.log("Creating modifier groups…");

    const wingTypeGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Wing Type",
        displayLabel: "Choose Your Wing Type",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 1,
      },
    });
    for (const [idx, opt] of (["House Breaded Bone-In", "Non-Breaded Bone-In", "Boneless"] as const).entries()) {
      await tx.modifierOption.create({
        data: { modifierGroupId: wingTypeGroup.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
      });
    }

    // Five flavour slot groups so the 75 / 100 wing party specials can carry
    // up to 5 picks. Wings (1–5 lb) and combos still use only 1–3 of these.
    // The (menu_item_id, modifier_group_id) join is unique, so each slot
    // must be its own row.
    const flavourSlotGroups: { id: string }[] = [];
    for (let slot = 1; slot <= 5; slot++) {
      const fg = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: `Flavour ${slot}`,
          displayLabel: `Choose Flavour ${slot}`,
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 1 + slot,
        },
      });
      for (const [idx, fl] of flavourRows.entries()) {
        await tx.modifierOption.create({
          data: {
            modifierGroupId: fg.id,
            name: fl.name,
            priceDeltaCents: 0,
            sortOrder: idx + 1,
            linkedFlavourId: fl.id,
          },
        });
      }
      flavourSlotGroups.push({ id: fg.id });
    }

    // Combo side slots split by portion size (per Issue E):
    //   1 lb combo →  1 small side
    //   1.5 / 2 lb →  1 large side
    //   3 / 5 lb   →  2 large sides
    // Each slot is its own ModifierGroup row because the
    // (menu_item_id, modifier_group_id) join is unique — slots can't share a
    // group when you need more than one of them on the same item.
    async function createSideSlotGroup(label: string, sortOrder: number) {
      const group = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: label,
          displayLabel: `Choose ${label}`,
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder,
          contextKey: "side",
        },
      });
      for (const [idx, opt] of SIDE_OPTIONS.entries()) {
        await tx.modifierOption.create({
          data: { modifierGroupId: group.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
        });
      }
      return group;
    }

    const smallSideGroup = await createSideSlotGroup("Small Side", 10);
    const largeSideGroup1 = await createSideSlotGroup("Large Side 1", 11);
    const largeSideGroup2 = await createSideSlotGroup("Large Side 2", 12);

    const extrasGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Extras",
        displayLabel: "Add Extras",
        selectionMode: "MULTI",
        minSelect: 0,
        maxSelect: 5,
        isRequired: false,
        sortOrder: 20,
        contextKey: "addon",
      },
    });
    for (const [idx, opt] of ([
      { name: "Extra Sauce", price: 50 },
      { name: "Ranch Dip", price: 100 },
      { name: "Blue Cheese Dip", price: 100 },
      { name: "Chipotle Dip", price: 100 },
    ] as const).entries()) {
      await tx.modifierOption.create({
        data: { modifierGroupId: extrasGroup.id, name: opt.name, priceDeltaCents: opt.price, sortOrder: idx + 1 },
      });
    }

    // Phase 9: free dip slot for tenders (every tender SKU comes with a
    // dip on the menu). Single-select required, $0 — paid extras still live
    // on `extrasGroup` so customers can stack additional dips on top.
    const tenderDipGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Dip",
        displayLabel: "Choose Your Dip",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 5,
        contextKey: "dip",
      },
    });
    for (const [idx, opt] of (["Ranch", "Blue Cheese", "Chipotle"] as const).entries()) {
      await tx.modifierOption.create({
        data: { modifierGroupId: tenderDipGroup.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
      });
    }

    // Pop picker for the standalone "Pop" drink item and the lunch specials.
    // Expanded to the full pop SKU list — see POP_OPTIONS at the top of this file.
    const popTypeGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Pop Type",
        displayLabel: "Choose Your Pop",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 1,
        contextKey: "drink",
      },
    });
    for (const [idx, opt] of POP_OPTIONS.entries()) {
      await tx.modifierOption.create({
        data: { modifierGroupId: popTypeGroup.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
      });
    }

    // Phase 10: Six pop-slot groups so customers can build a 6-pack and
    // repeat the same flavour across slots. Each slot is its own group
    // because the (menu_item_id, modifier_group_id) join is unique per
    // pair, mirroring the wing flavour slot pattern.
    const popSixPackSlotGroups: { id: string }[] = [];
    for (let slot = 1; slot <= 6; slot++) {
      const psg = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: `Pop ${slot}`,
          displayLabel: `Choose Pop ${slot}`,
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 30 + slot,
          contextKey: "drink",
        },
      });
      for (const [idx, opt] of POP_OPTIONS.entries()) {
        await tx.modifierOption.create({
          data: { modifierGroupId: psg.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
        });
      }
      popSixPackSlotGroups.push({ id: psg.id });
    }

    // Salad picker for the Wings-4-U Special. The kitchen ships a small
    // salad with the special, but the customer should pick which one.
    // Single-select, $0, required. Houses a flat list of named salads.
    const saladTypeGroup = await tx.modifierGroup.create({
      data: {
        locationId: location.id,
        name: "Salad",
        displayLabel: "Choose Your Salad",
        selectionMode: "SINGLE",
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        sortOrder: 8,
        contextKey: "salad",
      },
    });
    for (const [idx, opt] of ([
      "Garden Salad",
      "Caesar Salad",
      "Greek Salad",
      "Horiatiki Salad",
    ] as const).entries()) {
      await tx.modifierOption.create({
        data: { modifierGroupId: saladTypeGroup.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
      });
    }

    // Combo drink slots: water / energy / every pop in one flat picker.
    // 5 distinct groups so the 5 lb combo can carry 5 drink slots — the
    // join row is unique on (menu_item_id, modifier_group_id), so a single
    // shared group cannot be attached multiple times.
    const drinkSlotGroups: { id: string }[] = [];
    for (let slot = 1; slot <= 5; slot++) {
      const dg = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name: `Drink ${slot}`,
          displayLabel: `Choose Drink ${slot}`,
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 20 + slot,
          contextKey: "drink",
        },
      });
      for (const [idx, opt] of COMBO_DRINK_OPTIONS.entries()) {
        await tx.modifierOption.create({
          data: { modifierGroupId: dg.id, name: opt, priceDeltaCents: 0, sortOrder: idx + 1 },
        });
      }
      drinkSlotGroups.push({ id: dg.id });
    }

    /**
     * PRD §4.6: paid extras stay on modifier_groups / modifier_options with
     * context_key = "addon". These category-level groups are reused across
     * matching items instead of creating a new payload type.
     */
    async function createAddonGroup(
      name: string,
      options: Array<{
        name: string;
        price: number;
        scopeIngredientName?: string;
      }>,
      displayLabel = name,
    ) {
      const group = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name,
          displayLabel,
          selectionMode: "MULTI",
          minSelect: 0,
          maxSelect: options.length,
          isRequired: false,
          sortOrder: 30,
          contextKey: "addon",
        },
      });
      for (const [idx, opt] of options.entries()) {
        await tx.modifierOption.create({
          data: {
            modifierGroupId: group.id,
            name: opt.name,
            priceDeltaCents: opt.price,
            sortOrder: idx + 1,
            addonMatchNormalized: opt.scopeIngredientName
              ? normalizeIngredientText(opt.scopeIngredientName)
              : null,
          },
        });
      }
      return group;
    }

    const wrapExtrasGroup = await createAddonGroup(
      "Wrap Extras",
      [
        { name: "Extra Chicken", price: 250 },
        { name: "Extra Cheese", price: 100 },
        { name: "Extra Sauce", price: 50 },
        { name: "Add Bacon", price: 150 },
        { name: "Add Avocado", price: 200 },
        { name: "Add Jalapenos", price: 100 },
      ],
      "Wrap extras",
    );

    const poutineExtrasGroup = await createAddonGroup(
      "Poutine Extras",
      [
        { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
        { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
        { name: "Add Pulled Chicken", price: 250 },
        { name: "Extra Sauce (On the Side)", price: 50 },
      ],
      "Poutine extras",
    );

    const specialtyFriesExtrasGroup = await createAddonGroup(
      "Specialty Fry Extras",
      [
        { name: "Extra Cheese", price: 100 },
        { name: "Extra Sauce", price: 50 },
        { name: "Add Bacon", price: 150 },
        { name: "Add Jalapenos", price: 100 },
      ],
      "Specialty fry extras",
    );

    // ── Helper: create item + attach modifier groups ─────────────────────
    async function createItem(
      categorySlug: string,
      name: string,
      slug: string,
      priceCents: number,
      opts?: {
        description?: string;
        builder?: string;
        popular?: boolean;
        fulfillment?: string;
        modifiers?: { groupId: string; sortOrder: number; contextKey?: string }[];
        removableIngredients?: string[];
        addonOptions?: Array<{
          name: string;
          price: number;
          scopeIngredientName?: string;
        }>;
        addonDisplayLabel?: string;
      },
    ) {
      const item = await tx.menuItem.create({
        data: {
          locationId: location.id,
          categoryId: cat(categorySlug),
          name,
          slug,
          description: opts?.description,
          basePriceCents: priceCents,
          allowedFulfillmentType: opts?.fulfillment ?? "BOTH",
          isAvailable: true,
          isPopular: opts?.popular ?? false,
          builderType: opts?.builder,
        },
      });
      if (opts?.modifiers) {
        for (const m of opts.modifiers) {
          await tx.menuItemModifierGroup.create({
            data: { menuItemId: item.id, modifierGroupId: m.groupId, sortOrder: m.sortOrder, contextKey: m.contextKey },
          });
        }
      }
      if (opts?.removableIngredients) {
        for (const [idx, name] of opts.removableIngredients.entries()) {
          await tx.removableIngredient.create({
            data: { menuItemId: item.id, name, sortOrder: idx + 1 },
          });
        }
      }
      if (opts?.addonOptions?.length) {
        const addonGroup = await createAddonGroup(
          `${name} Extras`,
          opts.addonOptions,
          opts.addonDisplayLabel ?? `${name} extras`,
        );
        await tx.menuItemModifierGroup.create({
          data: {
            menuItemId: item.id,
            modifierGroupId: addonGroup.id,
            sortOrder: 10,
            contextKey: "addon",
          },
        });
      }
      return item;
    }

    function wingMods(flavourCount: 1 | 2 | 3 | 4 | 5) {
      const mods = [
        { groupId: wingTypeGroup.id, sortOrder: 1 },
        ...flavourSlotGroups.slice(0, flavourCount).map((g, i) => ({ groupId: g.id, sortOrder: 2 + i })),
        { groupId: extrasGroup.id, sortOrder: 10 },
      ];
      return mods;
    }

    /** Party 75/100: wing type + flavour slots only (no dips / extra sauce add-ons). */
    function wingModsPartyPack(flavourCount: 5) {
      return [
        { groupId: wingTypeGroup.id, sortOrder: 1 },
        ...flavourSlotGroups.slice(0, flavourCount).map((g, i) => ({ groupId: g.id, sortOrder: 2 + i })),
      ];
    }

    /** Wings by the pound: wing type + flavour slots only (no dip / extra sauce add-ons). */
    function wingModsByPound(flavourCount: 1 | 2 | 3) {
      return [
        { groupId: wingTypeGroup.id, sortOrder: 1 },
        ...flavourSlotGroups.slice(0, flavourCount).map((g, i) => ({ groupId: g.id, sortOrder: 2 + i })),
      ];
    }

    /**
     * Per Issue E (combo weight → side & pop counts):
     *   1 lb   →  1 small side + 1 pop
     *   1.5 lb →  1 large side + 1 pop
     *   2 lb   →  1 large side + 2 pops
     *   3 lb   →  2 large sides + 3 pops
     *   5 lb   →  2 large sides + 5 pops
     * (4 lb combo is intentionally excluded from the combo lineup —
     *  it lives only on the wings-by-the-pound flow.)
     */
    function comboMods(
      flavourCount: 1 | 2 | 3,
      sideShape: "SMALL_1" | "LARGE_1" | "LARGE_2",
      drinkCount: 1 | 2 | 3 | 5,
    ) {
      const sides =
        sideShape === "SMALL_1"
          ? [{ groupId: smallSideGroup.id, sortOrder: 5 }]
          : sideShape === "LARGE_1"
            ? [{ groupId: largeSideGroup1.id, sortOrder: 5 }]
            : [
                { groupId: largeSideGroup1.id, sortOrder: 5 },
                { groupId: largeSideGroup2.id, sortOrder: 6 },
              ];
      const drinks = drinkSlotGroups
        .slice(0, drinkCount)
        .map((g, i) => ({ groupId: g.id, sortOrder: 7 + i }));
      return [
        { groupId: wingTypeGroup.id, sortOrder: 1 },
        ...flavourSlotGroups.slice(0, flavourCount).map((g, i) => ({ groupId: g.id, sortOrder: 2 + i })),
        ...sides,
        ...drinks,
        { groupId: extrasGroup.id, sortOrder: 20 },
      ];
    }

    async function createSizeGroup(name: string, options: { name: string; priceDelta: number }[]) {
      const group = await tx.modifierGroup.create({
        data: {
          locationId: location.id,
          name,
          displayLabel: `Choose Size`,
          selectionMode: "SINGLE",
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          sortOrder: 1,
          contextKey: "size",
        },
      });
      for (const [idx, opt] of options.entries()) {
        await tx.modifierOption.create({
          data: { modifierGroupId: group.id, name: opt.name, priceDeltaCents: opt.priceDelta, sortOrder: idx + 1 },
        });
      }
      return group;
    }

    // ── 13. Lunch Specials ───────────────────────────────────────────────
    // lunch-5-wings is wired through the WINGS builder so the customer can
    // pick wing type / preparation / 1 flavour / saucing exactly like a
    // standalone wings order — the WingsBuilder also renders the attached
    // pop slot (context_key: "drink") as a generic step.
    //
    // lunch-burger and lunch-wrap are routed by slug to a dedicated
    // LunchSpecialBuilder on the client; the lunch row owns the pop choice
    // and the builder lets the customer pick which burger/wrap to customise.
    console.log("Creating lunch specials…");
    const lunchDesc = "Available everyday 11 AM – 3 PM";
    const lunchWings = await createItem("lunch-specials", "5 Wings + Small Fry + Pop", "lunch-5-wings", 999, {
      description: lunchDesc,
      builder: "WINGS",
      modifiers: [
        ...wingMods(1),
        { groupId: popTypeGroup.id, sortOrder: 11 },
      ],
    });
    const lunchTender = await createItem("lunch-specials", "3pc Chicken Tender + Small Fry + Pop", "lunch-3-tender", 999, { description: lunchDesc });
    const lunchNuggets = await createItem("lunch-specials", "6pc Chicken Nuggets + Small Fry + Pop", "lunch-6-nuggets", 999, { description: lunchDesc });
    const lunchBurger = await createItem("lunch-specials", "Any Burger + Small Fry + Pop", "lunch-burger", 999, { description: lunchDesc });
    const lunchWrap = await createItem("lunch-specials", "Any Wrap + Small Fry + Pop", "lunch-wrap", 999, { description: lunchDesc });
    const lunchPoutine = await createItem("lunch-specials", "Large Poutine + Pop", "lunch-poutine", 999, { description: lunchDesc });
    const lunchItems = [lunchWings, lunchTender, lunchNuggets, lunchBurger, lunchWrap, lunchPoutine];
    for (const li of lunchItems) {
      for (let dow = 0; dow <= 6; dow++) {
        await tx.menuItemSchedule.create({
          data: {
            menuItemId: li.id,
            dayOfWeek: dow,
            timeFrom: new Date(Date.UTC(1970, 0, 1, 11, 0, 0)),
            timeTo: new Date(Date.UTC(1970, 0, 1, 15, 0, 0)),
          },
        });
      }
    }
    // lunch-5-wings already has popTypeGroup attached via wingMods + drink slot.
    for (const li of [lunchTender, lunchNuggets, lunchBurger, lunchWrap, lunchPoutine]) {
      await tx.menuItemModifierGroup.create({
        data: { menuItemId: li.id, modifierGroupId: popTypeGroup.id, sortOrder: 1 },
      });
    }

    // ── 14. Wings (6 real size cards) ────────────────────────────────────
    console.log("Creating wing items…");
    await createItem("wings", "1 Pound – 1 Flavour", "wings-1lb", 1299, { builder: "WINGS", modifiers: wingModsByPound(1) });
    await createItem("wings", "1.5 Pound – 1 Flavour", "wings-1.5lb", 1899, { builder: "WINGS", modifiers: wingModsByPound(1) });
    await createItem("wings", "2 Pound – 1 Flavour", "wings-2lb", 2499, { builder: "WINGS", modifiers: wingModsByPound(1) });
    await createItem("wings", "3 Pound – 2 Flavours", "wings-3lb", 3599, { builder: "WINGS", modifiers: wingModsByPound(2) });
    await createItem("wings", "4 Pound – 2 Flavours", "wings-4lb", 4699, { builder: "WINGS", modifiers: wingModsByPound(2) });
    await createItem("wings", "5 Pound – 3 Flavours", "wings-5lb", 5899, { builder: "WINGS", modifiers: wingModsByPound(3) });

    // ── 15. Wing Combos (5 real size cards) ──────────────────────────────
    // Per Issue E: 4 lb combo is intentionally excluded — that weight is only
    // sold on the wings-by-the-pound flow. Each row's modifier shape is
    // driven by comboMods(flavourCount, sideShape, drinkCount).
    console.log("Creating wing combo items…");
    await createItem("wing-combos", "1 Pound Combo", "combo-1lb", 1799, { builder: "WING_COMBO", description: "1 small side + 1 pop", modifiers: comboMods(1, "SMALL_1", 1) });
    await createItem("wing-combos", "1.5 Pound Combo", "combo-1.5lb", 2399, { builder: "WING_COMBO", description: "1 large side + 1 pop", modifiers: comboMods(1, "LARGE_1", 1) });
    await createItem("wing-combos", "2 Pound Combo", "combo-2lb", 2999, { builder: "WING_COMBO", description: "1 large side + 2 pops", modifiers: comboMods(1, "LARGE_1", 2) });
    await createItem("wing-combos", "3 Pound Combo", "combo-3lb", 4999, { builder: "WING_COMBO", description: "2 large sides + 3 pops", modifiers: comboMods(2, "LARGE_2", 3) });
    await createItem("wing-combos", "5 Pound Combo", "combo-5lb", 7999, { builder: "WING_COMBO", description: "2 large sides + 5 pops", modifiers: comboMods(3, "LARGE_2", 5) });

    // ── 16. Burgers ──────────────────────────────────────────────────────
    console.log("Creating burgers…");
    const veggieBurgerRemovables = [
      "Sriracha Mayo",
      "Lettuce",
      "Red Onion",
      "Tomato",
      "Signature Sauce",
    ];
    await createItem("burgers", "Veggie Burger", "veggie-burger", 799, {
      description: "Sriracha mayo, lettuce, red onion, tomato, veggie patty tossed in signature sauce",
      removableIngredients: veggieBurgerRemovables,
      addonOptions: addonOptionsFromRemovableIngredients(veggieBurgerRemovables),
    });
    const chickenBurgerRemovables = [
      "Sriracha Mayo",
      "Lettuce",
      "Red Onion",
      "Tomato",
      "Thai Sauce",
    ];
    await createItem("burgers", "Chicken Burger", "chicken-burger", 999, {
      description: "Sriracha mayo, lettuce, red onion, tomato, freshly breaded chicken tossed in Thai sauce",
      removableIngredients: chickenBurgerRemovables,
      addonOptions: addonOptionsFromRemovableIngredients(chickenBurgerRemovables),
    });
    const buffaloBurgerRemovables = ["Sriracha Mayo", "Lettuce", "Red Onion", "Tomato"];
    await createItem("burgers", "Buffalo Chicken Burger", "buffalo-chicken-burger", 999, {
      description: "Sriracha mayo, lettuce, red onion, tomato, freshly breaded buffalo chicken",
      removableIngredients: buffaloBurgerRemovables,
      addonOptions: addonOptionsFromRemovableIngredients(buffaloBurgerRemovables),
    });
    await createItem("burgers", "Add Side & Pop to Any Burger", "burger-side-add", 499, { description: "Fries, onion rings, wedges, or coleslaw + 1 pop" });

    // ── 17. Tenders ──────────────────────────────────────────────────────
    // Phase 9: every tender SKU forces the customization overlay open via
    // its required dip slot, plus combos pull in side/pop slots so the
    // customer always picks before adding to cart.
    console.log("Creating tenders…");
    await createItem("tenders", "3pc Chicken Tenders + 1 Dip", "tenders-3pc", 699, {
      description: "3 chicken tenders served with one 2 oz. dip.",
      modifiers: [{ groupId: tenderDipGroup.id, sortOrder: 5 }],
    });
    await createItem("tenders", "5pc Chicken Tenders + 1 Dip", "tenders-5pc", 1199, {
      description: "5 chicken tenders served with one 2 oz. dip.",
      modifiers: [{ groupId: tenderDipGroup.id, sortOrder: 5 }],
    });
    await createItem("tenders", "10pc Chicken Tenders + 1 Dip", "tenders-10pc", 2399, {
      description: "10 chicken tenders served with one 4 oz. dip.",
      modifiers: [{ groupId: tenderDipGroup.id, sortOrder: 5 }],
    });
    await createItem("tenders", "Tender Combo (3pc) – Small Side + Dip + Pop", "tenders-combo-3", 1099, {
      description: "3 tenders + small side + 2 oz. dip + 1 pop.",
      modifiers: [
        { groupId: smallSideGroup.id, sortOrder: 4 },
        { groupId: tenderDipGroup.id, sortOrder: 5 },
        { groupId: drinkSlotGroups[0].id, sortOrder: 6 },
      ],
    });
    await createItem("tenders", "Tender Combo (5pc) – Large Side + Dip + Pop", "tenders-combo-5", 1799, {
      description: "5 tenders + large side + 4 oz. dip + 1 pop.",
      modifiers: [
        { groupId: largeSideGroup1.id, sortOrder: 4 },
        { groupId: tenderDipGroup.id, sortOrder: 5 },
        { groupId: drinkSlotGroups[0].id, sortOrder: 6 },
      ],
    });

    // ── 18. Wraps ────────────────────────────────────────────────────────
    console.log("Creating wraps…");
    await createItem("wraps", "Veggie Wrap", "veggie-wrap", 999, {
      addonOptions: [
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cauliflower Bites", price: 150, scopeIngredientName: "Cauliflower Bites" },
        { name: "Extra Jalapeno Popper", price: 150, scopeIngredientName: "Jalapeno Popper" },
        { name: "Extra Roasted Garlic", price: 50, scopeIngredientName: "Roasted Garlic" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
        { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
        { name: "Add Feta", price: 150 },
        { name: "Add Avocado", price: 200 },
      ],
      description: "Lettuce, red onion, tomato, cauliflower bites, jalapeno popper, cheese blend, roasted garlic, tzatziki",
      removableIngredients: ["Lettuce", "Red Onion", "Tomato", "Cauliflower Bites", "Jalapeno Popper", "Cheese Blend", "Roasted Garlic", "Tzatziki"],
    });
    await createItem("wraps", "Chicken Caesar Wrap", "chicken-caesar-wrap", 999, {
      addonOptions: [
        { name: "Extra Chicken", price: 250 },
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Bacon Bits", price: 100, scopeIngredientName: "Bacon Bits" },
        { name: "Extra Parm Cheese", price: 100, scopeIngredientName: "Parm Cheese" },
        { name: "Extra Caesar Dressing", price: 50, scopeIngredientName: "Caesar Dressing" },
        { name: "Add Bacon", price: 150 },
      ],
      description: "Lettuce, bacon bits, parm cheese, hand-breaded chicken, Caesar dressing",
      removableIngredients: ["Lettuce", "Bacon Bits", "Parm Cheese", "Caesar Dressing"],
    });
    await createItem("wraps", "Buffalo Chicken Wrap", "buffalo-chicken-wrap", 999, {
      addonOptions: [
        { name: "Extra Chicken", price: 250 },
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
        { name: "Extra Croutons", price: 50, scopeIngredientName: "Croutons" },
        { name: "Extra Sriracha Mayo", price: 50, scopeIngredientName: "Sriracha Mayo" },
        { name: "Add Jalapenos", price: 100 },
      ],
      description: "Lettuce, red onion, cucumber, tomato, cheese blend, croutons, buffalo breaded chicken, sriracha mayo",
      removableIngredients: ["Lettuce", "Red Onion", "Cucumber", "Tomato", "Cheese Blend", "Croutons", "Sriracha Mayo"],
    });
    await createItem("wraps", "Garden Chicken Wrap", "garden-chicken-wrap", 999, {
      addonOptions: [
        { name: "Extra Chicken", price: 250 },
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Extra Julienne Carrots", price: 50, scopeIngredientName: "Julienne Carrots" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
        { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
        { name: "Add Jalapenos", price: 100 },
      ],
      description: "Lettuce, red onion, tomato, cucumber, julienne carrots, cheese blend, hand-breaded chicken, ranch",
      removableIngredients: ["Lettuce", "Red Onion", "Tomato", "Cucumber", "Julienne Carrots", "Cheese Blend", "Ranch"],
    });
    await createItem("wraps", "Greek Chicken Wrap", "greek-chicken-wrap", 999, {
      addonOptions: [
        { name: "Extra Chicken", price: 250 },
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
        { name: "Extra Greek Dressing", price: 50, scopeIngredientName: "Greek Dressing" },
        { name: "Add Olives", price: 100, scopeIngredientName: "Black Olives" },
      ],
      description: "Lettuce, red onion, cucumber, tomato, black olives, feta, Greek dressing",
      removableIngredients: ["Lettuce", "Red Onion", "Cucumber", "Tomato", "Black Olives", "Feta", "Greek Dressing"],
    });
    await createItem("wraps", "Add Side & Pop to Any Wrap", "wrap-side-add", 499, { description: "Fries, onion rings, wedges, or coleslaw + 1 pop" });

    // ── 19. Salads ───────────────────────────────────────────────────────
    console.log("Creating salads…");
    const saladSizeSmLg = [{ name: "Small", priceDelta: 0 }, { name: "Large", priceDelta: 400 }];
    const saladSizeGroup = await createSizeGroup("Salad Size", saladSizeSmLg);
    const breadedChickenBySize = [
      { name: "Add fresh hand breaded chicken (Small)", price: 299 },
      { name: "Add fresh hand breaded chicken (Large)", price: 399 },
    ];

    await createItem("salads", "Caesar Salad", "caesar-salad", 699, {
      description: "Romaine, bacon, croutons, parm cheese, Caesar dressing",
      modifiers: [{ groupId: saladSizeGroup.id, sortOrder: 1 }],
      removableIngredients: ["Romaine", "Bacon", "Croutons", "Parm Cheese", "Caesar Dressing"],
      addonOptions: [
        { name: "Extra Romaine", price: 50, scopeIngredientName: "Romaine" },
        { name: "Extra Bacon", price: 150, scopeIngredientName: "Bacon" },
        { name: "Extra Croutons", price: 50, scopeIngredientName: "Croutons" },
        { name: "Extra Caesar Dressing", price: 50, scopeIngredientName: "Caesar Dressing" },
        { name: "Extra Parm Cheese", price: 100, scopeIngredientName: "Parm Cheese" },
        ...breadedChickenBySize,
      ],
      addonDisplayLabel: "Additional ingredients",
    });

    await createItem("salads", "Garden Salad", "garden-salad", 699, {
      description: "Iceberg, red onion, tomato, cucumber, julienne carrots, cheese blend, ranch",
      modifiers: [{ groupId: saladSizeGroup.id, sortOrder: 1 }],
      removableIngredients: ["Iceberg", "Red Onion", "Tomato", "Cucumber", "Julienne Carrots", "Cheese Blend", "Ranch"],
      addonOptions: [
        { name: "Extra Iceberg", price: 50, scopeIngredientName: "Iceberg" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Extra Julienne Carrots", price: 50, scopeIngredientName: "Julienne Carrots" },
        { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
        ...breadedChickenBySize,
      ],
      addonDisplayLabel: "Additional ingredients",
    });

    await createItem("salads", "Greek Salad", "greek-salad", 699, {
      description: "Iceberg, red onion, tomato, cucumber, black olives, feta, Greek dressing",
      modifiers: [{ groupId: saladSizeGroup.id, sortOrder: 1 }],
      removableIngredients: ["Iceberg", "Red Onion", "Tomato", "Cucumber", "Black Olives", "Feta", "Greek Dressing"],
      addonOptions: [
        { name: "Extra Iceberg", price: 50, scopeIngredientName: "Iceberg" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Add Olives", price: 100, scopeIngredientName: "Black Olives" },
        { name: "Extra Greek Dressing", price: 50, scopeIngredientName: "Greek Dressing" },
        { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
        ...breadedChickenBySize,
      ],
      addonDisplayLabel: "Additional ingredients",
    });

    await createItem("salads", "Horiatiki Salad", "horiatiki-salad", 899, {
      description: "Green pepper, red onion, tomato, cucumber, black olives, feta, olive oil",
      modifiers: [{ groupId: saladSizeGroup.id, sortOrder: 1 }],
      removableIngredients: ["Green Pepper", "Red Onion", "Tomato", "Cucumber", "Black Olives", "Feta", "Olive Oil"],
      addonOptions: [
        { name: "Extra Green Pepper", price: 50, scopeIngredientName: "Green Pepper" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Add Olives", price: 100, scopeIngredientName: "Black Olives" },
        { name: "Extra Olive Oil", price: 50, scopeIngredientName: "Olive Oil" },
        { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
        ...breadedChickenBySize,
      ],
      addonDisplayLabel: "Additional ingredients",
    });

    // Menu: Buffalo Chicken Salad is large only (no small).
    const saladSizeLargeOnly = await createSizeGroup("Salad Size", [{ name: "Large", priceDelta: 0 }]);

    await createItem("salads", "Buffalo Chicken Salad", "buffalo-chicken-salad", 1599, {
      description: "Lettuce, cucumber, cheese blend, red onion, tomato, croutons, breaded chicken, ranch on side",
      modifiers: [{ groupId: saladSizeLargeOnly.id, sortOrder: 1 }],
      removableIngredients: ["Lettuce", "Cucumber", "Cheese Blend", "Red Onion", "Tomato", "Croutons", "Breaded Chicken", "Ranch"],
      addonOptions: [
        { name: "Extra Lettuce", price: 50, scopeIngredientName: "Lettuce" },
        { name: "Extra Cucumber", price: 50, scopeIngredientName: "Cucumber" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Croutons", price: 50, scopeIngredientName: "Croutons" },
        { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      ],
      addonDisplayLabel: "Additional ingredients",
    });

    // ── 20. Poutines & Sides ─────────────────────────────────────────────
    console.log("Creating poutines & sides…");
    const poutineSizeSmLg = [{ name: "Small", priceDelta: 0 }, { name: "Large", priceDelta: 350 }];
    const poutineSizeSmLg500 = [{ name: "Small", priceDelta: 0 }, { name: "Large", priceDelta: 500 }];
    const sideSizeSmLg = [{ name: "Small", priceDelta: 0 }, { name: "Large", priceDelta: 300 }];
    const gravySize = [{ name: "Small", priceDelta: 0 }, { name: "Large", priceDelta: 150 }];
    const nuggetSize = [{ name: "6pc", priceDelta: 0 }, { name: "12pc", priceDelta: 500 }];

    const regPoutineSize = await createSizeGroup("Regular Poutine Size", poutineSizeSmLg);
    await createItem("poutines-and-sides", "Regular Poutine", "regular-poutine", 649, {
      addonOptions: [
        { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
        { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      ],
      modifiers: [
        { groupId: regPoutineSize.id, sortOrder: 1 },
      ],
      removableIngredients: ["Cheese Curds", "Gravy"],
    });

    const baconPoutineSize = await createSizeGroup("Bacon Poutine Size", poutineSizeSmLg500);
    await createItem("poutines-and-sides", "Bacon Poutine", "bacon-poutine", 699, {
      addonOptions: [
        { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
        { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
        { name: "Add Bacon", price: 150, scopeIngredientName: "Bacon" },
      ],
      modifiers: [
        { groupId: baconPoutineSize.id, sortOrder: 1 },
      ],
      removableIngredients: ["Cheese Curds", "Gravy", "Bacon"],
    });

    const buffPoutineSize = await createSizeGroup("Buffalo Chicken Poutine Size", poutineSizeSmLg500);
    await createItem("poutines-and-sides", "Buffalo Chicken Poutine", "buffalo-chicken-poutine", 799, {
      addonOptions: [
        { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
        { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
        { name: "Add Buffalo Chicken", price: 250, scopeIngredientName: "Buffalo Chicken" },
      ],
      modifiers: [
        { groupId: buffPoutineSize.id, sortOrder: 1 },
      ],
      removableIngredients: ["Cheese Curds", "Gravy", "Buffalo Chicken"],
    });

    const butterPoutineSize = await createSizeGroup("Butter Chicken Poutine Size", poutineSizeSmLg500);
    await createItem("poutines-and-sides", "Butter Chicken Poutine", "butter-chicken-poutine", 799, {
      addonOptions: [
        { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
        { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
        { name: "Add Butter Chicken", price: 250, scopeIngredientName: "Butter Chicken" },
      ],
      modifiers: [
        { groupId: butterPoutineSize.id, sortOrder: 1 },
      ],
      removableIngredients: ["Cheese Curds", "Gravy", "Butter Chicken"],
    });

    const friesSize = await createSizeGroup("Fries Size", sideSizeSmLg);
    await createItem("poutines-and-sides", "Fries", "fries", 449, { modifiers: [{ groupId: friesSize.id, sortOrder: 1 }] });

    const onionRingsSize = await createSizeGroup("Onion Rings Size", sideSizeSmLg);
    await createItem("poutines-and-sides", "Onion Rings", "onion-rings", 449, { modifiers: [{ groupId: onionRingsSize.id, sortOrder: 1 }] });

    const wedgesSize = await createSizeGroup("Wedges Size", sideSizeSmLg);
    await createItem("poutines-and-sides", "Wedges", "wedges", 449, { modifiers: [{ groupId: wedgesSize.id, sortOrder: 1 }] });

    const coleslawSize = await createSizeGroup("Coleslaw Size", sideSizeSmLg);
    await createItem("poutines-and-sides", "Coleslaw", "coleslaw", 449, { modifiers: [{ groupId: coleslawSize.id, sortOrder: 1 }] });

    const gravySizeGroup = await createSizeGroup("Gravy Size", gravySize);
    await createItem("poutines-and-sides", "Gravy", "gravy", 199, { modifiers: [{ groupId: gravySizeGroup.id, sortOrder: 1 }] });

    const nuggetSizeGroup = await createSizeGroup("Chicken Nuggets Size", nuggetSize);
    await createItem("poutines-and-sides", "Chicken Nuggets", "chicken-nuggets", 699, { modifiers: [{ groupId: nuggetSizeGroup.id, sortOrder: 1 }] });

    // ── 20. Specialty Fries ──────────────────────────────────────────────
    console.log("Creating specialty fries…");
    await createItem("specialty-fries", "Cajun Lemon Pepper Fries", "cajun-lemon-pepper-fries", 899, {
      addonOptions: [
        { name: "Extra Cajun Seasoning", price: 50, scopeIngredientName: "Cajun Seasoning" },
        { name: "Extra Lemon Pepper", price: 50, scopeIngredientName: "Lemon Pepper" },
        { name: "Extra Cheese", price: 100 },
      ],
      removableIngredients: ["Cajun Seasoning", "Lemon Pepper"],
    });
    await createItem("specialty-fries", "Creamy Dill Fries", "creamy-dill-fries", 999, {
      addonOptions: [
        { name: "Extra Creamy Dill Sauce", price: 50, scopeIngredientName: "Creamy Dill Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Bacon", price: 150 },
      ],
      removableIngredients: ["Creamy Dill Sauce"],
    });
    await createItem("specialty-fries", "Gar-Par Fries", "gar-par-fries", 999, {
      addonOptions: [
        { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Bacon", price: 150 },
      ],
      removableIngredients: ["Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Spicy Gar-Par Fries", "spicy-gar-par-fries", 999, {
      addonOptions: [
        { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Jalapenos", price: 100 },
      ],
      removableIngredients: ["Spicy Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Gar-Par Onion Rings", "gar-par-onion-rings", 999, {
      addonOptions: [
        { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Bacon", price: 150 },
      ],
      removableIngredients: ["Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Spicy Gar-Par Onion Rings", "spicy-gar-par-onion-rings", 999, {
      addonOptions: [
        { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Jalapenos", price: 100 },
      ],
      removableIngredients: ["Spicy Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Gar-Par Wedges", "gar-par-wedges", 999, {
      addonOptions: [
        { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Bacon", price: 150 },
      ],
      removableIngredients: ["Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Spicy Gar-Par Wedges", "spicy-gar-par-wedges", 999, {
      addonOptions: [
        { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
        { name: "Extra Cheese", price: 100 },
        { name: "Add Jalapenos", price: 100 },
      ],
      removableIngredients: ["Spicy Garlic Parmesan Sauce"],
    });
    await createItem("specialty-fries", "Greek Fries", "greek-fries", 1099, {
      addonOptions: [
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Garlic", price: 50, scopeIngredientName: "Garlic" },
        { name: "Extra Oregano", price: 50, scopeIngredientName: "Oregano" },
        { name: "Extra Paprika", price: 50, scopeIngredientName: "Paprika" },
        { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
        { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
        { name: "Extra Olive Oil", price: 50, scopeIngredientName: "Olive Oil" },
        { name: "Add Olives", price: 100 },
      ],
      description: "Tomato, tzatziki, feta, olive oil, garlic, oregano, paprika",
      removableIngredients: ["Tomato", "Tzatziki", "Feta", "Olive Oil", "Garlic", "Oregano", "Paprika"],
    });
    await createItem("specialty-fries", "Chilli Cheese Fries", "chilli-cheese-fries", 1099, {
      addonOptions: [
        { name: "Extra Chilli", price: 100, scopeIngredientName: "Red Meat Chilli" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese" },
        { name: "Add Jalapenos", price: 100 },
      ],
      description: "Red meat chilli",
      removableIngredients: ["Red Meat Chilli", "Cheese"],
    });

    // ── 21. Appetizers ───────────────────────────────────────────────────
    console.log("Creating appetizers…");
    await createItem("appetizers", "Mac n Cheese Bites (8pc.)", "mac-cheese-bites", 799, { description: "Served with ranch" });
    await createItem("appetizers", "Mozzarella Sticks (8pc.)", "mozz-sticks", 1049, { description: "Served with salsa" });
    await createItem("appetizers", "Cheddar Cheese Cubes", "cheddar-cubes", 949, { description: "Served with ranch" });
    await createItem("appetizers", "Jalapeno Poppers (6pc.)", "jalapeno-poppers", 949, { description: "Served with ranch" });
    await createItem("appetizers", "Cauliflower Bites", "cauliflower-bites", 949, { description: "Served with ranch" });
    await createItem("appetizers", "Breaded Pickle Spears", "pickle-spears", 949, { description: "Served with ranch" });
    await createItem("appetizers", "Sweet Potato Fries", "sweet-potato-fries", 949, { description: "Served with chipotle sauce" });
    await createItem("appetizers", "Battered Mushroom Caps", "mushroom-caps", 949, { description: "Served with ranch" });
    await createItem("appetizers", "Breaded Popcorn Chicken", "popcorn-chicken", 949, { description: "Served with plum sauce" });
    await createItem("appetizers", "Loaded Potato Skins (4pc.)", "potato-skins", 949, { description: "Served with sour cream" });
    await createItem("appetizers", "Vegetable Samosa", "veg-samosa", 100, { description: "Served with thai sauce" });
    await createItem("appetizers", "Veg. Samosa Poutine", "veg-samosa-poutine", 1099, { description: "Made with our signature sauce" });
    await createItem("appetizers", "Spinach Dip", "spinach-dip", 1499);
    await createItem("appetizers", "Chicken Loaded Fries", "chicken-loaded-fries", 1199, {
      description: "Fries, tomato, red onion, blend cheese, freshly breaded chicken drizzled with sweet chili sauce, ranch, house seasoning & served with sour cream on side",
      removableIngredients: ["Tomato", "Red Onion", "Blend Cheese", "Breaded Chicken", "Sweet Chili Sauce", "Ranch", "House Seasoning", "Sour Cream"],
      addonOptions: [
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Blend Cheese" },
        { name: "Extra Chicken", price: 200, scopeIngredientName: "Breaded Chicken" },
        { name: "Extra Sweet Chili Sauce", price: 50, scopeIngredientName: "Sweet Chili Sauce" },
        { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
        { name: "Extra House Seasoning", price: 50, scopeIngredientName: "House Seasoning" },
        { name: "Extra Sour Cream", price: 50, scopeIngredientName: "Sour Cream" },
        { name: "Add Bacon", price: 150 },
        { name: "Add Jalapenos", price: 100 },
      ],
    });
    await createItem("appetizers", "Bacon Loaded Fries", "bacon-loaded-fries", 1199, {
      description: "Fries, tomato, red onion, blend cheese, bacon, drizzled with sweet chili sauce, ranch, house seasoning & served with sour cream on side",
      removableIngredients: ["Tomato", "Red Onion", "Blend Cheese", "Bacon", "Sweet Chili Sauce", "Ranch", "House Seasoning", "Sour Cream"],
      addonOptions: [
        { name: "Extra Tomato", price: 50, scopeIngredientName: "Tomato" },
        { name: "Extra Red Onion", price: 50, scopeIngredientName: "Red Onion" },
        { name: "Extra Cheese", price: 100, scopeIngredientName: "Blend Cheese" },
        { name: "Extra Bacon", price: 150, scopeIngredientName: "Bacon" },
        { name: "Extra Sweet Chili Sauce", price: 50, scopeIngredientName: "Sweet Chili Sauce" },
        { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
        { name: "Extra House Seasoning", price: 50, scopeIngredientName: "House Seasoning" },
        { name: "Extra Sour Cream", price: 50, scopeIngredientName: "Sour Cream" },
        { name: "Add Chicken", price: 200 },
        { name: "Add Jalapenos", price: 100 },
      ],
    });

    // ── 22. Breads ───────────────────────────────────────────────────────
    console.log("Creating breads…");
    const breadPlainSize = await createSizeGroup("Garlic Bread Plain Size", [{ name: "4pc", priceDelta: 0 }, { name: "8pc", priceDelta: 350 }]);
    await createItem("breads", "Garlic Bread Plain", "garlic-bread-plain", 449, { modifiers: [{ groupId: breadPlainSize.id, sortOrder: 1 }] });

    const breadCheeseSize = await createSizeGroup("Garlic Bread Cheese Size", [{ name: "4pc", priceDelta: 0 }, { name: "8pc", priceDelta: 450 }]);
    await createItem("breads", "Garlic Bread Cheese", "garlic-bread-cheese", 549, { modifiers: [{ groupId: breadCheeseSize.id, sortOrder: 1 }] });

    const breadCheeseBaconSize = await createSizeGroup("Garlic Bread Cheese & Bacon Size", [{ name: "4pc", priceDelta: 0 }, { name: "8pc", priceDelta: 550 }]);
    await createItem("breads", "Garlic Bread Cheese & Bacon", "garlic-bread-cheese-bacon", 649, { modifiers: [{ groupId: breadCheeseBaconSize.id, sortOrder: 1 }] });

    // ── 23. Specials ─────────────────────────────────────────────────────
    // Wings-4-U Special: 2 lb wings (1 flavour in builder) + salad type +
    // removals/add-ons + 2 drink slots. Routes through WINGS
    // builder; pound-size step hidden (single weight option).
    console.log("Creating specials…");
    await createItem("specials", "Wings-4-U Special", "wings-4u-special", 4399, {
      builder: "WINGS",
      description:
        "2 lbs wings + large fries + 4 mozz. sticks + small salad + 2 pop.",
      popular: true,
      modifiers: [
        ...wingModsByPound(1),
        { groupId: saladTypeGroup.id, sortOrder: 8 },
        { groupId: drinkSlotGroups[0].id, sortOrder: 12 },
        { groupId: drinkSlotGroups[1].id, sortOrder: 13 },
      ],
    });

    // ── 24. Party Specials ────────────────────────────────────────────────
    // Party specials are fixed-size (75 or 100 wings, no per-pound builder)
    // and ship with 5 flavour slots so the description matches what the
    // builder asks the customer to pick.
    console.log("Creating party specials…");
    await createItem("party-specials", "75 Wings — 5 Flavours", "party-75-wings", 8999, { builder: "WINGS", description: "Party pack: 75 wings, choose 5 flavours.", modifiers: wingModsPartyPack(5) });
    await createItem("party-specials", "100 Wings — 5 Flavours", "party-100-wings", 11699, { builder: "WINGS", description: "Party pack: 100 wings, choose 5 flavours.", modifiers: wingModsPartyPack(5) });

    // ── 25. Drinks ───────────────────────────────────────────────────────
    console.log("Creating drinks…");
    await createItem("drinks", "Pop", "pop", 150, {
      description: "Pick from the full pop lineup — Pepsi, Coke, or Mountain Dew family.",
      modifiers: [{ groupId: popTypeGroup.id, sortOrder: 1 }],
    });
    // Phase 10: 6-pack of pop at $7. Six required slots so the customer
    // can mix-and-match (or pick the same can six times).
    await createItem("drinks", "6-Pack of Pop", "pop-6-pack", 700, {
      description: "Six cans, mix and match any pop flavours.",
      modifiers: popSixPackSlotGroups.map((g, i) => ({ groupId: g.id, sortOrder: 1 + i })),
    });
    await createItem("drinks", "Water", "water", 100);
    await createItem("drinks", "Energy Drink", "energy-drink", 299);

    // ── 26. Dessert ──────────────────────────────────────────────────────
    console.log("Creating dessert…");
    await createItem("dessert", "Caramel Choco Brownie", "caramel-choco-brownie", 399);

    // ── 27. Dips ─────────────────────────────────────────────────────────
    console.log("Creating dips…");
    await createItem("dips", "Ranch Dip", "dip-ranch", 100);
    await createItem("dips", "Blue Cheese Dip", "dip-blue-cheese", 100);
    await createItem("dips", "Chipotle Dip", "dip-chipotle", 100);

    console.log("Seed completed successfully.");
  }, { timeout: 120_000 });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
