import { HttpException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, WingFlavour } from "@prisma/client";
import {
  buildScheduleViolationBody,
  getLocationLocalDate,
  isLunchSpecialMenuItem,
  SIDE_POP_BUNDLE_SLUGS,
  getLunchAddonOptionIds,
  getBuilderPriceDelta,
} from "./pricing";
import {
  isOperatingHourOpenAt,
  minutesFromTime,
} from "./weekly-operating-hours";

type FulfillmentType = "PICKUP" | "DELIVERY";

type ValidationDb = Prisma.TransactionClient;

export type ValidationMenuItem = {
  id: string;
  name: string;
  slug?: string | null;
  builderType?: string | null;
  isAvailable: boolean;
  archivedAt: Date | null;
  allowedFulfillmentType: string;
  requiresSpecialInstructions: boolean;
  category?: {
    name?: string | null;
    slug?: string | null;
    availableFromMinutes?: number | null;
    availableUntilMinutes?: number | null;
  } | null;
  schedules: Array<{ dayOfWeek: number; timeFrom: Date; timeTo: Date }>;
  modifierGroups: Array<{ modifierGroupId: string }>;
};

export type ValidationModifierOption = {
  id: string;
  modifierGroupId: string;
};

export type ScheduleContext = {
  timezone: string;
  dow: number;
  hhmm: number;
};

type WingFlavourRef = {
  id: string;
  name: string | null;
};

export function getScheduleContext(
  referenceDate: Date,
  timezone: string,
): ScheduleContext {
  const local = getLocationLocalDate(referenceDate, timezone);
  return {
    timezone,
    dow: local.getDay(),
    hhmm: local.getHours() * 60 + local.getMinutes(),
  };
}

function isWithinMinuteWindow(params: {
  nowMinutes: number;
  fromMinutes: number;
  untilMinutes: number;
}): boolean {
  const { nowMinutes, fromMinutes, untilMinutes } = params;
  if (fromMinutes === untilMinutes) return true;
  if (fromMinutes < untilMinutes) {
    return nowMinutes >= fromMinutes && nowMinutes < untilMinutes;
  }
  return nowMinutes >= fromMinutes || nowMinutes < untilMinutes;
}

export function isMenuCategoryScheduledAt(
  category: ValidationMenuItem["category"],
  context: ScheduleContext,
): boolean {
  const from = category?.availableFromMinutes;
  const until = category?.availableUntilMinutes;
  if (from == null || until == null) return true;
  return isWithinMinuteWindow({
    nowMinutes: context.hhmm,
    fromMinutes: from,
    untilMinutes: until,
  });
}

export function isMenuItemScheduledAt(
  item: ValidationMenuItem,
  context: ScheduleContext,
): boolean {
  if (item.schedules.length === 0) return true;
  return item.schedules.some((schedule) => {
    if (schedule.dayOfWeek !== context.dow) return false;
    return (
      context.hhmm >= minutesFromTime(new Date(schedule.timeFrom)) &&
      context.hhmm < minutesFromTime(new Date(schedule.timeTo))
    );
  });
}

export function collectScheduleViolation(
  item: ValidationMenuItem,
  context: ScheduleContext,
  scheduleViolationIds: string[],
  lunchScheduleViolationIds: string[],
) {
  if (
    isMenuCategoryScheduledAt(item.category, context) &&
    isMenuItemScheduledAt(item, context)
  ) {
    return;
  }
  scheduleViolationIds.push(item.id);
  if (isLunchSpecialMenuItem(item)) {
    lunchScheduleViolationIds.push(item.id);
  }
}

export function throwScheduleViolations(params: {
  scheduleViolationIds: string[];
  lunchScheduleViolationIds: string[];
  timezone: string;
}) {
  const { scheduleViolationIds, lunchScheduleViolationIds, timezone } = params;
  if (scheduleViolationIds.length === 0) return;

  throw new HttpException(
    buildScheduleViolationBody({
      affectedItemIds: scheduleViolationIds,
      timezone,
      lunchOnly: lunchScheduleViolationIds.length === scheduleViolationIds.length,
    }),
    422,
  );
}

