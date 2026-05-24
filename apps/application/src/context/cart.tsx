import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_LOCATION_ID } from "../lib/env";
import {
  deleteSavedCart,
  fetchSavedCart,
  mergeSavedCartOnLogin,
  putSavedCart,
  type DriverTipPercent,
  type SavedCartItemSnapshot,
  type SavedCartSnapshot,
} from "../lib/saved-cart-api";
import type {
  CartBuilderPayload,
  CartItem,
  CartModifierSelection,
  FulfillmentType,
  RemovedIngredientSelection,
} from "../lib/types";
import { useSession } from "./session";

type PersistedCartDraft = {
  v: 1;
  locationId: string;
  savedAt: number;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  locationTimezone: string;
  scheduledFor: string | null;
  driverTipPercent: DriverTipPercent;
};

type CartState = {
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  locationId: string;
  locationTimezone: string;
  scheduledFor: string | null;
  driverTipPercent: DriverTipPercent;
  cartExpiresAt: string | null;
  isGuestCart: boolean;
  isCartHydrated: boolean;
  isCartHydrating: boolean;
  cartAddNonce: number;
};

type CartActions = {
  addItem: (item: Omit<CartItem, "key">) => void;
  replaceItem: (existingKey: string, item: Omit<CartItem, "key">) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  setFulfillmentType: (type: FulfillmentType) => void;
  setLocationTimezone: (timezone: string) => void;
  setScheduledFor: (scheduledFor: string | null) => void;
  setDriverTipPercent: (percent: DriverTipPercent) => void;
  clear: () => void;
  itemCount: number;
};

export type CartContextValue = CartState & CartActions;

const CartContext = createContext<CartContextValue | null>(null);

const CART_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CART_DRAFT_KEY = "wings4u.mobile-cart-draft-v1";

const DEFAULT_CART_CONTEXT = {
  fulfillmentType: "PICKUP" as FulfillmentType,
  locationTimezone: "America/Toronto",
  scheduledFor: null as string | null,
  driverTipPercent: "none" as DriverTipPercent,
};

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}

function parseDriverTipPercent(value: unknown): DriverTipPercent {
  if (value === "none") return "none";
  const numeric = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (numeric === 10 || numeric === 15 || numeric === 20) return numeric;
  return "none";
}

function draftStorageKey(locationId: string): string {
  return `${CART_DRAFT_KEY}:${locationId}`;
}

async function loadPersistedDraft(locationId: string): Promise<PersistedCartDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(draftStorageKey(locationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCartDraft>;
    if (
      parsed.v !== 1 ||
      parsed.locationId !== locationId ||
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > CART_DRAFT_MAX_AGE_MS) {
      await AsyncStorage.removeItem(draftStorageKey(locationId));
      return null;
    }
    return parsed as PersistedCartDraft;
  } catch {
    return null;
  }
}

async function persistDraft(payload: Omit<PersistedCartDraft, "v" | "savedAt">): Promise<void> {
  try {
    const data: PersistedCartDraft = {
      v: 1,
      savedAt: Date.now(),
      ...payload,
    };
    await AsyncStorage.setItem(draftStorageKey(payload.locationId), JSON.stringify(data));
  } catch {
    // Storage is best-effort; DB sync remains the source of truth.
  }
}

async function clearPersistedDraft(locationId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(draftStorageKey(locationId));
  } catch {
    // ignore
  }
}

function getRemovedIngredientsFromPayload(
  payload: CartBuilderPayload | undefined,
): RemovedIngredientSelection[] {
  if (!payload) return [];
  if (payload.builder_type === "ITEM_CUSTOMIZATION") {
    return payload.removed_ingredients ?? [];
  }
  if (payload.builder_type === "LUNCH_SPECIAL") {
    return payload.removed_ingredients ?? [];
  }
  if (payload.builder_type === "WING_COMBO") {
    return payload.salad_customization?.removed_ingredients ?? [];
  }
  return [];
}

function normalizeRemovedIngredients(
  incoming: Omit<CartItem, "key">,
): RemovedIngredientSelection[] {
  return incoming.removed_ingredients?.length
    ? incoming.removed_ingredients
    : getRemovedIngredientsFromPayload(incoming.builder_payload);
}

