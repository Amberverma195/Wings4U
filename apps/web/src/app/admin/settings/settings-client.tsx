"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { Copy } from "lucide-react";

type Settings = {
  timezone: string;
  taxRateBps: number;
  taxDeliveryFee: boolean;
  taxTip: boolean;
  discountsReduceTaxableBase: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number | null;
  minimumDeliverySubtotalCents: number;
  deliveryDisabled: boolean;
  deliveryAvailableFromMinutes: number | null;
  deliveryAvailableUntilMinutes: number | null;
  defaultPrepTimeMinutes: number;
  busyModeEnabled: boolean;
  busyModePrepTimeMinutes: number | null;
  firstOrderDiscountEnabled: boolean;
  defaultPromoStackable: boolean;
  prepaymentThresholdNoShows: number;
  kdsAutoAcceptSeconds: number;
  deliveryPinExpiryMinutes: number;
  managerCreditLimitCents: number | null;
  defaultPickupMinMinutes: number;
  defaultPickupMaxMinutes: number;
  defaultDeliveryMinMinutes: number;
  defaultDeliveryMaxMinutes: number;
  overdueDeliveryGraceMinutes: number;
  trustedIpRanges: string[];
  kdsPasswordConfigured?: boolean;
  storeHours: StoreHour[];
  kdsHours: StoreHour[];
};

type StoreHour = {
  day_of_week: number;
  time_from: string;
  time_to: string;
  is_closed: boolean;
};

type FieldDef = {
  key: keyof Settings;
  label: string;
  group: string;
  kind: "number" | "boolean" | "cents" | "nullable-int" | "time-minutes";
  /** Extra hint for money fields shown in dollars while API/DB use cents */
  description?: string;
  trueLabel?: string;
  falseLabel?: string;
};

const FIELDS: FieldDef[] = [
  { key: "taxRateBps", label: "Tax rate (bps)", group: "Tax", kind: "number" },
  { key: "taxDeliveryFee", label: "Tax delivery fee", group: "Tax", kind: "boolean" },
  { key: "taxTip", label: "Tax tip", group: "Tax", kind: "boolean" },
  {
    key: "discountsReduceTaxableBase",
    label: "Discounts reduce taxable base",
    group: "Tax",
    kind: "boolean",
  },
  {
    key: "deliveryFeeCents",
    label: "Delivery fee",
    group: "Delivery",
    kind: "cents",
    description: "Flat delivery fee in dollars (e.g. 3.50).",
  },
  {
    key: "freeDeliveryThresholdCents",
    label: "Free delivery threshold",
    group: "Delivery",
    kind: "nullable-int",
    description: "Subtotal in cents at which delivery fee is waived. Blank to disable.",
  },
  {
    key: "minimumDeliverySubtotalCents",
    label: "Minimum delivery subtotal",
    group: "Delivery",
    kind: "cents",
    description:
      "Minimum cart subtotal for delivery, in dollars (e.g. 20 for $20). Pickup is not affected.",
  },
  {
    key: "defaultDeliveryMinMinutes",
    label: "Delivery ETA min (min)",
    group: "Delivery",
    kind: "number",
  },
  {
    key: "defaultDeliveryMaxMinutes",
    label: "Delivery ETA max (min)",
    group: "Delivery",
    kind: "number",
  },
  {
    key: "overdueDeliveryGraceMinutes",
    label: "Overdue grace (min)",
    group: "Delivery",
    kind: "number",
  },
  {
    key: "deliveryDisabled",
    label: "Delivery availability",
    group: "Delivery",
    kind: "boolean",
    trueLabel: "Disabled",
    falseLabel: "Enabled",
    description: "Turns off delivery for customers and POS phone orders until re-enabled.",
  },
  {
    key: "deliveryAvailableFromMinutes",
    label: "Delivery starts at",
    group: "Delivery",
    kind: "time-minutes",
    description: "Leave both delivery time fields blank to allow delivery all day.",
  },
  {
    key: "deliveryAvailableUntilMinutes",
    label: "Delivery ends at",
    group: "Delivery",
    kind: "time-minutes",
    description: "At this exact time, delivery becomes unavailable.",
  },
  {
    key: "defaultPickupMinMinutes",
    label: "Pickup ETA min (min)",
    group: "Pickup",
    kind: "number",
  },
  {
    key: "defaultPickupMaxMinutes",
    label: "Pickup ETA max (min)",
    group: "Pickup",
    kind: "number",
  },
  {
    key: "defaultPrepTimeMinutes",
    label: "Default prep time (min)",
    group: "Kitchen",
    kind: "number",
  },
  {
    key: "busyModeEnabled",
    label: "Busy mode enabled",
    group: "Kitchen",
    kind: "boolean",
  },
  {
    key: "busyModePrepTimeMinutes",
    label: "Busy mode prep time (min)",
    group: "Kitchen",
    kind: "nullable-int",
  },
  {
    key: "kdsAutoAcceptSeconds",
    label: "KDS auto-accept (sec)",
    group: "Kitchen",
    kind: "number",
  },
  {
    key: "firstOrderDiscountEnabled",
    label: "First-order discount enabled",
    group: "Promotions",
    kind: "boolean",
  },
  {
    key: "defaultPromoStackable",
    label: "Promos stack by default",
    group: "Promotions",
    kind: "boolean",
  },
  {
    key: "prepaymentThresholdNoShows",
    label: "Prepayment after N no-shows",
    group: "Risk",
    kind: "number",
  },
  {
    key: "managerCreditLimitCents",
    label: "Manager credit limit",
    group: "Risk",
    kind: "nullable-int",
    description: "Per-credit cap a manager can issue without admin (cents). Blank for no cap.",
  },
];

