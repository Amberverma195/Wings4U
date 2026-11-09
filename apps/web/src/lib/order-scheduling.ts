"use client";

import type { FulfillmentType, LocationServiceHours } from "./types";
import { PICKUP_ETA_MIN_MINUTES, PICKUP_ETA_MAX_MINUTES, PICKUP_ETA_RANGE } from "./pickup-eta";

export type TimingWindow = {
  minMinutes: number;
  maxMinutes: number;
};

export type SchedulingConfig = {
  pickup: TimingWindow;
  delivery: TimingWindow;
};

export type SchedulingHours = {
  pickup: LocationServiceHours[];
  delivery: LocationServiceHours[];
  store: LocationServiceHours[];
  deliveryAvailableFromMinutes?: number | null;
  deliveryAvailableUntilMinutes?: number | null;
};

export type ScheduleDateOption = {
  value: string;
  label: string;
  dayOfWeek: number;
  isToday: boolean;
};

export type ScheduleTimeOption = {
  value: string;
  label: string;
};

const DAYS_AHEAD = 7;
const SLOT_INTERVAL_MINUTES = 15;
const FALLBACK_TIME_FROM = "11:00";
const FALLBACK_TIME_TO = "23:00";

const PICKUP_TIMING_WINDOW = Object.freeze({ minMinutes: PICKUP_ETA_MIN_MINUTES, maxMinutes: PICKUP_ETA_MAX_MINUTES });

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  pickup: PICKUP_TIMING_WINDOW,
  delivery: { minMinutes: 40, maxMinutes: 60 },
};

export const DEFAULT_SCHEDULING_HOURS: SchedulingHours = {
  pickup: Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    time_from: FALLBACK_TIME_FROM,
    time_to: FALLBACK_TIME_TO,
    is_closed: false,
  })),
  delivery: Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    time_from: FALLBACK_TIME_FROM,
    time_to: FALLBACK_TIME_TO,
    is_closed: false,
  })),
  store: Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    time_from: FALLBACK_TIME_FROM,
    time_to: FALLBACK_TIME_TO,
    is_closed: false,
  })),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isTimingWindow(value: unknown): value is TimingWindow {
  return (
    isRecord(value) &&
    typeof value.minMinutes === "number" &&
    Number.isFinite(value.minMinutes) &&
    typeof value.maxMinutes === "number" &&
    Number.isFinite(value.maxMinutes)
  );
}

function getDefaultTimingWindow(
  fulfillmentType: FulfillmentType,
): TimingWindow {
  return fulfillmentType === "DELIVERY"
    ? DEFAULT_SCHEDULING_CONFIG.delivery
    : DEFAULT_SCHEDULING_CONFIG.pickup;
}

function getDateFormatter(timezone = "America/Toronto"): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

