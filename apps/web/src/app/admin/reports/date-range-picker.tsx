"use client";

import { useEffect, useState } from "react";

export type DateRange = {
  start: string;
  end: string;
};

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "custom", label: "Custom" },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: PresetId): DateRange {
  const now = new Date();
  const todayStr = isoDay(now);
  if (preset === "today") return { start: todayStr, end: todayStr };
  const days = preset === "7" ? 6 : 29;
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  return { start: isoDay(start), end: todayStr };
}

export function DateRangePicker({
  value,
  onChange,
  initialPreset = "today",
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  initialPreset?: PresetId;
}) {
  const [preset, setPreset] = useState<PresetId>(initialPreset);

  useEffect(() => {
    if (preset !== "custom") {
      onChange(rangeForPreset(preset));
    }
    // intentionally not depending on onChange (stable parent setter expected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? "btn-primary" : "btn-secondary"}
            style={{ width: "auto", padding: "0.4rem 0.85rem" }}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem" }}>
            From{" "}
            <input
              type="date"
              value={value.start}
              onChange={(e) => onChange({ ...value, start: e.target.value })}
              style={{
                padding: "0.4rem 0.5rem",
                borderRadius: "0.375rem",
                border: "1px solid #d4d4d4",
              }}
            />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            To{" "}
            <input
              type="date"
              value={value.end}
              onChange={(e) => onChange({ ...value, end: e.target.value })}
              style={{
                padding: "0.4rem 0.5rem",
                borderRadius: "0.375rem",
                border: "1px solid #d4d4d4",
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function defaultRange(): DateRange {
  return rangeForPreset("today");
}
