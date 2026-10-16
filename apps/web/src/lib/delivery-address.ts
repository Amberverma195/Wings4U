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
  const compact = value.normalize("NFKC").replace(/\s/g, "").toUpperCase();
  return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : compact;
}

function normalizeAddressText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
function normalizeAddressDraft(draft: DeliveryAddressDraft): DeliveryAddressDraft {
  return { line1: normalizeAddressText(draft.line1), city: normalizeAddressText(draft.city),
    postalCode: normalizeDeliveryPostalCode(draft.postalCode) };
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

const PENDING_GUEST_DELIVERY_ADDRESS_KEY =
  "wings4u.pending-guest-delivery-address";

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
  return JSON.stringify([normalizeAddressText(d.line1).toLowerCase(), normalizeAddressText(d.city).toLowerCase(),
    normalizeDeliveryPostalCode(d.postalCode).replace(/\s/g, "").toLowerCase()]);
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
 * for /api/v1/customer/addresses; writes go to the server first
 * and then we re-hydrate so server-issued
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
let addressAccountId: string | null = null;
let addressSessionVersion = 0;
let addressWriteVersion = 0;
let pendingGuestAddressMigration: Promise<boolean> | null = null;

/**
 * Called by DeliveryAddressProvider whenever the session auth state flips.
 * Returns true iff the state actually changed (callers can use that to
 * decide whether to trigger a hydrate).
 */
export function setDeliveryAddressAuthState(authed: boolean, userId?: string): boolean {
  const nextAccount = authed ? userId ?? "authenticated" : null;
  if (isAuthenticatedForAddresses === authed && addressAccountId === nextAccount) return false;
  const switchedAccount = authed && isAuthenticatedForAddresses && addressAccountId !== nextAccount;
  isAuthenticatedForAddresses = authed;
  addressAccountId = nextAccount;
  addressSessionVersion += 1;
  pendingGuestAddressMigration = null;

  if ((!authed || switchedAccount) && typeof window !== "undefined") {
    window.sessionStorage.removeItem(DELIVERY_ADDRESSES_LIST_KEY);
    window.sessionStorage.removeItem(DELIVERY_ADDRESS_STORAGE_KEY);
    window.sessionStorage.removeItem(PENDING_GUEST_DELIVERY_ADDRESS_KEY);
    window.dispatchEvent(new Event(DELIVERY_ADDRESSES_UPDATED_EVENT));
    window.dispatchEvent(new Event(DELIVERY_ADDRESS_UPDATED_EVENT));
  }

  return true;
}

function loadPendingGuestDeliveryAddress(): DeliveryAddressDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(
    PENDING_GUEST_DELIVERY_ADDRESS_KEY,
  );
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isDeliveryAddressDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingGuestDeliveryAddress(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_GUEST_DELIVERY_ADDRESS_KEY);
}

/**
 * Merge the address selected while signed out into the authenticated
 * customer's address book. The API's create endpoint is an idempotent upsert,
 * so an existing normalized street + postal match is never duplicated.
 */
export async function persistPendingGuestDeliveryAddress(
  refresh?: () => Promise<void | boolean>,
  clear?: () => void,
): Promise<boolean> {
  if (!isAuthenticatedForAddresses || typeof window === "undefined") {
    return false;
  }
  if (pendingGuestAddressMigration) return pendingGuestAddressMigration;

  const pending = loadPendingGuestDeliveryAddress();
  if (!pending || !hasCompleteDeliveryAddress(pending)) return false;

  const sessionVersion = addressSessionVersion;
  const request = (async () => {
    try {
      const fetchCall = () =>
        apiFetch("/api/v1/customer/addresses/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            line1: pending.line1.trim(),
            city: pending.city.trim(),
            postal_code: normalizeDeliveryPostalCode(pending.postalCode),
          }),
        });
      const res =
        refresh && clear
          ? await withSilentRefresh(fetchCall, refresh, clear)
          : await fetchCall();
      if (!res.ok) {
        console.warn(
          `[Addresses] Guest address migration failed: ${res.status} ${res.statusText}`,
        );
        return false;
      }

      const body = await res.json() as ApiEnvelope<CustomerAddressApiRow>;
      if (sessionVersion !== addressSessionVersion) return false;
      if (!body.data) return false;
      cacheServerAddress(body.data);
      const currentPending = loadPendingGuestDeliveryAddress();
      if (
        currentPending &&
        deliveryAddressDedupeKey(currentPending) ===
          deliveryAddressDedupeKey(pending)
      ) {
        clearPendingGuestDeliveryAddress();
      }
      return true;
    } catch (error) {
      console.warn("[Addresses] Guest address migration failed", error);
      return false;
    }
  })();

  pendingGuestAddressMigration = request;
  try {
    return await request;
  } finally {
    if (pendingGuestAddressMigration === request) {
      pendingGuestAddressMigration = null;
    }
  }
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
  refresh?: () => Promise<void | boolean>,
  clear?: () => void,
): Promise<void> {
  if (!isAuthenticatedForAddresses || typeof window === "undefined") return;

  const sessionVersion = addressSessionVersion;
  const writeVersion = addressWriteVersion;
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
    if (sessionVersion === addressSessionVersion && writeVersion === addressWriteVersion) saveSavedAddressesList(items.map(toSavedAddress));
  } catch (err) {
    console.error("[Addresses] Sync error:", err);
    // Offline/network — keep whatever's in the local cache for now.
  }
}