function getTimeFormatter(timezone = "America/Toronto"): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function minutesFromHHMM(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

function nextDayOfWeek(dayOfWeek: number): number {
  return (dayOfWeek + 1) % 7;
}

function formatDateOptionLabel(
  date: Date,
  isToday: boolean,
  timezone?: string,
): string {
  const formatted = getDateFormatter(timezone).format(date);
  return isToday ? `Today, ${formatted.replace(/^[A-Za-z]{3},\s*/, "")}` : formatted;
}

function getHoursForType(
  fulfillmentType: FulfillmentType,
  hours?: SchedulingHours,
): LocationServiceHours[] {
  const source = fulfillmentType === "DELIVERY" ? hours?.delivery : hours?.pickup;
  if (source && source.length > 0) return source;
  if (hours?.store && hours.store.length > 0) return hours.store;
  return fulfillmentType === "DELIVERY"
    ? DEFAULT_SCHEDULING_HOURS.delivery
    : DEFAULT_SCHEDULING_HOURS.pickup;
}

function hourTouchesDay(slot: LocationServiceHours, dayOfWeek: number): boolean {
  if (slot.is_closed) return false;
  const startMinutes = minutesFromHHMM(slot.time_from);
  const endMinutes = minutesFromHHMM(slot.time_to);
  if (startMinutes === endMinutes) return slot.day_of_week === dayOfWeek || (startMinutes > 0 && nextDayOfWeek(slot.day_of_week) === dayOfWeek);
  if (startMinutes < endMinutes) return slot.day_of_week === dayOfWeek;
  return slot.day_of_week === dayOfWeek || nextDayOfWeek(slot.day_of_week) === dayOfWeek;
}

function getWindowSegmentsForDay(
  slot: LocationServiceHours,
  dayOfWeek: number,
): Array<{ startMinutes: number; endMinutes: number }> {
  if (slot.is_closed) return [];

  const startMinutes = minutesFromHHMM(slot.time_from);
  const endMinutes = minutesFromHHMM(slot.time_to);
  if (startMinutes < endMinutes) {
    return slot.day_of_week === dayOfWeek
      ? [{ startMinutes, endMinutes }]
      : [];
  }

  const segments: Array<{ startMinutes: number; endMinutes: number }> = [];
  if (slot.day_of_week === dayOfWeek) {
    segments.push({ startMinutes, endMinutes: 24 * 60 });
  }
  if (nextDayOfWeek(slot.day_of_week) === dayOfWeek) {
    segments.push({ startMinutes: 0, endMinutes });
  }
  return segments;
}

export function normalizeSchedulingConfig(value: unknown): SchedulingConfig {
  if (!isRecord(value)) {
    return DEFAULT_SCHEDULING_CONFIG;
  }

  const pickup = PICKUP_TIMING_WINDOW;
  const delivery = isTimingWindow(value.delivery)
    ? value.delivery
    : DEFAULT_SCHEDULING_CONFIG.delivery;

  return { pickup, delivery };
}

export function getTimingWindow(
  config: SchedulingConfig,
  fulfillmentType: FulfillmentType,
): TimingWindow {
  if (fulfillmentType === "PICKUP") return PICKUP_TIMING_WINDOW;
  const candidate =
    fulfillmentType === "DELIVERY" ? config.delivery : config.pickup;
  return isTimingWindow(candidate)
    ? candidate
    : getDefaultTimingWindow(fulfillmentType);
}

export function formatEtaLabel(
  fulfillmentType: FulfillmentType,
  config: SchedulingConfig,
): string {
  if (fulfillmentType === "PICKUP") return `ASAP (${PICKUP_ETA_RANGE} min)`;
  const window = getTimingWindow(config, fulfillmentType);
  if (window.minMinutes === window.maxMinutes) {
    return `ASAP (~${window.minMinutes} min)`;
  }
  return `ASAP (${window.minMinutes}-${window.maxMinutes} min)`;
}

export function getDateKey(date: Date, timezone = "America/Toronto"): string {
  return restaurantClock(date, timezone).dateKey;
}

export function getSelectedDateKey(scheduledFor: string | null, now = new Date(), timezone = "America/Toronto"): string {
  return getDateKey(scheduledFor ? new Date(scheduledFor) : now, timezone);
}

export function formatScheduleDateLabel(
  scheduledFor: string | null,
  timezone?: string,
  now = new Date(),
): string {
  const target = scheduledFor ? new Date(scheduledFor) : now;
  const todayKey = getDateKey(now, timezone);
  return formatDateOptionLabel(target, getDateKey(target, timezone) === todayKey, timezone ?? "America/Toronto");
}

export function formatScheduleTimeLabel(
  scheduledFor: string | null,
  fulfillmentType: FulfillmentType,
  config: SchedulingConfig,
  timezone?: string,
): string {
  if (!scheduledFor) {
    return formatEtaLabel(fulfillmentType, config);
  }
  return getTimeFormatter(timezone).format(new Date(scheduledFor));
}

export function buildScheduleDateOptions(
  fulfillmentType: FulfillmentType,
  hours?: SchedulingHours,
  timezone?: string,
  now = new Date(),
): ScheduleDateOption[] {
  return buildRestaurantDateOptions(fulfillmentType, hours, timezone, now);
}

export function buildScheduleTimeOptions(params: {
  fulfillmentType: FulfillmentType;
  selectedDateKey: string;
  config: SchedulingConfig;
  hours?: SchedulingHours;
  timezone?: string;
  now?: Date;
  /** Catalog's effective kitchen prep (including busy mode), never the ad range.
   * Unknown while loading/failing: offer no explicit pickup slots. */
  pickupLeadMinutes?: number;
}): ScheduleTimeOption[] {
  if (params.fulfillmentType === "PICKUP") return buildPickupTimeOptions(params);
  return buildDeliveryTimeOptions(params);
}

function withinDeliveryWindow(minutes: number, hours?: SchedulingHours): boolean {
  const from = hours?.deliveryAvailableFromMinutes;
  const until = hours?.deliveryAvailableUntilMinutes;
  if (from == null || until == null || from === until) return true;
  return from < until ? minutes >= from && minutes < until : minutes >= from || minutes < until;
}

function buildDeliveryTimeOptions(params: {
  selectedDateKey: string; config: SchedulingConfig; hours?: SchedulingHours;
  timezone?: string; now?: Date; pickupLeadMinutes?: number;
}): ScheduleTimeOption[] {
  const now = params.now ?? new Date();
  const timezone = params.timezone ?? "America/Toronto";
  const clock = restaurantClock(now, timezone);
  const source = getHoursForType("DELIVERY", params.hours);
  const isOpen = (date: Date) => {
    const local = restaurantClock(date, timezone);
    const day = new Date(local.dateKey + "T12:00:00Z").getUTCDay();
    return withinDeliveryWindow(local.minutes, params.hours) && source.some(slot =>
      getWindowSegmentsForDay(slot, day).some(segment => local.minutes >= segment.startMinutes && local.minutes < segment.endMinutes));
  };
  const options: ScheduleTimeOption[] = [];
  if (params.selectedDateKey === clock.dateKey && isOpen(now)) {
    options.push({ value: "ASAP", label: formatEtaLabel("DELIVERY", params.config) });
  }
  const start = restaurantInstant(params.selectedDateKey, 0, timezone);
  const nextDay = new Date(params.selectedDateKey + "T12:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = restaurantInstant(nextDay.toISOString().slice(0, 10), 0, timezone);
  if (!start || !end) return options;
  const lead = Math.max(getTimingWindow(params.config, "DELIVERY").minMinutes, params.pickupLeadMinutes ?? 0);
  const earliest = now.getTime() + lead * 60_000;
  const formatter = getTimeFormatter(timezone);
  // Iterate real instants: spring gaps disappear and both fall-back occurrences
  // retain distinct UTC values. Never construct restaurant times in the browser zone.
  for (let time = start.getTime(); time < end.getTime(); time += SLOT_INTERVAL_MINUTES * 60_000) {
    const instant = new Date(time);
    if (time < earliest || !isOpen(instant)) continue;
    options.push({ value: instant.toISOString(), label: formatter.format(instant) });
  }
  const labelCounts = new Map<string, number>();
  for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone,
    hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return options.map(option => (labelCounts.get(option.label) ?? 0) > 1
    ? { ...option, label: offsetFormatter.format(new Date(option.value)) } : option);
}

// Slot calculation uses the restaurant's clock, not the browser's zone.
const restaurantClockFormatters = new Map<string, Intl.DateTimeFormat>();
function restaurantClock(date: Date, timezone = "America/Toronto") {
  let formatter = restaurantClockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    restaurantClockFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function restaurantInstant(dateKey: string, minutes: number, timezone?: string): Date | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day) + minutes * 60_000;
  let instant = new Date(desired);
  for (let pass = 0; pass < 3; pass++) {
    const clock = restaurantClock(instant, timezone);
    const projected = Date.parse(`${clock.dateKey}T00:00:00Z`) + clock.minutes * 60_000;
    instant = new Date(instant.getTime() + desired - projected);
  }
  const clock = restaurantClock(instant, timezone);
  // Skip nonexistent local times during a spring DST transition.
  return clock.dateKey === dateKey && clock.minutes === minutes ? instant : null;
}

function buildRestaurantDateOptions(fulfillmentType: FulfillmentType, hours: SchedulingHours | undefined, timezone: string | undefined, now: Date): ScheduleDateOption[] {
  const today = restaurantClock(now, timezone).dateKey;
  const source = getHoursForType(fulfillmentType, hours);
  return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const value = day.toISOString().slice(0, 10);
    return { value, dayOfWeek: day.getUTCDay(), isToday: offset === 0 };
  }).filter(day => source.some(slot => hourTouchesDay(slot, day.dayOfWeek)))
    .map(day => ({ ...day, label: formatDateOptionLabel(restaurantInstant(day.value, 12 * 60, timezone)!, day.isToday, timezone ?? "America/Toronto") }));
}

