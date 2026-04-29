"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents } from "@/lib/format";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { SessionState } from "@/lib/session";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModifierOption = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_default: boolean;
};

type ModifierGroup = {
  id: string;
  name: string;
  display_label: string | null;
  selection_mode: "SINGLE" | "MULTI" | string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  sort_order: number;
  options: ModifierOption[];
};

type MenuItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  is_available: boolean;
  stock_status: string;
  builder_type: string | null;
  modifier_groups: ModifierGroup[];
};

type MenuCategory = {
  id: string;
  name: string;
  slug: string;
  items: MenuItem[];
};

type MenuResponse = {
  categories: MenuCategory[];
  location: { name: string };
};

type CartLine = {
  /** Local-only id for React reconciliation. */
  localId: string;
  menuItemId: string;
  name: string;
  unitBaseCents: number;
  quantity: number;
  modifiers: {
    modifierOptionId: string;
    groupName: string;
    optionName: string;
    priceDeltaCents: number;
  }[];
  specialInstructions?: string;
};

type PaymentMethod = "CASH" | "CARD_TERMINAL" | "STORE_CREDIT";
type FulfillmentType = "PICKUP" | "DELIVERY";
type OrderSource = "POS" | "PHONE";

type PosOrder = {
  id: string;
  order_number: number;
  order_source: string;
  fulfillment_type: string;
  status: string;
  placed_at: string;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  final_payable_cents: number;
  payment_status_summary: string | null;
};

type Envelope<T> = { data?: T; errors?: { message: string }[] | null };

type SessionControls = Pick<SessionState, "refresh" | "clear">;

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD_TERMINAL: "Card",
  STORE_CREDIT: "Store Credit",
};

const POS_PIN_LENGTH = 5;
const POS_KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "backspace"],
] as const;

/* ------------------------------------------------------------------ */
/*  Role helpers                                                       */
/* ------------------------------------------------------------------ */

function canEnterPos(session: SessionState): boolean {
  if (!session.authenticated || !session.user) return false;
  return session.user.role === "ADMIN" || session.user.role === "STAFF";
}

function canApplyDiscount(session: SessionState): boolean {
  if (!session.authenticated || !session.user) return false;
  if (session.user.role === "ADMIN") return true;
  return session.user.role === "STAFF" && session.user.employeeRole === "MANAGER";
}

/* ------------------------------------------------------------------ */
/*  Fetch helper — one-time silent refresh on 401                      */
/* ------------------------------------------------------------------ */

async function posJson<T>(
  controls: SessionControls,
  path: string,
  init: RequestInit & { locationId?: string } = {},
): Promise<T> {
  const res = await withSilentRefresh(
    () => apiFetch(path, init),
    controls.refresh,
    controls.clear,
  );
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok) {
    throw new Error(getApiErrorMessage(body, `Request failed (${res.status})`));
  }
  if (!body || body.data === undefined) {
    throw new Error("Request succeeded without a response body");
  }
  return body.data;
}

/* ================================================================== */
/*  Root                                                               */
/* ================================================================== */

function PosFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pos-root">
      <header className="pos-topbar">
        <div className="pos-brand">
          WINGS 4U <span className="pos-brand-badge">POS</span>
        </div>
      </header>

      <div className="pos-login-stage">{children}</div>
    </div>
  );
}

function PosStatusScreen({
  eyebrow = "STATION ACCESS",
  title,
  message,
  actionLabel,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <PosFrame>
      <section className="pos-login-card">
        <p className="pos-login-eyebrow">{eyebrow}</p>
        <h1 className="pos-login-title">{title}</h1>
        <p className="pos-login-sub">{message}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            className="pos-btn pos-btn--primary pos-login-submit"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </section>
    </PosFrame>
  );
}

export function PosClient() {
  const session = useSession();

  if (!session.loaded) {
    return (
      <PosStatusScreen
        title="Checking session"
        message="Loading POS access..."
      />
    );
  }

  if (!session.authenticated || !canEnterPos(session)) {
    return (
      <PosStatusScreen
        title="POS unavailable"
        message="This station is reserved for authorized staff on the configured store IP."
      />
    );
  }

  if (session.user?.role === "STAFF" && !session.isPosSession) {
    return <PosLoginScreen session={session} />;
  }

  return <PosShell session={session} />;
}

