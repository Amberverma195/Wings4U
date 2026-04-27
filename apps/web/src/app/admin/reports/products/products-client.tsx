"use client";

import { adminApiFetch, formatCents } from "../../admin-api";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { DateRangePicker, defaultRange, type DateRange } from "../date-range-picker";

type ProductRow = {
  menu_item_id: string;
  product_name: string;
  category_name: string;
  quantity_sold: number;
  revenue_cents?: number;
};

type ModifierRow = {
  modifier_option_id: string | null;
  modifier_name: string;
  modifier_group: string;
  quantity_sold: number;
  revenue_cents: number;
};

type SoldOutRow = { menu_item_id: string; count: number };

type ProductsResponse = {
  top_items: ProductRow[];
  least_items: ProductRow[];
  top_modifiers: ModifierRow[];
  sold_out_frequency: SoldOutRow[];
};

function rangeToQuery(range: DateRange): string {
  const start = new Date(`${range.start}T00:00:00.000Z`).toISOString();
  const end = new Date(`${range.end}T23:59:59.999Z`).toISOString();
  return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
}

export function ProductsReportClient() {
  const session = useSession();
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch(`/api/v1/reports/products?${rangeToQuery(range)}`),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setData(json.data as ProductsResponse);
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
        <h1 style={{ margin: "0.2rem 0 0" }}>Product performance</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          Best sellers, least ordered items, modifier popularity, and sold-out
          incidents in the selected window.
        </p>
        <DateRangePicker value={range} onChange={setRange} />
      </section>

      {error && <p className="surface-error">{error}</p>}

      <section className="surface-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Top sellers</h3>
        {!data ? (
          <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
            {loading ? "Loading…" : "No data."}
          </p>
        ) : data.top_items.length === 0 ? (
          <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
            No items sold in this range.
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
                <th style={{ padding: "0.35rem 0" }}>Item</th>
                <th style={{ padding: "0.35rem 0" }}>Category</th>
                <th style={{ padding: "0.35rem 0", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "0.35rem 0", textAlign: "right" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.top_items.slice(0, 25).map((row) => (
                <tr key={row.menu_item_id}>
                  <td style={{ padding: "0.3rem 0" }}>{row.product_name}</td>
                  <td style={{ padding: "0.3rem 0" }} className="surface-muted">
                    {row.category_name}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.quantity_sold}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatCents(row.revenue_cents ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <div className="surface-card" style={{ padding: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Least ordered</h3>
          {!data || data.least_items.length === 0 ? (
            <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
              No data.
            </p>
          ) : (
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
              {data.least_items.slice(0, 15).map((r) => (
                <li key={r.menu_item_id}>
                  {r.product_name}{" "}
                  <span className="surface-muted">— {r.quantity_sold} sold</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="surface-card" style={{ padding: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Top modifiers</h3>
          {!data || data.top_modifiers.length === 0 ? (
            <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
              No modifier data.
            </p>
          ) : (
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
              {data.top_modifiers.slice(0, 15).map((m, i) => (
                <li key={(m.modifier_option_id ?? "") + i}>
                  {m.modifier_name}{" "}
                  <span className="surface-muted">
                    ({m.modifier_group}) — {m.quantity_sold}× ·{" "}
                    {formatCents(m.revenue_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="surface-card" style={{ padding: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Sold-out frequency</h3>
          {!data || data.sold_out_frequency.length === 0 ? (
            <p className="surface-muted" style={{ marginTop: "0.5rem" }}>
              No sold-out events recorded.
            </p>
          ) : (
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
              {data.sold_out_frequency.map((r) => (
                <li key={r.menu_item_id}>
                  Item {r.menu_item_id.slice(0, 8)}…{" "}
                  <span className="surface-muted">— {r.count} times</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
