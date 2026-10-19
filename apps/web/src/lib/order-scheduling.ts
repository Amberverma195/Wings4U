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

function getDateFormatter(timezone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

function getTimeFormatter(timezone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function roundUpToInterval(totalMinutes: number, intervalMinutes: number): number {
  return Math.ceil(totalMinutes / intervalMinutes) * intervalMinutes;
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

function buildIsoForDateAndMinutes(dateKey: string, totalMinutes: number): string {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
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
  if (startMinutes === endMinutes) return slot.day_of_week === dayOfWeek;
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
  if (startMinutes === endMinutes) {
    return slot.day_of_week === dayOfWeek
      ? [{ startMinutes: 0, endMinutes: 24 * 60 }]
      : [];
  }

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

export function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getSelectedDateKey(scheduledFor: string | null, now = new Date()): string {
  if (!scheduledFor) return getDateKey(now);
  return getDateKey(new Date(scheduledFor));
}

export function formatScheduleDateLabel(
  scheduledFor: string | null,
  timezone?: string,
  now = new Date(),
): string {
  const target = scheduledFor ? new Date(scheduledFor) : now;
  const todayKey = getDateKey(now);
  return formatDateOptionLabel(target, getDateKey(target) === todayKey, timezone);
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
  if (fulfillmentType === "PICKUP") return buildPickupDateOptions(hours, timezone, now);
  const sourceHours = getHoursForType(fulfillmentType, hours);
  const todayKey = getDateKey(now);
  const availableDays = new Set(
    sourceHours.flatMap((slot) =>
      Array.from({ length: 7 }, (_, dayOfWeek) => dayOfWeek).filter((dayOfWeek) =>
        hourTouchesDay(slot, dayOfWeek),
      ),
    ),
  );

  return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
    const date = startOfLocalDay(addDays(now, offset));
    return date;
  })
    .filter((date) => availableDays.size === 0 || availableDays.has(date.getDay()))
    .map((date) => {
      const isToday = getDateKey(date) === todayKey;
      return {
        value: getDateKey(date),
        label: formatDateOptionLabel(date, isToday, timezone),
        dayOfWeek: date.getDay(),
        isToday,
      };
    });
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
  const {
    fulfillmentType,
    selectedDateKey,
    config,
    hours,
    timezone,
    now = new Date(),
  } = params;
  const todayKey = getDateKey(now);
  const timeFormatter = getTimeFormatter(timezone);
  const dayOfWeek = new Date(`${selectedDateKey}T00:00:00`).getDay();
  const sourceHours = getHoursForType(fulfillmentType, hours).filter(
    (slot) => hourTouchesDay(slot, dayOfWeek),
  );
  const timingWindow = getTimingWindow(config, fulfillmentType);
  const options: ScheduleTimeOption[] = [];

  if (selectedDateKey === todayKey) {
    options.push({
      value: "ASAP",
      label: formatEtaLabel(fulfillmentType, config),
    });
  }

  for (const slot of sourceHours) {
    for (const segment of getWindowSegmentsForDay(slot, dayOfWeek)) {
      const { startMinutes, endMinutes } = segment;
      const earliestMinutes =
        selectedDateKey === todayKey
          ? roundUpToInterval(
              now.getHours() * 60 + now.getMinutes() + timingWindow.minMinutes,
              SLOT_INTERVAL_MINUTES,
            )
          : startMinutes;
      const firstSlot = Math.max(startMinutes, earliestMinutes);

      for (
        let totalMinutes = firstSlot;
        totalMinutes <= endMinutes - SLOT_INTERVAL_MINUTES;
        totalMinutes += SLOT_INTERVAL_MINUTES
      ) {
        const isoValue = buildIsoForDateAndMinutes(selectedDateKey, totalMinutes);
        options.push({
          value: isoValue,
          label: timeFormatter.format(new Date(isoValue)),
        });
      }
    }
  }

  return options;
}

// Pickup slot calculation uses the restaurant's clock, not the browser's zone.
const pickupClockFormatters = new Map<string, Intl.DateTimeFormat>();
function pickupClock(date: Date, timezone = "America/Toronto") {
  let formatter = pickupClockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    pickupClockFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function pickupInstant(dateKey: string, minutes: number, timezone?: string): Date | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day) + minutes * 60_000;
  let instant = new Date(desired);
  for (let pass = 0; pass < 3; pass++) {
    const clock = pickupClock(instant, timezone);
    const projected = Date.parse(`${clock.dateKey}T00:00:00Z`) + clock.minutes * 60_000;
    instant = new Date(instant.getTime() + desired - projected);
  }
  const clock = pickupClock(instant, timezone);
  // Skip nonexistent local times during a spring DST transition.
  return clock.dateKey === dateKey && clock.minutes === minutes ? instant : null;
}

function buildPickupDateOptions(hours: SchedulingHours | undefined, timezone: string | undefined, now: Date): ScheduleDateOption[] {
  const today = pickupClock(now, timezone).dateKey;
  const source = getHoursForType("PICKUP", hours);
  return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const value = day.toISOString().slice(0, 10);
    return { value, dayOfWeek: day.getUTCDay(), isToday: offset === 0 };
  }).filter(day => source.some(slot => hourTouchesDay(slot, day.dayOfWeek)))
    .map(day => ({ ...day, label: formatDateOptionLabel(pickupInstant(day.value, 12 * 60, timezone)!, day.isToday, timezone ?? "America/Toronto") }));
}

function buildPickupTimeOptions(params: {
  selectedDateKey: string; hours?: SchedulingHours; timezone?: string; now?: Date; pickupLeadMinutes?: number;
}): ScheduleTimeOption[] {
  const now = params.now ?? new Date();
  const clock = pickupClock(now, params.timezone);
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
      const instant = pickupInstant(params.selectedDateKey, minutes, params.timezone);
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
