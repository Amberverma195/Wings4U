import { TZDate } from "@date-fns/tz";
import {
  minutesFromTime,
  operatingWindowDurationMinutes,
  WeeklyOperatingHour,
} from "../shared/weekly-operating-hours";

export const KDS_HOURS_SERVICE_TYPE = "KDS";
export const STORE_HOURS_SERVICE_TYPE = "STORE";
export const KDS_ACTIVE_ORDER_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
] as const;

export type OperatingHour = WeeklyOperatingHour;

export type SerializedOperatingHour = {
  day_of_week: number;
  time_from: string;
  time_to: string;
  is_closed: boolean;
};

export type OperatingWindow = {
  opensAt: Date;
  closesAt: Date;
  dayOfWeek: number;
};

export type OperatingScheduleState = {
  timezone: string;
  isOpen: boolean;
  currentWindow: OperatingWindow | null;
  nextWindow: OperatingWindow | null;
};

export function timeDateToString(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(
    value.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

export function serializeOperatingHours(
  hours: OperatingHour[],
): SerializedOperatingHour[] {
  return hours.map((hour) => ({
    day_of_week: hour.dayOfWeek,
    time_from: timeDateToString(hour.timeFrom),
    time_to: timeDateToString(hour.timeTo),
    is_closed: hour.isClosed,
  }));
}

function createLocalBoundary(
  day: TZDate,
  minuteOfDay: number,
  timezone: string,
): TZDate {
  return TZDate.tz(
    timezone,
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
}

function buildWindows(
  hours: OperatingHour[],
  timezone: string,
  referenceDate: Date,
): OperatingWindow[] {
  const localReference = TZDate.tz(timezone, referenceDate);
  const localAnchor = TZDate.tz(
    timezone,
    localReference.getFullYear(),
    localReference.getMonth(),
    localReference.getDate(),
  );
  const byDay = new Map(hours.map((hour) => [hour.dayOfWeek, hour]));
  const windows: OperatingWindow[] = [];

  for (let offset = -1; offset <= 14; offset += 1) {
    const day = TZDate.tz(timezone, localAnchor);
    day.setDate(day.getDate() + offset);
    const hour = byDay.get(day.getDay());
    if (!hour || hour.isClosed) continue;

    const fromMinutes = minutesFromTime(hour.timeFrom);
    const toMinutes = minutesFromTime(hour.timeTo);
    const opensAt = createLocalBoundary(day, fromMinutes, timezone);
    const closingDay = TZDate.tz(timezone, day);
    if (toMinutes <= fromMinutes) {
      closingDay.setDate(closingDay.getDate() + 1);
    }
    const closesAt = createLocalBoundary(closingDay, toMinutes, timezone);
    windows.push({
      opensAt: new Date(opensAt.getTime()),
      closesAt: new Date(closesAt.getTime()),
      dayOfWeek: hour.dayOfWeek,
    });
  }

  return windows.sort((left, right) => left.opensAt.getTime() - right.opensAt.getTime());
}

export function evaluateOperatingSchedule(
  hours: OperatingHour[],
  timezone: string,
  referenceDate = new Date(),
): OperatingScheduleState {
  const windows = buildWindows(hours, timezone, referenceDate);
  const now = referenceDate.getTime();
  const currentWindow =
    windows.find(
      (window) =>
        window.opensAt.getTime() <= now && now < window.closesAt.getTime(),
    ) ?? null;
  const nextWindow =
    windows.find((window) => window.opensAt.getTime() > now) ?? null;

  return {
    timezone,
    isOpen: currentWindow !== null,
    currentWindow,
    nextWindow,
  };
}

type MinuteInterval = { start: number; end: number };

function toWeeklyIntervals(hours: OperatingHour[]): MinuteInterval[] {
  return hours
    .filter((hour) => !hour.isClosed)
    .map((hour) => {
      const start = hour.dayOfWeek * 1_440 + minutesFromTime(hour.timeFrom);
      const duration = operatingWindowDurationMinutes(hour);
      return { start, end: start + duration };
    });
}

export function isScheduleCovered(
  requiredHours: OperatingHour[],
  coveringHours: OperatingHour[],
): boolean {
  const required = toWeeklyIntervals(requiredHours);
  const coveringBase = toWeeklyIntervals(coveringHours);
  const week = 7 * 1_440;
  const covering = [-week, 0, week]
    .flatMap((shift) =>
      coveringBase.map((interval) => ({
        start: interval.start + shift,
        end: interval.end + shift,
      })),
    )
    .sort((left, right) => left.start - right.start);

  return required.every((interval) => {
    let cursor = interval.start;
    for (const candidate of covering) {
      if (candidate.end <= cursor || candidate.start > cursor) continue;
      cursor = Math.max(cursor, candidate.end);
      if (cursor >= interval.end) return true;
    }
    return false;
  });
}

export function serializeScheduleState(
  state: OperatingScheduleState,
  hours: OperatingHour[],
) {
  return {
    timezone: state.timezone,
    is_open: state.isOpen,
    current_window: state.currentWindow
      ? {
          opens_at: state.currentWindow.opensAt.toISOString(),
          closes_at: state.currentWindow.closesAt.toISOString(),
        }
      : null,
    next_open_at: state.nextWindow?.opensAt.toISOString() ?? null,
    hours: serializeOperatingHours(hours),
  };
}