export function cartItemKey(
  menuItemId: string,
  modifierSelections: CartModifierSelection[],
  specialInstructions: string,
  removedIngredients?: RemovedIngredientSelection[],
  builderPayload?: CartBuilderPayload,
): string {
  const modifierIds = modifierSelections
    .map((selection) => selection.modifier_option_id ?? selection.option_name)
    .sort()
    .join(",");
  const removedIds = (removedIngredients ?? [])
    .map((selection) => selection.id)
    .sort()
    .join(",");
  const payload = builderPayload ? JSON.stringify(builderPayload) : "";
  return `${menuItemId}|${modifierIds}|${removedIds}|${specialInstructions.trim()}|${payload}`;
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
    modifier_selections: snapshot.modifier_selections ?? [],
    removed_ingredients: snapshot.removed_ingredients ?? [],
    special_instructions: snapshot.special_instructions ?? "",
    builder_payload: snapshot.builder_payload
      ? (snapshot.builder_payload as unknown as CartBuilderPayload)
      : undefined,
  };
}

function draftToSnapshot(
  draft: PersistedCartDraft,
  authenticated: boolean,
): SavedCartSnapshot {
  return {
    items: draft.items.map((item) => ({
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
    })),
    fulfillment_type: draft.fulfillmentType,
    location_timezone: draft.locationTimezone,
    scheduled_for: draft.scheduledFor,
    driver_tip_percent:
      draft.driverTipPercent === "none"
        ? "none"
        : (String(draft.driverTipPercent) as "10" | "15" | "20"),
    expires_at: null,
    is_guest: !authenticated,
  };
}

function shouldUseDraft(server: SavedCartSnapshot | null, draft: PersistedCartDraft | null): boolean {
  if (!draft || draft.items.length === 0) return false;
  if (!server) return true;
  return server.items.length === 0;
}

