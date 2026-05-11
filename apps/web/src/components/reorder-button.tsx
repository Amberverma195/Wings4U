"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="reorder-modal-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="reorder-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reorder-modal-title"
        aria-describedby="reorder-modal-description"
      >
        <h3 id="reorder-modal-title" className="reorder-modal-title">
          Review your reorder
        </h3>

        {all_unavailable ? (
          <p id="reorder-modal-description" className="surface-error reorder-modal-copy">
            We&apos;re sorry, none of the items from this order are currently available.
          </p>
        ) : (
          <p id="reorder-modal-description" className="surface-muted reorder-modal-copy">
            {items.length} item{items.length === 1 ? "" : "s"} will be added to your cart at
            current prices.
          </p>
        )}

        {diff.skipped.length > 0 && (
          <div className="reorder-modal-section">
            <strong>Skipped</strong>
            <ul className="reorder-modal-list">
              {diff.skipped.map((s, i) => (
                <li key={i}>
                  {s.name} — {SKIP_REASON_COPY[s.reason]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff.modifier_changes.length > 0 && (
          <div className="reorder-modal-section">
            <strong>Modifiers dropped</strong>
            <ul className="reorder-modal-list">
              {diff.modifier_changes.map((c, i) => (
                <li key={i}>
                  {c.name}: {c.dropped.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff.price_changes.length > 0 && (
          <div className="reorder-modal-section">
            <strong>Price changes</strong>
            <ul className="reorder-modal-list">
              {diff.price_changes.map((p, i) => (
                <li key={i}>
                  {p.name}: {formatCents(p.old_cents)} → {formatCents(p.new_cents)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="reorder-modal-actions">
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
    </div>,
    document.body,
  );
}
