"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, adminFetch, formatCents } from "./admin-api";
import type { FullMenuItem } from "./menu/admin-menu.types";

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
  const [lowStockOpen, setLowStockOpen] = useState(false);

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
              ) : card.key === "low_stock_items" ? (
                <button
                  type="button"
                  className="admin-stat-tile__button"
                  onClick={() => setLowStockOpen(true)}
                >
                  {inner}
                </button>
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

      {lowStockOpen ? (
        <LowStockItemsModal
          onClose={() => setLowStockOpen(false)}
          onChanged={load}
        />
      ) : null}
    </>
  );
}

type LowStockItemsModalProps = {
  onClose: () => void;
  onChanged: () => Promise<void>;
};

function LowStockItemsModal({ onClose, onChanged }: LowStockItemsModalProps) {
  const [items, setItems] = useState<FullMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadLowStockItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetch<FullMenuItem[]>("/api/v1/admin/menu/items");
      setItems(rows.filter((item) => item.stockStatus === "LOW_STOCK"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load low stock items",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLowStockItems();
  }, [loadLowStockItems]);

  const removeLowStock = async (item: FullMenuItem) => {
    setUpdatingId(item.id);
    setError(null);
    try {
      await adminFetch(`/api/v1/admin/menu/items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: item.name,
          description: item.description ?? undefined,
          base_price_cents: item.basePriceCents,
          category_id: item.categoryId,
          stock_status: "NORMAL",
          is_hidden: item.isHidden,
          allowed_fulfillment_type: item.allowedFulfillmentType,
        }),
      });
      setItems((current) => current.filter((row) => row.id !== item.id));
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to remove low stock status",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <section
        className="surface-card admin-low-stock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="low-stock-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-low-stock-modal__header">
          <div>
            <p className="surface-eyebrow" style={{ margin: 0 }}>
              Inventory
            </p>
            <h2 id="low-stock-title">Low stock items</h2>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="Close low stock items"
          >
            x
          </button>
        </div>

        {error ? <p className="surface-error">{error}</p> : null}

        {loading ? (
          <p className="surface-muted">Loading low stock items...</p>
        ) : items.length === 0 ? (
          <div className="admin-low-stock-empty">
            No menu items are marked low stock.
          </div>
        ) : (
          <div className="admin-low-stock-list">
            {items.map((item) => (
              <div key={item.id} className="admin-low-stock-row">
                <div className="admin-low-stock-row__item">
                  <strong>{item.name}</strong>
                  <span>
                    {item.category.name} | {formatCents(item.basePriceCents)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary admin-low-stock-row__action"
                  onClick={() => void removeLowStock(item)}
                  disabled={updatingId === item.id}
                >
                  {updatingId === item.id
                    ? "Removing..."
                    : "Remove from low stock"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
