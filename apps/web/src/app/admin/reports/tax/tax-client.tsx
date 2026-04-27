"use client";

import { adminApiFetch, formatCents, formatDateTime } from "../../admin-api";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";

type TaxResponse = {
  business_date: string;
  location_id: string;
  orders_count: number;
  taxable_sales_cents: number;
  tax_collected_cents: number;
  refund_tax_reversed_cents: number;
  net_tax_cents: number;
  created_at: string;
  updated_at: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DailyTaxClient() {
  const session = useSession();
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<TaxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/admin/reports/daily-tax?date=${encodeURIComponent(date)}`),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setData(json.data as TaxResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [date, session]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Reporting</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Daily tax summary</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          Shows the upserted tax summary for a business date — net tax owed
          after reversed refunds.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Business date{" "}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayIso()}
              style={{
                padding: "0.4rem 0.5rem",
                borderRadius: "0.375rem",
                border: "1px solid #d4d4d4",
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load()}
            disabled={loading}
            style={{ width: "auto" }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </section>

      {error && <p className="surface-error">{error}</p>}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          { label: "Orders", value: data?.orders_count ?? 0 },
          { label: "Taxable sales", value: formatCents(data?.taxable_sales_cents) },
          { label: "Tax collected", value: formatCents(data?.tax_collected_cents) },
          {
            label: "Tax reversed (refunds)",
            value: formatCents(data?.refund_tax_reversed_cents),
          },
          { label: "Net tax", value: formatCents(data?.net_tax_cents) },
        ].map((m) => (
          <div key={m.label} className="surface-card" style={{ padding: "1rem" }}>
            <span
              className="surface-muted"
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {m.label}
            </span>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.3rem" }}>
              {data ? m.value : "—"}
            </div>
          </div>
        ))}
      </section>

      {data && (
        <p className="surface-muted" style={{ fontSize: "0.8rem" }}>
          Snapshot last updated {formatDateTime(data.updated_at)}.
        </p>
      )}
    </>
  );
}
