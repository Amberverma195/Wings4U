"use client";

import { adminApiFetch, formatCents, formatDateTime } from "../../admin-api";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { DateRangePicker, defaultRange, type DateRange } from "../date-range-picker";

type SalesResponse = {
  total_sales_cents: number;
  total_orders: number;
  average_order_value_cents: number;
  timeline: Array<{ time_bucket: string; sales_cents: number }>;
  source_breakdown: Record<string, number>;
  fulfillment_breakdown: Record<string, number>;
  payment_method_breakdown: Record<string, number>;
  total_refunds_cents: number;
  total_discounts_cents: number;
};

function rangeToQuery(range: DateRange): string {
  const start = new Date(`${range.start}T00:00:00.000Z`).toISOString();
  const end = new Date(`${range.end}T23:59:59.999Z`).toISOString();
  return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
}

function BreakdownTable({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="surface-card" style={{ padding: "1rem" }}>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
      {entries.length === 0 ? (
        <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
          No data in this range.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "0.6rem",
            fontSize: "0.9rem",
          }}
        >
          <tbody>
            {entries.map(([k, v]) => {
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return (
                <tr key={k}>
                  <td style={{ padding: "0.35rem 0" }}>{k}</td>
                  <td
                    style={{
                      padding: "0.35rem 0",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatCents(v)} <span className="surface-muted">({pct}%)</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SalesReportClient() {
  const session = useSession();
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch(`/api/v1/reports/sales?${rangeToQuery(range)}`),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setData(json.data as SalesResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [range, session]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Reporting</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Sales dashboard</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          Gross sales, payment mix, fulfillment split, and order channels for
          the selected window.
        </p>
        <DateRangePicker value={range} onChange={setRange} />
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
          { label: "Total sales", value: formatCents(data?.total_sales_cents) },
          { label: "Orders", value: data?.total_orders ?? 0 },
          {
            label: "Avg order value",
            value: formatCents(data?.average_order_value_cents),
          },
          {
            label: "Refunds issued",
            value: formatCents(data?.total_refunds_cents),
          },
          {
            label: "Discounts",
            value: formatCents(data?.total_discounts_cents),
          },
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
              {loading && !data ? "…" : m.value}
            </div>
          </div>
        ))}
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <BreakdownTable
          title="Order source"
          data={data?.source_breakdown ?? {}}
        />
        <BreakdownTable
          title="Fulfillment type"
          data={data?.fulfillment_breakdown ?? {}}
        />
        <BreakdownTable
          title="Payment method"
          data={data?.payment_method_breakdown ?? {}}
        />
      </section>

      <section className="surface-card" style={{ padding: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Sales timeline</h3>
        {!data || data.timeline.length === 0 ? (
          <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
            No completed orders in this range.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "0.6rem",
              fontSize: "0.9rem",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "0.35rem 0" }}>Hour</th>
                <th
                  style={{
                    padding: "0.35rem 0",
                    textAlign: "right",
                  }}
                >
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((row) => (
                <tr key={row.time_bucket}>
                  <td style={{ padding: "0.3rem 0" }}>
                    {formatDateTime(row.time_bucket)}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatCents(row.sales_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
