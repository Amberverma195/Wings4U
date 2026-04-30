"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatCents } from "./admin-api";

type WidgetResponse = {
  active_orders: number;
  sales_today_cents: number;
  employees_clocked_in: number;
  drivers_on_delivery: number;
  low_stock_items: number;
  open_support_tickets: number;
  pending_catering_inquiries: number;
  open_registers: number;
};

type WidgetCard = {
  key: keyof WidgetResponse;
  label: string;
  href?: string;
  format?: (n: number) => string;
};

const CARDS: WidgetCard[] = [
  { key: "active_orders", label: "Active orders", href: "/kds" },
  {
    key: "sales_today_cents",
    label: "Sales today",
    href: "/admin/reports/sales",
    format: formatCents,
  },
  {
    key: "employees_clocked_in",
    label: "Employees clocked in",
    href: "/timeclock",
  },
  { key: "drivers_on_delivery", label: "Drivers on delivery", href: "/kds" },
  { key: "low_stock_items", label: "Low stock items" },
  {
    key: "open_support_tickets",
    label: "Open support tickets",
    href: "/admin/support",
  },
  { key: "pending_catering_inquiries", label: "Pending catering" },
  { key: "open_registers", label: "Open registers", href: "/register" },
];

const SHORTCUT_LINKS = [
  {
    href: "/admin/approvals",
    label: "Cancellation & refund approvals",
    summary: "Review pending KDS / chat-initiated cancellations and refunds.",
  },
  {
    href: "/admin/staff",
    label: "Staff and drivers",
    summary: "Add team members and keep the dispatch roster ready for KDS.",
  },
  {
    href: "/admin/order-changes",
    label: "Order change requests",
    summary: "Approve add-item requests on active orders.",
  },
  {
    href: "/admin/support",
    label: "Support tickets",
    summary: "Triage open issues, reply, resolve, or escalate.",
  },
  {
    href: "/admin/reviews",
    label: "Reviews",
    summary: "Reply and choose which reviews to publish publicly.",
  },
  {
    href: "/admin/orders",
    label: "Order tools",
    summary: "Search orders, force-cancel, credit, regenerate delivery PIN.",
  },
  {
    href: "/admin/settings",
    label: "Store settings",
    summary: "Hours, thresholds, and operational toggles (admin only).",
  },
];

export function AdminHomeClient() {
  const session = useSession();
  const [data, setData] = useState<WidgetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch("/api/v1/reports/widgets"),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setData(json.data as WidgetResponse);
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <>
      <section className="surface-card admin-section-lead">
        <div className="admin-section-lead__row">
          <div>
            <p className="surface-eyebrow" style={{ margin: 0 }}>
              Operations dashboard
            </p>
            <h1>Today at the store</h1>

          </div>
          <div className="admin-section-lead__actions">
            {refreshedAt && (
              <span className="surface-muted admin-meta-time">
                Updated {refreshedAt.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void load()}
              disabled={loading}
              style={{ width: "auto" }}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <p className="surface-error" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
      </section>

      <ul className="admin-stat-grid" role="list">
        {CARDS.map((card) => {
          const value = data?.[card.key] ?? 0;
          const formatted = card.format
            ? card.format(value as number)
            : String(value);
          const inner = (
            <div className="surface-card admin-stat-tile">
              <span className="admin-stat-tile__label">{card.label}</span>
              <span className="admin-stat-tile__value">
                {data ? formatted : "--"}
              </span>
            </div>
          );
          return (
            <li key={card.key} className="admin-stat-grid__item">
              {card.href ? (
                <Link href={card.href} className="admin-stat-tile__link">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      <section className="surface-card admin-quick-actions">
        <h2>Quick actions</h2>
        <p className="surface-muted">Jump into the queues admins use most.</p>
        <div className="admin-quick-grid">
          {SHORTCUT_LINKS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="surface-link"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <h2>{s.label}</h2>
              <p>{s.summary}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