const GROUPS = [
  "Tax",
  "Delivery",
  "Store Hours",
  "KDS Hours",
  "Pickup",
  "Kitchen",
  "Promotions",
  "Risk",
];

const STORE_HOUR_DAYS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

const DEFAULT_STORE_HOURS: StoreHour[] = STORE_HOUR_DAYS.map(({ day }) => ({
  day_of_week: day,
  time_from: "11:00",
  time_to: day === 5 || day === 6 ? "02:30" : "01:00",
  is_closed: false,
}));

function normalizeStoreHours(hours?: StoreHour[] | null): StoreHour[] {
  const byDay = new Map<number, StoreHour>();
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
        time_from: typeof hour.time_from === "string" ? hour.time_from : "11:00",
        time_to: typeof hour.time_to === "string" ? hour.time_to : "01:00",
        is_closed: Boolean(hour.is_closed),
      });
    }
  }

  return STORE_HOUR_DAYS.map(({ day }) => {
    const fallback = DEFAULT_STORE_HOURS.find((hour) => hour.day_of_week === day)!;
    return byDay.get(day) ?? { ...fallback };
  });
}

function storeHoursEqual(a?: StoreHour[] | null, b?: StoreHour[] | null): boolean {
  const left = normalizeStoreHours(a);
  const right = normalizeStoreHours(b);
  return left.every((hour, index) => {
    const other = right[index];
    return (
      other &&
      hour.day_of_week === other.day_of_week &&
      hour.time_from === other.time_from &&
      hour.time_to === other.time_to &&
      hour.is_closed === other.is_closed
    );
  });
}

function updateStoreHour(
  rows: StoreHour[],
  dayOfWeek: number,
  patch: Partial<StoreHour>,
): StoreHour[] {
  return rows.map((row) =>
    row.day_of_week === dayOfWeek ? { ...row, ...patch } : row,
  );
}

