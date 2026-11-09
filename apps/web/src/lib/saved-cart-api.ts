import { apiFetch, getRetryAfterSeconds } from "./api";
import type { ApiEnvelope } from "@wings4u/contracts";
import { getAuthSessionGeneration } from "./auth-events";
import type { CartItem, FulfillmentType } from "./types";
import type { DriverTipPercent } from "./cart";

async function cartFetch(path: string, init: Parameters<typeof apiFetch>[1]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try { return await apiFetch(path, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

/**
 * Saved-cart failures are not empty carts. Mutations are serialized and
 * queued replacements coalesce to the newest state for the same owner.
 */

export type SavedCartItemSnapshot = {
  key: string;
  menu_item_id: string;
  menu_item_slug: string | null;
  name: string;
  image_url: string | null;
  base_price_cents: number;
  quantity: number;
  modifier_selections: CartItem["modifier_selections"];
  removed_ingredients: NonNullable<CartItem["removed_ingredients"]>;
  special_instructions: string;
  builder_payload: Record<string, unknown> | null;
};

export type SavedCartSnapshot = {
  revision?: string | null;
  converted?: boolean;
  items: SavedCartItemSnapshot[];
  fulfillment_type: FulfillmentType;
  location_timezone: string;
  scheduled_for: string | null;
  driver_tip_percent: "none" | "10" | "15" | "20";
  expires_at: string | null;
  is_guest: boolean;
  expired?: boolean;
};

export type MergeResult = {
  snapshot: SavedCartSnapshot | null;
  merge_outcome: "merged" | "kept_both" | "no_guest";
};

function driverTipToString(tip: DriverTipPercent): "none" | "10" | "15" | "20" {
  return tip === "none" ? "none" : (String(tip) as "10" | "15" | "20");
}

function itemToPayload(item: CartItem): SavedCartItemSnapshot {
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

export async function fetchSavedCart(
  locationId: string,
  ownerId?: string | null,
): Promise<SavedCartSnapshot | null> {
  try {
    const res = await cartFetch("/api/v1/cart/me", { locationId, headers: ownerHeaders(ownerId) });
    if (!res.ok) throw await requestError(res);
    const env = (await res.json()) as ApiEnvelope<SavedCartSnapshot>;
    if (!env || !("data" in env) || (env.data !== null && !Array.isArray(env.data?.items))) {
      throw new SavedCartRequestError(502);
    }
    revisions.set(scope(locationId, ownerId), env.data?.revision ?? null);
    return env.data;
  } catch (error) {
    throw error instanceof SavedCartRequestError ? error : new SavedCartRequestError(0);
  }
}

type SavedCartWrite = {
  ownerId?: string | null;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  locationTimezone: string;
  scheduledFor: string | null;
  driverTipPercent: DriverTipPercent;
};

export class SavedCartRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(code === "SAVED_CART_OWNER_CHANGED" ? "Your session needs to be verified. Your cart draft has been kept. Please retry."
      : status === 409 ? "Your saved cart changed. Restore it before continuing."
      : "We could not restore or save your cart. Your browser draft has been kept. Please retry.");
    this.name = "SavedCartRequestError";
  }
}

async function requestError(res: Response): Promise<SavedCartRequestError> {
  const body = await res.json().catch(() => null);
  return new SavedCartRequestError(res.status, body?.errors?.[0]?.code);
}

function ownerHeaders(ownerId?: string | null): Record<string, string> {
  return ownerId === undefined ? {} : { "X-Cart-Owner": ownerId === null ? "guest" : `user:${ownerId}` };
}
const scope = (location: string, owner?: string | null) => JSON.stringify([location, owner]);
const revisions = new Map<string, string | null>();
type WriteJob = {
  kind: "write"; locationId: string; state: SavedCartWrite; generation: number; epoch: number;
  resolve: (value: SavedCartSnapshot | null) => void; reject: (error: unknown) => void;
};
type ControlJob = { kind: "control"; run: () => Promise<void> };
let jobs: Array<WriteJob | ControlJob> = [];
let active = false;
let epoch = 0;
let writesBlockedUntil = 0;
let deferredTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelDeferredSavedCartWrite(): void {
  epoch++;
  if (deferredTimer) clearTimeout(deferredTimer);
  deferredTimer = null;
  for (const job of jobs) if (job.kind === "write") job.resolve(null);
  jobs = jobs.filter(job => job.kind !== "write");
  writesBlockedUntil = 0;
}

async function pump(): Promise<void> {
  if (active || !jobs.length) return;
  if (jobs[0].kind === "write" && Date.now() < writesBlockedUntil) {
    if (!deferredTimer) deferredTimer = setTimeout(() => {
      deferredTimer = null; void pump();
    }, writesBlockedUntil - Date.now());
    return;
  }
  active = true;
  const job = jobs.shift()!;
  try {
    if (job.kind === "control") { await job.run(); return; }
    if (job.generation !== getAuthSessionGeneration() || job.epoch !== epoch) { job.resolve(null); return; }
    const key = scope(job.locationId, job.state.ownerId);
    const res = await cartFetch("/api/v1/cart/me", {
      locationId: job.locationId, method: "PUT",
      headers: { "Content-Type": "application/json", ...ownerHeaders(job.state.ownerId) },
      body: JSON.stringify({ items: job.state.items.map(itemToPayload),
        fulfillment_type: job.state.fulfillmentType, location_timezone: job.state.locationTimezone,
        scheduled_for: job.state.scheduledFor, driver_tip_percent: driverTipToString(job.state.driverTipPercent),
        ...(revisions.has(key) ? { expected_revision: revisions.get(key) } : {}),
      }),
    });
    if (job.generation !== getAuthSessionGeneration()) { job.resolve(null); return; }
    if (job.epoch !== epoch) {
      // A clear cancels the callback, not a request already accepted by the
      // server. Keep its revision so the subsequent empty save can supersede it.
      if (res.ok) {
        const env = (await res.json()) as ApiEnvelope<SavedCartSnapshot>;
        if (env?.data) revisions.set(key, env.data.revision ?? null);
      }
      job.resolve(null); return;
    }
    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      writesBlockedUntil = Date.now() + (getRetryAfterSeconds(res, body) ?? 30) * 1000;
      if (jobs.some(next => next.kind === "write" && scope(next.locationId, next.state.ownerId) === key)) job.resolve(null);
      else jobs.unshift(job);
      return;
    }
    if (!res.ok) throw await requestError(res);
    const env = (await res.json()) as ApiEnvelope<SavedCartSnapshot>;
    if (!env?.data || !Array.isArray(env.data.items)) throw new SavedCartRequestError(502);
    revisions.set(key, env.data.revision ?? null);
    job.resolve(env.data);
  } catch (error) {
    if (job.kind === "write") {
      if (job.epoch !== epoch || job.generation !== getAuthSessionGeneration()) job.resolve(null);
      else job.reject(error instanceof SavedCartRequestError ? error : new SavedCartRequestError(0));
    }
  } finally {
    active = false; void pump();
  }
}

export function putSavedCart(locationId: string, state: SavedCartWrite): Promise<SavedCartSnapshot | null> {
  const key = scope(locationId, state.ownerId);
  jobs = jobs.filter(job => {
    if (job.kind !== "write" || scope(job.locationId, job.state.ownerId) !== key) return true;
    job.resolve(null); return false;
  });
  return new Promise((resolve, reject) => {
    jobs.push({ kind: "write", locationId, state, generation: getAuthSessionGeneration(), epoch, resolve, reject });
    void pump();
  });
}

function exclusively<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    jobs.push({ kind: "control", run: async () => { try { resolve(await operation()); } catch (error) { reject(error); } } });
    void pump();
  });
}

export async function deleteSavedCart(locationId: string, ownerId?: string | null): Promise<void> {
  cancelDeferredSavedCartWrite();
  await exclusively(async () => {
    const res = await cartFetch("/api/v1/cart/me", { method: "DELETE", locationId, headers: ownerHeaders(ownerId) });
    if (!res.ok) throw await requestError(res);
    revisions.set(scope(locationId, ownerId), null);
  });
}

export async function mergeSavedCartOnLogin(locationId: string, ownerId?: string | null): Promise<MergeResult> {
  const generation = getAuthSessionGeneration();
  return exclusively(async () => {
    if (generation !== getAuthSessionGeneration()) throw new SavedCartRequestError(409);
    const res = await cartFetch("/api/v1/cart/merge", { method: "POST", locationId, headers: ownerHeaders(ownerId) });
    if (!res.ok) throw await requestError(res);
    const env = (await res.json()) as ApiEnvelope<MergeResult>;
    if (!env?.data) throw new SavedCartRequestError(502);
    revisions.set(scope(locationId, ownerId), env.data.snapshot?.revision ?? null);
    return env.data;
  });
}
