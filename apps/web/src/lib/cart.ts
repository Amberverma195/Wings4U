/**
 * Client-side cart state with React context.
 *
 * Items + fulfillment + schedule + tip are persisted to the backend via
 * /api/v1/cart/me. A sessionStorage draft mirrors the latest lines so a hard
 * reload before the debounced PUT lands can still restore the cart. Local
 * state is the optimistic UI cache; the sync effect debounces PUTs on
 * mutation. On login we merge guest cart → user cart via
 * /api/v1/cart/merge; on logout we wipe local state only (the user's DB
 * cart stays for next sign-in). UI-only state (schedulingConfig,
 * cartAddNonce, hasCommittedOrderContext) is not persisted to the DB.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  DEFAULT_SCHEDULING_CONFIG,
  normalizeSchedulingConfig,
  type SchedulingConfig,
} from "./order-scheduling";
import { getRemovedIngredientsFromBuilderPayload } from "./cart-item-utils";
import {
  fetchSavedCart,
  mergeSavedCartOnLogin,
  putSavedCart,
  type SavedCartItemSnapshot,
  type SavedCartSnapshot,
} from "./saved-cart-api";
import { useSession } from "./session";
import type { CartItem, CartModifierSelection, FulfillmentType } from "./types";

/** Coalesce rapid +/- quantity taps into one toast. */
let cartQtyToastTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCartQuantityUpdatedToast() {
  if (typeof window === "undefined") return;
  if (cartQtyToastTimer) clearTimeout(cartQtyToastTimer);
  cartQtyToastTimer = setTimeout(() => {
    toast.message("Cart updated", {
      description: "Your cart has been saved.",
    });
    cartQtyToastTimer = null;
  }, 450);
}

/** Driver tip % for delivery; stored on the cart so it survives cart ↔ checkout navigation. */
export type DriverTipPercent = "none" | 10 | 15 | 20;

function parseDriverTipPercent(value: unknown): DriverTipPercent {
  if (value === "none") return "none";
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (n === 10 || n === 15 || n === 20) return n;
  return "none";
}

export type CartState = {
  items: CartItem[];
  hasCommittedOrderContext: boolean;
  fulfillmentType: FulfillmentType;
  locationId: string;
  locationTimezone: string;
  scheduledFor: string | null;
  schedulingConfig: SchedulingConfig;
  /** Increments on every `addItem` call; use for nav / UI add animations. */
  cartAddNonce: number;
  driverTipPercent: DriverTipPercent;
  /** ISO timestamp; set only for guest carts (null for signed-in users). */
  cartExpiresAt: string | null;
  /** Whether the active cart is a guest cart (vs. a signed-in user cart). */
  isGuestCart: boolean;
  /** False until the first successful hydration from the backend completes. */
  isCartHydrated: boolean;
  /** True while saved cart is still loading/reconciling — prefer over showing an empty cart. */
  isCartHydrating: boolean;
};

export type CartActions = {
  addItem: (item: Omit<CartItem, "key">) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  /** Phase 13: replace an existing cart line in place (used when editing). */
  replaceItem: (existingKey: string, item: Omit<CartItem, "key">) => void;
  commitOrderContext: (selection: {
    fulfillmentType: FulfillmentType;
    scheduledFor: string | null;
  }) => void;
  setLocationTimezone: (timezone: string) => void;
  setFulfillmentType: (type: FulfillmentType) => void;
  setScheduledFor: (scheduledFor: string | null) => void;
  setSchedulingConfig: (config: SchedulingConfig) => void;
  resetOrderContext: () => void;
  setDriverTipPercent: (percent: DriverTipPercent) => void;
  clear: () => void;
  itemCount: number;
};

export type CartContextValue = CartState & CartActions;

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

const ORDER_CONTEXT_STORAGE_KEY = "wings4u.order-context";

const CART_ITEMS_DRAFT_STORAGE_KEY = "wings4u.cart-items-draft-v1";

/** Drop drafts older than this (client clock) so we do not resurrect ancient carts. */
const CART_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * When a reload happens before the debounced PUT lands, the API cart can be empty
 * while this draft still has the latest lines. Prefer the draft inside this window.
 */
