"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents, orderStatusCustomerLabel, shortTime, statusLabel } from "@/lib/format";
import { createOrdersSocket, subscribeToChannels } from "@/lib/realtime";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { OrderDetail, OrderStatus } from "@/lib/types";
import { OrderAddItems } from "@/components/order-add-items";
import { OrderChat } from "@/components/order-chat";
import { OrderReviews } from "@/components/order-reviews";
import { OrderStatusTimelineChakra } from "@/components/order-status-timeline-chakra";
import { ReorderButton } from "@/components/reorder-button";
import { SupportTicketForm } from "@/components/support-ticket-form";
import { OrderSkeleton } from "./order-skeleton";
import styles from "./order-detail.module.css";

function isTerminal(status: OrderStatus): boolean {
  const terminalStatuses: ReadonlySet<string> = new Set([
    "PICKED_UP",
    "DELIVERED",
    "NO_SHOW_PICKUP",
    "NO_SHOW_DELIVERY",
    "NO_PIN_DELIVERY",
    "CANCELLED",
  ]);
  return terminalStatuses.has(status);
}

function canOpenPostOrderSupport(status: OrderStatus): boolean {
  return status === "PICKED_UP" || status === "DELIVERED";
}

function cancelStillAllowed(order: OrderDetail): boolean {
  if (!order.cancel_allowed_until) return false;
  if (new Date(order.cancel_allowed_until) <= new Date()) return false;
  // The self-cancel button is only available before kitchen prep starts.
  // Once KDS moves ACCEPTED -> PREPARING, route customers to Help instead.
  // The backend also rejects this case (see
  // `customerCancel` in `orders.service.ts`) — the UI check is just to
  // keep the button from being shown at all in the common path.
  return order.status === "PLACED" || order.status === "ACCEPTED";
}

type DeliveryPinResponse = {
  pin: string | null;
  expires_at?: string;
  status?: string;
};

/** Navigates away with a hard load so leftover client/socket state resets after account switch */
function goToCustomerOrdersHome() {
  if (typeof window !== "undefined") {
    window.location.assign("/account/orders");
  }
}

function formatDriverPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone.trim() || null;
}

function formatDeliveryPreference(value: string | null): string | null {
  switch (value) {
    case "HAND_TO_ME":
      return "Hand it to me";
    case "LEAVE_AT_DOOR":
      return "Leave at door";
    case "CALL_ON_ARRIVAL":
      return "Call on arrival";
    case "TEXT_ON_ARRIVAL":
      return "Text on arrival";
    default:
      return null;
  }
}