function formatHourInput(value: string): string {
  const [rawHour, rawMinute] = value.split(":").map(Number);
  if (!Number.isInteger(rawHour) || !Number.isInteger(rawMinute)) return value;
  const suffix = rawHour >= 12 ? "PM" : "AM";
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(rawMinute).padStart(2, "0")} ${suffix}`;
}

function HoursEditor({
  title,
  description,
  hours,
  disabled,
  onChange,
  onCopy,
}: {
  title: string;
  description: string;
  hours: StoreHour[];
  disabled: boolean;
  onChange: (dayOfWeek: number, patch: Partial<StoreHour>) => void;
  onCopy?: () => void;
}) {
  return (
    <section className="surface-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h2>
        {onCopy ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={onCopy}
            disabled={disabled}
            title="Copy Store Hours"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            <Copy size={16} aria-hidden="true" />
            Copy Store Hours
          </button>
        ) : null}
      </div>
      <p className="surface-muted" style={{ marginTop: "0.45rem", marginBottom: "0.9rem" }}>
        {description}
      </p>
      <div style={{ display: "grid", gap: "0.7rem" }}>
        {hours.map((row) => {
          const dayLabel =
            STORE_HOUR_DAYS.find((day) => day.day === row.day_of_week)?.label ?? "Day";
          const nextDay = !row.is_closed && row.time_to < row.time_from;
          const fullDay = !row.is_closed && row.time_to === row.time_from;
          const nextDayLabel =
            STORE_HOUR_DAYS.find(
              (day) => day.day === (row.day_of_week + 1) % 7,
            )?.label ?? "next day";
          const scheduleSummary = row.is_closed
            ? `${dayLabel}: Closed`
            : fullDay
              ? `${dayLabel}: Open 24 hours from ${formatHourInput(row.time_from)}`
              : `${dayLabel}: ${formatHourInput(row.time_from)} to ${
                  nextDay ? `${nextDayLabel} ` : ""
                }${formatHourInput(row.time_to)}`;
          return (
            <div
              key={row.day_of_week}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(110px, 1fr) minmax(120px, 160px) minmax(120px, 160px) minmax(100px, auto)",
                gap: "0.7rem",
                alignItems: "center",
              }}
            >
              <div>
                <strong style={{ fontSize: "0.9rem" }}>{dayLabel}</strong>
                <span
                  className="surface-muted"
                  style={{ display: "block", fontSize: "0.72rem" }}
                >
                  {scheduleSummary}
                </span>
              </div>
              <label style={{ fontSize: "0.8rem" }}>
                <span className="surface-muted">Open</span>
                <input
                  type="time"
                  step="60"
                  value={row.time_from}
                  disabled={disabled || row.is_closed}
                  onChange={(event) =>
                    onChange(row.day_of_week, { time_from: event.target.value })
                  }
                  style={{
                    display: "block",
                    marginTop: "0.25rem",
                    padding: "0.4rem 0.5rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #d4d4d4",
                    width: "100%",
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label style={{ fontSize: "0.8rem" }}>
                <span className="surface-muted">Close</span>
                <input
                  type="time"
                  step="60"
                  value={row.time_to}
                  disabled={disabled || row.is_closed}
                  onChange={(event) =>
                    onChange(row.day_of_week, { time_to: event.target.value })
                  }
                  style={{
                    display: "block",
                    marginTop: "0.25rem",
                    padding: "0.4rem 0.5rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #d4d4d4",
                    width: "100%",
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label
                style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.85rem" }}
              >
                <input
                  type="checkbox"
                  checked={row.is_closed}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(row.day_of_week, { is_closed: event.target.checked })
                  }
                />
                Closed
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function parseValue(raw: string, kind: FieldDef["kind"]): unknown {
  if (kind === "boolean") return raw === "true";
  if (kind === "time-minutes") {
    const t = raw.trim();
    if (t === "") return null;
    const [hourText, minuteText] = t.split(":");
    const hour = Number.parseInt(hourText ?? "", 10);
    const minute = Number.parseInt(minuteText ?? "", 10);
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return hour * 60 + minute;
  }
  if (kind === "nullable-int") {
    const t = raw.trim();
    if (t === "") return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "cents") {
    const t = raw.trim();
    if (t === "") return 0;
    const x = Number.parseFloat(t.replace(/[$,]/g, ""));
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.round(x * 100);
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function valueToInput(value: unknown, kind: FieldDef["kind"]): string {
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "time-minutes") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    const minutes = Math.max(0, Math.min(1439, Math.floor(value)));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (kind === "cents") {
    if (value == null) return "";
    const cents =
      typeof value === "number" && Number.isFinite(value) ? value : 0;
    return (cents / 100).toFixed(2);
  }
  if (value == null) return "";
  return String(value);
}

const MAX_ALLOWED_IPS = 3;

function getAllowedIps(settings: Settings | null): string[] {
  if (!settings || !Array.isArray(settings.trustedIpRanges)) return [];
  return settings.trustedIpRanges
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim())
    .slice(0, MAX_ALLOWED_IPS);
}

/** Trim, drop blanks, de-dupe, and cap the draft IP list at MAX_ALLOWED_IPS. */
function cleanAllowedIps(drafts: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const value = draft.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= MAX_ALLOWED_IPS) break;
  }
  return result;
}

function allowedIpsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/** Seed the editor with the configured IPs, or a single blank row when none. */
function toAllowedIpDrafts(ips: string[]): string[] {
  return ips.length > 0 ? [...ips] : [""];
}

function isValidAllowedIp(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.toLowerCase() === "localhost"
  ) {
    return false;
  }

  const isCidr = normalized.includes("/");
  const isIpv6 =
    !isCidr &&
    normalized.includes(":") &&
    /^[0-9a-fA-F:.]+$/.test(normalized) &&
    normalized.split("::").length <= 2 &&
    normalized
      .split(":")
      .filter(Boolean)
      .every((part) => /^[0-9a-fA-F]{1,4}$/.test(part));
  if (isIpv6) return true;

  const [baseIp, prefixText] = normalized.split("/");
  const parts = baseIp.split(".");
  if (parts.length !== 4) return false;

  const isValidIpv4 = parts.every((part) => {
    const octet = Number.parseInt(part, 10);
    return Number.isFinite(octet) && octet >= 0 && octet <= 255;
  });

  if (!isValidIpv4) return false;
  if (!isCidr) return true;

  const prefix = Number.parseInt(prefixText ?? "", 10);
  return Number.isFinite(prefix) && prefix >= 0 && prefix <= 32;
}

export function SettingsClient() {
  const session = useSession();
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [storeHoursDraft, setStoreHoursDraft] =
    useState<StoreHour[]>(DEFAULT_STORE_HOURS);
  const [kdsHoursDraft, setKdsHoursDraft] =
    useState<StoreHour[]>(DEFAULT_STORE_HOURS);
  const [allowedIpDrafts, setAllowedIpDrafts] = useState<string[]>(
    toAllowedIpDrafts([]),
  );
  const [editingAllowedIp, setEditingAllowedIp] = useState(false);
  const [kdsPasswordDraft, setKdsPasswordDraft] = useState("");
  const [editingKdsPassword, setEditingKdsPassword] = useState(false);
  const [removingKdsPassword, setRemovingKdsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = session.user?.role === "ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/locations/settings", {
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      const settings = json.data as Settings;
      setData(settings);
      const seeded: Record<string, string> = {};
      for (const f of FIELDS) {
        seeded[f.key] = valueToInput(settings[f.key], f.kind);
      }
      setDraft(seeded);
      setStoreHoursDraft(normalizeStoreHours(settings.storeHours));
      setKdsHoursDraft(normalizeStoreHours(settings.kdsHours ?? settings.storeHours));
      setAllowedIpDrafts(toAllowedIpDrafts(getAllowedIps(settings)));
      setEditingAllowedIp(false);
      setKdsPasswordDraft("");
      setEditingKdsPassword(false);
      setRemovingKdsPassword(false);
      setRemovingKdsPassword(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const cleanedAllowedIps = cleanAllowedIps(allowedIpDrafts);
  const dirty = data
    ? FIELDS.some((f) => valueToInput(data[f.key], f.kind) !== draft[f.key]) ||
      !storeHoursEqual(storeHoursDraft, data.storeHours) ||
      !storeHoursEqual(kdsHoursDraft, data.kdsHours) ||
      !allowedIpsEqual(getAllowedIps(data), cleanedAllowedIps) ||
      (editingKdsPassword && kdsPasswordDraft !== "") ||
      removingKdsPassword
    : false;
  const configuredAllowedIps = getAllowedIps(data);
  const hasAllowedIps = configuredAllowedIps.length > 0;

  const onSave = async () => {
    if (!data) return;
    if (!confirm("Apply these settings now? Some changes take effect immediately.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const normalizedAllowedIps = cleanAllowedIps(allowedIpDrafts);
      if (normalizedAllowedIps.some((ip) => !isValidAllowedIp(ip))) {
        throw new Error(
          "Allowed IP address must be a valid IP address and cannot be localhost.",
        );
      }
      const deliveryFrom = draft.deliveryAvailableFromMinutes?.trim() ?? "";
      const deliveryUntil = draft.deliveryAvailableUntilMinutes?.trim() ?? "";
      if ((deliveryFrom === "") !== (deliveryUntil === "")) {
        throw new Error(
          "Set both delivery start and end times, or leave both blank.",
        );
      }
      for (const row of storeHoursDraft) {
        if (!row.is_closed && (!row.time_from || !row.time_to)) {
          const dayLabel =
            STORE_HOUR_DAYS.find((day) => day.day === row.day_of_week)?.label ??
            "Store";
          throw new Error(`${dayLabel} needs both an open and close time.`);
        }
      }
      for (const row of kdsHoursDraft) {
        if (!row.is_closed && (!row.time_from || !row.time_to)) {
          const dayLabel =
            STORE_HOUR_DAYS.find((day) => day.day === row.day_of_week)?.label ??
            "KDS";
          throw new Error(`${dayLabel} KDS hours need both an open and close time.`);
        }
      }

      const payload: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const before = valueToInput(data[f.key], f.kind);
        const after = draft[f.key];
        if (before !== after) {
          payload[f.key] = parseValue(after, f.kind);
        }
      }
      if (!allowedIpsEqual(getAllowedIps(data), normalizedAllowedIps)) {
        payload.trustedIpRanges = normalizedAllowedIps;
      }
      if (!storeHoursEqual(storeHoursDraft, data.storeHours)) {
        payload.storeHours = storeHoursDraft;
      }
      if (!storeHoursEqual(kdsHoursDraft, data.kdsHours)) {
        payload.kdsHours = kdsHoursDraft;
      }
      if (editingKdsPassword && kdsPasswordDraft.length > 0 && !/^\d{8}$/.test(kdsPasswordDraft)) {
        throw new Error("KDS and POS password must be exactly 8 digits.");
      }
      if (editingKdsPassword && kdsPasswordDraft.length > 0) {
        payload.kdsPassword = kdsPasswordDraft;
      }
      if (removingKdsPassword) {
        payload.kdsPassword = "";
      }
      if (Object.keys(payload).length === 0) {
        setSaving(false);
        return;
      }
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/locations/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Save failed (${res.status})`,
        );
      }
      toast.success("Settings saved", {
        description: "Store settings were updated for this location.",
      });
      const settings = json.data as Settings;
      setData(settings);
      const seeded: Record<string, string> = {};
      for (const f of FIELDS) {
        seeded[f.key] = valueToInput(settings[f.key], f.kind);
      }
      setDraft(seeded);
      setStoreHoursDraft(normalizeStoreHours(settings.storeHours));
      setKdsHoursDraft(normalizeStoreHours(settings.kdsHours ?? settings.storeHours));
      setAllowedIpDrafts(toAllowedIpDrafts(getAllowedIps(settings)));
      setEditingAllowedIp(false);
      setKdsPasswordDraft("");
      setEditingKdsPassword(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setError(message);
      toast.error("Could not save settings", { description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>

        <h1 style={{ margin: "0.2rem 0 0" }}>Store settings</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0" }}>
          Operational thresholds and toggles for this location.
          {!isAdmin && session.loaded && (
            <>
              {" "}
              Read-only — only admins can apply changes.
            </>
          )}
        </p>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {!data && loading ? (
        <p className="surface-muted">Loading settings…</p>
      ) : data ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          {GROUPS.map((group) => {
            if (group === "Store Hours" || group === "KDS Hours") {
              const isKds = group === "KDS Hours";
              return (
                <HoursEditor
                  key={group}
                  title={isKds ? "KDS Operating Hours" : "Store Hours"}
                  description={
                    isKds
                      ? `The kitchen display connects only during these hours in ${data.timezone}. KDS Hours must cover Store Hours.`
                      : `These customer-facing hours use ${data.timezone} and can cross midnight.`
                  }
                  hours={isKds ? kdsHoursDraft : storeHoursDraft}
                  disabled={!isAdmin}
                  onCopy={
                    isKds
                      ? () => setKdsHoursDraft(storeHoursDraft.map((row) => ({ ...row })))
                      : undefined
                  }
                  onChange={(dayOfWeek, patch) => {
                    if (isKds) {
                      setKdsHoursDraft((previous) =>
                        updateStoreHour(previous, dayOfWeek, patch),
                      );
                    } else {
                      setStoreHoursDraft((previous) =>
                        updateStoreHour(previous, dayOfWeek, patch),
                      );
                    }
                  }}
                />
              );
            }

            return (
              <section
                key={group}
                className="surface-card"
                style={{ padding: "1rem", marginBottom: "1rem" }}
              >
                <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{group}</h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  {FIELDS.filter((f) => f.group === group).map((f) => (
                    <label key={f.key} style={{ display: "block", fontSize: "0.85rem" }}>
                      <span style={{ fontWeight: 600 }}>{f.label}</span>
                      {f.kind === "boolean" ? (
                        <select
                          value={draft[f.key] ?? "false"}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                          disabled={!isAdmin}
                          style={{
                            display: "block",
                            marginTop: "0.25rem",
                            padding: "0.4rem 0.5rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #d4d4d4",
                            width: "100%",
                            fontFamily: "inherit",
                          }}
                        >
                          {f.key === "deliveryDisabled" ? (
                            <>
                              <option value="false">{f.falseLabel ?? "Enabled"}</option>
                              <option value="true">{f.trueLabel ?? "Disabled"}</option>
                            </>
                          ) : (
                            <>
                              <option value="true">{f.trueLabel ?? "Enabled"}</option>
                              <option value="false">{f.falseLabel ?? "Disabled"}</option>
                            </>
                          )}
                        </select>
                      ) : (
                        <input
                          type={f.kind === "time-minutes" ? "time" : "number"}
                          step={
                            f.kind === "time-minutes"
                              ? "60"
                              : f.kind === "cents"
                                ? "0.01"
                                : "1"
                          }
                          min={f.kind === "cents" ? "0" : undefined}
                          value={draft[f.key] ?? ""}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                          disabled={!isAdmin}
                          style={{
                            display: "block",
                            marginTop: "0.25rem",
                            padding: "0.4rem 0.5rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #d4d4d4",
                            width: "100%",
                            fontFamily: "inherit",
                          }}
                        />
                      )}
                      {f.description && (
                        <span
                          className="surface-muted"
                          style={{ display: "block", fontSize: "0.75rem", marginTop: "0.2rem" }}
                        >
                          {f.description}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}

          <section
            className="surface-card"
            style={{ padding: "1rem", marginBottom: "1rem" }}
          >
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              KDS and POS Password
            </h2>
            <p
              className="surface-muted"
              style={{ marginTop: 0, marginBottom: "0.9rem" }}
            >
              Configure an 8-digit password used for both the Kitchen Display System and the POS register. Changes apply and revoke current KDS and POS station sessions when you save the page.
            </p>

            {!editingKdsPassword && !data.kdsPasswordConfigured ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!isAdmin}
                style={{ width: "auto" }}
                onClick={() => {
                  setRemovingKdsPassword(false);
                  setEditingKdsPassword(true);
                }}
              >
                Set KDS and POS password
              </button>
            ) : null}

            {editingKdsPassword ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px, 420px)",
                  gap: "0.75rem",
                }}
              >
                <label style={{ display: "block", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600 }}>8-Digit Password</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={kdsPasswordDraft}
                    onChange={(e) => setKdsPasswordDraft(e.target.value.replace(/\D/g, ""))}
                    disabled={!isAdmin}
                    placeholder="e.g. 12345678"
                    style={{
                      display: "block",
                      marginTop: "0.25rem",
                      padding: "0.4rem 0.5rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #d4d4d4",
                      width: "100%",
                      fontFamily: "inherit",
                    }}
                  />
                </label>

                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => setEditingKdsPassword(false)}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setKdsPasswordDraft("");
                      setEditingKdsPassword(false);
                      setRemovingKdsPassword(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : removingKdsPassword ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Current status
                  </div>
                  <code
                    style={{
                      display: "inline-block",
                      marginTop: "0.25rem",
                      padding: "0.3rem 0.45rem",
                      borderRadius: "0.35rem",
                      background: "#fff7ed",
                      color: "#9a3412",
                    }}
                  >
                    Will be removed on save
                  </code>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!isAdmin}
                  style={{ width: "auto" }}
                  onClick={() => setRemovingKdsPassword(false)}
                >
                  Undo
                </button>
              </div>
            ) : data.kdsPasswordConfigured ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Current status
                  </div>
                  <code
                    style={{
                      display: "inline-block",
                      marginTop: "0.25rem",
                      padding: "0.3rem 0.45rem",
                      borderRadius: "0.35rem",
                      background: "#e8f5e9",
                      color: "#1b5e20"
                    }}
                  >
                    Configured
                  </code>
                </div>

                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setRemovingKdsPassword(false);
                      setEditingKdsPassword(true);
                    }}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setKdsPasswordDraft("");
                      setEditingKdsPassword(false);
                      setRemovingKdsPassword(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section
            className="surface-card"
            style={{ padding: "1rem", marginBottom: "1rem" }}
          >
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              Allowed IP address
            </h2>
            <p
              className="surface-muted"
              style={{ marginTop: 0, marginBottom: "0.9rem" }}
            >
              Store up to {MAX_ALLOWED_IPS} station IPs here. Localhost is never
              allowed. Changes apply when you save the page.
            </p>

            {!editingAllowedIp && !hasAllowedIps ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!isAdmin}
                style={{ width: "auto" }}
                onClick={() => {
                  setAllowedIpDrafts(toAllowedIpDrafts(configuredAllowedIps));
                  setEditingAllowedIp(true);
                }}
              >
                Add allowed IP
              </button>
            ) : null}

            {editingAllowedIp ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px, 420px)",
                  gap: "0.75rem",
                }}
              >
                {allowedIpDrafts.map((ipDraft, index) => (
                  <label
                    key={index}
                    style={{ display: "block", fontSize: "0.85rem" }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      IP address {index + 1}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        marginTop: "0.25rem",
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        value={ipDraft}
                        onChange={(e) =>
                          setAllowedIpDrafts((current) =>
                            current.map((value, i) =>
                              i === index ? e.target.value : value,
                            ),
                          )
                        }
                        disabled={!isAdmin}
                        placeholder="e.g. 192.168.1.24"
                        style={{
                          flex: 1,
                          padding: "0.4rem 0.5rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #d4d4d4",
                          fontFamily: "inherit",
                        }}
                      />
                      {allowedIpDrafts.length > 1 ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={!isAdmin}
                          aria-label={`Remove IP address ${index + 1}`}
                          style={{ width: "auto" }}
                          onClick={() =>
                            setAllowedIpDrafts((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </label>
                ))}

                {allowedIpDrafts.length < MAX_ALLOWED_IPS ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto", justifySelf: "start" }}
                    onClick={() =>
                      setAllowedIpDrafts((current) => [...current, ""])
                    }
                  >
                    + Add another IP
                  </button>
                ) : null}

                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => setEditingAllowedIp(false)}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setAllowedIpDrafts(
                        toAllowedIpDrafts(configuredAllowedIps),
                      );
                      setEditingAllowedIp(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : hasAllowedIps ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    {configuredAllowedIps.length > 1
                      ? "Current IPs"
                      : "Current IP"}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.4rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    {configuredAllowedIps.map((ip) => (
                      <code
                        key={ip}
                        style={{
                          display: "inline-block",
                          padding: "0.3rem 0.45rem",
                          borderRadius: "0.35rem",
                          background: "#f6f3ee",
                        }}
                      >
                        {ip}
                      </code>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setAllowedIpDrafts(toAllowedIpDrafts(configuredAllowedIps));
                      setEditingAllowedIp(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setAllowedIpDrafts(toAllowedIpDrafts([]));
                      setEditingAllowedIp(false);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <button
            type="submit"
            className="btn-primary"
            disabled={!isAdmin || !dirty || saving}
            style={{ width: "auto" }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      ) : null}
    </>
  );
}