function cacheServerAddress(row: CustomerAddressApiRow): void {
  addressWriteVersion += 1;
  const saved = toSavedAddress(row);
  const key = deliveryAddressDedupeKey(saved);
  const list = loadSavedAddressesRaw().filter(address => address.id !== saved.id && deliveryAddressDedupeKey(address) !== key);
  saveSavedAddressesList([...list, saved]);
}

async function persistAddressOnServer(
  draft: DeliveryAddressDraft, id?: string,
  refresh?: () => Promise<void | boolean>, clear?: () => void,
): Promise<void> {
  const sessionVersion = addressSessionVersion;
  const fetchCall = () => apiFetch(id ? `/api/v1/customer/addresses/${id}` : "/api/v1/customer/addresses", {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ line1: draft.line1, city: draft.city, postal_code: draft.postalCode }),
  });
  const res = refresh && clear ? await withSilentRefresh(fetchCall, refresh, clear) : await fetchCall();
  const body = await res.json() as ApiEnvelope<CustomerAddressApiRow>;
  if (!res.ok) throw new Error((body as { errors?: Array<{ message?: string }> }).errors?.[0]?.message ?? "Unable to save this address. Please try again.");
  if (sessionVersion !== addressSessionVersion) throw new Error("Your account changed. Please save the address again.");
  if (!body.data) throw new Error("The saved address could not be confirmed. Please try again.");
  cacheServerAddress(body.data);
  await syncSavedAddressesFromServer(refresh, clear);
}

async function deleteAddressOnServer(
  id: string,
  refresh?: () => Promise<void | boolean>,
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
 * All addresses saved in this session. Guests get a one-time migration from
 * the legacy single-address key; signed-in users use the server-backed cache
 * only so a checkout draft is never mistaken for a persisted address row.
 */
export function loadSavedAddresses(): SavedDeliveryAddress[] {
  if (typeof window === "undefined") return [];

  let list = loadSavedAddressesRaw();
  if (list.length === 0 && !isAuthenticatedForAddresses) {
    const legacy = loadDeliveryAddressDraft();
    if (legacy) {
      list = [{ id: crypto.randomUUID(), ...legacy }];
      saveSavedAddressesList(list);
    }
  }
  return list;
}

/** Signed-in saves wait for the server and cache only its real address ID. */
export async function upsertSavedAddressFromDraft(
  draft: DeliveryAddressDraft, refresh?: () => Promise<void | boolean>, clear?: () => void,
): Promise<void> {
  if (typeof window === "undefined") return;
  const normalized = normalizeAddressDraft(draft);
  if (isAuthenticatedForAddresses) {
    await persistAddressOnServer(normalized, undefined, refresh, clear);
    return;
  }
  const list = loadSavedAddresses();
  const key = deliveryAddressDedupeKey(normalized);
  const existing = list.find(address => deliveryAddressDedupeKey(address) === key);
  saveSavedAddressesList([...list.filter(address => deliveryAddressDedupeKey(address) !== key),
    { id: existing?.id ?? crypto.randomUUID(), ...normalized }]);
}
export function upsertSavedAddressFromDraftSync(
  draft: DeliveryAddressDraft, refresh: () => Promise<void | boolean>, clear: () => void,
): Promise<void> { return upsertSavedAddressFromDraft(draft, refresh, clear); }

/** Failed edits preserve both the original cache and the active checkout draft. */
export async function replaceSavedAddressById(
  id: string, draft: DeliveryAddressDraft, refresh?: () => Promise<void | boolean>, clear?: () => void,
): Promise<void> {
  if (typeof window === "undefined") return;
  const normalized = normalizeAddressDraft(draft);
  if (isAuthenticatedForAddresses) {
    await persistAddressOnServer(normalized, id, refresh, clear);
    return;
  }
  const list = loadSavedAddresses();
  const key = deliveryAddressDedupeKey(normalized);
  if (list.some(address => address.id !== id && deliveryAddressDedupeKey(address) === key)) throw new Error("This address is already saved.");
  if (!list.some(address => address.id === id)) throw new Error("Address not found. Please reopen the address list.");
  saveSavedAddressesList(list.map(address => address.id === id ? { id, ...normalized } : address));
}
export function replaceSavedAddressByIdSync(
  id: string, draft: DeliveryAddressDraft, refresh: () => Promise<void | boolean>, clear: () => void,
): Promise<void> { return replaceSavedAddressById(id, draft, refresh, clear); }

/** Remove one saved address. If the active checkout draft matched it, switch or clear. */
export function removeSavedAddressById(id: string): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const removed = list.find((a) => a.id === id);
  if (!removed) return;
  addressWriteVersion += 1;

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
  refresh: () => Promise<void | boolean>,
  clear: () => void,
): void {
  if (typeof window === "undefined") return;

  const list = loadSavedAddresses();
  const removed = list.find((a) => a.id === id);
  if (!removed) return;
  addressWriteVersion += 1;

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
    JSON.stringify(normalizeAddressDraft(address)),
  );
  if (!isAuthenticatedForAddresses) {
    window.sessionStorage.setItem(
      PENDING_GUEST_DELIVERY_ADDRESS_KEY,
      JSON.stringify(normalizeAddressDraft(address)),
    );
  }
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
