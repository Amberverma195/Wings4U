export type WeeklyOperatingHour = {
  dayOfWeek: number;
  timeFrom: Date;
  timeTo: Date;
  isClosed: boolean;
};

export type WeeklyScheduleContext = {
  dow: number;
  hhmm: number;
};

export function minutesFromTime(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

export function operatingWindowDurationMinutes(
  hour: Pick<WeeklyOperatingHour, "timeFrom" | "timeTo">,
): number {
  const fromMinutes = minutesFromTime(new Date(hour.timeFrom));
  const toMinutes = minutesFromTime(new Date(hour.timeTo));
  return toMinutes > fromMinutes
    ? toMinutes - fromMinutes
    : 1_440 - fromMinutes + toMinutes;
}

export function isOperatingHourOpenAt(
  hour: WeeklyOperatingHour,
  context: WeeklyScheduleContext,
): boolean {
  if (hour.isClosed) return false;

  const fromMinutes = minutesFromTime(new Date(hour.timeFrom));
  const duration = operatingWindowDurationMinutes(hour);
  const startOfWeek = hour.dayOfWeek * 1_440 + fromMinutes;
  const currentMinute = context.dow * 1_440 + context.hhmm;
  const week = 7 * 1_440;

  return [-week, 0, week].some((shift) => {
    const shiftedStart = startOfWeek + shift;
    return (
      shiftedStart <= currentMinute &&
      currentMinute < shiftedStart + duration
    );
  });
}
