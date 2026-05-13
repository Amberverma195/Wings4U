"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Link from "next/link";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents, relativeTime, statusLabel } from "@/lib/format";
import { createOrdersSocket, subscribeToChannels } from "@/lib/realtime";
import { ReorderButton } from "@/components/reorder-button";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";
import type { OrderSummary } from "@/lib/types";
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from "@/lib/types";
import { AccountSkeleton } from "@/components/account-skeleton";
import { AccountSurfaceLinks } from "../account-surface-links";

import styles from "./orders.module.css";

type Tab = "active" | "past";

type OrdersPage = {
  orders: OrderSummary[];
  next_cursor: string | null;
};

export function OrdersListClient() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("active");
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const router = useRouter();

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    session.clear();
    router.replace("/");
  }, [session, router]);






  const fetchOrders = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (nextCursor) params.set("cursor", nextCursor);
        const res = await withSilentRefresh(
          () =>
            apiFetch(`/api/v1/orders/customer?${params}`, {
              locationId: DEFAULT_LOCATION_ID,
            }),
          session.refresh,
          session.clear,
        );
        const body = (await res.json()) as ApiEnvelope<OrdersPage>;
        if (!res.ok) {
          throw new Error(getApiErrorMessage(body, res.statusText));
        }
        const page = body.data!;
        if (nextCursor) {
          setOrders((prev) => [...prev, ...page.orders]);
        } else {
          setOrders(page.orders);
        }
        setCursor(page.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load orders");
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // Stable ref so the socket effect doesn't re-run when fetchOrders
  // changes identity (session revalidation, etc.).
  const fetchOrdersRef = useRef(fetchOrders);
  useEffect(() => {
    fetchOrdersRef.current = fetchOrders;
  }, [fetchOrders]);

  // Realtime: subscribe to each active order's channel so the list
  // reflects status changes (accepted / ready / cancelled / etc.)
  // without a manual page reload.
  // Stabilise the channel list: only tear down the socket when the set of
  // active order IDs actually changes, not on every re-render / re-fetch.
  const activeOrderIdsKey = useMemo(
    () =>
      orders
        .filter((o) => ACTIVE_STATUSES.has(o.status))
        .map((o) => o.id)
        .sort()
        .join(","),
    [orders],
  );

  useEffect(() => {
    if (!activeOrderIdsKey) return;

    const ids = activeOrderIdsKey.split(",");
    const socket = createOrdersSocket();

    const refresh = () => void fetchOrdersRef.current();
    socket.on("order.accepted", refresh);
    socket.on("order.status_changed", refresh);
    socket.on("order.cancelled", refresh);
    socket.on("order.driver_assigned", refresh);
    socket.on("order.delivery_started", refresh);
    socket.on("order.eta_updated", refresh);
    socket.on("cancellation.decided", refresh);

    const channels = ids.map((id) => `order:${id}`);
    const disposeSubscription = subscribeToChannels(socket, channels);
    socket.connect();

    return () => {
      disposeSubscription();
      socket.disconnect();
    };
  }, [activeOrderIdsKey]);

  const { active, past } = useMemo(() => {
    return {
      active: orders.filter((o) => ACTIVE_STATUSES.has(o.status)),
      past: orders.filter((o) => TERMINAL_STATUSES.has(o.status)),
    };
  }, [orders]);

  const visible = tab === "active" ? active : past;
  const isInitialLoading = loading && orders.length === 0;

  if (!session.loaded || isLoggingOut) {
    return <AccountSkeleton isLoggingOut={isLoggingOut} />;
  }

  const showEmpty = !loading && visible.length === 0;

  return (
    <div className={styles.pageShell}>
      <main className={styles.hub}>
        <div className={styles.mainContainer}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.identityCard}>
              <h1 className={styles.name}>{session.user?.displayName ?? "Customer"}</h1>
              <div className={styles.phone}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
              </div>

              <nav className={styles.navLinks}>
                <Link href="/account/profile" className={styles.navLink}>
                  <span>My Profile</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <AccountSurfaceLinks
                  user={session.user}
                  navLinkClassName={styles.navLink}
                  navLinkArrowClassName={styles.navLinkArrow}
                />
                <Link href="/account" className={styles.navLink}>
                  <span>My Account</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                  <span>Order History</span>
                  <span className={styles.navLinkArrow}>→</span>
                </div>
                <Link href="/account/addresses" className={styles.navLink}>
                  <span>My Addresses</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/cards" className={styles.navLink}>
                  <span>My Cards</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/support" className={styles.navLink}>
                  <span>Support</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <button onClick={handleLogout} className={`${styles.navLink} ${styles.navLinkLogout}`}>
                  <span>Logout</span>
                  <span className={styles.navLinkArrow}>→</span>
                </button>
              </nav>
            </div>
          </aside>

          {/* Main Content Area */}
          <div className={styles.contentStack}>
            <header className={styles.hero}>
              <div className={styles.titleArea}>
            <p className={styles.eyebrow}>Order History</p>
            <h1 id="orders-hub-title" className={styles.title}>
              My Orders
            </h1>
            <p className={styles.subtitle}>
              Track your active orders in real-time and quickly reorder your past favorites.
            </p>
          </div>

        </header>

        <div className={styles.controls}>
          <div className={styles.tabs} role="tablist" aria-label="Filter orders" data-tab={tab}>
            <div className={styles.tabIndicator} aria-hidden />
            <button
              type="button"
              role="tab"
              aria-selected={tab === "active"}
              className={styles.tab}
              data-active={tab === "active"}
              onClick={() => setTab("active")}
            >
              <span>Active</span>
              <span className={styles.tabCount}>{active.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "past"}
              className={styles.tab}
              data-active={tab === "past"}
              onClick={() => setTab("past")}
            >
              <span>Past</span>
              <span className={styles.tabCount}>{past.length}</span>
            </button>
          </div>

        </div>

        {error && (
          <div className={styles.alert} role="alert">
            {error}
          </div>
        )}

        {isInitialLoading ? (
          <div className={styles.grid} aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeletonCard}>
                <div className={`${styles.skeletonRow} ${styles.skeletonRowShort}`} />
                <div className={styles.skeletonRow} />
                <div className={`${styles.skeletonRow} ${styles.skeletonRowMid}`} />
              </div>
            ))}
          </div>
        ) : showEmpty ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden>
              {tab === "active" ? "\u23F1" : "\uD83C\uDF57"}
            </div>
            <h2 className={styles.emptyTitle}>
              {tab === "active" ? "Nothing cooking at the moment" : "No past orders yet"}
            </h2>
            <p className={styles.emptyBody}>
              {tab === "active"
                ? "When you place an order, it will land here so you can track it live."
                : "Once an order wraps up, it will live here for easy reordering."}
            </p>
            <Link href="/order" className={styles.cta}>
              <span>Order Something New</span>
              <span className={styles.ctaArrow} aria-hidden>{"\u2192"}</span>
            </Link>
          </div>
        ) : (
          <div className={styles.grid}>
            {visible.map((o) => {
              const isTerminal = TERMINAL_STATUSES.has(o.status);
              const unread = o.unread_chat_count ?? 0;
              const readyAt =
                o.estimated_ready_at && ACTIVE_STATUSES.has(o.status)
                  ? new Date(o.estimated_ready_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : null;
              return (
                <article
                  key={o.id}
                  className={`${styles.card} ${isTerminal ? styles.cardPast : ""}`}
                >
                  <Link
                    href={`/orders/${o.id}`}
                    style={{ textDecoration: "none", color: "inherit", flex: 1, display: "flex", flexDirection: "column" }}
                    aria-label={`Open order #${o.order_number}`}
                  >
                    <div className={styles.cardTop}>
                      <div className={styles.orderNumberWrap}>
                        <span className={styles.hash}>#</span>
                        <span className={styles.orderNumber}>{o.order_number}</span>
                        {unread > 0 && (
                          <span
                            className={styles.unread}
                            aria-label={`${unread} unread chat message${unread === 1 ? "" : "s"}`}
                          >
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </div>
                      <span
                        className={`${styles.statusBadge} ${
                          isTerminal ? styles.statusPast : styles.statusActive
                        }`}
                      >
                        {!isTerminal && <span className={styles.statusDot} aria-hidden />}
                        {statusLabel(o.status)}
                      </span>
                    </div>

                    <div className={styles.cardMeta}>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {o.fulfillment_type === "PICKUP" ? "Pickup" : "Delivery"}
                        </span>
                        <span className={`${styles.metaValue} ${styles.metaValueTotal}`}>
                          {cents(o.final_payable_cents)}
                        </span>
                      </div>
                      <div className={`${styles.metaItem} ${styles.metaItemRight}`}>
                        <span className={styles.metaLabel}>Placed</span>
                        <span className={styles.metaValue}>{relativeTime(o.placed_at)}</span>
                      </div>
                    </div>

                    {readyAt && (
                      <div className={styles.cardEta}>
                        <span className={styles.etaLabel}>
                          {o.fulfillment_type === "PICKUP" ? "Ready for pickup" : "Ready"}
                        </span>
                        <span className={styles.etaValue}>~{readyAt}</span>
                      </div>
                    )}
                  </Link>

                  {isTerminal && (
                    <div className={styles.cardActions}>
                      <ReorderButton
                        orderId={o.id}
                        locationId={o.location_id}
                        variant="secondary"
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {cursor && !isInitialLoading && (
          <button
            type="button"
            className={styles.loadMoreBtn}
            disabled={loading}
            onClick={() => void fetchOrders(cursor)}
          >
            {loading ? "Loading\u2026" : "Load more orders"}
          </button>
        )}
          </div>
        </div>
      </main>
    </div>
  );
}

function formatPhoneNumber(phone?: string | null) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length > 10) {
    const countryLength = digits.length - 10;
    const countryCode = digits.slice(0, countryLength);
    const main = digits.slice(countryLength);
    return `+${countryCode} (${main.slice(0, 3)})-${main.slice(3, 6)}-${main.slice(6)}`;
  }
  return phone;
}