export function assertMenuItemOrderable(params: {
  menuItem: ValidationMenuItem;
  fulfillmentType: FulfillmentType;
  label?: string;
  specialInstructions?: string;
}) {
  const { menuItem, fulfillmentType, label = "Menu item", specialInstructions } = params;
  if (menuItem.archivedAt) {
    throw new UnprocessableEntityException({
      message: `${label} "${menuItem.name}" is no longer available`,
      field: "items",
    });
  }
  if (!menuItem.isAvailable) {
    throw new UnprocessableEntityException({
      message: `${label} "${menuItem.name}" is currently unavailable`,
      field: "items",
    });
  }
  if (
    menuItem.allowedFulfillmentType !== "BOTH" &&
    menuItem.allowedFulfillmentType !== fulfillmentType
  ) {
    throw new UnprocessableEntityException({
      message: `${label} "${menuItem.name}" is not available for ${fulfillmentType}`,
      field: "items",
    });
  }
  if (menuItem.requiresSpecialInstructions && !specialInstructions?.trim()) {
    throw new UnprocessableEntityException({
      message: `"${menuItem.name}" requires special instructions`,
      field: "items",
    });
  }
}

export async function assertLocationOpenForFulfillment(params: {
  db: ValidationDb;
  locationId: string;
  fulfillmentType: FulfillmentType;
  context: ScheduleContext;
}) {
  const { db, locationId, fulfillmentType, context } = params;
  const hours = await db.locationHours.findMany({
    where: { locationId, serviceType: { in: [fulfillmentType, "STORE"] } },
  });
  const fulfillmentHours = hours.filter(
    (hour) => hour.serviceType === fulfillmentType,
  );
  const storeHours = hours.filter((hour) => hour.serviceType === "STORE");
  const hoursForFulfillment =
    fulfillmentHours.length > 0 ? fulfillmentHours : storeHours;

  const isOpen =
    hoursForFulfillment.length === 0
      ? context.hhmm >= 660 && context.hhmm < 1380
      : hoursForFulfillment.some((hour) =>
          isOperatingHourOpenAt(hour, context),
        );

  if (!isOpen) {
    throw new UnprocessableEntityException({
      message: `The store is not open for ${fulfillmentType.toLowerCase()} at the selected time.`,
      field: "scheduled_for",
    });
  }
}

function readWingFlavourRef(value: unknown): WingFlavourRef | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    wing_flavour_id?: unknown;
    flavour_name?: unknown;
  };
  if (typeof candidate.wing_flavour_id !== "string") return null;
  return {
    id: candidate.wing_flavour_id,
    name:
      typeof candidate.flavour_name === "string" && candidate.flavour_name.trim()
        ? candidate.flavour_name.trim()
        : null,
  };
}

export function collectWingFlavourRefs(
  builderPayload?: Record<string, unknown>,
): WingFlavourRef[] {
  if (!builderPayload) return [];

  const refs: WingFlavourRef[] = [];
  if (Array.isArray(builderPayload.flavour_slots)) {
    for (const slot of builderPayload.flavour_slots) {
      const ref = readWingFlavourRef(slot);
      if (ref) refs.push(ref);
    }
  }

  const extraRef = readWingFlavourRef(builderPayload.extra_flavour);
  if (extraRef) refs.push(extraRef);
  return refs;
}

export async function loadWingFlavourMapForRefs(params: {
  db: ValidationDb;
  locationId: string;
  refs: WingFlavourRef[];
}): Promise<Map<string, WingFlavour>> {
  const ids = Array.from(new Set(params.refs.map((ref) => ref.id)));
  if (ids.length === 0) return new Map();

  const flavours = await params.db.wingFlavour.findMany({
    where: { id: { in: ids }, locationId: params.locationId },
  });
  return new Map(flavours.map((flavour) => [flavour.id, flavour]));
}

export function assertWingFlavoursOrderable(params: {
  builderPayload?: Record<string, unknown>;
  wingFlavourMap: Map<string, WingFlavour>;
}) {
  for (const ref of collectWingFlavourRefs(params.builderPayload)) {
    const flavour = params.wingFlavourMap.get(ref.id);
    const displayName = flavour?.name ?? ref.name ?? "selected sauce";
    if (!flavour || flavour.archivedAt) {
      throw new UnprocessableEntityException({
        message: `Sauce "${displayName}" is no longer available. Please edit or remove this item.`,
        field: "items",
      });
    }
    if (!flavour.isActive) {
      throw new UnprocessableEntityException({
        message: `Sauce "${displayName}" is currently unavailable. Please edit or remove this item.`,
        field: "items",
      });
    }
  }
}

export function assertModifierOptionAllowedForItem(params: {
  option: ValidationModifierOption;
  menuItem: ValidationMenuItem;
}) {
  const allowedGroupIds = new Set(
    params.menuItem.modifierGroups.map((group) => group.modifierGroupId),
  );
  if (!allowedGroupIds.has(params.option.modifierGroupId)) {
    throw new UnprocessableEntityException({
      message: `Modifier option ${params.option.id} is not valid for ${params.menuItem.name}`,
      field: "items",
    });
  }
}

