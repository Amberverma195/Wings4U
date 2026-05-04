import { UnprocessableEntityException } from "@nestjs/common";

export const DELIVERY_UNAVAILABLE_MESSAGE =
  "Delivery is currently unavailable. Pickup is still available.";

type DeliveryAvailabilitySettings = {
  deliveryDisabled?: boolean | null;
  deliveryAvailableFromMinutes?: number | null;
  deliveryAvailableUntilMinutes?: number | null;
};

function getLocalMinutes(referenceDate: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(referenceDate);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

function isWithinWindow(params: {
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

export function getDeliveryAvailability(params: {
  settings: DeliveryAvailabilitySettings | null | undefined;
  timezone: string;
  referenceDate?: Date;
}): {
  available: boolean;
  message: string | null;
} {
  const { settings, timezone } = params;
  if (settings?.deliveryDisabled) {
    return {
      available: false,
      message: DELIVERY_UNAVAILABLE_MESSAGE,
    };
  }

  const from = settings?.deliveryAvailableFromMinutes;
  const until = settings?.deliveryAvailableUntilMinutes;
  if (from == null || until == null) {
    return { available: true, message: null };
  }

  const nowMinutes = getLocalMinutes(params.referenceDate ?? new Date(), timezone);
  const available = isWithinWindow({
    nowMinutes,
    fromMinutes: from,
    untilMinutes: until,
  });

  return {
    available,
    message: available ? null : DELIVERY_UNAVAILABLE_MESSAGE,
  };
}

export function assertDeliveryAvailable(params: {
  settings: DeliveryAvailabilitySettings | null | undefined;
  timezone: string;
  referenceDate?: Date;
}) {
  const availability = getDeliveryAvailability(params);
  if (!availability.available) {
    throw new UnprocessableEntityException({
      message: availability.message ?? DELIVERY_UNAVAILABLE_MESSAGE,
      field: "fulfillment_type",
    });
  }
}
