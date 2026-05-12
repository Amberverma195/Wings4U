"use client";

import type { FulfillmentType, LocationServiceHours } from "./types";

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

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  pickup: { minMinutes: 30, maxMinutes: 40 },
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

  const pickup = isTimingWindow(value.pickup)
    ? value.pickup
    : DEFAULT_SCHEDULING_CONFIG.pickup;
  const delivery = isTimingWindow(value.delivery)
    ? value.delivery
    : DEFAULT_SCHEDULING_CONFIG.delivery;

  return { pickup, delivery };
}

export function getTimingWindow(
  config: SchedulingConfig,
  fulfillmentType: FulfillmentType,
): TimingWindow {
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
}): ScheduleTimeOption[] {
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
