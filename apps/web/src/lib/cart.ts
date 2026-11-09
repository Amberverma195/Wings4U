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
  cancelDeferredSavedCartWrite,
  type SavedCartItemSnapshot,
  type SavedCartSnapshot,
} from "./saved-cart-api";
import { useSession } from "./session";
import { getAuthSessionGeneration } from "./auth-events";
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
  cartHydrationError?: string | null;
  cartHydrationConflict?: boolean;
};

export type CartActions = {
  retryCartRestoration?: () => void;
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
  clear: (options?: { afterCheckout?: boolean }) => void;
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
  pending?: boolean;
  baseRevision?: string | null;
  ownerId?: string | null;
  expiresAt?: string | null;
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
  try {
    const raw = window.sessionStorage.getItem(CART_ITEMS_DRAFT_STORAGE_KEY);
    if (!raw) return null;
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
}, ownerId: string | null, expiresAt: string | null, pending = false, baseRevision?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const data: PersistedCartDraftV1 = {
      v: 1,
      ownerId,
      expiresAt,
      pending,
      baseRevision,
      locationId: payload.locationId,
      savedAt: Date.now(),
      items: payload.items,
      fulfillmentType: payload.fulfillmentType,
      locationTimezone: payload.locationTimezone,
      scheduledFor: payload.scheduledFor,
      driverTipPercent: payload.driverTipPercent,
    };
    const previous = loadPersistedCartDraft(payload.locationId);
    if (previous) {
      const signature = (draft: PersistedCartDraftV1) => JSON.stringify([draft.ownerId ?? null, draft.locationId,
        draft.items.map(cartItemToSavedSnapshot), draft.fulfillmentType, draft.locationTimezone, draft.scheduledFor, draft.driverTipPercent]);
      if (signature(previous) === signature(data)) {
        if (previous.expiresAt === data.expiresAt && previous.pending === pending && previous.baseRevision === baseRevision) return;
        data.savedAt = previous.savedAt;
      }
    }
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
  ownerId?: string | null;
}): {
  snapshot: SavedCartSnapshot | null;
  writeBackDraft: PersistedCartDraftV1 | null;
} {
  const { server, locationId, now, authenticated } = args;
  let { draft } = args;
  if (draft && (draft.ownerId ?? null) !== (args.ownerId ?? null)) draft = null;
  if (draft && authenticated && !draft.ownerId) draft = null;
  if (draft?.expiresAt && (!Number.isFinite(Date.parse(draft.expiresAt)) || Date.parse(draft.expiresAt) <= now)) draft = null;

  if (!draft || draft.locationId !== locationId) draft = null;
  else if (!Number.isFinite(draft.savedAt) || now < draft.savedAt || now - draft.savedAt > CART_DRAFT_MAX_AGE_MS) draft = null;

  if (server?.converted && !(draft?.pending && draft.baseRevision === server.revision)) {
    return { snapshot: server, writeBackDraft: null };
  }

  if (server?.expired || (server?.expires_at && Date.parse(server.expires_at) <= now)) {
    return { snapshot: { ...server, items: [] }, writeBackDraft: null };
  }

  if (!server && !draft) {
    return { snapshot: null, writeBackDraft: null };
  }
  if (draft?.pending === false) return { snapshot: server, writeBackDraft: null };
  if (!server) {
    if (!draft || (!draft.items.length && !draft.pending)) {
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

  if (draft.pending && draft.baseRevision !== undefined && server.revision !== undefined &&
      draft.baseRevision !== server.revision && snapshotContentSignature(server) !==
        snapshotContentSignature(snapshotFromDraft(draft, authenticated))) {
    throw Object.assign(new Error("Your saved cart changed while this browser had unsaved edits. Your draft has been kept. Restore the saved cart to continue."), { status: 409 });
  }
  if (draft.pending) return { snapshot: serverSnapshotWithDraft(server, draft), writeBackDraft: draft };

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

function snapshotContentSignature(snapshot: SavedCartSnapshot | null): string {
  return JSON.stringify([snapshot?.items.map(item => cartItemToSavedSnapshot(snapshotItemToCartItem(item))) ?? [],
    snapshot?.fulfillment_type ?? "PICKUP", snapshot?.location_timezone ?? "America/Toronto",
    snapshot?.scheduled_for ?? null, snapshot?.driver_tip_percent ?? "none"]);
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

  try {
    const raw = window.sessionStorage.getItem(ORDER_CONTEXT_STORAGE_KEY);
    if (!raw) return { ...SSR_ORDER_CONTEXT_INITIAL };
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
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [cartHydrationError, setCartHydrationError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [acknowledgement, setAcknowledgement] = useState(0);

  const session = useSession();
  const ownerId = session.authenticated ? session.user?.id ?? null : null;
  const ownerKnown = session.loaded && session.resolved !== false && (!session.authenticated || ownerId !== null);
  const scope = JSON.stringify([locationId, ownerId]);
  const ready = ownerKnown && isCartHydrated && hydratedScope === scope;
  const displayedScopeRef = useRef<string | null>(null);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = ownerKnown ? scope : "unresolved";
  const acknowledgedSignature = useRef<string | null>(null);
  const revisionRef = useRef<string | null | undefined>(undefined);
  const previousOwner = useRef<{ authenticated: boolean; ownerId: string | null } | null>(null);
  /** Consumed by the persistence effect to avoid PUT-ing state we just
   * *received* (hydration, merge, logout wipe). Each snapshot apply sets
   * this true; the effect's next pass reads-and-clears it. */
  const skipNextSyncRef = useRef(false);

  /** SessionStorage is unavailable during SSR; hydrate after mount so server === first client paint. */
  const orderContextHydratedRef = useRef(false);
  useLayoutEffect(() => {
    const p = loadPersistedOrderContext();
    setSchedulingConfig(p.schedulingConfig);
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

  const clear = useCallback((options?: { afterCheckout?: boolean }) => {
    cancelDeferredSavedCartWrite?.();
    syncPayloadRef.current = { ...syncPayloadRef.current, items: [], driverTipPercent: "none" };
    setItems([]);
    setDriverTipPercent("none");
    clearPersistedCartDraft();
    if (options?.afterCheckout) {
      // Checkout already converted the cart. Read its new revision before
      // accepting the next order's edits; do not autosave an empty old revision.
      skipNextSyncRef.current = true;
      setIsCartHydrated(false);
      setRestoreAttempt(value => value + 1);
    }
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
    if (!ready) return;

    try { window.sessionStorage.setItem(
      ORDER_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        committed: hasCommittedOrderContext,
        fulfillment_type: fulfillmentType,
        location_timezone: locationTimezone,
        scheduled_for: scheduledFor,
        scheduling_config: schedulingConfig,
        driver_tip_percent: driverTipPercent,
      }),
    ); } catch { /* The server remains usable when browser storage is unavailable. */ }
  }, [
    fulfillmentType,
    locationTimezone,
    scheduledFor,
    schedulingConfig,
    hasCommittedOrderContext,
    driverTipPercent,
    ready,
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
        setCartExpiresAt(snapshot.expired ? null : snapshot.expires_at);
        setIsGuestCart(snapshot.is_guest);
        if (snapshot.expired) setHasCommittedOrderContext(false);
        // If the snapshot carries meaningful schedule/fulfillment data, mirror
        // the existing sessionStorage committed logic.
        if (snapshot.items.length > 0 || snapshot.scheduled_for || snapshot.fulfillment_type === "DELIVERY") {
          setHasCommittedOrderContext(true);
        }
      } else {
        // null snapshot → empty/defaults
        setItems([]);
        setFulfillmentType("PICKUP");
        setLocationTimezone("America/Toronto");
        setScheduledFor(null);
        setDriverTipPercent("none");
        setHasCommittedOrderContext(false);
        setCartExpiresAt(null);
        setIsGuestCart(!session.authenticated);
      }
    },
    [session.authenticated],
  );

  // Long-lived tabs must not keep an idle cart alive past its server deadline.
  useEffect(() => {
    if (!cartExpiresAt || !Number.isFinite(Date.parse(cartExpiresAt))) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (activeScopeRef.current !== scope) return;
      const remaining = Date.parse(cartExpiresAt) - Date.now();
      if (remaining > 0) { timer = setTimeout(check, Math.min(remaining, 2_147_483_647)); return; }
      skipNextSyncRef.current = true;
      cancelDeferredSavedCartWrite?.();
      acknowledgedSignature.current = snapshotContentSignature(null);
      clearPersistedCartDraft();
      setHasCommittedOrderContext(false);
      applySnapshot({ items: [], fulfillment_type: "PICKUP", location_timezone: "America/Toronto",
        scheduled_for: null, driver_tip_percent: "none", expires_at: null, is_guest: !session.authenticated, expired: true });
    };
    check();
    return () => clearTimeout(timer);
  }, [cartExpiresAt, applySnapshot, session.authenticated, scope]);

  // Ownership must be resolved before reading or replacing any draft. One
  // lifecycle handles initial hydration, login, logout, account and location changes.
  const [cartHydrationConflict, setCartHydrationConflict] = useState(false);
  const retryCartRestoration = useCallback(() => {
    if (cartHydrationConflict && ownerKnown && activeScopeRef.current === scope) clearPersistedCartDraft(); // explicit "Use saved cart" action
    void Promise.resolve(session.refresh?.()).finally(() => setRestoreAttempt(value => value + 1));
  }, [session.refresh, cartHydrationConflict, ownerKnown, scope]);

  useEffect(() => {
    if (!ownerKnown) {
      setIsCartHydrated(false);
      setCartHydrationError(session.loaded ? session.error || "We could not verify your session. Please retry restoring your cart." : null);
      return;
    }
    let cancelled = false;
    const previous = previousOwner.current;
    const changedOwner = previous !== null && previous.ownerId !== ownerId;
    if (changedOwner) {
      cancelDeferredSavedCartWrite?.();
      if (previous.authenticated) clearPersistedCartDraft();
    }
    previousOwner.current = { ownerId, authenticated: session.authenticated };
    displayedScopeRef.current = scope;
    setIsCartHydrated(false);
    setCartHydrationError(null);
    setCartHydrationConflict(false);
    setItems([]);
    setCartExpiresAt(null);
    void (async () => {
      try {
        const merged = previous && !previous.authenticated && session.authenticated
          ? await mergeSavedCartOnLogin(locationId, ownerId) : null;
        if (cancelled) return;
        const server = merged?.snapshot ?? await fetchSavedCart(locationId, ownerId);
        if (cancelled) return;
        if (server?.expired) clearPersistedCartDraft();
        const reconciled = reconcileSavedCartHydration({ server, draft: loadPersistedCartDraft(locationId),
          locationId, now: Date.now(), authenticated: session.authenticated, ownerId });
        acknowledgedSignature.current = snapshotContentSignature(server);
        revisionRef.current = server?.revision;
        skipNextSyncRef.current = true;
        applySnapshot(reconciled.snapshot);
        setHydratedScope(scope);
        setIsCartHydrated(true);
        if (reconciled.writeBackDraft) {
          const draft = reconciled.writeBackDraft;
          const signature = snapshotContentSignature(snapshotFromDraft(draft, session.authenticated));
          const res = await putSavedCart(locationId, { ...draft, ownerId });
          if (cancelled || !res) return;
          acknowledgedSignature.current = signature;
          revisionRef.current = res.revision;
          setCartExpiresAt(res.expires_at);
          setIsGuestCart(res.is_guest);
          setAcknowledgement(value => value + 1);
        }
      } catch (error) {
        if (cancelled) return;
        const draft = loadPersistedCartDraft(locationId);
        const fallback = reconcileSavedCartHydration({ server: null,
          draft: draft ? { ...draft, pending: undefined } : null,
          locationId, now: Date.now(), authenticated: session.authenticated, ownerId });
        if (fallback.snapshot) applySnapshot(fallback.snapshot);
        setCartHydrationError(error instanceof Error ? error.message : "Your cart could not be restored. Please retry.");
        const failure = error as { status?: number; code?: string };
        setCartHydrationConflict(failure?.status === 409 && failure.code !== "SAVED_CART_OWNER_CHANGED");
      }
    })();
    return () => { cancelled = true; };
    // The owner/scope dependencies cancel reads and merges from an earlier account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKnown, scope, session.loaded, session.resolved, session.authenticated, session.error, restoreAttempt]);

  useEffect(() => {
    if (!ready || cartHydrationError) return;
    if (skipNextSyncRef.current) { skipNextSyncRef.current = false; return; }
    const payload = { locationId, items, fulfillmentType, locationTimezone, scheduledFor, driverTipPercent };
    const signature = snapshotContentSignature(snapshotFromDraft({ ...payload, v: 1, savedAt: Date.now() }, session.authenticated));
    if (signature === acknowledgedSignature.current) return;
    const generation = getAuthSessionGeneration();
    const timer = setTimeout(() => {
      if (activeScopeRef.current !== scope || generation !== getAuthSessionGeneration()) return;
      void putSavedCart(locationId, { ...payload, ownerId }).then(res => {
        if (!res || activeScopeRef.current !== scope || generation !== getAuthSessionGeneration()) return;
        acknowledgedSignature.current = signature;
        revisionRef.current = res.revision;
        setCartExpiresAt(res.expires_at);
        setIsGuestCart(res.is_guest);
        setAcknowledgement(value => value + 1);
        const latest = snapshotContentSignature(snapshotFromDraft({ ...syncPayloadRef.current, v: 1, savedAt: Date.now() }, session.authenticated));
        if (latest === signature) { setCartHydrationError(null); setCartHydrationConflict(false); }
      }).catch(error => {
        if (activeScopeRef.current !== scope || generation !== getAuthSessionGeneration()) return;
        const latest = snapshotContentSignature(snapshotFromDraft({ ...syncPayloadRef.current, v: 1, savedAt: Date.now() }, session.authenticated));
        if (latest !== signature) return;
        setCartHydrationError(error instanceof Error ? error.message : "Your latest cart could not be saved. Please retry.");
        setCartHydrationConflict(error?.status === 409 && error?.code !== "SAVED_CART_OWNER_CHANGED");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [ready, cartHydrationError, scope, locationId, ownerId, items, fulfillmentType, locationTimezone,
    scheduledFor, driverTipPercent, acknowledgement, session.authenticated]);

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

  const draftReadyRef = useRef(false);
  draftReadyRef.current = ready;
  const draftOwnerRef = useRef(ownerId);
  draftOwnerRef.current = ownerId;
  const cartExpiryRef = useRef(cartExpiresAt);
  cartExpiryRef.current = cartExpiresAt;
  const persistCurrentDraft = useCallback(() => {
    if (!draftReadyRef.current) return;
    const p = syncPayloadRef.current;
    const signature = snapshotContentSignature(snapshotFromDraft({ ...p, v: 1, savedAt: Date.now() }, draftOwnerRef.current !== null));
    persistCartDraftToStorage(p, draftOwnerRef.current, cartExpiryRef.current,
      signature !== acknowledgedSignature.current, revisionRef.current);
  }, []);
  // Synchronous after a committed edit: a refresh before the backend debounce
  // must still see this exact cart. Never persist pre-hydration defaults.
  useLayoutEffect(() => { persistCurrentDraft(); }, [persistCurrentDraft, ready, items, fulfillmentType,
    locationId, locationTimezone, scheduledFor, driverTipPercent, cartExpiresAt, acknowledgement]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", persistCurrentDraft);
    return () => window.removeEventListener("pagehide", persistCurrentDraft);
  }, [persistCurrentDraft]);

  return {
    items: ownerKnown && displayedScopeRef.current === scope ? items : [],
    hasCommittedOrderContext: ownerKnown && displayedScopeRef.current === scope ? hasCommittedOrderContext : false,
    fulfillmentType: ownerKnown && displayedScopeRef.current === scope ? fulfillmentType : "PICKUP",
    locationId,
    locationTimezone: ownerKnown && displayedScopeRef.current === scope ? locationTimezone : "America/Toronto",
    scheduledFor: ownerKnown && displayedScopeRef.current === scope ? scheduledFor : null,
    schedulingConfig,
    cartAddNonce,
    driverTipPercent: ownerKnown && displayedScopeRef.current === scope ? driverTipPercent : "none",
    cartExpiresAt,
    isGuestCart,
    isCartHydrated: ready && !cartHydrationError,
    isCartHydrating: !ready && !cartHydrationError,
    cartHydrationError,
    cartHydrationConflict: ownerKnown && activeScopeRef.current === scope && cartHydrationConflict,
    retryCartRestoration,
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
    itemCount: ownerKnown && displayedScopeRef.current === scope ? itemCount : 0,
  };
}
