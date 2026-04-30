import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { getDeliveryEligibilityForCustomer } from "../customers/no-show-policy";

type LocationCatalogPayload = Prisma.LocationGetPayload<{
  include: {
    settings: true;
    hours: {
      where: {
        serviceType: {
          in: ["PICKUP", "DELIVERY"];
        };
      };
      orderBy: [
        { serviceType: "asc" },
        { dayOfWeek: "asc" },
        { timeFrom: "asc" },
      ];
    };
    menuCategories: {
      include: {
        menuItems: {
          include: {
            removableIngredients: {
              orderBy: {
                sortOrder: "asc";
              };
            };
            schedules: true;
            modifierGroups: {
              include: {
                modifierGroup: {
                  include: {
                    options: true;
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}>;

type CatalogItem = LocationCatalogPayload["menuCategories"][number]["menuItems"][number];

type SerializedModifierGroup = {
  id: string;
  name: string;
  display_label: string;
  selection_mode: string;
  min_select: number;
  max_select: number | null;
  is_required: boolean;
  sort_order: number;
  context_key: string | null;
  options: Array<{
    id: string;
    name: string;
    price_delta_cents: number;
    is_default: boolean;
    addon_match_normalized: string | null;
    linked_flavour_id: string | null;
  }>;
};

type SerializedBuilderOption = {
  menu_item_id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  weight_lb: number;
  flavour_count: number;
  side_slot_count: number;
  drink_slot_count: number;
  modifier_groups: SerializedModifierGroup[];
};

type SerializedMenuItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  allowed_fulfillment_type: string;
  is_available: boolean;
  stock_status: string;
  is_popular: boolean;
  image_url: string | null;
  builder_type: string | null;
  requires_special_instructions: boolean;
  schedules: ReturnType<typeof serializeSchedules>;
  modifier_groups: SerializedModifierGroup[];
  removable_ingredients: Array<{
    id: string;
    name: string;
    sort_order: number;
  }>;
  weight_options?: SerializedBuilderOption[];
  combo_options?: SerializedBuilderOption[];
  builder_sku_map?: Record<string, string>;
};

function getLocationLocalDate(referenceDate: Date, locationTz: string): Date {
  let localStr: string;
  try {
    localStr = referenceDate.toLocaleString("en-US", { timeZone: locationTz });
  } catch {
    localStr = referenceDate.toLocaleString("en-US");
  }
  return new Date(localStr);
}

function isItemAvailableAt(
  item: CatalogItem,
  locationTz: string,
  referenceDate: Date,
): boolean {
  if (!item.schedules.length) return true;

  const local = getLocationLocalDate(referenceDate, locationTz);
  const dow = local.getDay();
  const hhmm = local.getHours() * 60 + local.getMinutes();

  return item.schedules.some((schedule) => {
    if (schedule.dayOfWeek !== dow) return false;
    const from = new Date(schedule.timeFrom);
    const to = new Date(schedule.timeTo);
    const fromMin = from.getUTCHours() * 60 + from.getUTCMinutes();
    const toMin = to.getUTCHours() * 60 + to.getUTCMinutes();
    return hhmm >= fromMin && hhmm < toMin;
  });
}

function serializeSchedules(item: CatalogItem) {
  if (!item.schedules.length) return null;
  return item.schedules.map((schedule) => {
    const from = new Date(schedule.timeFrom);
    const to = new Date(schedule.timeTo);
    return {
      day_of_week: schedule.dayOfWeek,
      time_from: `${String(from.getUTCHours()).padStart(2, "0")}:${String(from.getUTCMinutes()).padStart(2, "0")}`,
      time_to: `${String(to.getUTCHours()).padStart(2, "0")}:${String(to.getUTCMinutes()).padStart(2, "0")}`,
    };
  });
}

function serializeLocationHours(hours: LocationCatalogPayload["hours"]) {
  return hours.map((hour) => {
    const from = new Date(hour.timeFrom);
    const to = new Date(hour.timeTo);
    return {
      day_of_week: hour.dayOfWeek,
      time_from: `${String(from.getUTCHours()).padStart(2, "0")}:${String(from.getUTCMinutes()).padStart(2, "0")}`,
      time_to: `${String(to.getUTCHours()).padStart(2, "0")}:${String(to.getUTCMinutes()).padStart(2, "0")}`,
      is_closed: hour.isClosed,
    };
  });
}

function serializeModifierGroups(item: CatalogItem): SerializedModifierGroup[] {
  return item.modifierGroups.map((mappedGroup) => ({
    id: mappedGroup.modifierGroup.id,
    name: mappedGroup.modifierGroup.name,
    display_label: mappedGroup.modifierGroup.displayLabel,
    selection_mode: mappedGroup.modifierGroup.selectionMode,
    min_select: mappedGroup.modifierGroup.minSelect,
    max_select: mappedGroup.modifierGroup.maxSelect,
    is_required: mappedGroup.modifierGroup.isRequired,
    sort_order: mappedGroup.sortOrder,
    context_key: mappedGroup.contextKey ?? mappedGroup.modifierGroup.contextKey ?? null,
    options: mappedGroup.modifierGroup.options.map((option) => ({
      id: option.id,
      name: option.name,
      price_delta_cents: option.priceDeltaCents,
      is_default: option.isDefault,
      addon_match_normalized: option.addonMatchNormalized,
      linked_flavour_id: option.linkedFlavourId,
    })),
  }));
}

function serializeRemovableIngredients(item: CatalogItem) {
  return item.removableIngredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    sort_order: ingredient.sortOrder,
  }));
}

function extractWeightLb(name: string): number {
  const wingsMatch = name.match(/(\d+)\s*wings/i);
  if (wingsMatch) {
    const wingCount = Number.parseInt(wingsMatch[1] ?? "", 10);
    return Number.isFinite(wingCount) ? Number((wingCount / 15).toFixed(2)) : 0;
  }

  const poundsMatch = name.match(/([\d.]+)\s*pound/i);
  if (!poundsMatch) return 0;

  const weight = Number.parseFloat(poundsMatch[1] ?? "");
  return Number.isFinite(weight) ? weight : 0;
}

function countFlavourSlots(groups: SerializedModifierGroup[]): number {
  return groups.filter((group) =>
    group.options.some((option) => option.linked_flavour_id),
  ).length;
}

function countGroupsByContext(groups: SerializedModifierGroup[], contextKey: "side" | "drink"): number {
  return groups.filter((group) => group.context_key === contextKey).length;
}

function serializeBuilderOption(item: CatalogItem): SerializedBuilderOption {
  const modifierGroups = serializeModifierGroups(item);
  return {
    menu_item_id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    base_price_cents: item.basePriceCents,
    weight_lb:
      item.slug === "wings-4u-special"
        ? 2
        : extractWeightLb(item.name) || 1,
    flavour_count: countFlavourSlots(modifierGroups),
    side_slot_count: countGroupsByContext(modifierGroups, "side"),
    drink_slot_count: countGroupsByContext(modifierGroups, "drink"),
    modifier_groups: modifierGroups,
  };
}

function serializeMenuItem(item: CatalogItem): SerializedMenuItem {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    base_price_cents: item.basePriceCents,
    allowed_fulfillment_type: item.allowedFulfillmentType,
    is_available: item.isAvailable,
    stock_status: item.stockStatus,
    is_popular: item.isPopular,
    image_url: item.imageUrl,
    builder_type: item.builderType,
    requires_special_instructions: item.requiresSpecialInstructions,
    schedules: serializeSchedules(item),
    modifier_groups: serializeModifierGroups(item),
    removable_ingredients: serializeRemovableIngredients(item),
  };
}

function buildSyntheticCard(params: {
  id: string;
  name: string;
  slug: string;
  description: string;
  builderType: "WINGS" | "WING_COMBO";
  items: CatalogItem[];
}): SerializedMenuItem | null {
  if (params.items.length === 0) return null;

  const serializedOptions = params.items.map(serializeBuilderOption);
  const minPrice = Math.min(...params.items.map((item) => item.basePriceCents));

  return {
    id: params.id,
    name: params.name,
    slug: params.slug,
    description: params.description,
    base_price_cents: minPrice,
    allowed_fulfillment_type: params.items[0].allowedFulfillmentType,
    is_available: params.items.some((item) => item.isAvailable),
    stock_status: params.items.every((item) => item.stockStatus === "UNAVAILABLE") ? "UNAVAILABLE" : params.items.some((item) => item.stockStatus === "LOW_STOCK") ? "LOW_STOCK" : "NORMAL",
    is_popular: params.items.some((item) => item.isPopular),
    image_url: params.items.find((item) => item.imageUrl)?.imageUrl ?? null,
    builder_type: params.builderType,
    requires_special_instructions: false,
    schedules: null,
    modifier_groups: [],
    removable_ingredients: [],
    ...(params.builderType === "WINGS"
      ? { weight_options: serializedOptions }
      : { combo_options: serializedOptions }),
    builder_sku_map: Object.fromEntries(
      serializedOptions.map((option) => [option.slug, option.menu_item_id]),
    ),
  };
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenu(
    locationId: string,
    fulfillmentType: "PICKUP" | "DELIVERY",
    scheduledFor?: string,
    customerUserId?: string,
  ) {
    const location = (await this.prisma.location.findUnique({
      where: { id: locationId },
      include: {
        settings: true,
        hours: {
          where: {
            serviceType: { in: ["PICKUP", "DELIVERY"] },
          },
          orderBy: [
            { serviceType: "asc" },
            { dayOfWeek: "asc" },
            { timeFrom: "asc" },
          ],
        },
        menuCategories: {
          where: { isActive: true, archivedAt: null },
          orderBy: { sortOrder: "asc" },
          include: {
            menuItems: {
              where: {
                isHidden: false,
                archivedAt: null,
                allowedFulfillmentType: { in: ["BOTH", fulfillmentType] },
              },
              orderBy: [{ isPopular: "desc" }, { createdAt: "asc" }, { name: "asc" }],
              include: {
                removableIngredients: {
                  orderBy: { sortOrder: "asc" },
                },
                schedules: true,
                modifierGroups: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    modifierGroup: {
                      include: {
                        options: {
                          where: { isActive: true },
                          orderBy: { sortOrder: "asc" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })) as LocationCatalogPayload | null;

    if (!location || !location.isActive) {
      throw new NotFoundException("Location not found or inactive");
    }

    const settings = location.settings;
    const timezone = location.timezoneName ?? "America/Toronto";
    const scheduleReference = scheduledFor ? new Date(scheduledFor) : new Date();
    const deliveryEligibility = await getDeliveryEligibilityForCustomer(
      this.prisma,
      locationId,
      customerUserId,
      settings?.prepaymentThresholdNoShows,
    );

    const categories = location.menuCategories
      .map((category) => {
        const availableItems = category.menuItems.filter((item) =>
          isItemAvailableAt(item, timezone, scheduleReference),
        );

        let items: SerializedMenuItem[] = [];
        if (category.slug === "wings") {
          const syntheticWings = buildSyntheticCard({
            id: "SYNTHETIC_WINGS",
            name: "Wings (By the Pound)",
            slug: "wings-by-the-pound",
            description: "Choose your weight, flavours, and saucing.",
            builderType: "WINGS",
            items: availableItems.filter((item) => item.builderType === "WINGS"),
          });
          items = syntheticWings ? [syntheticWings] : [];
        } else if (category.slug === "wing-combos") {
          const syntheticCombo = buildSyntheticCard({
            id: "SYNTHETIC_WING_COMBO",
            name: "Wing Combo",
            slug: "wing-combo-builder",
            description: "Pick your combo size, wing setup, flavours, sides, and drinks.",
            builderType: "WING_COMBO",
            items: availableItems.filter((item) => item.builderType === "WING_COMBO"),
          });
          items = syntheticCombo ? [syntheticCombo] : [];
        } else {
          items = availableItems.map(serializeMenuItem);
        }

        return {
          id: category.id,
          name: category.name,
          slug: category.slug,
          sort_order: category.sortOrder,
          items,
          /** Used only to decide whether to keep an empty Salads row in the response. */
          _rawMenuItemCount: category.menuItems.length,
        };
      })
      .filter((category) => {
        if (category.items.length > 0) return true;
        // Keep Salads in the category strip (after Wraps, before Poutines & Sides) even when
        // every salad SKU is temporarily unavailable (schedule window / fulfillment filter).
        if (category.slug === "salads" && category._rawMenuItemCount > 0) return true;
        return false;
      })
      .map(({ _rawMenuItemCount: _unused, ...rest }) => rest);

    const prepMinutes = settings?.busyModeEnabled && settings.busyModePrepTimeMinutes
      ? settings.busyModePrepTimeMinutes
      : (settings?.defaultPrepTimeMinutes ?? 30);

    return {
      categories,
      location: {
        id: location.id,
        name: location.name,
        timezone,
        is_open: location.isActive,
        busy_mode: settings?.busyModeEnabled ?? false,
        estimated_prep_minutes: prepMinutes,
        delivery_fee_cents: settings?.deliveryFeeCents ?? 0,
        tax_rate_bps: settings?.taxRateBps ?? 1300,
        free_delivery_threshold_cents: settings?.freeDeliveryThresholdCents ?? null,
        minimum_delivery_subtotal_cents: settings?.minimumDeliverySubtotalCents ?? 0,
        pickup_min_minutes: settings?.defaultPickupMinMinutes ?? 30,
        pickup_max_minutes: settings?.defaultPickupMaxMinutes ?? 40,
        delivery_min_minutes: settings?.defaultDeliveryMinMinutes ?? 40,
        delivery_max_minutes: settings?.defaultDeliveryMaxMinutes ?? 60,
        prepayment_threshold_no_shows:
          deliveryEligibility.prepaymentThresholdNoShows,
        customer_total_no_shows: deliveryEligibility.customerTotalNoShows,
        delivery_blocked_due_to_no_shows:
          deliveryEligibility.deliveryBlockedDueToNoShows,
        pickup_hours: serializeLocationHours(
          location.hours.filter((hour) => hour.serviceType === "PICKUP"),
        ),
        delivery_hours: serializeLocationHours(
          location.hours.filter((hour) => hour.serviceType === "DELIVERY"),
        ),
      },
    };
  }

  async getWingFlavours(locationId: string) {
    const flavours = await this.prisma.wingFlavour.findMany({
      where: { locationId, isActive: true, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    });

    return flavours.map((flavour) => ({
      id: flavour.id,
      name: flavour.name,
      slug: flavour.slug,
      heat_level: flavour.heatLevel,
      is_plain: flavour.isPlain,
      sort_order: flavour.sortOrder,
    }));
  }
}
