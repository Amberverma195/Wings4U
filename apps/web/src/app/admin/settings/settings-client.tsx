"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

type Settings = {
  taxRateBps: number;
  taxDeliveryFee: boolean;
  taxTip: boolean;
  discountsReduceTaxableBase: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number | null;
  minimumDeliverySubtotalCents: number;
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
  addItemsAutoApproveEnabled: boolean;
  trustedIpRanges: string[];
  kdsPasswordConfigured?: boolean;
};

type FieldDef = {
  key: keyof Settings;
  label: string;
  group: string;
  kind: "number" | "boolean" | "cents" | "nullable-int";
  /** Extra hint for money fields shown in dollars while API/DB use cents */
  description?: string;
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
    key: "deliveryPinExpiryMinutes",
    label: "Delivery PIN expiry (min)",
    group: "Delivery",
    kind: "number",
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
    key: "addItemsAutoApproveEnabled",
    label: "Auto-approve add-items",
    group: "Kitchen",
    kind: "boolean",
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

const GROUPS = Array.from(new Set(FIELDS.map((f) => f.group)));

function parseValue(raw: string, kind: FieldDef["kind"]): unknown {
  if (kind === "boolean") return raw === "true";
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
  if (kind === "cents") {
    if (value == null) return "";
    const cents =
      typeof value === "number" && Number.isFinite(value) ? value : 0;
    return (cents / 100).toFixed(2);
  }
  if (value == null) return "";
  return String(value);
}

function getAllowedIp(settings: Settings | null): string {
  if (!settings || !Array.isArray(settings.trustedIpRanges)) return "";
  return settings.trustedIpRanges.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )?.trim() ?? "";
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

  const [baseIp, prefixText] = normalized.split("/");
  const parts = baseIp.split(".");
  if (parts.length !== 4) return false;

  const isValidIpv4 = parts.every((part) => {
    const octet = Number.parseInt(part, 10);
    return Number.isFinite(octet) && octet >= 0 && octet <= 255;
  });

  if (!isValidIpv4) return false;
  if (!normalized.includes("/")) return true;

  const prefix = Number.parseInt(prefixText ?? "", 10);
  return Number.isFinite(prefix) && prefix >= 0 && prefix <= 32;
}

export function SettingsClient() {
  const session = useSession();
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [allowedIpDraft, setAllowedIpDraft] = useState("");
  const [editingAllowedIp, setEditingAllowedIp] = useState(false);
  const [kdsPasswordDraft, setKdsPasswordDraft] = useState("");
  const [editingKdsPassword, setEditingKdsPassword] = useState(false);
  const [removingKdsPassword, setRemovingKdsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setAllowedIpDraft(getAllowedIp(settings));
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

  const dirty = data
    ? FIELDS.some((f) => valueToInput(data[f.key], f.kind) !== draft[f.key]) ||
      getAllowedIp(data) !== allowedIpDraft.trim() ||
      (editingKdsPassword && kdsPasswordDraft !== "") ||
      removingKdsPassword
    : false;
  const configuredAllowedIp = getAllowedIp(data);
  const hasAllowedIp = allowedIpDraft.trim().length > 0;

  const onSave = async () => {
    if (!data) return;
    if (!confirm("Apply these settings now? Some changes take effect immediately.")) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const normalizedAllowedIp = allowedIpDraft.trim();
      if (!isValidAllowedIp(normalizedAllowedIp)) {
        throw new Error(
          "Allowed IP address must be a valid IPv4 address and cannot be localhost.",
        );
      }

      const payload: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const before = valueToInput(data[f.key], f.kind);
        const after = draft[f.key];
        if (before !== after) {
          payload[f.key] = parseValue(after, f.kind);
        }
      }
      if (getAllowedIp(data) !== normalizedAllowedIp) {
        payload.trustedIpRanges = normalizedAllowedIp ? [normalizedAllowedIp] : [];
      }
      if (editingKdsPassword && kdsPasswordDraft.length > 0 && !/^\d{8}$/.test(kdsPasswordDraft)) {
        throw new Error("KDS password must be exactly 8 digits.");
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
      setSuccess("Settings saved.");
      const settings = json.data as Settings;
      setData(settings);
      const seeded: Record<string, string> = {};
      for (const f of FIELDS) {
        seeded[f.key] = valueToInput(settings[f.key], f.kind);
      }
      setDraft(seeded);
      setAllowedIpDraft(getAllowedIp(settings));
      setEditingAllowedIp(false);
      setKdsPasswordDraft("");
      setEditingKdsPassword(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Governance</p>
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
      {success && (
        <p style={{ color: "#166534", marginBottom: "1rem" }}>{success}</p>
      )}

      {!data && loading ? (
        <p className="surface-muted">Loading settings…</p>
      ) : data ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          {GROUPS.map((group) => (
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
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        step={f.kind === "cents" ? "0.01" : "1"}
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
          ))}

          <section
            className="surface-card"
            style={{ padding: "1rem", marginBottom: "1rem" }}
          >
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              KDS Password
            </h2>
            <p
              className="surface-muted"
              style={{ marginTop: 0, marginBottom: "0.9rem" }}
            >
              Configure an 8-digit password for the Kitchen Display System. Changes apply and revoke current KDS sessions when you save the page.
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
                Set KDS password
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
              Store exactly one station IP here. Localhost is never allowed.
              Changes apply when you save the page.
            </p>

            {!editingAllowedIp && !hasAllowedIp ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!isAdmin}
                style={{ width: "auto" }}
                onClick={() => setEditingAllowedIp(true)}
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
                <label style={{ display: "block", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600 }}>IPv4 address</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={allowedIpDraft}
                    onChange={(e) => setAllowedIpDraft(e.target.value)}
                    disabled={!isAdmin}
                    placeholder="e.g. 192.168.1.24"
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
                      setAllowedIpDraft(configuredAllowedIp);
                      setEditingAllowedIp(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : hasAllowedIp ? (
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
                    Current IP
                  </div>
                  <code
                    style={{
                      display: "inline-block",
                      marginTop: "0.25rem",
                      padding: "0.3rem 0.45rem",
                      borderRadius: "0.35rem",
                      background: "#f6f3ee",
                    }}
                  >
                    {allowedIpDraft}
                  </code>
                </div>

                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => setEditingAllowedIp(true)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!isAdmin}
                    style={{ width: "auto" }}
                    onClick={() => {
                      setAllowedIpDraft("");
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