export function assertBuilderPayloadValid(params: {
  menuItem: ValidationMenuItem;
  builderPayload?: Record<string, unknown>;
  optionMap?: Map<string, { id: string; isActive?: boolean; priceDeltaCents: number }>;
}): void {
  const { menuItem, builderPayload, optionMap } = params;
  const requiredType = menuItem.builderType === "WINGS" || menuItem.builderType === "WING_COMBO"
    ? menuItem.builderType : ["lunch-burger", "lunch-wrap"].includes(menuItem.slug ?? "") ? "LUNCH_SPECIAL" : null;
  if (requiredType && builderPayload?.builder_type !== requiredType) {
    throw new UnprocessableEntityException("Required builder type: " + requiredType);
  }
  if (!builderPayload) return;

  const validBuilderTypes = new Set([
    "WINGS",
    "WING_COMBO",
    "ITEM_CUSTOMIZATION",
    "LUNCH_SPECIAL",
  ]);
  const builderType =
    typeof builderPayload.builder_type === "string"
      ? builderPayload.builder_type
      : null;

  if (!builderType || !validBuilderTypes.has(builderType)) {
    throw new UnprocessableEntityException({
      message: `Invalid builder type: "${builderType}"`,
      field: "items",
    });
  }

  if (builderType === "WINGS") {
    if (menuItem.builderType !== "WINGS") {
      throw new UnprocessableEntityException({
        message: `"${menuItem.name}" is not eligible for wing builder`,
        field: "items",
      });
    }
    if (
      builderPayload.wing_type === "BONELESS" &&
      builderPayload.preparation === "NON_BREADED"
    ) {
      throw new UnprocessableEntityException({
        message: "Boneless wings cannot be non-breaded",
        field: "items",
      });
    }
    if (
      builderPayload.salad_customization &&
      menuItem.slug &&
      menuItem.slug !== "wings-4u-special" &&
      menuItem.builderType === "WINGS"
    ) {
      throw new UnprocessableEntityException({
        message: "Salad customization is only available for Wings-4-U Special",
        field: "items",
      });
    }
  }

  if (builderType === "WING_COMBO") {
    if (menuItem.builderType !== "WING_COMBO") {
      throw new UnprocessableEntityException({
        message: `"${menuItem.name}" is not eligible for wing combo builder`,
        field: "items",
      });
    }
    if (
      builderPayload.wing_type === "BONELESS" &&
      builderPayload.preparation === "NON_BREADED"
    ) {
      throw new UnprocessableEntityException({
        message: "Boneless wings cannot be non-breaded",
        field: "items",
      });
    }
    if (builderPayload.salad_customization) {
      throw new UnprocessableEntityException({
        message: "Salad customization is not valid for wing combos",
        field: "items",
      });
    }
  }

  if (builderType === "WINGS" || builderType === "WING_COMBO") {
    if (!['BONE_IN', 'BONELESS'].includes(builderPayload.wing_type as string) ||
        !['BREADED', 'NON_BREADED'].includes(builderPayload.preparation as string) ||
        !Array.isArray(builderPayload.flavour_slots) || builderPayload.flavour_slots.length === 0) {
      throw new UnprocessableEntityException("Incomplete wing builder");
    }
  }

  if (builderType === "ITEM_CUSTOMIZATION") {
    const bundle = builderPayload.side_pop_bundle;
    if (bundle !== undefined) {
      if (!menuItem.slug || !SIDE_POP_BUNDLE_SLUGS.has(menuItem.slug)) {
        throw new UnprocessableEntityException({
          message: `Side and pop combo is not available for ${menuItem.name}`,
          field: "items",
        });
      }
      const selection = bundle as { side_label?: unknown; pop_label?: unknown } | null;
      if (!selection || Array.isArray(selection) ||
          !["Fries", "Onion rings", "Wedges", "Coleslaw"].includes(selection.side_label as string) ||
          !["Pepsi", "Diet Pepsi", "Pepsi Zero", "Coke", "Diet Coke", "Coke Zero", "Mountain Dew", "Diet Mountain Dew"].includes(selection.pop_label as string)) {
        throw new UnprocessableEntityException("Unsupported side and pop combo choices");
      }
    }
  }

  if (builderType === "LUNCH_SPECIAL") {
    const isLunchItem =
      (menuItem.slug?.startsWith("lunch-") ?? false) ||
      menuItem.category?.slug === "lunch-specials";
    if (!isLunchItem) {
      throw new UnprocessableEntityException({
        message: `"${menuItem.name}" is not a lunch special`,
        field: "items",
      });
    }
    getLunchAddonOptionIds(builderPayload);
    getBuilderPriceDelta(builderPayload, optionMap);
  }
}
