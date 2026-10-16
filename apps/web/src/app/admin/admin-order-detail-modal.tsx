"use client";

import { useRef } from "react";
import { useAdminDialog } from "./use-admin-dialog";
import type { OrderDetail, OrderItem } from "@/lib/types";
import { OrderChat } from "@/components/order-chat";
import { PaymentCollectionPanel } from "@/components/payment-collection";
import { adminApiFetch, formatCents } from "./admin-api";

const TERMINAL_STATUSES = new Set([
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
]);

function formatAdminOrderPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  return phone.trim();
}

function formatOrderTime(value: string | null | undefined): string {
  if (!value) return "No ETA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No ETA";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatAddress(address: OrderDetail["address_snapshot_json"]): string | null {
  if (!address || typeof address !== "object") return null;
  return [
    address.line1,
    address.line2,
    address.city,
    address.province,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

function getItemDetails(item: OrderItem): string[] {
  const details: string[] = [];
  for (const flavour of item.flavours) {
    details.push(
      [
        flavour.flavour_name_snapshot,
        flavour.heat_level_snapshot ? `(${flavour.heat_level_snapshot})` : null,
        flavour.placement === "ON_SIDE" ? "[On Side]" : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  for (const modifier of item.modifiers) {
    if (modifier.modifier_kind === "REMOVE_INGREDIENT") {
      details.push(`NO ${modifier.modifier_name_snapshot}`);
    } else {
      details.push(
        `${modifier.quantity > 1 ? `${modifier.quantity}x ` : ""}${modifier.modifier_name_snapshot}`,
      );
    }
  }
  return details;
}

export function AdminOrderDetailModal({
  order,
  onClose,
  onPaymentRecorded,
  returnFocusTo,
}: {
  order: OrderDetail;
  onClose: () => void;
  onPaymentRecorded: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useAdminDialog({ dialogRef, initialFocusRef: closeRef, onClose, returnFocusTo });
  const isTerminal = TERMINAL_STATUSES.has(order.status);
  const address = formatAddress(order.address_snapshot_json);

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-order-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(1200px, 96vw)",
          height: "min(760px, 88vh)",
          display: "flex",
          flexDirection: "column",
          background: "white",
          color: "#17120d",
          borderRadius: "24px",
          padding: "1.5rem",
          boxShadow: "0 32px 80px rgba(0,0,0,0.25)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "flex-start",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h2 id="admin-order-detail-title" style={{ margin: "0 0 0.35rem" }}>
              Order #{order.order_number}{" "}
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                ({order.id})
              </span>
            </h2>
            <p
              style={{
                margin: 0,
                display: "inline-block",
                padding: "0.5rem 0.85rem",
                borderRadius: "12px",
                border: "1px solid rgba(217, 119, 6, 0.2)",
                background: "#fef3c7",
                color: "#111827",
                fontSize: "0.92rem",
                fontWeight: 650,
                lineHeight: 1.45,
              }}
            >
              {order.customer_name_snapshot ?? "Guest"}
              {order.customer_phone_snapshot
                ? ` | ${formatAdminOrderPhone(order.customer_phone_snapshot)}`
                : ""}
              {order.customer_email_snapshot ? ` | ${order.customer_email_snapshot}` : ""}
              {" | "}
              {order.fulfillment_type}
              {" | "}
              {order.status}
              {" | Placed: "}
              {formatOrderTime(order.placed_at)}
              {" | ETA: "}
              {formatOrderTime(order.estimated_ready_at)}
            </p>
          </div>
          <button ref={closeRef} type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        <div style={{ display: "flex", gap: "1.5rem", flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 2,
              minWidth: 0,
              overflowY: "auto",
              paddingRight: "0.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <section>
              <h3 style={{ margin: "0 0 1rem" }}>Items</h3>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {order.items.map((item) => {
                  const details = getItemDetails(item);
                  return (
                    <li
                      key={item.id}
                      style={{
                        marginBottom: "1rem",
                        paddingBottom: "1rem",
                        borderBottom: "1px dashed var(--border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "1rem",
                        }}
                      >
                        <strong style={{ fontSize: "1.05rem" }}>
                          {item.quantity}x {item.product_name_snapshot}
                        </strong>
                        <strong>{formatCents(item.line_total_cents)}</strong>
                      </div>
                      {details.length > 0 ? (
                        <ul
                          style={{
                            margin: "0.35rem 0 0 1.5rem",
                            padding: 0,
                            color: "#34495e",
                          }}
                        >
                          {details.map((detail, index) => (
                            <li key={`${item.id}-${index}`}>{detail}</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.special_instructions ? (
                        <p
                          style={{
                            margin: "0.5rem 0 0",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            background: "#fdf2e9",
                            color: "#c0392b",
                            fontWeight: 700,
                            fontStyle: "italic",
                          }}
                        >
                          Note: {item.special_instructions}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            {order.customer_order_notes || address ? (
              <section
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  background: "#fffbeb",
                  padding: "0.85rem 1rem",
                }}
              >
                {order.customer_order_notes ? (
                  <p style={{ margin: 0 }}>
                    <strong>Customer notes:</strong> {order.customer_order_notes}
                  </p>
                ) : null}
                {address ? (
                  <p style={{ margin: order.customer_order_notes ? "0.45rem 0 0" : 0 }}>
                    <strong>Delivery address:</strong> {address}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section
              style={{
                marginTop: "auto",
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                background: "var(--surface)",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem" }}>Pricing Summary</h3>
              <SummaryLine label="Subtotal" value={order.item_subtotal_cents} />
              {order.item_discount_total_cents + order.order_discount_total_cents > 0 ? (
                <SummaryLine
                  label="Discounts"
                  value={-(order.item_discount_total_cents + order.order_discount_total_cents)}
                  tone="danger"
                />
              ) : null}
              {order.delivery_fee_cents > 0 ? (
                <SummaryLine label="Delivery Fee" value={order.delivery_fee_cents} />
              ) : null}
              {order.tax_cents > 0 ? (
                <SummaryLine label="Tax" value={order.tax_cents} />
              ) : null}
              {order.driver_tip_cents > 0 ? (
                <SummaryLine label="Tip" value={order.driver_tip_cents} />
              ) : null}
              {order.wallet_applied_cents > 0 ? (
                <SummaryLine
                  label="Wallet Credit"
                  value={-order.wallet_applied_cents}
                  tone="success"
                />
              ) : null}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "0.6rem",
                  paddingTop: "0.6rem",
                  borderTop: "1px solid var(--border)",
                  fontWeight: 800,
                  fontSize: "1.08rem",
                }}
              >
                <span>Total</span>
                <span>{formatCents(order.final_payable_cents)}</span>
              </div>
            </section>

            <section
              style={{
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                background: "var(--surface)",
              }}
            >
              <h3 style={{ margin: "0 0 0.75rem" }}>Payment</h3>
              <PaymentCollectionPanel
                paymentsPath={`/api/v1/orders/${order.id}/payments`}
                locationId={order.location_id}
                fetcher={adminApiFetch}
                onRecorded={onPaymentRecorded}
              />
            </section>
          </div>

          <aside
            style={{
              flex: 1,
              minWidth: 0,
              borderLeft: "1px solid var(--border)",
              paddingLeft: "1.5rem",
              overflowY: "auto",
            }}
          >
            <OrderChat
              orderId={order.id}
              locationId={order.location_id}
              isTerminal={isTerminal}
              viewerSide="STAFF"
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "success";
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: "0.25rem",
        color:
          tone === "danger"
            ? "#c0392b"
            : tone === "success"
              ? "#27ae60"
              : undefined,
      }}
    >
      <span>{label}</span>
      <span>{value < 0 ? `-${formatCents(Math.abs(value))}` : formatCents(value)}</span>
    </div>
  );
}