function buildPickupTimeOptions(params: {
  selectedDateKey: string; hours?: SchedulingHours; timezone?: string; now?: Date; pickupLeadMinutes?: number;
}): ScheduleTimeOption[] {
  const now = params.now ?? new Date();
  const clock = restaurantClock(now, params.timezone);
  const day = new Date(`${params.selectedDateKey}T12:00:00Z`).getUTCDay();
  const segments = getHoursForType("PICKUP", params.hours).flatMap(slot => getWindowSegmentsForDay(slot, day))
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const options: ScheduleTimeOption[] = [];
  if (clock.dateKey === params.selectedDateKey && segments.some(segment => clock.minutes >= segment.startMinutes && clock.minutes < segment.endMinutes)) {
    options.push({ value: "ASAP", label: `ASAP (${PICKUP_ETA_RANGE} min)` });
  }
  const lead = params.pickupLeadMinutes;
  if (typeof lead !== "number" || !Number.isFinite(lead) || lead < 0) return options;
  const earliest = now.getTime() + lead * 60_000;
  const formatter = getTimeFormatter(params.timezone ?? "America/Toronto");
  for (const segment of segments) {
    for (let minutes = segment.startMinutes; minutes <= segment.endMinutes - SLOT_INTERVAL_MINUTES; minutes += SLOT_INTERVAL_MINUTES) {
      const instant = restaurantInstant(params.selectedDateKey, minutes, params.timezone);
      if (!instant || instant.getTime() < earliest) continue;
      const value = instant.toISOString();
      if (!options.some(option => option.value === value)) options.push({ value, label: formatter.format(instant) });
    }
  }
  return options;
}

export function getInitialTimeValue(
  scheduledFor: string | null,
  timeOptions: ScheduleTimeOption[],
): string {
  const committedValue = scheduledFor ?? "ASAP";
  if (timeOptions.some((option) => option.value === committedValue)) {
    return committedValue;
  }
  return timeOptions[0]?.value ?? "ASAP";
}
