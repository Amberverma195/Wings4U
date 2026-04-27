"use client";

import type { CartItem } from "./types";

export const DEFAULT_LUNCH_TIMEZONE = "America/Toronto";
export const LUNCH_WINDOW_START_MINUTES = 11 * 60;
export const LUNCH_WINDOW_END_MINUTES = 15 * 60;
export const LUNCH_WINDOW_LABEL = "11 AM - 3 PM";
export const LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE =
  "Lunch specials are available 11 AM - 3 PM. Change your scheduled time or remove lunch items from your cart.";

const KNOWN_LUNCH_ITEM_SLUGS = new Set([
  "lunch-5-wings",
  "lunch-3-tender",
  "lunch-6-nuggets",
  "lunch-burger",
  "lunch-wrap",
  "lunch-poutine",
]);

function resolveTimezone(timezone?: string | null): string {
  return timezone?.trim() || DEFAULT_LUNCH_TIMEZONE;
}

function getLocalClockMinutes(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: resolveTimezone(timezone),
  });

  const parts = formatter.formatToParts(date);
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "0",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "0",
    10,
  );

  return hour * 60 + minute;
}

function normalizeSlug(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isLunchSpecialCartItem(item: CartItem): boolean {
  if (item.builder_payload?.builder_type === "LUNCH_SPECIAL") {
    return true;
  }

  const slug = normalizeSlug(item.menu_item_slug);
  if (slug && (KNOWN_LUNCH_ITEM_SLUGS.has(slug) || slug.startsWith("lunch-"))) {
    return true;
  }

  const name = item.name.trim().toLowerCase();
  return name.startsWith("lunch ") || name.includes(" lunch ");
}

export function cartHasLunchSpecialItems(items: CartItem[]): boolean {
  return items.some((item) => isLunchSpecialCartItem(item));
}

export function isScheduledTimeWithinLunchWindow(
  scheduledFor: string | null,
  timezone?: string | null,
  now = new Date(),
): boolean {
  const targetInstant = scheduledFor ? new Date(scheduledFor) : now;
  if (Number.isNaN(targetInstant.getTime())) {
    return true;
  }

  const localClockMinutes = getLocalClockMinutes(
    targetInstant,
    resolveTimezone(timezone),
  );
  return (
    localClockMinutes >= LUNCH_WINDOW_START_MINUTES &&
    localClockMinutes < LUNCH_WINDOW_END_MINUTES
  );
}

export function getLunchScheduleConflict(params: {
  items: CartItem[];
  scheduledFor: string | null;
  timezone?: string | null;
  now?: Date;
}): { affectedItems: CartItem[]; message: string } | null {
  const { items, scheduledFor, timezone, now } = params;
  const affectedItems = items.filter((item) => isLunchSpecialCartItem(item));

  if (affectedItems.length === 0) {
    return null;
  }

  if (isScheduledTimeWithinLunchWindow(scheduledFor, timezone, now)) {
    return null;
  }

  return {
    affectedItems,
    message: LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE,
  };
}