function formatDeliveryAddress(
  address: OrderDetail["address_snapshot_json"],
): string | null {
  if (!address || typeof address !== "object") return null;
  const postalCode = address.postal_code ?? address.postalCode;
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.province,
    postalCode,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const session = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showDriverChatModal, setShowDriverChatModal] = useState(false);
  const [deliveryPin, setDeliveryPin] = useState<DeliveryPinResponse | null>(null);
  const [orderStatusHistoryOpen, setOrderStatusHistoryOpen] = useState(false);
  const orderStatusAnchorRef = useRef<HTMLDivElement | null>(null);
  const [orderStatusPopoverRect, setOrderStatusPopoverRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const clearPrivateOrderState = useCallback(() => {
    setOrder(null);
    setError(null);
    setCancelling(false);
    setCancelError(null);
    setShowCancelConfirm(false);
    setShowSupport(false);
    setShowHelpModal(false);
    setShowChatModal(false);
    setShowDriverChatModal(false);
    setDeliveryPin(null);
    setOrderStatusHistoryOpen(false);
  }, []);

  useEffect(() => {
    clearPrivateOrderState();
  }, [orderId, clearPrivateOrderState]);

  useEffect(() => {
    setError(null);
  }, [session.user?.id]);

  // The customer tracking route must not keep stale order details across logout
  // or account switching. Admin/staff order access belongs in admin surfaces,
  // not on this customer-facing page.
  useEffect(() => {
    if (!session.loaded) return;
    if (!session.authenticated || !session.user?.id) {
      clearPrivateOrderState();
      return;
    }
    if (order && order.customer_user_id !== session.user.id) {
      clearPrivateOrderState();
      goToCustomerOrdersHome();
    }
  }, [
    session.loaded,
    session.authenticated,
    session.user?.id,
    order,
    clearPrivateOrderState,
  ]);

  const fetchOrder = useCallback(async () => {
    if (!session.loaded) return;
    if (!session.authenticated || !session.user?.id) {
      clearPrivateOrderState();
      return;
    }

    const currentUserId = session.user.id;

    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/orders/${orderId}`, {
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        if (res.status === 403) {
          clearPrivateOrderState();
          goToCustomerOrdersHome();
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { errors?: readonly { message?: string }[] }
          | null;
        throw new Error(
          body?.errors?.[0]?.message ?? `Failed to load order (${res.status})`,
        );
      }
      const body = (await res.json()) as { data?: OrderDetail };
      if (!body.data) {
        throw new Error("Failed to load order");
      }

      if (body.data.customer_user_id !== currentUserId) {
        clearPrivateOrderState();
        goToCustomerOrdersHome();
        return;
      }

      setOrder(body.data);
      setError(null);
    } catch (e) {
      setOrder(null);
      const msg =
        typeof e === "object" &&
        e !== null &&
        "message" in e &&
        typeof (e as Error).message === "string"
          ? (e as Error).message
          : null;
      if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("do not have access to this order")
      ) {
        clearPrivateOrderState();
        goToCustomerOrdersHome();
        return;
      }
      setError(msg ?? "Failed to load order");
    }
  }, [
    orderId,
    session.loaded,
    session.authenticated,
    session.user?.id,
    session.refresh,
    session.clear,
    clearPrivateOrderState,
  ]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  // PRD §7.8.5: fetch the delivery PIN while the order is out for delivery.
  useEffect(() => {
    if (!order || order.fulfillment_type !== "DELIVERY") {
      setDeliveryPin(null);
      return;
    }
    if (
      !session.loaded ||
      !session.authenticated ||
      !session.user?.id ||
      order.customer_user_id !== session.user.id
    ) {
      setDeliveryPin(null);
      return;
    }
    if (order.status !== "OUT_FOR_DELIVERY") {
      setDeliveryPin(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await withSilentRefresh(
          () =>
            apiFetch(`/api/v1/orders/${orderId}/delivery-pin`, {
              locationId: DEFAULT_LOCATION_ID,
            }),
          session.refresh,
          session.clear,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { data?: DeliveryPinResponse };
        if (!cancelled && body.data) setDeliveryPin(body.data);
      } catch {
        // Non-fatal — PIN display is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    order,
    orderId,
    session.loaded,
    session.authenticated,
    session.user?.id,
    session.refresh,
    session.clear,
  ]);

  // Keep a stable ref to the latest fetchOrder so the socket effect doesn't
  // tear down & reconnect every time the session object changes identity
  // (which happens on focus, visibility-change, and pathname transitions).
  // Without this, the effect's dependency on `fetchOrder` caused the socket
  // to disconnect and reconnect on every session revalidation, creating a
  // window where incoming events were silently dropped.
  const fetchOrderRef = useRef(fetchOrder);
  useEffect(() => {
    fetchOrderRef.current = fetchOrder;
  }, [fetchOrder]);

  // Realtime: subscribe to `order:${orderId}` so the customer sees status
  // changes (accepted / ready / out-for-delivery / delivered) without a
  // manual reload. `subscribeToChannels` keeps the subscription alive
  // across reconnects.
  useEffect(() => {
    if (!session.loaded || !session.authenticated || !session.user?.id) return;

    const socket = createOrdersSocket();

    const refresh = () => void fetchOrderRef.current();
    socket.on("order.accepted", refresh);
    socket.on("order.status_changed", refresh);
    socket.on("order.cancelled", refresh);
    socket.on("order.driver_assigned", refresh);
    socket.on("order.delivery_started", refresh);
    socket.on("order.eta_updated", refresh);
    socket.on("order.change_approved", refresh);
    socket.on("order.change_rejected", refresh);
    socket.on("cancellation.decided", refresh);

    const expectChannel = `order:${orderId}`;
    const disposeSubscription = subscribeToChannels(socket, [expectChannel], {
      onDenied(channel) {
        if (channel !== expectChannel) return;
        goToCustomerOrdersHome();
      },
    });
    socket.connect();

    return () => {
      disposeSubscription();
      socket.disconnect();
    };
  }, [orderId, session.loaded, session.authenticated, session.user?.id]);

  const handleCancel = useCallback(() => {
    if (cancelling) return;
    setCancelError(null);
    setShowCancelConfirm(true);
  }, [cancelling]);

  const confirmCancel = useCallback(async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/orders/${orderId}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.errors?.[0]?.message ?? `Cancel failed (${res.status})`);
      }
      setShowCancelConfirm(false);
      await fetchOrder();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }, [orderId, fetchOrder, session]);

  useLayoutEffect(() => {
    if (!orderStatusHistoryOpen) {
      setOrderStatusPopoverRect(null);
      return;
    }
    if (!orderStatusAnchorRef.current) return;

    const update = () => {
      const el = orderStatusAnchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(320, Math.max(260, r.width));
      const pad = 8;
      let left = r.left;
      if (left + width > window.innerWidth - pad) {
        left = window.innerWidth - pad - width;
      }
      if (left < pad) {
        left = pad;
      }
      setOrderStatusPopoverRect({ top: r.bottom + 6, left, width });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [orderStatusHistoryOpen]);

  useEffect(() => {
    if (!orderStatusHistoryOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOrderStatusHistoryOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [orderStatusHistoryOpen]);

  /* ── Error state ──────────────────────────────────────── */
  if (error) {
    return (
      <div className={styles.pageShell}>
        <main className={styles.hub}>
          <div className={styles.topBar}>
            <a href="/account/orders" className={styles.backBtn}>
              <span className={styles.backArrow}>←</span>
              Back to my orders
            </a>
          </div>
          <div className={styles.errorCard}>
            <p className={styles.errorText}>{error}</p>
            <a href="/account/orders" className={styles.backBtn}>
              <span className={styles.backArrow}>←</span>
              My orders
            </a>
          </div>
        </main>
      </div>
    );
  }

  /* ── Loading state ────────────────────────────────────── */
  if (!order) {
    return <OrderSkeleton />;
  }

  const terminal = isTerminal(order.status);
  const postOrderSupportAvailable = canOpenPostOrderSupport(order.status);
  const showOrderActionsColumn = terminal || postOrderSupportAvailable;
  const sortedStatusEvents = [...order.status_events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const assignedDriver = order.assigned_driver;
  const driverPhone = formatDriverPhone(assignedDriver?.phone);
  const vehicleLabel = [assignedDriver?.vehicle_type, assignedDriver?.vehicle_identifier]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" · ");
  const deliveryAddress = formatDeliveryAddress(order.address_snapshot_json);
  const deliveryPreference = formatDeliveryPreference(order.contactless_pref);
  const deliveryHasStarted =
    order.fulfillment_type === "DELIVERY" &&
    (Boolean(order.delivery_started_at) ||
      order.status === "OUT_FOR_DELIVERY" ||
      order.status === "DELIVERED" ||
      order.status === "NO_PIN_DELIVERY" ||
      order.status === "NO_SHOW_DELIVERY");
  const showDeliveryInfoCard =
    order.fulfillment_type === "DELIVERY" &&
    deliveryHasStarted &&
    (assignedDriver || deliveryAddress || deliveryPreference);
  const driverStatusTitle =
    order.status === "OUT_FOR_DELIVERY" ? "Driver is on the way" : "Delivery details";

  return (
    <div className={styles.pageShell}>
      <main className={styles.hub}>
        {/* ── Top bar ───────────────────────────────────── */}
        <div className={styles.topBar}>
          <Link href="/account/orders" className={styles.backBtn}>
            <span className={styles.backArrow}>←</span>
            Back to my orders
          </Link>
          <h1 className={styles.orderTitle}>
            Order <span className={styles.orderNumber}>#{order.order_number}</span>
          </h1>
        </div>

        {/* ── Two-column grid ──────────────────────────── */}
        <div className={styles.mainGrid}>
          {/* LEFT — Order details */}
          <div className={styles.leftColumn}>
            <div className={styles.orderCard}>
              {/* Status row — cancel / help on the right (timeline moved below summary) */}
              <div className={styles.statusRow}>
                <span className={`${styles.statusPill} ${terminal ? styles.statusPillTerminal : styles.statusPillActive}`}>
                  <span className={styles.statusDot} />
                  {orderStatusCustomerLabel(order.status, order.fulfillment_type)}
                </span>
                {!terminal && cancelStillAllowed(order) && (
                  <div className={styles.statusRowActions}>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      disabled={cancelling}
                      aria-haspopup="dialog"
                      onClick={handleCancel}
                    >
                      {cancelling ? "Cancelling…" : "Cancel order"}
                    </button>
                    {cancelError && (
                      <p style={{ color: "#dc2626", marginTop: "0.5rem", fontSize: "0.85rem", textAlign: "right" }}>
                        {cancelError}
                      </p>
                    )}
                  </div>
                )}
                {!terminal && !cancelStillAllowed(order) && order.cancel_allowed_until && (
                  <div className={styles.statusRowActions}>
                    <div className={styles.helpActionGroup}>
                      <button
                        type="button"
                        className={styles.chatIconBtn}
                        aria-label="Open order chat"
                        title="Open order chat"
                        onClick={() => {
                          setOrderStatusHistoryOpen(false);
                          setShowChatModal(true);
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={styles.helpBtn}
                        onClick={() => {
                          setOrderStatusHistoryOpen(false);
                          setShowHelpModal(true);
                        }}
                      >
                        Help
                      </button>
                    </div>
                  </div>
                )}
                {postOrderSupportAvailable ? (
                  <div className={styles.statusRowActions}>
                    <button
                      type="button"
                      className={styles.helpBtn}
                      aria-haspopup="dialog"
                      onClick={() => {
                        setOrderStatusHistoryOpen(false);
                        setShowSupport(true);
                      }}
                    >
                      Help
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Meta chips */}
              <div className={styles.metaRow}>
                <span className={styles.metaChip}>{statusLabel(order.fulfillment_type)}</span>
                <span className={`${styles.metaChip} ${styles.metaChipMuted}`}>
                  {new Date(order.placed_at).toLocaleString()}
                </span>
              </div>

              {/* ETA */}
              {order.estimated_ready_at && !terminal && (
                <div className={styles.etaBar}>
                  <span className={styles.etaIcon}>⏱</span>
                  <span>
                    Estimated ready ~{shortTime(order.estimated_ready_at)}
                    {order.estimated_window_min_minutes != null &&
                      order.estimated_window_max_minutes != null && (
                        <> ({order.estimated_window_min_minutes}–{order.estimated_window_max_minutes} min)</>
                      )}
                  </span>
                </div>
              )}

              {/* Delivery PIN */}
              {deliveryPin?.pin && (
                <div className={styles.pinCard}>
                  <p className={styles.pinLabel}>Delivery PIN</p>
                  <p className={styles.pinValue}>{deliveryPin.pin}</p>
                  <p className={styles.pinHint}>Share this PIN with your driver at handoff.</p>
                </div>
              )}

              {showDeliveryInfoCard && (
                <div className={styles.driverCard}>
                  <div className={styles.driverCardHeader}>
                    <div>
                      <p className={styles.driverEyebrow}>Delivery</p>
                      <h3 className={styles.driverTitle}>{driverStatusTitle}</h3>
                    </div>
                    {order.estimated_arrival_at && !terminal ? (
                      <span className={styles.driverEta}>
                        ETA {shortTime(order.estimated_arrival_at)}
                      </span>
                    ) : null}
                  </div>

                  {assignedDriver ? (
                    <div className={styles.driverProfileGrid}>
                      <div className={styles.driverProfileMain}>
                        <span className={styles.driverAvatar} aria-hidden>
                          {assignedDriver.full_name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <p className={styles.driverName}>{assignedDriver.full_name}</p>
                          <p className={styles.driverMeta}>
                            {driverPhone ?? "Phone not available"}
                          </p>
                        </div>
                      </div>

                      <div className={styles.driverVehicle}>
                        <span className={styles.driverMetaLabel}>Plate / vehicle</span>
                        <span className={styles.driverMetaValue}>
                          {vehicleLabel || "Not added"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.driverNotice}>
                      We will show your driver here once the store assigns one.
                    </p>
                  )}

                  {assignedDriver && !terminal ? (
                    <div className={styles.driverActions}>
                      <button
                        type="button"
                        className={styles.driverChatBtn}
                        onClick={() => setShowDriverChatModal(true)}
                      >
                        Chat with driver
                      </button>
                      {assignedDriver.phone ? (
                        <a
                          className={styles.driverCallBtn}
                          href={`tel:${assignedDriver.phone}`}
                        >
                          Call driver
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {(deliveryAddress || deliveryPreference) && (
                    <div className={styles.deliveryInfoGrid}>
                      {deliveryAddress ? (
                        <div className={styles.deliveryInfoItem}>
                          <span className={styles.driverMetaLabel}>Delivery address</span>
                          <span className={styles.driverMetaValue}>{deliveryAddress}</span>
                        </div>
                      ) : null}
                      {deliveryPreference ? (
                        <div className={styles.deliveryInfoItem}>
                          <span className={styles.driverMetaLabel}>Delivery preference</span>
                          <span className={styles.driverMetaValue}>{deliveryPreference}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Cancellation notice */}
              {order.status === "CANCELLED" && (
                <p className={styles.cancelReason}>
                  Order cancelled by Staff.
                </p>
              )}

              {/* Items */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Items</h3>
                {order.items.map((item) => {
                  const removedModifiers = item.modifiers.filter(
                    (modifier) => modifier.modifier_kind === "REMOVE_INGREDIENT",
                  );
                  const addonModifiers = item.modifiers.filter(
                    (modifier) => modifier.modifier_kind !== "REMOVE_INGREDIENT",
                  );

                  return (
                    <div key={item.id} className={styles.itemRow}>
                      <div>
                        <p className={styles.itemName}>
                          {item.product_name_snapshot} × {item.quantity}
                        </p>
                        {removedModifiers.length > 0 && (
                          <p className={styles.itemRemoved}>
                            {removedModifiers.map((m) => `No ${m.modifier_name_snapshot}`).join(", ")}
                          </p>
                        )}
                        {addonModifiers.length > 0 && (
                          <p className={styles.itemMods}>
                            {addonModifiers.map((m) => m.modifier_name_snapshot).join(", ")}
                          </p>
                        )}
                        {item.flavours.length > 0 && (
                          <p className={styles.itemMods}>
                            {item.flavours.map((f) => f.flavour_name_snapshot).join(", ")}
                          </p>
                        )}
                        {item.special_instructions && (
                          <p className={styles.itemInstructions}>{item.special_instructions}</p>
                        )}
                      </div>
                      <span className={styles.itemPrice}>{cents(item.line_total_cents)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Quote summary */}
              <div className={styles.summary}>
                <div className={styles.summaryRow}>
                  <span>Subtotal</span>
                  <span className={styles.summaryAmount}>{cents(order.item_subtotal_cents)}</span>
                </div>
                {order.delivery_fee_cents > 0 && (
                  <div className={styles.summaryRow}>
                    <span>Delivery fee</span>
                    <span className={styles.summaryAmount}>{cents(order.delivery_fee_cents)}</span>
                  </div>
                )}
                <div className={styles.summaryRow}>
                  <span>Tax(13%)</span>
                  <span className={styles.summaryAmount}>{cents(order.tax_cents)}</span>
                </div>
                {order.wallet_applied_cents > 0 && (
                  <div className={styles.summaryRow}>
                    <span>Wallet credit</span>
                    <span className={styles.summaryAmount}>-{cents(order.wallet_applied_cents)}</span>
                  </div>
                )}
                <div className={styles.summaryTotal}>
                  <span>Total</span>
                  <span className={styles.summaryTotalValue}>{cents(order.final_payable_cents)}</span>
                </div>
              </div>

              {sortedStatusEvents.length > 0 && (
                <div
                  ref={orderStatusAnchorRef}
                  className={`${styles.statusTimelineCompact} ${styles.timelineAfterSummary} ${styles.orderStatusPopoverHost}`}
                >
                  <button
                    type="button"
                    className={styles.orderStatusTrigger}
                    aria-expanded={orderStatusHistoryOpen}
                    aria-haspopup="dialog"
                    aria-label={orderStatusHistoryOpen ? "Close status updates" : "View all status updates"}
                    onClick={() => setOrderStatusHistoryOpen((open) => !open)}
                  >
                    <span className={styles.orderStatusTriggerHeader}>
                      <span className={styles.statusTimelineLabel}>Order status</span>
                      <span
                        className={`${styles.timelineToggleArrow} ${orderStatusHistoryOpen ? styles.timelineToggleArrowExpanded : ""}`}
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </span>
                    <div className={styles.orderStatusPreview}>
                      <OrderStatusTimelineChakra
                        events={sortedStatusEvents.slice(0, 1)}
                        getStatusLabel={(s) => orderStatusCustomerLabel(s as OrderStatus, order.fulfillment_type)}
                      />
                    </div>
                  </button>

                  {orderStatusHistoryOpen &&
                    typeof document !== "undefined" &&
                    createPortal(
                      <>
                        <div
                          className={styles.orderStatusBackdrop}
                          aria-hidden
                          onClick={() => setOrderStatusHistoryOpen(false)}
                        />
                        {orderStatusPopoverRect ? (
                          <div
                            className={styles.orderStatusPopover}
                            style={{
                              top: orderStatusPopoverRect.top,
                              left: orderStatusPopoverRect.left,
                              width: orderStatusPopoverRect.width,
                            }}
                            role="dialog"
                            aria-label="Order updates"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className={styles.orderStatusPopoverBody}>
                              <OrderStatusTimelineChakra
                                readable
                                events={sortedStatusEvents}
                                getStatusLabel={(s) =>
                                  orderStatusCustomerLabel(s as OrderStatus, order.fulfillment_type)
                                }
                              />
                            </div>
                          </div>
                        ) : null}
                      </>,
                      document.body,
                    )}
                </div>
              )}

            </div>

            {/* Add more items — hidden once the order is completed (terminal) */}
            {!terminal && (
              <OrderAddItems
                orderId={orderId}
                locationId={order.location_id}
                placedAt={order.placed_at}
                fulfillmentType={order.fulfillment_type}
                orderStatus={order.status}
              />
            )}

          </div>

          {/* RIGHT — support + reviews */}
          {showOrderActionsColumn ? (
          <div className={styles.rightColumn}>
            {terminal && (
              <div className={`${styles.sideCard} ${styles.reorderSideCard}`}>
                <ReorderButton
                  orderId={orderId}
                  locationId={order.location_id}
                  variant="primary"
                />
              </div>
            )}

            {/* Reviews */}
            <OrderReviews
              orderId={orderId}
              locationId={order.location_id}
              items={order.items}
              orderStatus={order.status}
            />

          </div>
          ) : null}
        </div>
      </main>

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (!cancelling) setShowCancelConfirm(false);
          }}
        >
          <div
            className={`${styles.modalContent} ${styles.cancelConfirmModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-order-title"
            aria-describedby="cancel-order-description"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="cancel-order-title" className={styles.modalTitle}>
              Cancel this order?
            </h3>
            <p id="cancel-order-description" className={styles.modalText}>
              Are you sure you want to cancel order #{order.order_number}? This
              cannot be undone once confirmed.
            </p>
            {cancelError && (
              <p className={styles.cancelConfirmError} role="alert">
                {cancelError}
              </p>
            )}
            <div className={styles.cancelConfirmActions}>
              <button
                type="button"
                className={styles.modalCloseBtn}
                disabled={cancelling}
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep order
              </button>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                disabled={cancelling}
                onClick={confirmCancel}
              >
                {cancelling ? "Cancelling…" : "Yes, cancel order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help modal */}
      {showHelpModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle}>Need help with this order?</h3>
            <p className={styles.modalText}>
              {order.status === "READY"
                ? "Your order is already prepared and can no longer be cancelled here. To request a cancellation, please contact us."
                : "Cancellation might not be possible — your order may already be in preparation. To request a cancellation, please contact us."}
            </p>
            {order.location_phone ? (
              <a
                className={styles.modalContactBtn}
                href={`tel:${order.location_phone}`}
              >
                Contact us · {order.location_phone}
              </a>
            ) : (
              <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "0.75rem" }}>
                Store phone is not available. You can chat with us here instead.
              </p>
            )}
            <button
              type="button"
              className={styles.modalChatBtn}
              onClick={() => {
                setShowHelpModal(false);
                setShowChatModal(true);
              }}
            >
              Chat with us
            </button>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={() => setShowHelpModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Chat modal */}
      {showChatModal && !terminal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowChatModal(false)}
        >
          <div
            className={`${styles.modalContent} ${styles.chatModalContent}`}
            onClick={(e) => e.stopPropagation()}
          >
            <OrderChat
              orderId={orderId}
              locationId={order.location_id}
              isTerminal={false}
              viewerSide="CUSTOMER"
            />
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={() => setShowChatModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Driver chat modal */}
      {showDriverChatModal && !terminal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowDriverChatModal(false)}
        >
          <div
            className={`${styles.modalContent} ${styles.chatModalContent}`}
            onClick={(e) => e.stopPropagation()}
          >
            <OrderChat
              orderId={orderId}
              locationId={order.location_id}
              isTerminal={false}
              viewerSide="CUSTOMER"
              title="Driver chat"
            />
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={() => setShowDriverChatModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Support ticket modal */}
      {showSupport && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowSupport(false)}
        >
          <div
            className={`${styles.modalContent} ${styles.supportModalContent}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SupportTicketForm
              orderId={orderId}
              orderNumber={order.order_number}
              locationId={order.location_id}
              items={order.items}
              onDone={() => setShowSupport(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
