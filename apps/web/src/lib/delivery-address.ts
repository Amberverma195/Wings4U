"use client";

import type { ApiEnvelope } from "@wings4u/contracts";
import { apiFetch } from "./api";
import { withSilentRefresh } from "./session";

export type DeliveryAddressDraft = {
  line1: string;
  city: string;
  postalCode: string;
};

export const FIXED_DELIVERY_CITY = "London";

export function normalizeDeliveryPostalCode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

export function hasCompleteDeliveryAddress(
  value: DeliveryAddressDraft | null | undefined,
): value is DeliveryAddressDraft {
  if (!value) return false;

  return (
    value.line1.trim().length > 0 &&
    value.city.trim().length > 0 &&
    normalizeDeliveryPostalCode(value.postalCode).length > 0
  );
}

const DELIVERY_ADDRESS_STORAGE_KEY = "wings4u.delivery-address";

const DELIVERY_ADDRESSES_LIST_KEY = "wings4u.delivery-addresses";

/** Fired when the saved-address list changes (same tab + sessionStorage). */
export const DELIVERY_ADDRESSES_UPDATED_EVENT = "wings4u-delivery-addresses-updated";

export type SavedDeliveryAddress = DeliveryAddressDraft & { id: string };

/** Fired on `window` after `saveDeliveryAddressDraft` (same tab + sessionStorage). */
export const DELIVERY_ADDRESS_UPDATED_EVENT = "wings4u-delivery-address-updated";

/** Fired when the user completes the delivery-address modal (intentional save). */
export const DELIVERY_ADDRESS_SAVED_EVENT = "wings4u-delivery-address-saved";

function isDeliveryAddressDraft(value: unknown): value is DeliveryAddressDraft {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.line1 === "string" &&
    typeof candidate.city === "string" &&
    typeof candidate.postalCode === "string"
  );
}

function isSavedDeliveryAddress(value: unknown): value is SavedDeliveryAddress {
  if (!isDeliveryAddressDraft(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && candidate.id.length > 0;
}

export function deliveryAddressDedupeKey(d: DeliveryAddressDraft): string {
  return `${d.line1.trim().toLowerCase()}|${normalizeDeliveryPostalCode(d.postalCode).toLowerCase()}`;
}

function loadSavedAddressesRaw(): SavedDeliveryAddress[] {
  if (typeof window === "undefined") return [];

  const raw = window.sessionStorage.getItem(DELIVERY_ADDRESSES_LIST_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedDeliveryAddress);
  } catch {
    return [];
  }
}

function saveSavedAddressesList(addresses: SavedDeliveryAddress[]): void {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(DELIVERY_ADDRESSES_LIST_KEY, JSON.stringify(addresses));
  window.dispatchEvent(new Event(DELIVERY_ADDRESSES_UPDATED_EVENT));
}

/**
 * --- Server-backed address book ---
 *
 * Guests still use the sessionStorage list above so the picker works before
 * login. When the user is signed in, the same list is a short-lived cache
 * for /api/v1/customer/addresses; writes go to the server first (optimistic
 * local update for UI snappiness) and then we re-hydrate so server-issued
 * UUIDs replace any temp ones. On logout the cache is cleared — another
 * user shouldn't inherit the previous one's addresses.
 */
type CustomerAddressApiRow = {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  postal_code: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

let isAuthenticatedForAddresses = false;

/**
 * Called by DeliveryAddressProvider whenever the session auth state flips.
 * Returns true iff the state actually changed (callers can use that to
 * decide whether to trigger a hydrate).
 */
export function setDeliveryAddressAuthState(authed: boolean): boolean {
  if (isAuthenticatedForAddresses === authed) return false;
  isAuthenticatedForAddresses = authed;

  if (!authed && typeof window !== "undefined") {
    window.sessionStorage.removeItem(DELIVERY_ADDRESSES_LIST_KEY);
    window.sessionStorage.removeItem(DELIVERY_ADDRESS_STORAGE_KEY);
    window.dispatchEvent(new Event(DELIVERY_ADDRESSES_UPDATED_EVENT));
    window.dispatchEvent(new Event(DELIVERY_ADDRESS_UPDATED_EVENT));
  }

  return true;
}

function toSavedAddress(row: CustomerAddressApiRow): SavedDeliveryAddress {
  return {
    id: row.id,
    line1: row.line1,
    city: row.city,
    postalCode: normalizeDeliveryPostalCode(row.postal_code),
  };
}

/** Pull the authoritative list from the server and mirror into sessionStorage. */
export async function syncSavedAddressesFromServer(
  refresh?: () => Promise<void>,
  clear?: () => void,
): Promise<void> {
  if (!isAuthenticatedForAddresses || typeof window === "undefined") return;

  try {
    const fetchCall = () => apiFetch("/api/v1/customer/addresses");
    const res =
      refresh && clear
        ? await withSilentRefresh(fetchCall, refresh, clear)
        : await fetchCall();

    if (!res.ok) {
      console.warn(`[Addresses] Sync failed: ${res.status} ${res.statusText}`);
      return;
    }

    const body = (await res.json()) as ApiEnvelope<{
      items: CustomerAddressApiRow[];
    }>;
    const items = body.data?.items ?? [];
    saveSavedAddressesList(items.map(toSavedAddress));
  } catch (err) {
    console.error("[Addresses] Sync error:", err);
    // Offline/network — keep whatever's in the local cache for now.
  }
}

async function createAddressOnServer(
  draft: DeliveryAddressDraft,
  refresh?: () => Promise<void>,
  clear?: () => void,
): Promise<void> {
  try {
    const fetchCall = () =>
      apiFetch("/api/v1/customer/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line1: draft.line1.trim(),
          city: draft.city.trim(),
          postal_code: normalizeDeliveryPostalCode(draft.postalCode),
        }),
      });

    const res =
      refresh && clear
        ? await withSilentRefresh(fetchCall, refresh, clear)
        : await fetchCall();

    if (!res.ok) {
      console.warn(`[Addresses] Create failed: ${res.status} ${res.statusText}`);
    }
  } finally {
    await syncSavedAddressesFromServer(refresh, clear);
  }
}

