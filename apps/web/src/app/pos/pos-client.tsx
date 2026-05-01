"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ComboBuilder } from "@/components/combo-builder";
import { ItemCustomizationOverlay } from "@/components/item-customization-overlay";
import { ItemModal } from "@/components/item-modal";
import { LegacySizePickerModal } from "@/components/legacy-size-picker-modal";
import { LunchSpecialBuilder } from "@/components/lunch-special-builder";
import { WingsBuilder } from "@/components/wings-builder";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { CartContext, type CartContextValue } from "@/lib/cart";
import {
  getCartItemUnitPrice,
  getRemovedIngredientsForApi,
} from "@/lib/cart-item-utils";
import { buildLineSummary } from "@/lib/cart-line-summary";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents, statusLabel } from "@/lib/format";
import {
  canQuickAddMenuItem,
  isComboBuilderItem,
  isLunchSpecialBuilderItem,
  isWingBuilderItem,
  shouldUseCustomizationOverlay,
} from "@/lib/menu-item-customization";
import { DEFAULT_SCHEDULING_CONFIG } from "@/lib/order-scheduling";
import { createOrdersSocket, subscribeToChannels } from "@/lib/realtime";
import {
  buildDisplayMenuCategories,
  type DisplayMenuItem,
  type LegacySizePickerGroup,
} from "@/Wings4u/menu-display";
import type {
  CartItem,
  FulfillmentType,
  MenuCategory,
  MenuItem,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type MenuResponse = {
  categories: MenuCategory[];
  location: {
    name: string;
    timezone?: string;
    tax_rate_bps?: number;
  };
};

type PaymentMethod = "EXACT_CASH" | "CASH" | "CARD_TERMINAL";
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
  item_subtotal_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  final_payable_cents: number;
  total_paid_cents: number;
  payment_status_summary: string | null;
  items?: any[];
};

type Envelope<T> = { data?: T; errors?: { message: string }[] | null };

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  EXACT_CASH: "Exact Amount",
  CASH: "Cash",
  CARD_TERMINAL: "Card",
};

const POS_PASSWORD_LENGTH = 8;
const POS_KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "backspace"],
] as const;

/* ------------------------------------------------------------------ */
/*  Fetch helper                                                       */
/*                                                                     */
/*  POS is station-gated, not account-gated, so we do NOT wrap calls   */
/*  in the silent-refresh helper used elsewhere — there is no main-    */
/*  site session to refresh and a 401 from a POS endpoint just means   */
/*  the station password screen needs to come back up.                 */
/* ------------------------------------------------------------------ */

async function posJson<T>(
  path: string,
  init: RequestInit & { locationId?: string } = {},
): Promise<T> {
  const res = await apiFetch(path, init);
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok) {
    throw new Error(getApiErrorMessage(body, `Request failed (${res.status})`));
  }
  if (!body || body.data === undefined) {
    throw new Error("Request succeeded without a response body");
  }
  return body.data;
}

function makePosCartKey(menuItemId: string): string {
  return `${menuItemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sameQuickAddLine(line: CartItem, item: MenuItem): boolean {
  return (
    line.menu_item_id === item.id &&
    line.modifier_selections.length === 0 &&
    !line.builder_payload &&
    !line.removed_ingredients?.length &&
    !line.special_instructions
  );
}

/* ================================================================== */
/*  Frame + status screens                                             */
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
}: {
  eyebrow?: string;
  title: string;
  message: string;
}) {
  return (
    <PosFrame>
      <section className="pos-login-card">
        <p className="pos-login-eyebrow">{eyebrow}</p>
        <h1 className="pos-login-title">{title}</h1>
        <p className="pos-login-sub">{message}</p>
      </section>
    </PosFrame>
  );
}

/* ================================================================== */
/*  Root                                                               */
/* ================================================================== */

type StationAuth =
  | { state: "loading" }
  | { state: "locked" }
  | { state: "unlocked" };

export function PosClient() {
  const [auth, setAuth] = useState<StationAuth>({ state: "loading" });

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/v1/pos/auth/status?location_id=${DEFAULT_LOCATION_ID}`,
      );
      const body = (await res.json().catch(() => null)) as
        | Envelope<{ authenticated: boolean }>
        | null;
      const authenticated = body?.data?.authenticated === true;
      setAuth({ state: authenticated ? "unlocked" : "locked" });
    } catch {
      setAuth({ state: "locked" });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (auth.state === "loading") {
    return (
      <PosStatusScreen
        title="Checking station"
        message="Loading POS access..."
      />
    );
  }

  if (auth.state === "locked") {
    return <PosLoginScreen onUnlocked={() => setAuth({ state: "unlocked" })} />;
  }

  return <PosShell onLocked={() => setAuth({ state: "locked" })} />;
}

/* ================================================================== */
/*  Station password gate                                              */
/* ================================================================== */

function PosLoginScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = useCallback(
    async (nextCode: string) => {
      if (busy || nextCode.length !== POS_PASSWORD_LENGTH) return;

      setBusy(true);
      setError(null);

      try {
        const res = await apiFetch("/api/v1/pos/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: nextCode,
            location_id: DEFAULT_LOCATION_ID,
          }),
        });
        const body = (await res.json().catch(() => null)) as
          | Envelope<unknown>
          | null;
        if (!res.ok) {
          throw new Error(
            getApiErrorMessage(body, `Request failed (${res.status})`),
          );
        }
        setCode("");
        onUnlocked();
      } catch (err) {
        setCode("");
        setError(err instanceof Error ? err.message : "Could not unlock POS");
      } finally {
        setBusy(false);
      }
    },
    [busy, onUnlocked],
  );

  const appendDigit = useCallback(
    (digit: string) => {
      if (busy || code.length >= POS_PASSWORD_LENGTH) return;
      const nextCode = `${code}${digit}`;
      setCode(nextCode);
      setError(null);
      if (nextCode.length === POS_PASSWORD_LENGTH) {
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
      <section
        className="pos-login-card"
        aria-label="POS station password"
        data-testid="pos-login-card"
      >
        <p className="pos-login-eyebrow">STATION ACCESS</p>
        <h1 className="pos-login-title">Enter station password</h1>
        <p className="pos-login-sub">
          Store network verified. Use the shared 8-digit KDS and POS password
          to unlock the register.
        </p>

        <div className="pos-pin-display" aria-label="Entered password">
          {Array.from({ length: POS_PASSWORD_LENGTH }, (_, index) => (
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

        <div className="pos-keypad" role="group" aria-label="Password keypad">
          {POS_KEYPAD_ROWS.flat().map((key) => {
            if (key === "clear") {
              return (
                <button
                  key={key}
                  type="button"
                  className="pos-key pos-key--action"
                  onClick={clearCode}
                  disabled={busy}
                  data-testid="pos-keypad-clear"
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
                  data-testid="pos-keypad-backspace"
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
                data-testid={`pos-keypad-${key}`}
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
          disabled={busy || code.length !== POS_PASSWORD_LENGTH}
          data-testid="pos-login-submit"
        >
          {busy ? "Unlocking..." : "Unlock register"}
        </button>

        {error ? (
          <p className="pos-login-error" data-testid="pos-login-error">
            {error}
          </p>
        ) : null}
      </section>
    </PosFrame>
  );
}

/* ================================================================== */
/*  Main POS shell                                                     */
/* ================================================================== */

function PosShell({ onLocked }: { onLocked: () => void }) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [diningOption, setDiningOption] = useState<
    "EAT_IN" | "TO_GO" | "DELIVERY"
  >("EAT_IN");
  const [fulfillmentType, setFulfillmentType] =
    useState<FulfillmentType>("PICKUP");
  const [orderSource, setOrderSource] = useState<OrderSource>("POS");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [amountTendered, setAmountTendered] = useState<string>("");
  const [orderNotes, setOrderNotes] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [amountAlreadyPaidCents, setAmountAlreadyPaidCents] = useState(0);

  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [editingLine, setEditingLine] = useState<CartItem | null>(null);
  const [legacyPickerGroup, setLegacyPickerGroup] =
    useState<LegacySizePickerGroup | null>(null);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showEmployeeDiscountModal, setShowEmployeeDiscountModal] = useState(false);
  const [showCustomDiscountModal, setShowCustomDiscountModal] = useState(false);
  const [showOpenFoodModal, setShowOpenFoodModal] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<{
    label: string;
    percent: number;
    fixedAmountCents?: number;
    employeeName?: string;
  } | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeSuccess, setPlaceSuccess] = useState<string | null>(null);

  const [todayOrders, setTodayOrders] = useState<PosOrder[]>([]);
  const [discountOrder, setDiscountOrder] = useState<PosOrder | null>(null);

  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [ordersSearchQuery, setOrdersSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<PosOrder | null>(null);
  const [showCustomerLookupModal, setShowCustomerLookupModal] = useState(false);
  const [showSpecialInstructionsModal, setShowSpecialInstructionsModal] = useState(false);
  const [staff, setStaff] = useState<Array<{ user_id: string; display_name: string }>>([]);
  const [customerFound, setCustomerFound] = useState<any | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  /* ---------- Menu fetch ---------- */

  const loadMenu = useCallback(async () => {
    try {
      const data = await posJson<MenuResponse>(
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
  }, [fulfillmentType]);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadMenu();
    }, 30_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadMenu();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadMenu]);

  /* ---------- Staff fetch ---------- */

  const loadStaff = useCallback(async () => {
    try {
      const data = await posJson<any[]>("/api/v1/pos/staff", {
        locationId: DEFAULT_LOCATION_ID,
      });
      setStaff(data);
    } catch (err) {
      console.error("Failed to load staff", err);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  /* ---------- Today's orders fetch ---------- */

  const loadOrders = useCallback(async () => {
    try {
      const data = await posJson<PosOrder[]>("/api/v1/pos/orders", {
        locationId: DEFAULT_LOCATION_ID,
      });
      setTodayOrders(data);
      setSelectedOrder((current) =>
        current ? data.find((order) => order.id === current.id) ?? current : current,
      );
    } catch {
      // Non-fatal; the strip just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadOrdersRef = useRef(loadOrders);
  useEffect(() => {
    loadOrdersRef.current = loadOrders;
  }, [loadOrders]);

  /* ---------- Realtime updates ---------- */

  useEffect(() => {
    const socket = createOrdersSocket({ preferPosStation: true });

    const refreshOrders = (event?: { payload?: Record<string, unknown> }) => {
      const payload = event?.payload ?? {};
      const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
      const nextStatus =
        typeof payload.to_status === "string" ? payload.to_status : null;

      if (orderId && nextStatus) {
        setTodayOrders((prev) =>
          prev.map((order) =>
            order.id === orderId ? { ...order, status: nextStatus } : order,
          ),
        );
        setSelectedOrder((prev) =>
          prev && prev.id === orderId
            ? { ...prev, status: nextStatus }
            : prev,
        );
      }

      void loadOrdersRef.current();
    };

    socket.on("order.placed", refreshOrders);
    socket.on("order.accepted", refreshOrders);
    socket.on("order.status_changed", refreshOrders);
    socket.on("order.cancelled", refreshOrders);
    socket.on("cancellation.requested", refreshOrders);
    socket.on("cancellation.decided", refreshOrders);

    const disposeSubscription = subscribeToChannels(socket, [
      `orders:${DEFAULT_LOCATION_ID}`,
    ]);
    socket.connect();

    return () => {
      disposeSubscription();
      socket.disconnect();
    };
  }, []);

  /* ---------- Customer Lookup ---------- */

  const performLookup = useCallback(async (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      setCustomerFound(null);
      setLookupError(null);
      return;
    }
    try {
      const data = await posJson<any>(
        `/api/v1/pos/customer-lookup?phone=${encodeURIComponent(phone)}`,
        { locationId: DEFAULT_LOCATION_ID },
      );
      if (data) {
        setCustomerFound(data);
        setCustomerName(data.display_name);
        setLookupError(null);
      } else {
        setCustomerFound(null);
        setLookupError("No User");
      }
    } catch (err) {
      console.error("Lookup failed", err);
      setLookupError(null);
    }
  }, []);

  useEffect(() => {
    void performLookup(customerPhone);
  }, [customerPhone, performLookup]);

  /* ---------- Cart management ---------- */

  const addSimpleItem = useCallback((item: MenuItem) => {
    if (!canQuickAddMenuItem(item)) {
      setPickerItem(item);
      return;
    }
    setCurrentOrderId(
      (prev) => prev ?? `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    );
    setCart((prev) => {
      const existing = prev.find((line) => sameQuickAddLine(line, item));
      if (existing) {
        return prev.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...prev,
        {
          key: makePosCartKey(item.id),
          menu_item_id: item.id,
          menu_item_slug: item.slug,
          name: item.name,
          image_url: item.image_url,
          base_price_cents: item.base_price_cents,
          quantity: 1,
          modifier_selections: [],
          special_instructions: "",
        },
      ];
    });
  }, []);

  const addCartItem = useCallback((incoming: Omit<CartItem, "key">) => {
    setCurrentOrderId(
      (prev) => prev ?? `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    );
    setCart((prev) => [
      ...prev,
      {
        ...incoming,
        key: makePosCartKey(incoming.menu_item_id),
        removed_ingredients: incoming.removed_ingredients ?? [],
      },
    ]);
  }, []);

  const replaceCartItem = useCallback(
    (existingKey: string, incoming: Omit<CartItem, "key">) => {
      setCurrentOrderId(
        (prev) => prev ?? `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      );
      setCart((prev) =>
        prev.map((line) =>
          line.key === existingKey
            ? {
              ...incoming,
              key: existingKey,
              removed_ingredients: incoming.removed_ingredients ?? [],
            }
            : line,
        ),
      );
    },
    [],
  );

  const setCartItemQuantity = useCallback((key: string, quantity: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.key === key
            ? { ...line, quantity: Math.max(0, quantity) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const adjustQuantity = useCallback((key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.key === key
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((line) => line.key !== key));
  }, []);

  const updatePhone = useCallback((val: string) => {
    const digits = (val ?? "").replace(/\D/g, "").slice(0, 10);
    let formatted = digits;
    if (digits.length > 6) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length > 3) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else if (digits.length > 0) {
      formatted = `(${digits}`;
    }
    setCustomerPhone(formatted);
  }, []);

  const copyOrderToCart = useCallback((order: PosOrder) => {
    const lines: CartItem[] = (order.items ?? []).map((item: any) => {
      const modifiers = (item.modifiers ?? [])
        .filter((m: any) => m.modifier_kind !== "REMOVE_INGREDIENT")
        .map((m: any) => ({
          modifier_option_id: m.modifier_option_id,
          group_name: m.modifier_group_name_snapshot,
          option_name: m.modifier_name_snapshot,
          price_delta_cents: m.price_delta_cents,
        }))
        .filter((m: any) => typeof m.modifier_option_id === "string");
      const builderPayload = item.builder_payload_json as
        | CartItem["builder_payload"]
        | undefined;
      const removedIngredients =
        builderPayload?.builder_type === "ITEM_CUSTOMIZATION"
          ? builderPayload.removed_ingredients
          : [];

      return {
        key: makePosCartKey(item.menu_item_id),
        menu_item_id: item.menu_item_id,
        menu_item_slug: null,
        name: item.product_name_snapshot,
        image_url: null,
        base_price_cents: item.unit_price_cents - modifiers.reduce(
          (sum: number, m: any) => sum + m.price_delta_cents,
          0,
        ),
        quantity: item.quantity,
        modifier_selections: modifiers,
        removed_ingredients: removedIngredients,
        special_instructions: item.special_instructions ?? "",
        builder_payload: builderPayload,
      };
    });

    setCart(lines);
    setCurrentOrderId(`ORD-${order.order_number}-RE`);
    setAmountAlreadyPaidCents(order.total_paid_cents);
    setFulfillmentType(order.fulfillment_type as FulfillmentType);
    setCustomerName(order.customer_name_snapshot ?? "");
    updatePhone(order.customer_phone_snapshot ?? "");
  }, [updatePhone]);

  const clearCart = useCallback(() => {
    setCart([]);
    setAmountTendered("");
    setOrderNotes("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerFound(null);
    setLookupError(null);
    setAppliedDiscount(null);
    setPlaceError(null);
    setPlaceSuccess(null);
    setCurrentOrderId(null);
    setAmountAlreadyPaidCents(0);
  }, []);

  const startNewOrder = useCallback(() => {
    clearCart();
    setCurrentOrderId(`ORD-${Math.floor(1000 + Math.random() * 9000)}`);
  }, [clearCart]);

  const handleOpenFood = useCallback((desc: string, amount: number) => {
    const amountCents = Math.round(amount * 100);
    setCurrentOrderId(
      (prev) => prev ?? `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    );
    setCart((prev) => {
      // Per user request: "add desc under last added item in cart wiht price as well"
      // If we have items, add it as a custom modifier to the last one.
      // If no items, add it as a standalone "Open Food" line.
      if (prev.length > 0) {
        const lastIndex = prev.length - 1;
        const lastItem = prev[lastIndex];
        const updatedItem = {
          ...lastItem,
          modifier_selections: [
            ...lastItem.modifier_selections,
            {
              group_name: "Open Food",
              option_name: desc,
              price_delta_cents: amountCents,
            },
          ],
        };
        const next = [...prev];
        next[lastIndex] = updatedItem;
        return next;
      }

      // No items: standalone
      return [
        ...prev,
        {
          key: makePosCartKey("open-food"),
          menu_item_id: "open-food",
          name: desc,
          base_price_cents: amountCents,
          quantity: 1,
          modifier_selections: [],
          special_instructions: "",
        },
      ];
    });
    setShowOpenFoodModal(false);
  }, []);

  /* ---------- Pricing preview ---------- */

  const subtotalCents = useMemo(() => {
    return cart.reduce((acc, line) => {
      return acc + getCartItemUnitPrice(line) * line.quantity;
    }, 0);
  }, [cart]);

  const discountCents = useMemo(() => {
    if (!appliedDiscount) return 0;
    if (appliedDiscount.fixedAmountCents) return appliedDiscount.fixedAmountCents;
    return Math.round((subtotalCents * appliedDiscount.percent) / 100);
  }, [appliedDiscount, subtotalCents]);

  const taxRateBps = menu?.location.tax_rate_bps ?? 1300;
  const subtotalAfterDiscount = subtotalCents - discountCents;
  const estimatedTaxCents = Math.round(
    (subtotalAfterDiscount * taxRateBps) / 10_000,
  );
  const estimatedTotalCents = subtotalAfterDiscount + estimatedTaxCents;
  const remainingBalanceCents = Math.max(
    0,
    estimatedTotalCents - amountAlreadyPaidCents,
  );

  const changeDueCents = useMemo(() => {
    if (paymentMethod !== "CASH") return null;
    const num = Number.parseFloat(amountTendered);
    if (!Number.isFinite(num) || num <= 0) return null;
    const tenderedCents = Math.round(num * 100);
    if (tenderedCents < remainingBalanceCents) return null;
    return tenderedCents - remainingBalanceCents;
  }, [amountTendered, estimatedTotalCents, paymentMethod]);

  /* ---------- Place order ---------- */

  const placeOrder = useCallback(async (overrides?: {
    paymentMethod?: "CASH" | "CARD_TERMINAL";
    amountTenderedCents?: number;
  }) => {
    if (cart.length === 0) return;
    setPlacing(true);
    setPlaceError(null);
    setPlaceSuccess(null);

    const finalPaymentMethod = overrides?.paymentMethod ?? paymentMethod;
    let finalAmountTenderedCents =
      overrides?.amountTenderedCents ?? remainingBalanceCents;

    if (!finalPaymentMethod) {
      setPlacing(false);
      setPlaceError("Choose a payment method first.");
      return;
    }

    if (!overrides && paymentMethod === "CASH" && amountTendered) {
      finalAmountTenderedCents = Math.round(
        Number.parseFloat(amountTendered) * 100,
      );
    }

    try {
      const payload: Record<string, unknown> = {
        fulfillment_type: fulfillmentType,
        order_source: orderSource,
        payment_method: finalPaymentMethod,
        items: cart.map((l) => ({
          menu_item_id: l.menu_item_id === "open-food" ? undefined : l.menu_item_id,
          name: l.menu_item_id === "open-food" ? l.name : undefined,
          unit_price_cents:
            l.menu_item_id === "open-food" ? l.base_price_cents : undefined,
          quantity: l.quantity,
          modifier_selections: l.modifier_selections.map((s) => ({
            modifier_option_id: s.modifier_option_id,
            name: s.option_name,
            price_delta_cents: s.price_delta_cents,
          })),
          removed_ingredients: getRemovedIngredientsForApi(l),
          ...(l.builder_payload
            ? { builder_payload: l.builder_payload }
            : {}),
          ...(l.special_instructions
            ? { special_instructions: l.special_instructions }
            : {}),
        })),
      };

      if (appliedDiscount) {
        payload.discount_amount_cents = discountCents;
        payload.discount_reason = `${appliedDiscount.label}${appliedDiscount.employeeName ? `: ${appliedDiscount.employeeName}` : ""}`;
      }
      if (customerName.trim()) payload.customer_name = customerName.trim();
      if (customerPhone.trim()) payload.customer_phone = customerPhone.trim();
      if (customerFound) payload.customer_id = customerFound.id;
      if (
        finalAmountTenderedCents != null &&
        Number.isFinite(finalAmountTenderedCents)
      ) {
        payload.amount_tendered = finalAmountTenderedCents;
      }
      if (orderNotes.trim()) payload.special_instructions = orderNotes.trim();

      const data = await posJson<{
        order_number: number;
        final_payable_cents: number;
        change_due_cents?: number;
      }>("/api/v1/pos/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        locationId: DEFAULT_LOCATION_ID,
      });

      const msg =
        data.change_due_cents != null
          ? `Order #${data.order_number} placed • ${cents(data.final_payable_cents)} • Change ${cents(data.change_due_cents)}`
          : `Order #${data.order_number} placed • ${cents(data.final_payable_cents)}`;
      startNewOrder();
      setPlaceSuccess(msg);
      void loadOrders();
    } catch (err) {
      setPlaceError(
        err instanceof Error ? err.message : "Could not place order",
      );
    } finally {
      setPlacing(false);
    }
  }, [
    amountTendered,
    appliedDiscount,
    cart,
    customerName,
    customerPhone,
    customerFound,
    discountCents,
    fulfillmentType,
    loadOrders,
    orderNotes,
    orderSource,
    paymentMethod,
    startNewOrder,
  ]);

  /* ---------- Sign out (POS station only) ---------- */

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/v1/pos/auth/logout", { method: "POST" });
    } catch {
      // Best effort: even if the network call fails we still re-lock
      // locally so the next action will require the password.
    }
    onLocked();
  }, [onLocked]);

  /* ---------- Render ---------- */

  const posCartContextValue = useMemo<CartContextValue>(
    () => ({
      items: cart,
      hasCommittedOrderContext: true,
      fulfillmentType,
      locationId: DEFAULT_LOCATION_ID,
      locationTimezone: menu?.location.timezone ?? "America/Toronto",
      scheduledFor: null,
      schedulingConfig: DEFAULT_SCHEDULING_CONFIG,
      cartAddNonce: cart.length,
      driverTipPercent: "none",
      cartExpiresAt: null,
      isGuestCart: false,
      isCartHydrated: true,
      isCartHydrating: false,
      addItem: addCartItem,
      removeItem: removeLine,
      updateQuantity: setCartItemQuantity,
      replaceItem: replaceCartItem,
      commitOrderContext: ({ fulfillmentType: nextFulfillmentType }) =>
        setFulfillmentType(nextFulfillmentType),
      setLocationTimezone: () => undefined,
      setFulfillmentType,
      setScheduledFor: () => undefined,
      setSchedulingConfig: () => undefined,
      resetOrderContext: () => undefined,
      setDriverTipPercent: () => undefined,
      clear: clearCart,
      itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    }),
    [
      addCartItem,
      cart,
      clearCart,
      fulfillmentType,
      menu?.location.timezone,
      removeLine,
      replaceCartItem,
      setCartItemQuantity,
    ],
  );

  const displayCategories = useMemo(
    () => (menu ? buildDisplayMenuCategories(menu.categories) : []),
    [menu],
  );

  const activeDisplayCategory = useMemo(() => {
    if (!displayCategories.length) return null;
    return (
      displayCategories.find((c) => c.id === activeCategoryId) ??
      displayCategories[0] ??
      null
    );
  }, [activeCategoryId, displayCategories]);

  const handleSelectDisplayItem = useCallback(
    (displayItem: DisplayMenuItem) => {
      if (displayItem.kind === "legacy-group") {
        setLegacyPickerGroup(displayItem.group);
        return;
      }
      addSimpleItem(displayItem.item);
    },
    [addSimpleItem],
  );

  return (
    <CartContext.Provider value={posCartContextValue}>
      <div className="pos-root" data-testid="pos-shell">
        <header className="pos-topbar">
          <div className="pos-brand">
            WINGS 4U <span className="pos-brand-badge">POS</span>
          </div>

          <div className="pos-topbar-nav">
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={() => {
                if (currentOrderId) {
                  toast.error("Order already opened", {
                    description: "Finish or clear the current order first.",
                  });
                  return;
                }
                startNewOrder();
              }}
              data-testid="pos-new-order-btn"
            >
              New Order
            </button>
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={() => setShowOrdersModal(true)}
              data-testid="pos-orders-btn"
            >
              Orders
            </button>
            <button
              type="button"
              className="pos-btn pos-nav-btn"
              onClick={() => setShowStaffModal(true)}
            >
              Staff
            </button>
          </div>

          <div className="pos-topbar-right">
            <div className="pos-user-chip">
              <strong>POS Station</strong>
              <span>STATION</span>
            </div>
            <button
              type="button"
              className="pos-btn pos-btn--ghost"
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.6rem" }}
              onClick={() => void signOut()}
              data-testid="pos-signout-btn"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="pos-workspace">
          <section className="pos-cart" aria-label="Cart">
            {todayOrders.filter((o) => o.order_source === "POS").length > 0 && (
              <div className="pos-recent-pills">
                {todayOrders
                  .filter((o) => o.order_source === "POS")
                  .slice(0, 12)
                  .map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="pos-order-pill"
                      onClick={() => copyOrderToCart(o)}
                      title={`Re-order #${o.order_number}`}
                    >
                      #{o.order_number}
                    </button>
                  ))}
              </div>
            )}
            <div className="pos-dining-selector">
              <button
                type="button"
                className="pos-dining-btn"
                aria-pressed={diningOption === "EAT_IN"}
                onClick={() => {
                  setDiningOption("EAT_IN");
                  setFulfillmentType("PICKUP");
                }}
              >
                Eat-in
              </button>
              <button
                type="button"
                className="pos-dining-btn"
                aria-pressed={diningOption === "TO_GO"}
                onClick={() => {
                  setDiningOption("TO_GO");
                  setFulfillmentType("PICKUP");
                }}
              >
                To-Go
              </button>
              {orderSource === "PHONE" && (
                <button
                  type="button"
                  className="pos-dining-btn"
                  aria-pressed={diningOption === "DELIVERY"}
                  onClick={() => {
                    setDiningOption("DELIVERY");
                    setFulfillmentType("DELIVERY");
                  }}
                >
                  Delivery
                </button>
              )}
            </div>

            <div className="pos-customer-fields" style={{ marginBottom: "0.75rem" }}>
              {customerFound ? (
                <div className="pos-customer-profile-card">
                  <div className="pos-customer-profile-info">
                    <strong>{customerFound.display_name}</strong>
                    <span>{customerPhone}</span>
                  </div>
                  <button
                    type="button"
                    className="pos-customer-change-btn"
                    onClick={() => {
                      setCustomerFound(null);
                      setCustomerName("");
                      setCustomerPhone("");
                      setLookupError(null);
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <label className="pos-field">
                    CUSTOMER NAME
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Optional"
                      autoComplete="off"
                    />
                  </label>
                  {orderSource === "PHONE" && (
                    <label className="pos-field">
                      PHONE{" "}
                      {lookupError && (
                        <span
                          style={{
                            color: "var(--pos-accent)",
                            fontSize: "0.7rem",
                            marginLeft: "0.5rem",
                            fontWeight: 900,
                            textTransform: "uppercase",
                          }}
                        >
                          ({lookupError})
                        </span>
                      )}
                      <input
                        type="tel"
                        inputMode="tel"
                        value={customerPhone}
                        onChange={(e) => updatePhone(e.target.value)}
                        placeholder="(519) 000-0000"
                        autoComplete="off"
                      />
                    </label>
                  )}
                </>
              )}
            </div>
            {currentOrderId && (
              <div className="pos-order-id-display">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span className="pos-accent" style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                    ID: {currentOrderId}
                  </span>
                  <div className="pos-segmented pos-segmented--small">
                    <button
                      type="button"
                      aria-pressed={orderSource === "POS"}
                      onClick={() => {
                        setOrderSource("POS");
                        if (diningOption === "DELIVERY") {
                          setDiningOption("TO_GO");
                          setFulfillmentType("PICKUP");
                        }
                      }}
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
                </div>
                <button
                  type="button"
                  className="pos-modal-close"
                  style={{ fontSize: "1.2rem", padding: "0 0.25rem", opacity: 0.6 }}
                  onClick={() => {
                    clearCart();
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {cart.length === 0 ? (
              <div className="pos-empty" />
            ) : (
              <div className="pos-cart-list">
                {cart.map((line) => {
                  const unitCents = getCartItemUnitPrice(line);
                  const summaryLines = buildLineSummary(line);
                  const lineMenuItem = menu?.categories
                    .flatMap((c) => c.items)
                    .find((item) => item.id === line.menu_item_id);
                  return (
                    <div key={line.key} className="pos-cart-line">
                      <div className="pos-cart-line-body">
                        <div className="pos-cart-line-name">
                          <span>{line.name}</span>
                          <span>{cents(unitCents * line.quantity)}</span>
                        </div>
                        {summaryLines.length > 0 ? (
                          <div className="pos-cart-line-mods">
                            {summaryLines.join(", ")}
                          </div>
                        ) : null}
                        <div className="pos-qty">
                          <button
                            type="button"
                            aria-label="Decrease"
                            onClick={() => adjustQuantity(line.key, -1)}
                          >
                            −
                          </button>
                          <span className="pos-qty-value">{line.quantity}</span>
                          <button
                            type="button"
                            aria-label="Increase"
                            onClick={() => adjustQuantity(line.key, +1)}
                          >
                            +
                          </button>

                          {lineMenuItem && !canQuickAddMenuItem(lineMenuItem) ? (
                            <button
                              type="button"
                              className="pos-cart-edit-btn"
                              onClick={() => {
                                setEditingLine(line);
                                setPickerItem(lineMenuItem);
                              }}
                            >
                              Edit
                            </button>
                          ) : null}

                          <button
                            type="button"
                            aria-label="Remove"
                            style={{ marginLeft: "auto", color: "#b91c1c" }}
                            onClick={() => removeLine(line.key)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {appliedDiscount?.employeeName && (
                  <div className="pos-cart-employee-info">
                    <button
                      type="button"
                      className="pos-cart-employee-info-close"
                      onClick={() => setAppliedDiscount(null)}
                    >
                      ×
                    </button>
                    Employee Discount: {appliedDiscount.employeeName} ({appliedDiscount.percent}%)
                  </div>
                )}
              </div>
            )}

            <div className="pos-cart-footer">
              <div className="pos-cart-totals">
                <div className="pos-cart-totals-row">
                  <span>Subtotal</span>
                  <span>{cents(subtotalCents)}</span>
                </div>
                {appliedDiscount && (
                  <div
                    className="pos-cart-totals-row"
                    style={{ color: "var(--pos-accent)" }}
                  >
                    <span>
                      Discount{" "}
                      {appliedDiscount.fixedAmountCents
                        ? ""
                        : `(${appliedDiscount.percent}%)`}
                    </span>
                    <span>-{cents(discountCents)}</span>
                  </div>
                )}
                <div className="pos-cart-totals-row">
                  <span>Tax (est.)</span>
                  <span>{cents(estimatedTaxCents)}</span>
                </div>
                <div className="pos-cart-totals-row pos-cart-totals-row--emph">
                  <span>Total</span>
                  <span>{cents(estimatedTotalCents)}</span>
                </div>
                {amountAlreadyPaidCents > 0 && (
                  <>
                    <div
                      className="pos-cart-totals-row"
                      style={{ color: "#4caf50" }}
                    >
                      <span>Paid</span>
                      <span>-{cents(amountAlreadyPaidCents)}</span>
                    </div>
                    <div
                      className="pos-cart-totals-row pos-cart-totals-row--emph"
                      style={{ borderTop: "2px solid var(--pos-accent)" }}
                    >
                      <span>Amount Due</span>
                      <span>
                        {cents(
                          Math.max(0, estimatedTotalCents - amountAlreadyPaidCents),
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div
                className="pos-payments"
                role="radiogroup"
                aria-label="Payment method"
              >
                <button
                  type="button"
                  className="pos-payment-btn"
                  disabled={cart.length === 0 || placing || remainingBalanceCents <= 0}
                  onClick={() => {
                    setPaymentMethod("CASH");
                    setAmountTendered((remainingBalanceCents / 100).toString());
                    void placeOrder({
                      paymentMethod: "CASH",
                      amountTenderedCents: remainingBalanceCents,
                    });
                  }}
                >
                  Exact Amount
                </button>
                <button
                  type="button"
                  className="pos-payment-btn"
                  disabled={cart.length === 0 || placing || remainingBalanceCents <= 0}
                  aria-pressed={showCashModal}
                  onClick={() => {
                    setPaymentMethod("CASH");
                    setShowCashModal(true);
                  }}
                >
                  Cash
                </button>
                <button
                  type="button"
                  className="pos-payment-btn"
                  disabled={cart.length === 0 || placing || remainingBalanceCents <= 0}
                  aria-pressed={paymentMethod === "CARD_TERMINAL"}
                  onClick={() => {
                    setPaymentMethod("CARD_TERMINAL");
                    void placeOrder({ paymentMethod: "CARD_TERMINAL" });
                  }}
                >
                  Card
                </button>
              </div>





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
            <div className="pos-menu-content">
              <div className="pos-tabs" role="tablist">
                {displayCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={cat.id === activeDisplayCategory?.id}
                    className={
                      "pos-tab" +
                      (cat.id === activeDisplayCategory?.id ? " pos-tab--active" : "")
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
              ) : !activeDisplayCategory || activeDisplayCategory.items.length === 0 ? (
                <p className="pos-empty">No items in this category.</p>
              ) : (
                <div className="pos-items-grid">
                  {activeDisplayCategory.items.map((displayItem) => {
                    const item =
                      displayItem.kind === "item"
                        ? displayItem.item
                        : displayItem.group.options[0]?.item;
                    if (!item) return null;
                    const isBuilder =
                      displayItem.kind === "item" &&
                      (isWingBuilderItem(item) ||
                        isComboBuilderItem(item) ||
                        isLunchSpecialBuilderItem(item));
                    const hasMods =
                      displayItem.kind === "item" &&
                      shouldUseCustomizationOverlay(item);
                    const outOfStock = displayItem.stockStatus === "UNAVAILABLE";
                    return (
                      <button
                        key={displayItem.key}
                        type="button"
                        className="pos-item-card"
                        disabled={outOfStock}
                        onClick={() => handleSelectDisplayItem(displayItem)}
                      >
                        <div className="pos-item-name">{displayItem.displayName}</div>
                        <div className="pos-item-price">
                          {displayItem.showStartingAt ? "From " : ""}
                          {cents(displayItem.displayPriceCents)}
                        </div>
                        <div className="pos-item-meta">
                          {outOfStock
                            ? "Unavailable"
                            : isBuilder
                              ? "Build item"
                              : hasMods
                                ? "Customize"
                                : displayItem.kind === "legacy-group"
                                  ? "Choose size"
                                  : "Tap to add"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="pos-bottom-navbar">
              <button
                type="button"
                className="pos-btn pos-nav-btn"
                onClick={() => {
                  if (cart.length === 0) {
                    toast.error("No open order", {
                      description: "Add items to the cart first.",
                    });
                    return;
                  }
                  setShowCustomerLookupModal(true);
                }}
              >
                CUST Lookup
              </button>
              <button
                type="button"
                className="pos-btn pos-nav-btn"
                onClick={() => {
                  if (cart.length === 0) {
                    toast.error("No open order", {
                      description: "Add items to the cart first.",
                    });
                    return;
                  }
                  setShowSpecialInstructionsModal(true);
                }}
              >
                SPC INS
              </button>
            </div>
          </section>
        </div>

        {showOrdersModal && (
          <div className="pos-orders-overlay">
            <div className="pos-orders-header">
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>
                Daily Orders
              </h2>
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
                <div
                  className="pos-orders-list-scroll"
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
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
                        <div className="pos-order-customer">
                          {o.customer_name_snapshot || "Walk-in"}
                        </div>
                        <div className="pos-order-phone">
                          {o.customer_phone_snapshot || "No phone"}
                        </div>
                        <div className="pos-order-time">
                          {new Date(o.placed_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <span
                          className="pos-order-item-total"
                          data-paid={
                            o.final_payable_cents > 0 &&
                            o.final_payable_cents <=
                            (o as any).total_paid_cents
                          }
                        >
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
                      <div className="pos-detail-hero">
                        <span className="pos-detail-label">
                          Order Reference
                        </span>
                        <h3>#{selectedOrder.order_number}</h3>
                      </div>
                      <div className="pos-order-detail-grid">
                        <div className="pos-detail-group">
                          <label>Customer</label>
                          <span>
                            {selectedOrder.customer_name_snapshot ||
                              "Walk-in"}
                          </span>
                        </div>
                        <div className="pos-detail-group">
                          <label>Phone Number</label>
                          <span>
                            {selectedOrder.customer_phone_snapshot || "—"}
                          </span>
                        </div>
                        <div className="pos-detail-group">
                          <label>Order Type</label>
                          <span style={{ fontWeight: "bold", color: "#fff" }}>
                            {selectedOrder.order_source === "POS"
                              ? "Walk-in"
                              : "Phone Order"}
                          </span>
                        </div>
                        <div className="pos-detail-group">
                          <label>Payment Status</label>
                          <span
                            style={{
                              color:
                                selectedOrder.final_payable_cents > 0 &&
                                  selectedOrder.final_payable_cents <=
                                  selectedOrder.total_paid_cents
                                  ? "#4caf50"
                                  : "#f44336",
                            }}
                          >
                            {selectedOrder.final_payable_cents > 0 &&
                              selectedOrder.final_payable_cents <=
                              selectedOrder.total_paid_cents
                              ? "PAID"
                              : "NOT PAID"}
                          </span>
                        </div>
                        <div className="pos-detail-group">
                          <label>Order Status</label>
                          <span
                            style={{
                              color: "var(--pos-accent)",
                              fontWeight: "bold",
                            }}
                          >
                            {statusLabel(selectedOrder.status)}
                          </span>
                        </div>
                        <div className="pos-detail-group">
                          <label>Placed At</label>
                          <span>
                            {new Date(
                              selectedOrder.placed_at,
                            ).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pos-order-detail-items">
                      <div className="pos-detail-section-title">
                        Order Items
                      </div>
                      {(selectedOrder as any).items?.map(
                        (item: any, idx: number) => (
                          <div
                            key={idx}
                            className="pos-detail-item-row"
                          >
                            <div className="pos-detail-item-info">
                              <div className="pos-detail-item-name">
                                <span className="pos-detail-qty">
                                  {item.quantity}×
                                </span>
                                {item.product_name_snapshot}
                              </div>
                              {item.modifiers?.length > 0 && (
                                <div className="pos-detail-item-mods">
                                  {item.modifiers
                                    .map(
                                      (m: any) =>
                                        m.modifier_name_snapshot,
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

                    <div className="pos-order-detail-footer">
                      <div className="pos-order-price-summary">
                        <div className="pos-price-row">
                          <span>Subtotal</span>
                          <span>
                            {cents(selectedOrder.item_subtotal_cents)}
                          </span>
                        </div>
                        <div className="pos-price-row">
                          <span>Tax</span>
                          <span>{cents(selectedOrder.tax_cents)}</span>
                        </div>
                        {selectedOrder.delivery_fee_cents > 0 && (
                          <div className="pos-price-row">
                            <span>Delivery Fee</span>
                            <span>
                              {cents(selectedOrder.delivery_fee_cents)}
                            </span>
                          </div>
                        )}
                        <div className="pos-price-row pos-price-row--total">
                          <span>Total Amount</span>
                          <strong>
                            {cents(selectedOrder.final_payable_cents)}
                          </strong>
                        </div>
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

        {showStaffModal && (
          <StaffModal
            onClose={() => setShowStaffModal(false)}
            onOpenDrawer={() => {
              alert("Cash drawer opened.");
              setShowStaffModal(false);
            }}
            onEmployeeDiscount={() => {
              if (cart.length === 0) {
                toast.error("No open order", {
                  description: "Add items to the cart first.",
                });
                return;
              }
              setShowStaffModal(false);
              setShowEmployeeDiscountModal(true);
            }}
            onCustomDiscount={() => {
              if (cart.length === 0) {
                toast.error("No open order", {
                  description: "Add items to the cart first.",
                });
                return;
              }
              setShowStaffModal(false);
              setShowCustomDiscountModal(true);
            }}
            onOpenFood={() => {
              setShowStaffModal(false);
              setShowOpenFoodModal(true);
            }}
          />
        )}

        {showOpenFoodModal && (
          <OpenFoodModal
            onClose={() => setShowOpenFoodModal(false)}
            onDone={handleOpenFood}
          />
        )}

        {showCustomDiscountModal && (
          <CustomDiscountModal
            onClose={() => setShowCustomDiscountModal(false)}
            onApply={(type, val, reason) => {
              if (type === "PERCENT") {
                setAppliedDiscount({
                  label: reason || "Custom Discount",
                  percent: val,
                });
              } else {
                setAppliedDiscount({
                  label: reason || "Custom Discount",
                  percent: 0,
                  fixedAmountCents: Math.round(val * 100),
                });
              }
              setShowCustomDiscountModal(false);
            }}
          />
        )}

        {showEmployeeDiscountModal && (
          <EmployeeDiscountModal
            onClose={() => setShowEmployeeDiscountModal(false)}
            employees={staff}
            onSelect={(name) => {
              setAppliedDiscount({
                label: `Emp: ${name}`,
                percent: 50,
                employeeName: name,
              });
              setShowEmployeeDiscountModal(false);
            }}
          />
        )}

        {showCashModal && (
          <CashPaymentModal
            totalDueCents={estimatedTotalCents}
            onCancel={() => setShowCashModal(false)}
            onDone={(tendered) => {
              setShowCashModal(false);
              setAmountTendered((tendered / 100).toString());
              void placeOrder({ paymentMethod: "CASH", amountTenderedCents: tendered });
            }}
          />
        )}

        {pickerItem &&
          (isWingBuilderItem(pickerItem) ? (
            <WingsBuilder
              item={pickerItem}
              saladMenuItems={
                menu?.categories.find((category) => category.slug === "salads")
                  ?.items ?? []
              }
              editingLine={editingLine ?? undefined}
              onClose={() => {
                setPickerItem(null);
                setEditingLine(null);
              }}
            />
          ) : isComboBuilderItem(pickerItem) ? (
            <ComboBuilder
              item={pickerItem}
              editingLine={editingLine ?? undefined}
              onClose={() => {
                setPickerItem(null);
                setEditingLine(null);
              }}
            />
          ) : isLunchSpecialBuilderItem(pickerItem) ? (
            <LunchSpecialBuilder
              item={pickerItem}
              childItems={
                menu?.categories.find(
                  (category) =>
                    category.slug ===
                    (pickerItem.slug === "lunch-burger" ? "burgers" : "wraps"),
                )?.items ?? []
              }
              editingLine={editingLine ?? undefined}
              onClose={() => {
                setPickerItem(null);
                setEditingLine(null);
              }}
            />
          ) : shouldUseCustomizationOverlay(pickerItem) ? (
            <ItemCustomizationOverlay
              item={pickerItem}
              editingLine={editingLine ?? undefined}
              onClose={() => {
                setPickerItem(null);
                setEditingLine(null);
              }}
            />
          ) : (
            <ItemModal
              item={pickerItem}
              onClose={() => {
                setPickerItem(null);
                setEditingLine(null);
              }}
            />
          ))}

        {legacyPickerGroup && (
          <LegacySizePickerModal
            group={legacyPickerGroup}
            onClose={() => setLegacyPickerGroup(null)}
          />
        )}

        {discountOrder ? (
          <ManualDiscountModal
            order={discountOrder}
            onClose={() => setDiscountOrder(null)}
            onApplied={() => {
              setDiscountOrder(null);
              void loadOrders();
            }}
          />
        ) : null}

        {showCustomerLookupModal && (
          <CustomerLookupModal
            onClose={() => setShowCustomerLookupModal(false)}
            onSelect={(c) => {
              setCustomerFound(c);
              setCustomerName(c.display_name);
              setCustomerPhone(c.phone);
              setLookupError(null);
            }}
          />
        )}
        {showSpecialInstructionsModal && (
          <SpecialInstructionsModal
            notes={orderNotes}
            onSave={setOrderNotes}
            onClose={() => setShowSpecialInstructionsModal(false)}
          />
        )}
      </div>
    </CartContext.Provider>
  );
}

/* ================================================================== */
/*  Modifier picker                                                    */
/* ================================================================== */

function ModifierPicker({
  item,
  onClose,
  onAdd,
  existingLine,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: any) => void;
  existingLine?: any;
}) {
  const initialSelection = useMemo<Record<string, string[]>>(() => {
    if (existingLine) {
      const out: Record<string, string[]> = {};
      for (const mod of existingLine.modifiers) {
        for (const group of item.modifier_groups) {
          if (group.options.some((o) => o.id === mod.modifierOptionId)) {
            out[group.id] = [...(out[group.id] || []), mod.modifierOptionId];
            break;
          }
        }
      }
      return out;
    }
    const out: Record<string, string[]> = {};
    for (const group of item.modifier_groups) {
      if (group.selection_mode === "SINGLE" && group.is_required) {
        const def =
          group.options.find((o) => o.is_default) ?? group.options[0];
        if (def) out[group.id] = [def.id];
      }
    }
    return out;
  }, [item, existingLine]);

  const [selection, setSelection] =
    useState<Record<string, string[]>>(initialSelection);
  const [notes, setNotes] = useState(existingLine?.specialInstructions ?? "");

  const toggle = useCallback((group: any, optionId: string) => {
    setSelection((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === "SINGLE") {
        return { ...prev, [group.id]: [optionId] };
      }
      if (current.includes(optionId)) {
        return {
          ...prev,
          [group.id]: current.filter((id) => id !== optionId),
        };
      }
      if (group.max_select && current.length >= group.max_select) {
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
    const modifiers: any[] = [];
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
      localId: existingLine?.localId ?? `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

        <div className="pos-modal-body">
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
                  <div className="pos-modifier-options-grid">
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
        </div>

        <div className="pos-modal-footer">
          <button
            type="button"
            className="pos-btn pos-btn--primary"
            style={{ width: "100%", padding: "1.25rem", fontSize: "1.2rem" }}
            onClick={submit}
            disabled={!ok}
          >
            {ok
              ? `Add to Order • ${cents(addCents)}`
              : (reason ?? "Select options")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Manual discount modal                                              */
/* ================================================================== */

function ManualDiscountModal({
  order,
  onClose,
  onApplied,
}: {
  order: PosOrder;
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
      await posJson<unknown>(`/api/v1/pos/orders/${order.id}/discounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount_amount_cents: cents100,
          reason: reason.trim(),
          description: desc.trim() || undefined,
        }),
        locationId: DEFAULT_LOCATION_ID,
      });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply discount");
    } finally {
      setBusy(false);
    }
  }, [amount, desc, onApplied, order.id, reason]);

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
            <input
              type="text"
              readOnly
              value={cents(order.final_payable_cents)}
            />
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

/* ================================================================== */
/*  Customer Lookup Modal                                              */
/* ================================================================== */

function CustomerLookupModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (c: any) => void;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhoneChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  };

  const displayPhone = useMemo(() => {
    if (!phone) return "";
    if (phone.length <= 3) return phone;
    if (phone.length <= 6) return `(${phone.slice(0, 3)}) ${phone.slice(3)}`;
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 10)}`;
  }, [phone]);

  const handleSearch = async () => {
    if (phone.length !== 10) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await posJson<any>(
        `/api/v1/pos/customer-lookup?phone=${encodeURIComponent(phone)}`,
        { locationId: DEFAULT_LOCATION_ID },
      );
      if (data) {
        onSelect(data);
        onClose();
      } else {
        setError("No customer found with this number");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Customer Lookup</h3>
          <button
            type="button"
            className="pos-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="pos-modal-body pos-modal-body--centered">
          <div className="pos-field pos-field--centered">
            <label>Customer Phone (Required)</label>
            <input
              type="tel"
              value={displayPhone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="(519) 000-0000"
              autoFocus
            />
          </div>

          <div className="pos-modal-actions">
            <button
              type="button"
              className="pos-btn pos-btn--primary pos-btn--rounded pos-btn--small"
              onClick={() => void handleSearch()}
              disabled={busy || phone.length !== 10}
            >
              {busy ? "Searching..." : "Search"}
            </button>
          </div>

          {error ? (
            <div
              className="pos-cart-message"
              style={{ marginTop: "0.5rem", color: "#ef4444" }}
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Special Instructions Modal                                         */
/* ================================================================== */

function SpecialInstructionsModal({
  notes,
  onSave,
  onClose,
}: {
  notes: string;
  onSave: (val: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(notes);

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Kitchen Instructions</h3>
          <button
            type="button"
            className="pos-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="pos-modal-body pos-modal-body--centered">
          <div className="pos-field pos-field--centered">
            <label>Notes for Kitchen</label>
            <textarea
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="e.g. No onions, extra spicy, well done wings..."
              rows={5}
              style={{ width: "100%", padding: "1rem", fontSize: "1.1rem" }}
            />
          </div>

          <div className="pos-modal-actions">
            <button
              type="button"
              className="pos-btn pos-btn--primary pos-btn--rounded pos-btn--small"
              onClick={() => {
                onSave(val);
                onClose();
              }}
            >
              Save Instructions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
/* ================================================================== */
/*  Staff Functions Modal                                              */
/* ================================================================== */

function StaffModal({
  onClose,
  onOpenDrawer,
  onEmployeeDiscount,
  onCustomDiscount,
  onOpenFood,
}: {
  onClose: () => void;
  onOpenDrawer: () => void;
  onEmployeeDiscount: () => void;
  onCustomDiscount: () => void;
  onOpenFood: () => void;
}) {
  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Staff Functions</h3>
          <button type="button" className="pos-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div
          className="pos-modal-body"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "1.5rem",
            padding: "2rem",
          }}
        >
          <button className="pos-staff-opt" onClick={onOpenDrawer}>
            <span style={{ fontSize: "1.5rem" }}>💰</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <strong>Open Drawer</strong>
              <small style={{ opacity: 0.6, fontSize: "0.8rem" }}>
                Access cash register
              </small>
            </div>
          </button>
          <button className="pos-staff-opt" onClick={onEmployeeDiscount}>
            <span style={{ fontSize: "1.5rem" }}>👥</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <strong>Employee Discount</strong>
              <small style={{ opacity: 0.6, fontSize: "0.8rem" }}>
                Apply 50% reduction
              </small>
            </div>
          </button>
          <button className="pos-staff-opt" onClick={onCustomDiscount}>
            <span style={{ fontSize: "1.5rem" }}>🎟️</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <strong>Apply Discount</strong>
              <small style={{ opacity: 0.6, fontSize: "0.8rem" }}>
                Custom $ or % off
              </small>
            </div>
          </button>
          <button className="pos-staff-opt" onClick={onOpenFood}>
            <span style={{ fontSize: "1.5rem" }}>🍔</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <strong>Open Food</strong>
              <small style={{ opacity: 0.6, fontSize: "0.8rem" }}>
                Custom upcharge
              </small>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeDiscountModal({
  onClose,
  onSelect,
  employees,
}: {
  onClose: () => void;
  onSelect: (name: string) => void;
  employees: Array<{ user_id: string; display_name: string }>;
}) {

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Select Employee</h3>
          <button type="button" className="pos-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div
          className="pos-modal-body"
          style={{
            maxHeight: "450px",
            overflowY: "auto",
            padding: "1rem",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          {employees.length === 0 ? (
            <div style={{ gridColumn: "span 2", textAlign: "center", color: "#666", padding: "2rem" }}>
              No staff members found.
            </div>
          ) : (
            employees.map((emp) => (
              <button
                key={emp.user_id}
                className="pos-employee-btn"
                onClick={() => onSelect(emp.display_name)}
              >
                {emp.display_name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
/* ================================================================== */
/*  Custom Discount Modal                                              */
/* ================================================================== */

function CustomDiscountModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (type: "PERCENT" | "DOLLAR", val: number, reason: string) => void;
}) {
  const [type, setType] = useState<"PERCENT" | "DOLLAR">("PERCENT");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Apply Discount</h3>
          <button type="button" className="pos-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div
          className="pos-modal-body"
          style={{
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          <div className="pos-segmented">
            <button
              type="button"
              aria-pressed={type === "PERCENT"}
              onClick={() => setType("PERCENT")}
            >
              % Percent
            </button>
            <button
              type="button"
              aria-pressed={type === "DOLLAR"}
              onClick={() => setType("DOLLAR")}
            >
              $ Fixed
            </button>
          </div>

          <div className="pos-field">
            <label>{type === "PERCENT" ? "Percent (%)" : "Amount ($)"}</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === "PERCENT" ? "e.g. 10" : "e.g. 5.00"}
              autoFocus
            />
          </div>

          <div className="pos-field">
            <label>Reason / Note</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Manager Special"
            />
          </div>

          <button
            type="button"
            className="pos-btn pos-btn--primary"
            style={{ marginTop: "1rem" }}
            disabled={!value || isNaN(parseFloat(value))}
            onClick={() => onApply(type, parseFloat(value), reason.trim())}
          >
            Apply Discount
          </button>
        </div>
      </div>
    </div>
  );
}
function CashPaymentModal({
  totalDueCents,
  onCancel,
  onDone,
}: {
  totalDueCents: number;
  onCancel: () => void;
  onDone: (tenderedCents: number) => void;
}) {
  const [totalStr, setTotalStr] = useState(totalDueCents.toString());
  const [tenderedStr, setTenderedStr] = useState("");

  const total = parseInt(totalStr) || 0;
  const tendered = parseInt(tenderedStr) || 0;
  const change = Math.max(0, tendered - total);

  const handleNumericInput = (val: string, setter: (v: string) => void) => {
    const digits = val.replace(/\D/g, "");
    setter(digits);
  };

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Cash Payment</h3>
        </div>
        <div className="pos-modal-body pos-modal-body--centered">
          <label className="pos-field pos-field--centered" style={{ gap: "0.75rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Amount Due</span>
            <input
              type="text"
              readOnly
              value={cents(total)}
              style={{
                textAlign: "center",
                fontSize: "2.5rem",
                opacity: 0.8,
                background: "#111",
                padding: "1rem",
              }}
            />
          </label>

          <label className="pos-field pos-field--centered" style={{ gap: "0.75rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Cash Received</span>
            <input
              type="text"
              inputMode="numeric"
              value={tenderedStr ? (tendered / 100).toFixed(2) : ""}
              autoFocus
              onChange={(e) =>
                handleNumericInput(e.target.value, setTenderedStr)
              }
              placeholder="0.00"
              style={{ textAlign: "center", fontSize: "2.5rem", padding: "1rem" }}
            />
          </label>

          <label className="pos-field pos-field--centered" style={{ gap: "0.75rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Change Due</span>
            <input
              type="text"
              readOnly
              value={cents(change)}
              style={{
                opacity: 0.8,
                background: "#111",
                textAlign: "center",
                fontSize: "2.5rem",
                color: change > 0 ? "#10b981" : "#fff",
                padding: "1rem",
              }}
            />
          </label>

          <div className="pos-modal-actions" style={{ marginTop: "1rem", gap: "1rem" }}>
            <button
              type="button"
              className="pos-btn pos-btn--secondary pos-btn--small"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pos-btn pos-btn--primary pos-btn--small"
              onClick={() => onDone(tendered)}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OpenFoodModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (desc: string, amount: number) => void;
}) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <div
      className="pos-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pos-modal pos-modal--small">
        <div className="pos-modal-header pos-modal-header--centered">
          <h3>Open Food</h3>
          <button
            type="button"
            className="pos-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div
          className="pos-modal-body"
          style={{
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          <div className="pos-field">
            <label>Description</label>
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. Extra Sauce, Special Request"
              autoFocus
            />
          </div>

          <div className="pos-field">
            <label>Amount ($)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <button
            type="button"
            className="pos-btn pos-btn--primary"
            disabled={!desc || !amount || isNaN(parseFloat(amount))}
            onClick={() => onDone(desc, parseFloat(amount))}
          >
            Add to Order
          </button>
        </div>
      </div>
    </div>
  );
}
