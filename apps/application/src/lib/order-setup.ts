import { normalizeAddressText, normalizeCanadianPostalCode } from './delivery-address';
import type { FulfillmentType, LocationInfo, LocationServiceHours } from './types';

export const ORDER_SETUP_TTL_MS = 15 * 60 * 1000;
export const DELIVERY_CITY = 'London';
export type DeliveryAddress = { line1: string; city: string; postal_code: string };
export type OrderSetupSelection = {
  fulfillmentType: FulfillmentType;
  scheduledFor: string | null;
  deliveryAddress: DeliveryAddress | null;
};
export type StoredOrderSetup = OrderSetupSelection & { v: 1; lastActiveAt: number };

export function normalizeDeliveryAddress(line1: string, postalCode: string): DeliveryAddress {
  return { line1: normalizeAddressText(line1), city: DELIVERY_CITY, postal_code: normalizeCanadianPostalCode(postalCode) };
}

export function validDeliveryAddress(address: DeliveryAddress | null): boolean {
  return Boolean(address && address.city === DELIVERY_CITY && address.line1.trim() &&
    /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/i.test(address.postal_code));
}

export function readOrderSetup(raw: string | null, now = Date.now()): StoredOrderSetup | null {
  try {
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredOrderSetup;
    if (data.v !== 1 || !Number.isFinite(data.lastActiveAt) || data.lastActiveAt > now ||
      now - data.lastActiveAt >= ORDER_SETUP_TTL_MS ||
      !['PICKUP', 'DELIVERY'].includes(data.fulfillmentType) ||
      (data.deliveryAddress !== null && (typeof data.deliveryAddress !== 'object' ||
        typeof data.deliveryAddress.line1 !== 'string' || typeof data.deliveryAddress.city !== 'string' ||
        typeof data.deliveryAddress.postal_code !== 'string')) ||
      (data.scheduledFor !== null && (typeof data.scheduledFor !== 'string' ||
        !Number.isFinite(Date.parse(data.scheduledFor)) || Date.parse(data.scheduledFor) <= now)) ||
      (data.fulfillmentType === 'DELIVERY' && !validDeliveryAddress(data.deliveryAddress))) return null;
    return data;
  } catch { return null; }
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  const key = `${part('year')}-${part('month')}-${part('day')}`;
  return { key, minutes: Number(part('hour')) * 60 + Number(part('minute')),
    weekday: new Date(`${key}T12:00:00Z`).getUTCDay() };
}

function withinHours(hours: LocationServiceHours[], weekday: number, minutes: number) {
  return hours.some(h => {
    if (h.is_closed) return false;
    const toMinutes = (time: string) => { const [hh, mm] = time.split(':').map(Number); return hh * 60 + mm; };
    const start = toMinutes(h.time_from), end = toMinutes(h.time_to);
    if (start === end) return weekday === h.day_of_week;
    if (start < end) return weekday === h.day_of_week && minutes >= start && minutes < end;
    return (weekday === h.day_of_week && minutes >= start) ||
      (weekday === (h.day_of_week + 1) % 7 && minutes < end);
  });
}

export function serviceAvailable(location: LocationInfo, type: FulfillmentType, date: Date) {
  const local = localParts(date, location.timezone);
  const hours = type === 'PICKUP' ? location.pickup_hours : location.delivery_hours;
  const storeHours = location.store_hours ?? [];
  const effectiveHours = hours.length ? hours : storeHours;
  // Missing hours are never presented as bookable times.
  if (!effectiveHours.length || !withinHours(effectiveHours, local.weekday, local.minutes) ||
    (storeHours.length && !withinHours(storeHours, local.weekday, local.minutes))) return false;
  if (type === 'PICKUP') return true;
  if (location.delivery_disabled || location.delivery_blocked_due_to_no_shows) return false;
  const start = location.delivery_available_from_minutes, end = location.delivery_available_until_minutes;
  if (start == null || end == null || start === end) return true;
  return start < end ? local.minutes >= start && local.minutes < end : local.minutes >= start || local.minutes < end;
}

export function leadMinutes(location: LocationInfo, type: FulfillmentType) {
  const configured = type === 'PICKUP' ? location.pickup_min_minutes : location.delivery_min_minutes;
  return Math.max(15, configured || 15, location.estimated_prep_minutes || 0);
}

export type OrderSlot = { value: string; label: string; dateKey: string; dateLabel: string };

/** Iterate real instants so store-local times stay correct across DST and device timezones. */
export function buildOrderSlots(location: LocationInfo, type: FulfillmentType, now = Date.now()): OrderSlot[] {
  const interval = 15 * 60 * 1000;
  const start = Math.ceil((now + leadMinutes(location, type) * 60 * 1000) / interval) * interval;
  const end = now + 7 * 24 * 60 * 60 * 1000;
  const today = localParts(new Date(now), location.timezone).key;
  const lastDay = new Date(`${today}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  const lastDateKey = lastDay.toISOString().slice(0, 10);
  const timeFormat = new Intl.DateTimeFormat('en-CA', { timeZone: location.timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: location.timezone, weekday: 'short', month: 'short', day: 'numeric' });
  const slots: OrderSlot[] = [];
  for (let ms = start; ms < end; ms += interval) {
    const date = new Date(ms);
    if (!serviceAvailable(location, type, date)) continue;
    const key = localParts(date, location.timezone).key;
    if (key > lastDateKey) break;
    slots.push({ value: date.toISOString(), label: timeFormat.format(date), dateKey: key,
      dateLabel: key === today ? 'Today' : dateFormat.format(date) });
  }
  return slots;
}

export function orderTimingLabel(scheduledFor: string | null, timezone: string) {
  return scheduledFor ? new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(scheduledFor)) : 'ASAP';
}