async function updateAddressOnServer(
  id: string,
  draft: DeliveryAddressDraft,
  refresh?: () => Promise<void>,
  clear?: () => void,
): Promise<void> {
  try {
    const fetchCall = () =>
      apiFetch(`/api/v1/customer/addresses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line1: draft.line1.trim(),
          city: draft.city.trim(),
          postal_code: normalizeDeliveryPostalCode(draft.postalCode),
        }),
      });

    const res =
      refresh && clear
        ? await withSilentRefresh(fetchCall, refresh, clear)
        : await fetchCall();

    if (!res.ok) {
      console.warn(`[Addresses] Update failed: ${res.status} ${res.statusText}`);
    }
  } finally {
    await syncSavedAddressesFromServer(refresh, clear);
  }
}

async function deleteAddressOnServer(
  id: string,
  refresh?: () => Promise<void>,
  clear?: () => void,
): Promise<void> {
  try {
    const fetchCall = () =>
      apiFetch(`/api/v1/customer/addresses/${id}`, { method: "DELETE" });

    const res =
      refresh && clear
        ? await withSilentRefresh(fetchCall, refresh, clear)
        : await fetchCall();

    if (!res.ok) {
      console.warn(`[Addresses] Delete failed: ${res.status} ${res.statusText}`);
    }
  } finally {
    await syncSavedAddressesFromServer(refresh, clear);
  }
}

export function loadDeliveryAddressDraft(): DeliveryAddressDraft | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(DELIVERY_ADDRESS_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isDeliveryAddressDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * All addresses saved in this session, including a one-time migration from the legacy
 * single-address key when the list was empty.
 */
export function loadSavedAddresses(): SavedDeliveryAddress[] {
  if (typeof window === "undefined") return [];

  let list = loadSavedAddressesRaw();
  if (list.length === 0) {
    const legacy = loadDeliveryAddressDraft();
    if (legacy) {
      list = [{ id: crypto.randomUUID(), ...legacy }];
      saveSavedAddressesList(list);
    }
  }
  return list;
}

/** Add or replace by street + postal code; keeps one row per logical address. */
export function upsertSavedAddressFromDraft(draft: DeliveryAddressDraft): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const key = deliveryAddressDedupeKey(draft);
  const idx = list.findIndex((a) => deliveryAddressDedupeKey(a) === key);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...draft };
    saveSavedAddressesList(next);
    // The server-side upsert also dedupes on normalized line1+postal, so a
    // matching local row means we want to touch the server row (city/label).
    if (isAuthenticatedForAddresses) void updateAddressOnServer(next[idx].id, draft);
    return;
  }
  // Optimistic insert with a temp id; `syncSavedAddressesFromServer` will
  // replace it with the server-issued UUID once the POST lands.
  saveSavedAddressesList([...list, { id: crypto.randomUUID(), ...draft }]);
  if (isAuthenticatedForAddresses) void createAddressOnServer(draft);
}

/** Add or replace by street + postal code; keeps one row per logical address. (Sync version) */
export function upsertSavedAddressFromDraftSync(
  draft: DeliveryAddressDraft,
  refresh: () => Promise<void>,
  clear: () => void,
): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const key = deliveryAddressDedupeKey(draft);
  const idx = list.findIndex((a) => deliveryAddressDedupeKey(a) === key);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...draft };
    saveSavedAddressesList(next);
    if (isAuthenticatedForAddresses) void updateAddressOnServer(next[idx].id, draft, refresh, clear);
    return;
  }
  saveSavedAddressesList([...list, { id: crypto.randomUUID(), ...draft }]);
  if (isAuthenticatedForAddresses) void createAddressOnServer(draft, refresh, clear);
}

/** Update a saved row by id (used when editing an existing card). */
export function replaceSavedAddressById(id: string, draft: DeliveryAddressDraft): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) {
    upsertSavedAddressFromDraft(draft);
    return;
  }
  const next = [...list];
  next[idx] = { id, ...draft };
  saveSavedAddressesList(next);
  if (isAuthenticatedForAddresses) void updateAddressOnServer(id, draft);
}

/** Update a saved row by id (used when editing an existing card). (Sync version) */
export function replaceSavedAddressByIdSync(
  id: string,
  draft: DeliveryAddressDraft,
  refresh: () => Promise<void>,
  clear: () => void,
): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) {
    upsertSavedAddressFromDraftSync(draft, refresh, clear);
    return;
  }
  const next = [...list];
  next[idx] = { id, ...draft };
  saveSavedAddressesList(next);
  if (isAuthenticatedForAddresses) void updateAddressOnServer(id, draft, refresh, clear);
}

/** Remove one saved address. If the active checkout draft matched it, switch or clear. */
export function removeSavedAddressById(id: string): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const removed = list.find((a) => a.id === id);
  if (!removed) return;

  const next = list.filter((a) => a.id !== id);
  const cur = loadDeliveryAddressDraft();
  const draftMatchedRemoved =
    cur !== null && deliveryAddressDedupeKey(cur) === deliveryAddressDedupeKey(removed);

  /**
   * Update or clear the legacy draft *before* persisting the new list + dispatching
   * `DELIVERY_ADDRESSES_UPDATED_EVENT`. Otherwise `loadSavedAddresses()` can run while the list
   * is still empty and re-migrate the not-yet-cleared draft back into the list.
   */
  if (draftMatchedRemoved) {
    if (next.length > 0) {
      const pick = next[0];
      saveDeliveryAddressDraft({
        line1: pick.line1,
        city: pick.city,
        postalCode: normalizeDeliveryPostalCode(pick.postalCode),
      });
    } else {
      window.sessionStorage.removeItem(DELIVERY_ADDRESS_STORAGE_KEY);
      window.dispatchEvent(new Event(DELIVERY_ADDRESS_UPDATED_EVENT));
    }
  }

  saveSavedAddressesList(next);
  if (isAuthenticatedForAddresses) void deleteAddressOnServer(id);
}

/** Remove one saved address. (Sync version) */
export function removeSavedAddressByIdSync(
  id: string,
  refresh: () => Promise<void>,
  clear: () => void,
): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const removed = list.find((a) => a.id === id);
  if (!removed) return;

  const next = list.filter((a) => a.id !== id);
  const cur = loadDeliveryAddressDraft();
  const draftMatchedRemoved =
    cur !== null && deliveryAddressDedupeKey(cur) === deliveryAddressDedupeKey(removed);

  if (draftMatchedRemoved) {
    if (next.length > 0) {
      const pick = next[0];
      saveDeliveryAddressDraft({
        line1: pick.line1,
        city: pick.city,
        postalCode: normalizeDeliveryPostalCode(pick.postalCode),
      });
    } else {
      window.sessionStorage.removeItem(DELIVERY_ADDRESS_STORAGE_KEY);
      window.dispatchEvent(new Event(DELIVERY_ADDRESS_UPDATED_EVENT));
    }
  }

  saveSavedAddressesList(next);
  if (isAuthenticatedForAddresses) void deleteAddressOnServer(id, refresh, clear);
}

export function saveDeliveryAddressDraft(address: DeliveryAddressDraft): void {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(
    DELIVERY_ADDRESS_STORAGE_KEY,
    JSON.stringify(address),
  );
  window.dispatchEvent(new Event(DELIVERY_ADDRESS_UPDATED_EVENT));
}

/** Merge into the saved draft (or empty) and persist. */
export function patchDeliveryAddressDraft(
  patch: Partial<DeliveryAddressDraft>,
): DeliveryAddressDraft {
  const prev = loadDeliveryAddressDraft() ?? {
    line1: "",
    city: FIXED_DELIVERY_CITY,
    postalCode: "",
  };
  const next: DeliveryAddressDraft = {
    line1: patch.line1 ?? prev.line1,
    city: patch.city ?? prev.city,
    postalCode: patch.postalCode ?? prev.postalCode,
  };
  saveDeliveryAddressDraft(next);
  return next;
}
