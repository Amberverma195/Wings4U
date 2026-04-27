"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useSession, withSilentRefresh } from "@/lib/session";
import type {
  CartBuilderPayload,
  CartItem,
  CartModifierSelection,
  RemovedIngredientSelection,
} from "@/lib/types";

// Response from POST /api/v1/orders/:id/reorder. Shape matches
// OrdersService.reorder() in apps/api.
type ReorderItem = {
  menu_item_id: string;
  menu_item_slug: string | null;
  name: string;
  image_url: string | null;
  base_price_cents: number;
  quantity: number;
  modifier_selections: CartModifierSelection[];
  removed_ingredients: RemovedIngredientSelection[];
  special_instructions: string;
  builder_payload: Record<string, unknown> | null;
};

type ReorderDiff = {
  skipped: Array<{
    name: string;
    reason:
      | "unavailable"
      | "archived"
      | "location_mismatch"
      | "required_group_missing";
  }>;
  modifier_changes: Array<{ name: string; dropped: string[] }>;
  price_changes: Array<{ name: string; old_cents: number; new_cents: number }>;
};

type ReorderResponse = {
  order_id: string;
  location_id: string;
  fulfillment_type_hint: string;
  items: ReorderItem[];
  diff: ReorderDiff;
  all_unavailable: boolean;
};

const SKIP_REASON_COPY: Record<ReorderDiff["skipped"][number]["reason"], string> = {
  unavailable: "currently unavailable",
  archived: "no longer offered",
  location_mismatch: "not on this location's menu",
  required_group_missing: "requires options that are no longer available",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ReorderButton({
  orderId,
  locationId,
  variant = "primary",
  label = "Order again",
}: {
  orderId: string;
  /**
   * Location the order was placed at. Required because the backend
   * `OrdersController` is behind `LocationScopeGuard`, which rejects any
   * request without a valid `X-Location-Id` UUID header (422
   * "X-Location-Id header must be a valid UUID"). Pass `order.location_id`
   * from the order detail page or `o.location_id` from the order list.
   */
  locationId: string;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const router = useRouter();
  const cart = useCart();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReorderResponse | null>(null);

  const fetchPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/orders/${orderId}/reorder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            locationId,
          }),
        session.refresh,
        session.clear,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.errors?.[0]?.message ?? `Reorder failed (${res.status})`);
      }
      setPreview(body.data as ReorderResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmReorder = () => {
    if (!preview) return;
    // PRD §7: "If nothing could be added (all items unavailable): do not open
    // an empty cart or navigate away."
    if (preview.all_unavailable) {
      setPreview(null);
      return;
    }
    if (preview.location_id !== cart.locationId) {
      setError(
        "This order was placed at a different location. Reorder is only available on the matching location.",
      );
      setPreview(null);
      return;
    }
    for (const item of preview.items) {
      const incoming: Omit<CartItem, "key"> = {
        menu_item_id: item.menu_item_id,
        menu_item_slug: item.menu_item_slug,
        name: item.name,
        image_url: item.image_url,
        base_price_cents: item.base_price_cents,
        quantity: item.quantity,
        modifier_selections: item.modifier_selections,
        removed_ingredients: item.removed_ingredients,
        special_instructions: item.special_instructions,
        builder_payload: (item.builder_payload as CartBuilderPayload | null) ?? undefined,
      };
      cart.addItem(incoming);
    }
    setPreview(null);
    router.push("/cart");
  };

  const buttonClass = variant === "primary" ? "btn-primary" : "btn-secondary";

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void fetchPreview();
        }}
        disabled={busy}
      >
        {busy ? "Loading..." : label}
      </button>
      {error && (
        <p className="surface-error" style={{ marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
      {preview && (
        <ReorderConfirmModal
          preview={preview}
          onConfirm={confirmReorder}
          onCancel={() => setPreview(null)}
        />
      )}
    </>
  );
}

function ReorderConfirmModal({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ReorderResponse;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { items, diff, all_unavailable } = preview;
  const hasAnyDiff =
    diff.skipped.length > 0 ||
    diff.modifier_changes.length > 0 ||
    diff.price_changes.length > 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "18px",
          padding: "1.5rem",
          maxWidth: "520px",
          width: "90%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 0.75rem" }}>Review your reorder</h3>

        {all_unavailable ? (
          <p className="surface-error">
            We&apos;re sorry, none of the items from this order are currently available.
          </p>
        ) : (
          <p className="surface-muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            {items.length} item{items.length === 1 ? "" : "s"} will be added to your cart at
            current prices.
          </p>
        )}

        {diff.skipped.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <strong>Skipped</strong>
            <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
              {diff.skipped.map((s, i) => (
                <li key={i}>
                  {s.name} — {SKIP_REASON_COPY[s.reason]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff.modifier_changes.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <strong>Modifiers dropped</strong>
            <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
              {diff.modifier_changes.map((c, i) => (
                <li key={i}>
                  {c.name}: {c.dropped.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff.price_changes.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <strong>Price changes</strong>
            <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
              {diff.price_changes.map((p, i) => (
                <li key={i}>
                  {p.name}: {formatCents(p.old_cents)} → {formatCents(p.new_cents)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasAnyDiff && !all_unavailable && (
          <p className="surface-muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            Everything from your original order is available at the same price.
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            marginTop: "1.25rem",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {all_unavailable ? "Close" : "Cancel"}
          </button>
          {!all_unavailable && (
            <button type="button" className="btn-primary" onClick={onConfirm}>
              Add to cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
