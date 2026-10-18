import type { PromoCode } from '@prisma/client';

type PromoSchedule = Pick<PromoCode, 'isActive' | 'archivedAt' | 'startsAt' | 'endsAt' | 'validTimeFrom' | 'validTimeTo'> & {
  validDays: Array<{ dayOfWeek: number }>;
};

export const PROMO_SCHEDULE_MESSAGE = 'This coupon is not available right now. Please check its valid days and hours.';
export const DELIVERY_CAP_MESSAGE = 'This coupon cannot cover the delivery fee for this order.';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeOfDay = (date: Date) => ((date.getUTCHours() * 60 + date.getUTCMinutes()) * 60 + date.getUTCSeconds()) * 1000 + date.getUTCMilliseconds();

/** Actual server evaluation time, expressed in the ordering restaurant's zone.
 * PostgreSQL TIME values store nominal wall time; their Date UTC fields are not an instant to convert.
 */
export function isPromoScheduledNow(promo: PromoSchedule, now: Date, timezone: string): boolean {
  if (!promo.isActive || promo.archivedAt || (promo.startsAt && now < promo.startsAt) || (promo.endsAt && now > promo.endsAt)) return false;
  const from = promo.validTimeFrom == null ? null : timeOfDay(promo.validTimeFrom);
  const to = promo.validTimeTo == null ? null : timeOfDay(promo.validTimeTo);
  // Coupon overnight/equal-time and incomplete-window semantics are undocumented.
  // Do not authorize a benefit by guessing which day's restriction applies.
  if ((from === null) !== (to === null) || (from !== null && to !== null && (!Number.isFinite(from) || !Number.isFinite(to) || from >= to))) return false;
  if (!promo.validDays.length && from === null) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
    const day = WEEKDAYS.indexOf(value('weekday'));
    if (promo.validDays.length && !promo.validDays.some(row => row.dayOfWeek === day)) return false;
    const localTime = ((Number(value('hour')) * 60 + Number(value('minute'))) * 60 + Number(value('second'))) * 1000 + now.getUTCMilliseconds();
    // Opening inclusive, closing exclusive, as in the existing restaurant-hours checks.
    return from === null || (localTime >= from && localTime < to!);
  } catch {
    // Invalid stored zones/configuration cannot grant a scheduled promotion or leak technical errors.
    return false;
  }
}

export function canWaiveDelivery(feeCents: number, maxDiscountCents: number | null): boolean {
  return feeCents > 0 && (maxDiscountCents == null || maxDiscountCents >= feeCents);
}