function PosLoginScreen({ session }: { session: SessionState }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = useCallback(
    async (nextCode: string) => {
      if (busy || nextCode.length !== POS_PIN_LENGTH) return;

      setBusy(true);
      setError(null);

      try {
        const res = await apiFetch("/api/v1/auth/pos/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_code: nextCode,
            location_id: DEFAULT_LOCATION_ID,
          }),
        });
        const body = (await res.json().catch(() => null)) as Envelope<unknown> | null;
        if (!res.ok) {
          throw new Error(getApiErrorMessage(body, `Request failed (${res.status})`));
        }
        setCode("");
        await session.refresh();
      } catch (err) {
        setCode("");
        setError(err instanceof Error ? err.message : "Could not sign in");
      } finally {
        setBusy(false);
      }
    },
    [busy, session],
  );

  const appendDigit = useCallback(
    (digit: string) => {
      if (busy || code.length >= POS_PIN_LENGTH) return;
      const nextCode = `${code}${digit}`;
      setCode(nextCode);
      setError(null);
      if (nextCode.length === POS_PIN_LENGTH) {
        void submitCode(nextCode);
      }
    },
    [busy, code, submitCode],
  );

  const clearCode = useCallback(() => {
    if (busy) return;
    setCode("");
    setError(null);
  }, [busy]);

  const backspace = useCallback(() => {
    if (busy) return;
    setCode((current) => current.slice(0, -1));
    setError(null);
  }, [busy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        appendDigit(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearCode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appendDigit, backspace, clearCode]);

  return (
    <PosFrame>
      <section className="pos-login-card" aria-label="POS employee login">
        <p className="pos-login-eyebrow">STATION ACCESS</p>
        <h1 className="pos-login-title">Enter employee PIN</h1>
        <p className="pos-login-sub">
          Store network verified. Use the store&apos;s 5-digit employee code to
          unlock the register.
        </p>

        <div className="pos-pin-display" aria-label="Entered PIN">
          {Array.from({ length: POS_PIN_LENGTH }, (_, index) => (
            <div
              key={index}
              className={
                "pos-pin-dot" + (code[index] ? " pos-pin-dot--filled" : "")
              }
              aria-hidden="true"
            >
              {code[index] ? "•" : ""}
            </div>
          ))}
        </div>

        <div className="pos-keypad" role="group" aria-label="PIN keypad">
          {POS_KEYPAD_ROWS.flat().map((key) => {
            if (key === "clear") {
              return (
                <button
                  key={key}
                  type="button"
                  className="pos-key pos-key--action"
                  onClick={clearCode}
                  disabled={busy}
                >
                  Clear
                </button>
              );
            }
            if (key === "backspace") {
              return (
                <button
                  key={key}
                  type="button"
                  className="pos-key pos-key--action"
                  onClick={backspace}
                  disabled={busy || code.length === 0}
                  aria-label="Backspace"
                >
                  Delete
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                className="pos-key"
                onClick={() => appendDigit(key)}
                disabled={busy}
              >
                {key}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="pos-btn pos-btn--primary pos-login-submit"
          onClick={() => void submitCode(code)}
          disabled={busy || code.length !== POS_PIN_LENGTH}
        >
          {busy ? "Signing in..." : "Unlock register"}
        </button>

        {error ? <p className="pos-login-error">{error}</p> : null}
      </section>
    </PosFrame>
  );
}

/* ================================================================== */
/*  Main POS shell                                                     */
/* ================================================================== */

function PosShell({ session }: { session: SessionState }) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [fulfillmentType, setFulfillmentType] =
    useState<FulfillmentType>("PICKUP");
  const [orderSource, setOrderSource] = useState<OrderSource>("POS");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [amountTendered, setAmountTendered] = useState<string>("");
  const [orderNotes, setOrderNotes] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeSuccess, setPlaceSuccess] = useState<string | null>(null);

  const [todayOrders, setTodayOrders] = useState<PosOrder[]>([]);
  const [discountOrder, setDiscountOrder] = useState<PosOrder | null>(null);

  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [ordersSearchQuery, setOrdersSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<PosOrder | null>(null);

  const controls: SessionControls = useMemo(
    () => ({ refresh: session.refresh, clear: session.clear }),
    [session.refresh, session.clear],
  );

  /* ---------- Menu fetch ---------- */

  const loadMenu = useCallback(async () => {
    try {
      const data = await posJson<MenuResponse>(
        controls,
        `/api/v1/menu?location_id=${DEFAULT_LOCATION_ID}&fulfillment_type=${fulfillmentType}`,
        { locationId: DEFAULT_LOCATION_ID },
      );
      setMenu(data);
      setMenuError(null);
      setActiveCategoryId((prev) =>
        prev && data.categories.some((category) => category.id === prev)
          ? prev
          : data.categories[0]?.id ?? null,
      );
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : "Failed to load menu");
    }
  }, [controls, fulfillmentType]);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  /* ---------- Today's orders fetch ---------- */

  const loadOrders = useCallback(async () => {
    try {
      const data = await posJson<PosOrder[]>(controls, "/api/v1/pos/orders", {
        locationId: DEFAULT_LOCATION_ID,
      });
      setTodayOrders(data);
    } catch {
      // Non-fatal; the strip just stays empty.
    }
  }, [controls]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  /* ---------- Cart ops ---------- */

  const addSimpleItem = useCallback((item: MenuItem) => {
    if (item.builder_type) {
      // POS does not render the in-app wing builder; direct staff to the
      // customer-facing flow for those products.
      alert(
        "Wings & wing-combo builders are not available in POS mode yet. Use the customer app to build these items.",
      );
      return;
    }
    if (item.modifier_groups.length > 0) {
      // Handled via modifier modal.
      return;
    }
    setCart((prev) => {
      // Merge into existing identical simple line.
      const existing = prev.find(
        (l) => l.menuItemId === item.id && l.modifiers.length === 0,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          localId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          menuItemId: item.id,
          name: item.name,
          unitBaseCents: item.base_price_cents,
          quantity: 1,
          modifiers: [],
        },
      ];
    });
  }, []);

  const openModifierPicker = useCallback((item: MenuItem) => {
    if (item.builder_type) {
      alert("Wings/combos use the customer app builder.");
      return;
    }
    setModifierItem(item);
  }, []);

  const addConfiguredItem = useCallback(
    (line: CartLine) => {
      setCart((prev) => [...prev, line]);
      setModifierItem(null);
    },
    [],
  );

  const adjustQuantity = useCallback((localId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.localId === localId
            ? { ...l, quantity: Math.max(0, l.quantity + delta) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeLine = useCallback((localId: string) => {
    setCart((prev) => prev.filter((l) => l.localId !== localId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setAmountTendered("");
    setOrderNotes("");
    setCustomerName("");
    setCustomerPhone("");
    setPlaceError(null);
    setPlaceSuccess(null);
    setCurrentOrderId(null);
  }, []);

  const startNewOrder = useCallback(() => {
    clearCart();
    setCurrentOrderId(`ORD-${Math.floor(1000 + Math.random() * 9000)}`);
  }, [clearCart]);

  /* ---------- Pricing preview (client-side estimate) ---------- */

  const subtotalCents = useMemo(() => {
    return cart.reduce((acc, line) => {
      const modDelta = line.modifiers.reduce(
        (sum, m) => sum + m.priceDeltaCents,
        0,
      );
      return acc + (line.unitBaseCents + modDelta) * line.quantity;
    }, 0);
  }, [cart]);

  // Estimated 13% tax for display only; backend recomputes from the
  // location's configured tax rate and that's what actually gets charged.
  const estimatedTaxCents = Math.round(subtotalCents * 0.13);
  const estimatedTotalCents = subtotalCents + estimatedTaxCents;

  const changeDueCents = useMemo(() => {
    if (paymentMethod !== "CASH") return null;
    const num = Number.parseFloat(amountTendered);
    if (!Number.isFinite(num) || num <= 0) return null;
    const tenderedCents = Math.round(num * 100);
    if (tenderedCents < estimatedTotalCents) return null;
    return tenderedCents - estimatedTotalCents;
  }, [amountTendered, estimatedTotalCents, paymentMethod]);

  /* ---------- Place order ---------- */

  const placeOrder = useCallback(async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    setPlaceError(null);
    setPlaceSuccess(null);

    const amountTenderedCents =
      paymentMethod === "CASH" && amountTendered
        ? Math.round(Number.parseFloat(amountTendered) * 100)
        : undefined;

    try {
      const payload: Record<string, unknown> = {
        fulfillment_type: fulfillmentType,
        order_source: orderSource,
        payment_method: paymentMethod,
        items: cart.map((l) => ({
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          modifier_selections: l.modifiers.map((m) => ({
            modifier_option_id: m.modifierOptionId,
          })),
          ...(l.specialInstructions
            ? { special_instructions: l.specialInstructions }
            : {}),
        })),
      };
      if (customerName.trim()) payload.customer_name = customerName.trim();
      if (customerPhone.trim()) payload.customer_phone = customerPhone.trim();
      if (amountTenderedCents != null && Number.isFinite(amountTenderedCents)) {
        payload.amount_tendered = amountTenderedCents;
      }
      if (orderNotes.trim()) payload.special_instructions = orderNotes.trim();

      const data = await posJson<{
        order_number: number;
        final_payable_cents: number;
        change_due_cents?: number;
      }>(controls, "/api/v1/pos/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        locationId: DEFAULT_LOCATION_ID,
      });

      const msg =
        data.change_due_cents != null
          ? `Order #${data.order_number} placed • ${cents(data.final_payable_cents)} • Change ${cents(data.change_due_cents)}`
          : `Order #${data.order_number} placed • ${cents(data.final_payable_cents)}`;
      setPlaceSuccess(msg);
      clearCart();
      void loadOrders();
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : "Could not place order");
    } finally {
      setPlacing(false);
    }
  }, [
    amountTendered,
    cart,
    clearCart,
    controls,
    customerName,
    customerPhone,
    fulfillmentType,
    loadOrders,
    orderNotes,
    orderSource,
    paymentMethod,
  ]);

  /* ---------- Sign out ---------- */

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Best effort: fall back to a local clear if the network request fails.
    }
    session.clear();
    if (typeof window !== "undefined") {
      window.location.assign("/auth/login");
    }
  }, [session]);

  /* ---------- Render ---------- */

  const activeCategory = useMemo(() => {
    if (!menu) return null;
    return (
      menu.categories.find((c) => c.id === activeCategoryId) ??
      menu.categories[0] ??
      null
    );
  }, [activeCategoryId, menu]);

  return (
    <div className="pos-root">
      <header className="pos-topbar">
        <div className="pos-brand">
          WINGS 4U <span className="pos-brand-badge">POS</span>
        </div>
        <div className="pos-topbar-right">
          <div className="pos-topbar-nav">
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={startNewOrder}
            >
              New Order
            </button>
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={() => setShowOrdersModal(true)}
            >
              Orders
            </button>
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={() => alert("Employee functions placeholder")}
            >
              Staff
            </button>
          </div>
          <div className="pos-user-chip">
            <strong>{session.user?.displayName ?? "Employee"}</strong>
            <span>{session.user?.employeeRole ?? session.user?.role ?? "STAFF"}</span>
          </div>
          <button
            type="button"
            className="pos-btn pos-btn--ghost"
            style={{ fontSize: "0.75rem", padding: "0.4rem 0.6rem" }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="pos-workspace">
        <section className="pos-cart" aria-label="Cart">
          {currentOrderId && (
            <div className="pos-order-id-display">
              <span>Order ID: <strong>{currentOrderId}</strong></span>
              <button
                type="button"
                className="pos-modal-close"
                style={{ fontSize: "1.1rem", padding: "0 0.25rem" }}
                onClick={() => setCurrentOrderId(null)}
              >
                ×
              </button>
            </div>
          )}
          {cart.length > 0 ? (
            <div className="pos-cart-header">
              <button
                type="button"
                className="pos-btn pos-btn--danger"
                style={{ padding: "0.4rem 0.7rem", fontSize: "0.8rem" }}
                onClick={clearCart}
              >
                Clear
              </button>
            </div>
          ) : null}

          {cart.length === 0 ? (
            <div className="pos-empty" />
          ) : (
            <div className="pos-cart-list">
              {cart.map((line) => {
                const unitCents =
                  line.unitBaseCents +
                  line.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
                return (
                  <div key={line.localId} className="pos-cart-line">
                    <div className="pos-cart-line-body">
                      <div className="pos-cart-line-name">
                        <span>{line.name}</span>
                        <span>{cents(unitCents * line.quantity)}</span>
                      </div>
                      {line.modifiers.length > 0 ? (
                        <div className="pos-cart-line-mods">
                          {line.modifiers
                            .map(
                              (m) =>
                                `${m.optionName}${m.priceDeltaCents ? ` (+${cents(m.priceDeltaCents)})` : ""}`,
                            )
                            .join(", ")}
                        </div>
                      ) : null}
                      <div className="pos-qty" style={{ marginTop: "0.45rem" }}>
                        <button
                          type="button"
                          aria-label="Decrease"
                          onClick={() => adjustQuantity(line.localId, -1)}
                        >
                          −
                        </button>
                        <span className="pos-qty-value">{line.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase"
                          onClick={() => adjustQuantity(line.localId, +1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          aria-label="Remove"
                          style={{ marginLeft: "auto", color: "#b91c1c" }}
                          onClick={() => removeLine(line.localId)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pos-cart-footer">
            <div className="pos-customer-fields">
              <label className="pos-field">
                Fulfillment
                <div className="pos-segmented">
                  <button
                    type="button"
                    aria-pressed={fulfillmentType === "PICKUP"}
                    onClick={() => setFulfillmentType("PICKUP")}
                  >
                    Pickup
                  </button>
                  <button
                    type="button"
                    aria-pressed={fulfillmentType === "DELIVERY"}
                    onClick={() => setFulfillmentType("DELIVERY")}
                  >
                    Delivery
                  </button>
                </div>
              </label>
              <label className="pos-field">
                Source
                <div className="pos-segmented">
                  <button
                    type="button"
                    aria-pressed={orderSource === "POS"}
                    onClick={() => setOrderSource("POS")}
                  >
                    Walk-in
                  </button>
                  <button
                    type="button"
                    aria-pressed={orderSource === "PHONE"}
                    onClick={() => setOrderSource("PHONE")}
                  >
                    Phone
                  </button>
                </div>
              </label>
              <label className="pos-field">
                Customer name
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </label>
              <label className="pos-field">
                Phone
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+1 519 ..."
                  autoComplete="off"
                />
              </label>
              <label className="pos-field" style={{ gridColumn: "1 / -1" }}>
                Notes
                <textarea
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Special instructions for the kitchen"
                  rows={2}
                />
              </label>
            </div>

            <div className="pos-cart-totals">
              <div className="pos-cart-totals-row">
                <span>Subtotal</span>
                <span>{cents(subtotalCents)}</span>
              </div>
              <div className="pos-cart-totals-row">
                <span>Tax (est.)</span>
                <span>{cents(estimatedTaxCents)}</span>
              </div>
              <div className="pos-cart-totals-row pos-cart-totals-row--emph">
                <span>Total</span>
                <span>{cents(estimatedTotalCents)}</span>
              </div>
            </div>

            <div className="pos-payments" role="radiogroup" aria-label="Payment method">
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-pressed={paymentMethod === m}
                  aria-checked={paymentMethod === m}
                  className="pos-payment-btn"
                  onClick={() => setPaymentMethod(m)}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>

            {paymentMethod === "CASH" ? (
              <div className="pos-customer-fields" style={{ marginTop: "0.75rem" }}>
                <label className="pos-field">
                  Amount tendered
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="pos-field">
                  Change due
                  <input
                    type="text"
                    readOnly
                    value={
                      changeDueCents != null ? cents(changeDueCents) : "—"
                    }
                  />
                </label>
              </div>
            ) : null}

            <button
              type="button"
              className="pos-btn pos-btn--primary pos-place-btn"
              onClick={() => void placeOrder()}
              disabled={placing || cart.length === 0}
            >
              {placing
                ? "Placing…"
                : `Place Order • ${cents(estimatedTotalCents)}`}
            </button>

            {placeError ? (
              <div className="pos-cart-message">{placeError}</div>
            ) : null}
            {placeSuccess ? (
              <div className="pos-cart-message pos-cart-message--ok">
                {placeSuccess}
              </div>
            ) : null}
          </div>
        </section>

        <section className="pos-left">
          {showOrdersModal && (
            <div className="pos-orders-overlay">
              <div className="pos-orders-header">
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Daily Orders</h2>
                <button
                  type="button"
                  className="pos-modal-close"
                  onClick={() => {
                    setShowOrdersModal(false);
                    setSelectedOrder(null);
                  }}
                >
                  ×
                </button>
              </div>

              <div className="pos-orders-search">
                <input
                  type="text"
                  placeholder="Search by Order ID or Customer Name..."
                  value={ordersSearchQuery}
                  onChange={(e) => setOrdersSearchQuery(e.target.value)}
                />
              </div>

              <div className="pos-orders-content">
                <div className="pos-orders-sidebar">
                  <div className="pos-orders-list-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {todayOrders
                      .filter((o) => {
                        const q = ordersSearchQuery.toLowerCase();
                        return (
                          o.order_number.toString().includes(q) ||
                          (o.customer_name_snapshot ?? "")
                            .toLowerCase()
                            .includes(q) ||
                          (o.customer_phone_snapshot ?? "").includes(q)
                        );
                      })
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={
                            "pos-order-item" +
                            (selectedOrder?.id === o.id
                              ? " pos-order-item--active"
                              : "")
                          }
                          onClick={() => setSelectedOrder(o)}
                        >
                          <span className="pos-order-item-id">
                            #{o.order_number}
                          </span>
                          <div className="pos-order-item-meta">
                            <div>{o.customer_name_snapshot || "Walk-in"}</div>
                            <div>{o.customer_phone_snapshot || "No phone"}</div>
                            <div>
                              {new Date(o.placed_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                          <span className="pos-order-item-total">
                            {cents(o.final_payable_cents)}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>

                <div className="pos-orders-detail-view">
                  {selectedOrder ? (
                    <>
                      <div className="pos-order-detail-header">
                        <h3>Order #{selectedOrder.order_number}</h3>
                        <div className="pos-order-detail-grid">
                          <div className="pos-detail-group">
                            <label>Customer</label>
                            <span>
                              {selectedOrder.customer_name_snapshot || "Walk-in"}
                            </span>
                          </div>
                          <div className="pos-detail-group">
                            <label>Phone</label>
                            <span>
                              {selectedOrder.customer_phone_snapshot || "—"}
                            </span>
                          </div>
                          <div className="pos-detail-group">
                            <label>Placed On</label>
                            <span>
                              {new Date(selectedOrder.placed_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="pos-detail-group">
                            <label>Source</label>
                            <span>{selectedOrder.order_source}</span>
                          </div>
                        </div>
                      </div>

                      <div className="pos-order-detail-items">
                        {(selectedOrder as any).items?.map(
                          (item: any, idx: number) => (
                            <div key={idx} className="pos-detail-item-row">
                              <div className="pos-detail-item-info">
                                <h4>
                                  {item.quantity}× {item.product_name_snapshot}
                                </h4>
                                {item.modifiers?.length > 0 && (
                                  <div className="pos-detail-item-mods">
                                    {item.modifiers
                                      .map(
                                        (m: any) => m.modifier_name_snapshot,
                                      )
                                      .join(", ")}
                                  </div>
                                )}
                              </div>
                              <div className="pos-detail-item-price">
                                {cents(item.line_total_cents)}
                              </div>
                            </div>
                          ),
                        )}
                      </div>

                      <div
                        className="pos-cart-totals"
                        style={{ marginTop: "auto" }}
                      >
                        <div className="pos-cart-totals-row pos-cart-totals-row--emph">
                          <span>Total</span>
                          <span>{cents(selectedOrder.final_payable_cents)}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="pos-empty">
                      Select an order to view details
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="pos-tabs" role="tablist">
            {(menu?.categories ?? []).map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={cat.id === activeCategory?.id}
                className={
                  "pos-tab" +
                  (cat.id === activeCategory?.id ? " pos-tab--active" : "")
                }
                onClick={() => setActiveCategoryId(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {menuError ? (
            <p className="pos-empty">{menuError}</p>
          ) : !menu ? (
            <p className="pos-empty">Loading menu…</p>
          ) : !activeCategory || activeCategory.items.length === 0 ? (
            <p className="pos-empty">No items in this category.</p>
          ) : (
            <div className="pos-items-grid">
              {activeCategory.items.map((item) => {
                const isBuilder = Boolean(item.builder_type);
                const hasMods = item.modifier_groups.length > 0;
                const outOfStock =
                  !item.is_available ||
                  item.stock_status === "SOLD_OUT" ||
                  item.stock_status === "UNAVAILABLE";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="pos-item-card"
                    disabled={outOfStock || isBuilder}
                    onClick={() =>
                      hasMods ? openModifierPicker(item) : addSimpleItem(item)
                    }
                  >
                    <div className="pos-item-name">{item.name}</div>
                    <div className="pos-item-price">
                      {cents(item.base_price_cents)}
                    </div>
                    <div className="pos-item-meta">
                      {isBuilder
                        ? "Use customer app"
                        : outOfStock
                          ? "Unavailable"
                          : hasMods
                            ? `${item.modifier_groups.length} mod group${item.modifier_groups.length === 1 ? "" : "s"}`
                            : "Tap to add"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <OrdersStrip
            orders={todayOrders}
            canDiscount={canApplyDiscount(session)}
            onRefresh={() => void loadOrders()}
            onDiscount={setDiscountOrder}
          />
        </section>


      </div>

      {modifierItem ? (
        <ModifierPicker
          item={modifierItem}
          onClose={() => setModifierItem(null)}
          onAdd={addConfiguredItem}
        />
      ) : null}

      {discountOrder ? (
        <ManualDiscountModal
          order={discountOrder}
          controls={controls}
          onClose={() => setDiscountOrder(null)}
          onApplied={() => {
            setDiscountOrder(null);
            void loadOrders();
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== */
/*  Modifier picker                                                    */
/* ================================================================== */

function ModifierPicker({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  // Initialise required SINGLE-select groups with their default / first
  // option so the "Add" button reflects backend requirements without
  // forcing staff through a redundant tap.
  const initialSelection = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const group of item.modifier_groups) {
      if (group.selection_mode === "SINGLE" && group.is_required) {
        const def =
          group.options.find((o) => o.is_default) ?? group.options[0];
        if (def) out[group.id] = [def.id];
      }
    }
    return out;
  }, [item]);

  const [selection, setSelection] =
    useState<Record<string, string[]>>(initialSelection);
  const [notes, setNotes] = useState("");

  const toggle = useCallback((group: ModifierGroup, optionId: string) => {
    setSelection((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === "SINGLE") {
        return { ...prev, [group.id]: [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (group.max_select && current.length >= group.max_select) {
        // Swap oldest for newest so we stay within max_select.
        return { ...prev, [group.id]: [...current.slice(1), optionId] };
      }
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }, []);

  const { ok, reason } = useMemo(() => {
    for (const g of item.modifier_groups) {
      const picked = selection[g.id] ?? [];
      if (g.is_required && picked.length < Math.max(1, g.min_select)) {
        return { ok: false, reason: `Select ${g.name}` };
      }
      if (g.min_select && picked.length < g.min_select) {
        return {
          ok: false,
          reason: `Select at least ${g.min_select} in ${g.name}`,
        };
      }
      if (g.max_select && picked.length > g.max_select) {
        return { ok: false, reason: `Too many picked in ${g.name}` };
      }
    }
    return { ok: true, reason: null };
  }, [item.modifier_groups, selection]);

  const addCents = useMemo(() => {
    let delta = 0;
    for (const g of item.modifier_groups) {
      for (const optId of selection[g.id] ?? []) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) delta += opt.price_delta_cents;
      }
    }
    return item.base_price_cents + delta;
  }, [item, selection]);

  const submit = useCallback(() => {
    if (!ok) return;
    const modifiers: CartLine["modifiers"] = [];
    for (const g of item.modifier_groups) {
      for (const optId of selection[g.id] ?? []) {
        const opt = g.options.find((o) => o.id === optId);
        if (!opt) continue;
        modifiers.push({
          modifierOptionId: opt.id,
          groupName: g.display_label ?? g.name,
          optionName: opt.name,
          priceDeltaCents: opt.price_delta_cents,
        });
      }
    }
    onAdd({
      localId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      menuItemId: item.id,
      name: item.name,
      unitBaseCents: item.base_price_cents,
      quantity: 1,
      modifiers,
      specialInstructions: notes.trim() || undefined,
    });
  }, [item, notes, ok, onAdd, selection]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="pos-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Configure ${item.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pos-modal">
        <div className="pos-modal-header">
          <h3>{item.name}</h3>
          <button
            type="button"
            className="pos-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {item.modifier_groups
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((group) => {
            const picked = selection[group.id] ?? [];
            const hint =
              group.selection_mode === "SINGLE"
                ? group.is_required
                  ? "pick one"
                  : "pick one (optional)"
                : group.is_required
                  ? `pick ${group.min_select || 1}–${group.max_select || group.options.length}`
                  : `up to ${group.max_select || group.options.length}`;
            return (
              <div key={group.id} className="pos-modifier-group">
                <h4>
                  {group.display_label ?? group.name} <small>{hint}</small>
                </h4>
                {group.options.map((opt) => {
                  const active = picked.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className="pos-modifier-option"
                      aria-pressed={active}
                      onClick={() => toggle(group, opt.id)}
                    >
                      <span>{opt.name}</span>
                      {opt.price_delta_cents ? (
                        <span className="pos-modifier-option-price">
                          +{cents(opt.price_delta_cents)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}

        <label className="pos-field">
          Notes for this item
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Extra sauce, dressings, etc."
          />
        </label>

        <button
          type="button"
          className="pos-btn pos-btn--primary"
          style={{ width: "100%", marginTop: "1rem", padding: "0.85rem" }}
          onClick={submit}
          disabled={!ok}
        >
          {ok ? `Add • ${cents(addCents)}` : (reason ?? "Select options")}
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Today's orders strip                                               */
/* ================================================================== */

function OrdersStrip({
  orders,
  canDiscount,
  onRefresh,
  onDiscount,
}: {
  orders: PosOrder[];
  canDiscount: boolean;
  onRefresh: () => void;
  onDiscount: (order: PosOrder) => void;
}) {
  return (
    <div className="pos-orders-strip">
      <div className="pos-orders-strip-header">
        <h3>TODAY'S POS / PHONE ORDERS ({orders.length})</h3>
        <button
          type="button"
          className="pos-btn pos-btn--ghost"
          style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
      {orders.length === 0 ? (
        <p className="pos-empty" style={{ padding: "0.8rem 0" }}>
          No POS or phone orders yet today.
        </p>
      ) : (
        <div className="pos-orders-list">
          {orders.map((o) => {
            const time = new Date(o.placed_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const isPhone = o.order_source === "PHONE";
            return (
              <div key={o.id} className="pos-order-row">
                <span className="pos-order-num">#{o.order_number}</span>
                <span>
                  <span
                    className={
                      "pos-order-badge" +
                      (isPhone ? " pos-order-badge--phone" : "")
                    }
                  >
                    {isPhone ? "Phone" : "Walk-in"}
                  </span>
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      color: "rgba(247,233,200,0.6)",
                    }}
                  >
                    {o.customer_name_snapshot || "—"} • {time}
                  </span>
                </span>
                <span className="pos-order-pay">
                  {o.payment_status_summary ?? "—"}
                </span>
                <span className="pos-order-total">
                  {cents(o.final_payable_cents)}
                </span>
                {canDiscount ? (
                  <button
                    type="button"
                    className="pos-btn pos-btn--ghost"
                    onClick={() => onDiscount(o)}
                  >
                    Discount
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Manual discount modal                                              */
/* ================================================================== */

function ManualDiscountModal({
  order,
  controls,
  onClose,
  onApplied,
}: {
  order: PosOrder;
  controls: SessionControls;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = useCallback(async () => {
    const cents100 = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents100) || cents100 <= 0) {
      setError("Enter a positive discount amount");
      return;
    }
    if (cents100 > 10_000) {
      setError("Max manual discount is $100.00");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await posJson<unknown>(
        controls,
        `/api/v1/pos/orders/${order.id}/discounts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discount_amount_cents: cents100,
            reason: reason.trim(),
            description: desc.trim() || undefined,
          }),
          locationId: DEFAULT_LOCATION_ID,
        },
      );
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply discount");
    } finally {
      setBusy(false);
    }
  }, [amount, controls, desc, onApplied, order.id, reason]);

  return (
    <div
      className="pos-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Apply discount to order ${order.order_number}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pos-modal">
        <div className="pos-modal-header">
          <h3>Manual Discount • Order #{order.order_number}</h3>
          <button
            type="button"
            className="pos-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="pos-customer-fields" style={{ marginTop: 0 }}>
          <label className="pos-field">
            Amount ($)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="pos-field">
            Current total
            <input type="text" readOnly value={cents(order.final_payable_cents)} />
          </label>
          <label className="pos-field" style={{ gridColumn: "1 / -1" }}>
            Reason (required)
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Loyalty goodwill, damaged item replacement"
            />
          </label>
          <label className="pos-field" style={{ gridColumn: "1 / -1" }}>
            Description (optional)
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="pos-btn pos-btn--primary"
          style={{ width: "100%", marginTop: "1rem", padding: "0.85rem" }}
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? "Applying…" : "Apply discount"}
        </button>
        {error ? (
          <div className="pos-cart-message" style={{ marginTop: "0.75rem" }}>
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