export function CartProvider({
  children,
  locationId = DEFAULT_LOCATION_ID,
}: {
  children: React.ReactNode;
  locationId?: string;
}) {
  const session = useSession();
  const [items, setItems] = useState<CartItem[]>([]);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(
    DEFAULT_CART_CONTEXT.fulfillmentType,
  );
  const [locationTimezone, setLocationTimezone] = useState(
    DEFAULT_CART_CONTEXT.locationTimezone,
  );
  const [scheduledFor, setScheduledFor] = useState<string | null>(
    DEFAULT_CART_CONTEXT.scheduledFor,
  );
  const [driverTipPercent, setDriverTipPercent] = useState<DriverTipPercent>(
    DEFAULT_CART_CONTEXT.driverTipPercent,
  );
  const [cartExpiresAt, setCartExpiresAt] = useState<string | null>(null);
  const [isGuestCart, setIsGuestCart] = useState(true);
  const [isCartHydrated, setIsCartHydrated] = useState(false);
  const [cartAddNonce, setCartAddNonce] = useState(0);

  const skipNextSyncRef = useRef(false);
  const lastAuthenticatedRef = useRef<boolean | null>(null);

  const applySnapshot = useCallback((snapshot: SavedCartSnapshot | null) => {
    if (!snapshot) {
      setItems([]);
      setFulfillmentType(DEFAULT_CART_CONTEXT.fulfillmentType);
      setLocationTimezone(DEFAULT_CART_CONTEXT.locationTimezone);
      setScheduledFor(DEFAULT_CART_CONTEXT.scheduledFor);
      setDriverTipPercent(DEFAULT_CART_CONTEXT.driverTipPercent);
      setCartExpiresAt(null);
      setIsGuestCart(true);
      return;
    }

    setItems(snapshot.items.map(snapshotItemToCartItem));
    setFulfillmentType(snapshot.fulfillment_type);
    setLocationTimezone(snapshot.location_timezone || DEFAULT_CART_CONTEXT.locationTimezone);
    setScheduledFor(snapshot.scheduled_for);
    setDriverTipPercent(parseDriverTipPercent(snapshot.driver_tip_percent));
    setCartExpiresAt(snapshot.expires_at);
    setIsGuestCart(snapshot.is_guest);
  }, []);

  useEffect(() => {
    if (!session.loaded) return;
    let cancelled = false;

    setIsCartHydrated(false);
    void (async () => {
      const [server, draft] = await Promise.all([
        fetchSavedCart(locationId),
        loadPersistedDraft(locationId),
      ]);
      if (cancelled) return;

      const useDraft = shouldUseDraft(server, draft);
      const snapshot = useDraft && draft ? draftToSnapshot(draft, session.authenticated) : server;
      applySnapshot(snapshot);
      skipNextSyncRef.current = true;
      lastAuthenticatedRef.current = session.authenticated;
      setIsCartHydrated(true);

      if (useDraft && draft) {
        const written = await putSavedCart(locationId, {
          items: draft.items,
          fulfillmentType: draft.fulfillmentType,
          locationTimezone: draft.locationTimezone,
          scheduledFor: draft.scheduledFor,
          driverTipPercent: draft.driverTipPercent,
        });
        if (!cancelled && written) {
          setCartExpiresAt(written.expires_at);
          setIsGuestCart(written.is_guest);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySnapshot, locationId, session.loaded]);

  useEffect(() => {
    if (!session.loaded || !isCartHydrated) return;
    const previous = lastAuthenticatedRef.current;
    if (previous === null || previous === session.authenticated) {
      lastAuthenticatedRef.current = session.authenticated;
      return;
    }

    lastAuthenticatedRef.current = session.authenticated;
    let cancelled = false;

    if (previous === false && session.authenticated) {
      const localPayload = {
        items,
        fulfillmentType,
        locationTimezone,
        scheduledFor,
        driverTipPercent,
      };
      setIsCartHydrated(false);
      void (async () => {
        const merged = await mergeSavedCartOnLogin(locationId);
        let snapshot = merged.snapshot ?? (await fetchSavedCart(locationId));
        if ((!snapshot || snapshot.items.length === 0) && localPayload.items.length > 0) {
          snapshot = await putSavedCart(locationId, localPayload);
        }
        if (cancelled) return;
        applySnapshot(snapshot);
        skipNextSyncRef.current = true;
        setIsCartHydrated(true);
      })();
    } else if (previous === true && !session.authenticated) {
      skipNextSyncRef.current = true;
      applySnapshot(null);
      void clearPersistedDraft(locationId);
    }

    return () => {
      cancelled = true;
    };
  }, [
    applySnapshot,
    driverTipPercent,
    fulfillmentType,
    isCartHydrated,
    items,
    locationId,
    locationTimezone,
    scheduledFor,
    session.authenticated,
    session.loaded,
  ]);

  useEffect(() => {
    if (!isCartHydrated) return;
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }

    const timeout = setTimeout(() => {
      const payload = {
        locationId,
        items,
        fulfillmentType,
        locationTimezone,
        scheduledFor,
        driverTipPercent,
      };
      void persistDraft(payload);
      void (async () => {
        const snapshot = await putSavedCart(locationId, payload);
        if (snapshot) {
          setCartExpiresAt(snapshot.expires_at);
          setIsGuestCart(snapshot.is_guest);
        }
      })();
    }, 450);

    return () => clearTimeout(timeout);
  }, [
    driverTipPercent,
    fulfillmentType,
    isCartHydrated,
    items,
    locationId,
    locationTimezone,
    scheduledFor,
  ]);

  const addItem = useCallback((incoming: Omit<CartItem, "key">) => {
    const removedIngredients = normalizeRemovedIngredients(incoming);
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
          key,
          removed_ingredients: removedIngredients,
        },
      ];
    });
    setCartAddNonce((value) => value + 1);
  }, []);

  const replaceItem = useCallback((existingKey: string, incoming: Omit<CartItem, "key">) => {
    const removedIngredients = normalizeRemovedIngredients(incoming);
    const nextKey = cartItemKey(
      incoming.menu_item_id,
      incoming.modifier_selections,
      incoming.special_instructions,
      removedIngredients,
      incoming.builder_payload,
    );

    setItems((prev) => {
      const withoutExisting = prev.filter((item) => item.key !== existingKey);
      const collisionIndex = withoutExisting.findIndex((item) => item.key === nextKey);
      if (collisionIndex >= 0) {
        return withoutExisting.map((item, index) =>
          index === collisionIndex
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
        key: nextKey,
        removed_ingredients: removedIngredients,
      };
      const originalIndex = prev.findIndex((item) => item.key === existingKey);
      if (originalIndex < 0) return [...withoutExisting, replacement];
      const next = [...withoutExisting];
      next.splice(originalIndex, 0, replacement);
      return next;
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const updateQuantity = useCallback((key: string, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) return prev.filter((item) => item.key !== key);
      return prev.map((item) => (item.key === key ? { ...item, quantity } : item));
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setDriverTipPercent("none");
    setScheduledFor(null);
    void clearPersistedDraft(locationId);
    void deleteSavedCart(locationId);
  }, [locationId]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      fulfillmentType,
      locationId,
      locationTimezone,
      scheduledFor,
      driverTipPercent,
      cartExpiresAt,
      isGuestCart,
      isCartHydrated,
      isCartHydrating: !isCartHydrated,
      cartAddNonce,
      addItem,
      replaceItem,
      removeItem,
      updateQuantity,
      setFulfillmentType,
      setLocationTimezone,
      setScheduledFor,
      setDriverTipPercent,
      clear,
      itemCount,
    }),
    [
      addItem,
      cartAddNonce,
      cartExpiresAt,
      clear,
      driverTipPercent,
      fulfillmentType,
      isCartHydrated,
      isGuestCart,
      itemCount,
      items,
      locationId,
      locationTimezone,
      removeItem,
      replaceItem,
      scheduledFor,
      updateQuantity,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
