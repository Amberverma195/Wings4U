"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import type { LocationServiceHours, MenuResponse } from "@/lib/types";

const DAY_ORDER = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

const FALLBACK_HOURS: LocationServiceHours[] = DAY_ORDER.map(({ day }) => ({
  day_of_week: day,
  time_from: "11:00",
  time_to: day === 5 || day === 6 ? "02:30" : "01:00",
  is_closed: false,
}));

function normalizeHours(
  hours?: LocationServiceHours[] | null,
): LocationServiceHours[] {
  const byDay = new Map<number, LocationServiceHours>();
  if (Array.isArray(hours)) {
    for (const hour of hours) {
      if (
        !hour ||
        !Number.isInteger(hour.day_of_week) ||
        hour.day_of_week < 0 ||
        hour.day_of_week > 6
      ) {
        continue;
      }
      byDay.set(hour.day_of_week, {
        day_of_week: hour.day_of_week,
        time_from: hour.time_from || "11:00",
        time_to: hour.time_to || "01:00",
        is_closed: Boolean(hour.is_closed),
      });
    }
  }

  return DAY_ORDER.map(({ day }) => {
    const fallback = FALLBACK_HOURS.find((hour) => hour.day_of_week === day)!;
    return byDay.get(day) ?? fallback;
  });
}

function formatTime(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;

  const suffix = hour < 12 ? "a.m." : "p.m.";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function FooterStoreHours() {
  const [hours, setHours] =
    useState<LocationServiceHours[]>(FALLBACK_HOURS);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      location_id: DEFAULT_LOCATION_ID,
      fulfillment_type: "PICKUP",
    });

    apiJson<MenuResponse>(`/api/v1/menu?${query.toString()}`, {
      locationId: DEFAULT_LOCATION_ID,
    })
      .then((response) => {
        if (cancelled) return;
        setHours(normalizeHours(response.data?.location.store_hours));
      })
      .catch(() => {
        if (!cancelled) setHours(FALLBACK_HOURS);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <details className="footer-hours-disclosure">
      <summary className="footer-hours-toggle">Store Hours</summary>
      <div className="footer-hours" aria-label="Store hours">
        {hours.map((hour) => {
          const label =
            DAY_ORDER.find((day) => day.day === hour.day_of_week)?.label ??
            "Store";
          return (
            <p key={hour.day_of_week}>
              {label}:{" "}
              {hour.is_closed
                ? "Closed"
                : `${formatTime(hour.time_from)} \u2013 ${formatTime(hour.time_to)}`}
            </p>
          );
        })}
      </div>
    </details>
  );
}