const CART_DRAFT_TRUST_OVER_SERVER_MS = 120_000;

type PersistedCartDraftV1 = {
  v: 1;
  locationId: string;
  savedAt: number;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  locationTimezone: string;
  scheduledFor: string | null;
  driverTipPercent: DriverTipPercent;
};

function loadPersistedCartDraft(locationId: string): PersistedCartDraftV1 | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(CART_ITEMS_DRAFT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedCartDraftV1;
    if (
      parsed.v !== 1 ||
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.items) ||
      parsed.locationId !== locationId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedCartDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CART_ITEMS_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function persistCartDraftToStorage(payload: {
  locationId: string;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  locationTimezone: string;
  scheduledFor: string | null;
  driverTipPercent: DriverTipPercent;
}): void {
  if (typeof window === "undefined") return;
  try {
    const data: PersistedCartDraftV1 = {
      v: 1,
      locationId: payload.locationId,
      savedAt: Date.now(),
      items: payload.items,
      fulfillmentType: payload.fulfillmentType,
      locationTimezone: payload.locationTimezone,
      scheduledFor: payload.scheduledFor,
      driverTipPercent: payload.driverTipPercent,
    };
    window.sessionStorage.setItem(CART_ITEMS_DRAFT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // QuotaExceededError / private mode — ignore
  }
}

function cartItemToSavedSnapshot(item: CartItem): SavedCartItemSnapshot {
  return {
    key: item.key,
    menu_item_id: item.menu_item_id,
    menu_item_slug: item.menu_item_slug ?? null,
    name: item.name,
    image_url: item.image_url ?? null,
    base_price_cents: item.base_price_cents,
    quantity: item.quantity,
    modifier_selections: item.modifier_selections ?? [],
    removed_ingredients: item.removed_ingredients ?? [],
    special_instructions: item.special_instructions ?? "",
    builder_payload: (item.builder_payload as Record<string, unknown> | undefined) ?? null,
  };
}

function driverTipPercentToApi(
  percent: DriverTipPercent,
): SavedCartSnapshot["driver_tip_percent"] {
  return percent === "none" ? "none" : (String(percent) as "10" | "15" | "20");
}

function snapshotFromDraft(
  draft: PersistedCartDraftV1,
  authenticated: boolean,
): SavedCartSnapshot {
  return {
    items: draft.items.map(cartItemToSavedSnapshot),
    fulfillment_type: draft.fulfillmentType,
    location_timezone: draft.locationTimezone,
    scheduled_for: draft.scheduledFor,
    driver_tip_percent: driverTipPercentToApi(draft.driverTipPercent),
    expires_at: null,
    is_guest: !authenticated,
  };
}

function serverSnapshotWithDraft(
  server: SavedCartSnapshot,
  draft: PersistedCartDraftV1,
): SavedCartSnapshot {
  return {
    ...server,
    items: draft.items.map(cartItemToSavedSnapshot),
    fulfillment_type: draft.fulfillmentType,
    location_timezone: draft.locationTimezone,
    scheduled_for: draft.scheduledFor,
    driver_tip_percent: driverTipPercentToApi(draft.driverTipPercent),
  };
}

function reconcileSavedCartHydration(args: {
  server: SavedCartSnapshot | null;
  draft: PersistedCartDraftV1 | null;
  locationId: string;
  now: number;
  authenticated: boolean;
}): {
  snapshot: SavedCartSnapshot | null;
  writeBackDraft: PersistedCartDraftV1 | null;
} {
  const { server, locationId, now, authenticated } = args;
  let { draft } = args;

  if (!draft || draft.locationId !== locationId) draft = null;
  else if (now - draft.savedAt > CART_DRAFT_MAX_AGE_MS) draft = null;

  if (!server && !draft) {
    return { snapshot: null, writeBackDraft: null };
  }
  if (!server) {
    if (!draft || !draft.items.length) {
      return { snapshot: null, writeBackDraft: null };
    }
    return {
      snapshot: snapshotFromDraft(draft, authenticated),
      writeBackDraft: draft,
    };
  }
  if (!draft) {
    return { snapshot: server, writeBackDraft: null };
  }

  const draftAge = now - draft.savedAt;
  const serverEmpty = server.items.length === 0;

  if (serverEmpty && draft.items.length > 0 && draftAge <= CART_DRAFT_MAX_AGE_MS) {
    return {
      snapshot: serverSnapshotWithDraft(server, draft),
      writeBackDraft: draft,
    };
  }

  if (draftAge <= CART_DRAFT_TRUST_OVER_SERVER_MS) {
    return {
      snapshot: serverSnapshotWithDraft(server, draft),
      writeBackDraft: draft,
    };
  }

  return { snapshot: server, writeBackDraft: null };
}

function loadPersistedOrderContext(): {
  hasCommittedOrderContext: boolean;
  fulfillmentType: FulfillmentType;
  locationTimezone: string;
  scheduledFor: string | null;
  schedulingConfig: SchedulingConfig;
  driverTipPercent: DriverTipPercent;
} {
  if (typeof window === "undefined") {
    return {
      hasCommittedOrderContext: false,
      fulfillmentType: "PICKUP",
      locationTimezone: "America/Toronto",
      scheduledFor: null,
      schedulingConfig: DEFAULT_SCHEDULING_CONFIG,
      driverTipPercent: "none",
    };
  }

  const raw = window.sessionStorage.getItem(ORDER_CONTEXT_STORAGE_KEY);
  if (!raw) {
    return {
      hasCommittedOrderContext: false,
      fulfillmentType: "PICKUP",
      locationTimezone: "America/Toronto",
      scheduledFor: null,
      schedulingConfig: DEFAULT_SCHEDULING_CONFIG,
      driverTipPercent: "none",
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      hasCommittedOrderContext: parsed.committed === true,
      fulfillmentType:
        (parsed.fulfillment_type ?? parsed.fulfillmentType) === "DELIVERY"
          ? "DELIVERY"
          : "PICKUP",
      locationTimezone:
        typeof (parsed.location_timezone ?? parsed.locationTimezone) === "string" &&
        String(parsed.location_timezone ?? parsed.locationTimezone).trim()
          ? String(parsed.location_timezone ?? parsed.locationTimezone)
          : "America/Toronto",
      scheduledFor:
        typeof parsed.scheduled_for === "string"
          ? parsed.scheduled_for
          : typeof parsed.scheduledFor === "string"
            ? parsed.scheduledFor
            : null,
      schedulingConfig: normalizeSchedulingConfig(
        parsed.scheduling_config ?? parsed.schedulingConfig,
      ),
      driverTipPercent: parseDriverTipPercent(
        parsed.driver_tip_percent ?? parsed.driverTipPercent,
      ),
    };
  } catch {
    return {
      hasCommittedOrderContext: false,
      fulfillmentType: "PICKUP",
      locationTimezone: "America/Toronto",
      scheduledFor: null,
      schedulingConfig: DEFAULT_SCHEDULING_CONFIG,
      driverTipPercent: "none",
    };
  }
}

function cartItemKey(
  menuItemId: string,
  modifiers: CartModifierSelection[],
  specialInstructions: string,
  removedIngredients: Array<{ id: string; name: string }> | undefined,
  builderPayload?: unknown,
): string {
  const modIds = modifiers
    .map((modifier) => modifier.modifier_option_id)
    .sort()
    .join(",");
  const removedIds = (removedIngredients ?? [])
    .map((ingredient) => ingredient.id)
    .sort()
    .join(",");
  const bp = builderPayload ? JSON.stringify(builderPayload) : "";
  return `${menuItemId}|${modIds}|${removedIds}|${specialInstructions}|${bp}`;
}

function snapshotItemToCartItem(snapshot: SavedCartItemSnapshot): CartItem {
  return {
    key: snapshot.key,
    menu_item_id: snapshot.menu_item_id,
    menu_item_slug: snapshot.menu_item_slug,
    name: snapshot.name,
    image_url: snapshot.image_url,
    base_price_cents: snapshot.base_price_cents,
    quantity: snapshot.quantity,
    modifier_selections: snapshot.modifier_selections,
    removed_ingredients: snapshot.removed_ingredients,
    special_instructions: snapshot.special_instructions,
    builder_payload: snapshot.builder_payload
      ? (snapshot.builder_payload as unknown as CartItem["builder_payload"])
      : undefined,
  };
}

/** Matches `loadPersistedOrderContext()` when `window` is undefined — must match SSR output. */
const SSR_ORDER_CONTEXT_INITIAL = {
  hasCommittedOrderContext: false,
  fulfillmentType: "PICKUP" as FulfillmentType,
  locationTimezone: "America/Toronto",
  scheduledFor: null as string | null,
  schedulingConfig: DEFAULT_SCHEDULING_CONFIG,
  driverTipPercent: "none" as DriverTipPercent,
};

export function useCartState(locationId: string): CartContextValue {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hasCommittedOrderContext, setHasCommittedOrderContext] = useState(
    SSR_ORDER_CONTEXT_INITIAL.hasCommittedOrderContext,
  );
  const [fulfillmentType, setFulfillmentType] =
    useState<FulfillmentType>(SSR_ORDER_CONTEXT_INITIAL.fulfillmentType);
  const [locationTimezone, setLocationTimezone] = useState(
    SSR_ORDER_CONTEXT_INITIAL.locationTimezone,
  );
  const [scheduledFor, setScheduledFor] = useState<string | null>(
    SSR_ORDER_CONTEXT_INITIAL.scheduledFor,
  );
  const [schedulingConfig, setSchedulingConfig] = useState<SchedulingConfig>(
    SSR_ORDER_CONTEXT_INITIAL.schedulingConfig,
  );
  const [cartAddNonce, setCartAddNonce] = useState(0);
  const [driverTipPercent, setDriverTipPercent] = useState<DriverTipPercent>(
    SSR_ORDER_CONTEXT_INITIAL.driverTipPercent,
  );
  const [cartExpiresAt, setCartExpiresAt] = useState<string | null>(null);
  const [isGuestCart, setIsGuestCart] = useState(true);
  const [isCartHydrated, setIsCartHydrated] = useState(false);

  const session = useSession();
  /** Consumed by the persistence effect to avoid PUT-ing state we just
   * *received* (hydration, merge, logout wipe). Each snapshot apply sets
   * this true; the effect's next pass reads-and-clears it. */
  const skipNextSyncRef = useRef(false);
  /** Null until the first auth-aware hydration decides the initial branch;
   * after that, tracks previous `session.authenticated` so we can detect
   * login (false→true = merge) and logout (true→false = local wipe). */
  const lastAuthenticatedRef = useRef<boolean | null>(null);

  /** SessionStorage is unavailable during SSR; hydrate after mount so server === first client paint. */
  const orderContextHydratedRef = useRef(false);
  useLayoutEffect(() => {
    const now = Date.now();
    const p = loadPersistedOrderContext();
    const draft = loadPersistedCartDraft(locationId);
    const draftUsable =
      draft &&
      draft.locationId === locationId &&
      now - draft.savedAt <= CART_DRAFT_MAX_AGE_MS &&
      draft.items.length > 0;

    if (draftUsable) {
      setItems(draft.items);
      setFulfillmentType(draft.fulfillmentType);
      setLocationTimezone(draft.locationTimezone);
      setScheduledFor(draft.scheduledFor);
      setDriverTipPercent(draft.driverTipPercent);
      setSchedulingConfig(p.schedulingConfig);
      setHasCommittedOrderContext(
        p.hasCommittedOrderContext ||
          Boolean(draft.scheduledFor) ||
          draft.fulfillmentType === "DELIVERY",
      );
    } else {
      setHasCommittedOrderContext(p.hasCommittedOrderContext);
      setFulfillmentType(p.fulfillmentType);
      setLocationTimezone(p.locationTimezone);
      setScheduledFor(p.scheduledFor);
      setSchedulingConfig(p.schedulingConfig);
      setDriverTipPercent(p.driverTipPercent);
    }
    orderContextHydratedRef.current = true;
  }, [locationId]);

  const addItem = useCallback(
    (incoming: Omit<CartItem, "key">) => {
      const removedIngredients = incoming.removed_ingredients?.length
        ? incoming.removed_ingredients
        : getRemovedIngredientsFromBuilderPayload(incoming.builder_payload);
      const key = cartItemKey(
        incoming.menu_item_id,
        incoming.modifier_selections,
        incoming.special_instructions,
        removedIngredients,
        incoming.builder_payload,
      );
      setItems((prev) => {
        const existing = prev.find((item) => item.key === key);
        if (existing) {
          return prev.map((item) =>
            item.key === key
              ? {
                  ...item,
                  quantity: item.quantity + incoming.quantity,
                  image_url: item.image_url ?? incoming.image_url ?? null,
                }
              : item,
          );
        }
        return [
          ...prev,
          {
            ...incoming,
            removed_ingredients: removedIngredients,
            key,
          },
        ];
      });
      setCartAddNonce((n) => n + 1);
      toast.success("Added to cart", { description: incoming.name });
    },
    [],
  );

  const removeItem = useCallback((key: string) => {
    let removedName: string | undefined;
    setItems((prev) => {
      removedName = prev.find((item) => item.key === key)?.name;
      return prev.filter((item) => item.key !== key);
    });
    if (removedName) {
      toast.message("Removed from cart", { description: removedName });
    }
  }, []);

  const updateQuantity = useCallback((key: string, quantity: number) => {
    if (quantity <= 0) {
      let removedName: string | undefined;
      setItems((prev) => {
        removedName = prev.find((item) => item.key === key)?.name;
        return prev.filter((item) => item.key !== key);
      });
      if (removedName) {
        toast.message("Removed from cart", { description: removedName });
      }
      return;
    }
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, quantity } : item)),
    );
    scheduleCartQuantityUpdatedToast();
  }, []);

  /**
   * Phase 13: replace an existing cart line with a freshly built one. The
   * new key is recomputed from the new selections so equivalent edits stay
   * deduplicated. If the recomputed key matches another existing line, we
   * merge quantities into that line and drop the original — same merge
   * semantics as `addItem`.
   */
  const replaceItem = useCallback(
    (existingKey: string, incoming: Omit<CartItem, "key">) => {
      const removedIngredients = incoming.removed_ingredients?.length
        ? incoming.removed_ingredients
        : getRemovedIngredientsFromBuilderPayload(incoming.builder_payload);
      const nextKey = cartItemKey(
        incoming.menu_item_id,
        incoming.modifier_selections,
        incoming.special_instructions,
        removedIngredients,
        incoming.builder_payload,
      );

      setItems((prev) => {
        const without = prev.filter((item) => item.key !== existingKey);
        const collidingIndex = without.findIndex((item) => item.key === nextKey);

        if (collidingIndex >= 0) {
          return without.map((item, index) =>
            index === collidingIndex
              ? {
                  ...item,
                  quantity: item.quantity + incoming.quantity,
                  image_url: item.image_url ?? incoming.image_url ?? null,
                }
              : item,
          );
        }

        const replacement: CartItem = {
          ...incoming,
          removed_ingredients: removedIngredients,
          key: nextKey,
        };

        // Keep the original line's position when possible so the cart
        // doesn't reshuffle while the user edits.
        const originalIndex = prev.findIndex((item) => item.key === existingKey);
        if (originalIndex < 0) {
          return [...without, replacement];
        }
        const next = [...without];
        next.splice(originalIndex, 0, replacement);
        return next;
      });
      toast.success("Cart updated", {
        description: `${incoming.name} saved in your cart.`,
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setItems([]);
    setDriverTipPercent("none");
    clearPersistedCartDraft();
  }, []);

  const commitOrderContext = useCallback(
    ({
      fulfillmentType: nextFulfillmentType,
      scheduledFor: nextScheduledFor,
    }: {
      fulfillmentType: FulfillmentType;
      scheduledFor: string | null;
    }) => {
      setFulfillmentType(nextFulfillmentType);
      setScheduledFor(nextScheduledFor);
      setHasCommittedOrderContext(true);
    },
    [],
  );

  const resetOrderContext = useCallback(() => {
    setHasCommittedOrderContext(false);
    setFulfillmentType("PICKUP");
    setLocationTimezone("America/Toronto");
    setScheduledFor(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!orderContextHydratedRef.current) return;

    window.sessionStorage.setItem(
      ORDER_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        committed: hasCommittedOrderContext,
        fulfillment_type: fulfillmentType,
        location_timezone: locationTimezone,
        scheduled_for: scheduledFor,
        scheduling_config: schedulingConfig,
        driver_tip_percent: driverTipPercent,
      }),
    );
  }, [
    fulfillmentType,
    locationTimezone,
    scheduledFor,
    schedulingConfig,
    hasCommittedOrderContext,
    driverTipPercent,
  ]);

  /* ------------------------------------------------------------------ */
  /*  Snapshot application helper                                        */
  /* ------------------------------------------------------------------ */

  const applySnapshot = useCallback(
    (snapshot: SavedCartSnapshot | null) => {
      if (snapshot) {
        setItems(snapshot.items.map(snapshotItemToCartItem));
        setFulfillmentType(snapshot.fulfillment_type);
        setLocationTimezone(snapshot.location_timezone);
        setScheduledFor(snapshot.scheduled_for);
        setDriverTipPercent(parseDriverTipPercent(snapshot.driver_tip_percent));
        setCartExpiresAt(snapshot.expires_at);
        setIsGuestCart(snapshot.is_guest);
        // If the snapshot carries meaningful schedule/fulfillment data, mirror
        // the existing sessionStorage committed logic.
        if (snapshot.scheduled_for || snapshot.fulfillment_type === "DELIVERY") {
          setHasCommittedOrderContext(true);
        }
      } else {
        // null snapshot → empty/defaults
        setItems([]);
        setCartExpiresAt(null);
        setIsGuestCart(!session.authenticated);
      }
    },
    [session.authenticated],
  );

  /* ------------------------------------------------------------------ */
  /*  Hydration: fetch saved cart after session finishes loading          */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!session.loaded) return;
    if (!orderContextHydratedRef.current) return;

    let cancelled = false;
    void (async () => {
      const server = await fetchSavedCart(locationId);
      if (cancelled) return;
      const draft = loadPersistedCartDraft(locationId);
      const reconciled = reconcileSavedCartHydration({
        server,
        draft,
        locationId,
        now: Date.now(),
        authenticated: session.authenticated,
      });
      if (cancelled) return;
      applySnapshot(reconciled.snapshot);
      setIsCartHydrated(true);
      skipNextSyncRef.current = true;
      // Seed lastAuthenticatedRef so subsequent transitions are detected
      // correctly and the initial mount is not treated as a "logout".
      lastAuthenticatedRef.current = session.authenticated;
      // If the browser draft beat the server snapshot, immediately write it
      // back so future tabs / reloads see the recovered cart too.
      if (reconciled.writeBackDraft) {
        const res = await putSavedCart(locationId, {
          items: reconciled.writeBackDraft.items,
          fulfillmentType: reconciled.writeBackDraft.fulfillmentType,
          locationTimezone: reconciled.writeBackDraft.locationTimezone,
          scheduledFor: reconciled.writeBackDraft.scheduledFor,
          driverTipPercent: reconciled.writeBackDraft.driverTipPercent,
        });
        if (cancelled || !res) return;
        setCartExpiresAt(res.expires_at);
        setIsGuestCart(res.is_guest);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once after session.loaded becomes true (and order-context hydration
    // is complete). We intentionally exclude session.authenticated here;
    // login/logout transitions are handled in their own dedicated effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.loaded, locationId]);

  /* ------------------------------------------------------------------ */
  /*  Debounced PUT: sync local mutations to the backend                 */
  /* ------------------------------------------------------------------ */

  const putTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isCartHydrated) return;

    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }

    if (putTimerRef.current) clearTimeout(putTimerRef.current);

    putTimerRef.current = setTimeout(() => {
      void (async () => {
        const res = await putSavedCart(locationId, {
          items,
          fulfillmentType,
          locationTimezone,
          scheduledFor,
          driverTipPercent,
        });
        if (res) {
          setCartExpiresAt(res.expires_at);
          setIsGuestCart(res.is_guest);
        }
      })();
    }, 400);

    return () => {
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, fulfillmentType, locationTimezone, scheduledFor, driverTipPercent]);

  /* ------------------------------------------------------------------ */
  /*  Login transition: merge guest cart into user cart                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!session.loaded) return;
    if (lastAuthenticatedRef.current === null) return; // not yet initialised
    if (lastAuthenticatedRef.current === session.authenticated) return;

    const wasAuthenticated = lastAuthenticatedRef.current;
    lastAuthenticatedRef.current = session.authenticated;

    if (!wasAuthenticated && session.authenticated) {
      // Login: merge guest → user
      void (async () => {
        const mergeResult = await mergeSavedCartOnLogin(locationId);
        if (mergeResult.snapshot) {
          applySnapshot(mergeResult.snapshot);
          skipNextSyncRef.current = true;
        } else {
          // Merge returned no snapshot — fall back to fetching user's cart
          const snapshot = await fetchSavedCart(locationId);
          applySnapshot(snapshot);
          skipNextSyncRef.current = true;
        }
      })();
    } else if (wasAuthenticated && !session.authenticated) {
      // Logout: wipe local cart (DB cart stays for next sign-in)
      clearPersistedCartDraft();
      setItems([]);
      setDriverTipPercent("none");
      setCartExpiresAt(null);
      setIsGuestCart(true);
      skipNextSyncRef.current = true;
      // Fetch the (now-guest) cart state
      void (async () => {
        const snapshot = await fetchSavedCart(locationId);
        if (snapshot) {
          applySnapshot(snapshot);
          skipNextSyncRef.current = true;
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.loaded, session.authenticated, locationId]);

  /* ------------------------------------------------------------------ */

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const syncPayloadRef = useRef({
    locationId,
    items,
    fulfillmentType,
    locationTimezone,
    scheduledFor,
    driverTipPercent,
  });
  syncPayloadRef.current = {
    locationId,
    items,
    fulfillmentType,
    locationTimezone,
    scheduledFor,
    driverTipPercent,
  };

  const isCartHydratedRef = useRef(false);
  useEffect(() => {
    isCartHydratedRef.current = isCartHydrated;
  }, [isCartHydrated]);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!orderContextHydratedRef.current) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      persistCartDraftToStorage({
        locationId,
        items,
        fulfillmentType,
        locationTimezone,
        scheduledFor,
        driverTipPercent,
      });
    }, 200);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [items, fulfillmentType, locationId, locationTimezone, scheduledFor, driverTipPercent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushDraftAndMaybePut = () => {
      const p = syncPayloadRef.current;
      persistCartDraftToStorage(p);
      if (isCartHydratedRef.current) {
        void putSavedCart(p.locationId, {
          items: p.items,
          fulfillmentType: p.fulfillmentType,
          locationTimezone: p.locationTimezone,
          scheduledFor: p.scheduledFor,
          driverTipPercent: p.driverTipPercent,
        });
      }
    };
    window.addEventListener("pagehide", flushDraftAndMaybePut);
    return () => window.removeEventListener("pagehide", flushDraftAndMaybePut);
  }, []);

  return {
    items,
    hasCommittedOrderContext,
    fulfillmentType,
    locationId,
    locationTimezone,
    scheduledFor,
    schedulingConfig,
    cartAddNonce,
    driverTipPercent,
    cartExpiresAt,
    isGuestCart,
    isCartHydrated,
    isCartHydrating: !isCartHydrated,
    addItem,
    removeItem,
    updateQuantity,
    replaceItem,
    commitOrderContext,
    setLocationTimezone,
    setFulfillmentType,
    setScheduledFor,
    setSchedulingConfig,
    resetOrderContext,
    setDriverTipPercent,
    clear,
    itemCount,
  };
}
