"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents } from "@/lib/format";
import { createOrdersSocket, subscribeToChannels } from "@/lib/realtime";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { SessionState } from "@/lib/session";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type KdsModifier = {
  id: string;
  modifier_group_name_snapshot: string | null;
  modifier_name_snapshot: string;
  modifier_kind: string;
  quantity: number;
  price_delta_cents: number;
  sort_order: number;
};

type KdsFlavour = {
  id: string;
  flavour_name_snapshot: string;
  heat_level_snapshot: string | null;
  slot_no: number;
  flavour_role: string;
  placement: string;
  sort_order: number;
};

type KdsItem = {
  id: string;
  line_no: number;
  product_name_snapshot: string;
  category_name_snapshot: string | null;
  quantity: number;
  special_instructions: string | null;
  modifiers: KdsModifier[];
  flavours: KdsFlavour[];
};

type KdsPendingCancelRequest = {
  id: string;
  requested_by_user_id: string;
  request_source: string;
  reason_text: string | null;
  created_at: string;
};

type KdsOrder = {
  id: string;
  order_number: number;
  fulfillment_type: string;
  status: string;
  placed_at: string;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  customer_order_notes: string | null;
  estimated_ready_at: string | null;
  final_payable_cents: number;
  assigned_driver_user_id: string | null;
  kds_auto_accept_seconds: number | null;
  requires_manual_review: boolean;
  items: KdsItem[];
  pending_cancel_request: KdsPendingCancelRequest | null;
  pending_change_request_count: number;
};

type KdsDriver = {
  user_id: string;
  full_name: string;
  availability_status: string;
  is_on_delivery: boolean;
  vehicle_type?: string | null;
  vehicle_identifier?: string | null;
};

type KdsSessionControls = Pick<SessionState, "refresh" | "clear">;

type KdsApiEnvelope<T> = {
  data?: T;
  errors?: { message: string }[] | null;
};

/* ------------------------------------------------------------------ */
/*  Status columns                                                     */
/* ------------------------------------------------------------------ */

type StatusColumn = {
  key: string;
  label: string;
  statuses: string[];
  color: string;
};

const COLUMNS: StatusColumn[] = [
  { key: "placed", label: "New", statuses: ["PLACED"], color: "#e74c3c" },
  { key: "preparing", label: "Preparing", statuses: ["PREPARING"], color: "#f39c12" },
  { key: "ready", label: "Ready", statuses: ["READY"], color: "#2ecc71" },
  { key: "out", label: "Out for Delivery", statuses: ["OUT_FOR_DELIVERY"], color: "#3498db" },
];

const ALL_KDS_STATUSES = COLUMNS.flatMap((c) => c.statuses);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatKitchenTime(value: string | null) {
  if (!value) return "No ETA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No ETA";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Pretty-print a stored phone (E.164 or digits) for the ticket; NANP +1 (XXX) XXX-XXXX using slice. */
function formatKdsOrderPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.slice(0, 1) === "1") {
    const a = digits.slice(1, 4);
    const b = digits.slice(4, 7);
    const c = digits.slice(7, 11);
    return `+1 (${a}) ${b}-${c}`;
  }
  if (digits.length === 10) {
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    return `(${a}) ${b}-${c}`;
  }
  return phone.trim();
}

function fulfillmentBadge(type: string) {
  const isDelivery = type === "DELIVERY";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.55rem",
        borderRadius: "8px",
        fontSize: "0.75rem",
        fontWeight: 700,
        color: "#fff",
        background: isDelivery ? "#e67e22" : "#27ae60",
      }}
    >
      {isDelivery ? "DELIVERY" : "PICKUP"}
    </span>
  );
}

function getPlacedEtaSecondsRemaining(order: KdsOrder, nowMs: number): number | null {
  if (order.status !== "PLACED") return null;
  const placedAtMs = new Date(order.placed_at).getTime();
  if (!Number.isFinite(placedAtMs)) return null;
  const windowSeconds = order.kds_auto_accept_seconds ?? 10;
  return Math.max(0, Math.ceil((placedAtMs + windowSeconds * 1000 - nowMs) / 1000));
}

/* ------------------------------------------------------------------ */
/*  KDS Action API helpers                                             */
/* ------------------------------------------------------------------ */

async function kdsJson<T>(
  session: KdsSessionControls,
  path: string,
  init: RequestInit & { locationId?: string } = {},
): Promise<T> {
  const res = await withSilentRefresh(
    () => apiFetch(path, init),
    session.refresh,
    session.clear,
  );
  const body = (await res.json().catch(() => null)) as KdsApiEnvelope<T> | null;

  if (!res.ok) {
    throw new Error(getApiErrorMessage(body, `Request failed (${res.status})`));
  }

  if (!body || body.data === undefined) {
    throw new Error("Request succeeded without a response body");
  }

  return body.data;
}

async function kdsAction(
  session: KdsSessionControls,
  path: string,
  method: "POST" = "POST",
  body?: Record<string, unknown>,
): Promise<void> {
  const init: RequestInit & { locationId: string } = {
    method,
    locationId: DEFAULT_LOCATION_ID,
    headers: { "Content-Type": "application/json" },
  };
  if (body) init.body = JSON.stringify(body);
  await kdsJson<Record<string, unknown>>(session, `/api/v1/kds/orders/${path}`, init);
}

/* ------------------------------------------------------------------ */
/*  Cancel Reason Modal                                                */
/* ------------------------------------------------------------------ */

// PRD §7.5: pre-accept = "Reject Order" (new order refused);
// post-accept = "Request Cancellation" (PRD language for KDS-initiated cancel).
// The underlying call still hits /status with CANCELLED — admin-approval flow
// for post-accept cancels is tracked as a follow-up (see permission audit).
type CancelMode = "reject" | "request-cancellation";

const CANCEL_MODE_COPY: Record<
  CancelMode,
  { title: string; confirm: string; busy: string; placeholder: string }
> = {
  reject: {
    title: "Reject Order — Reason Required",
    confirm: "Confirm Reject",
    busy: "Rejecting...",
    placeholder: "e.g. Out of stock, Kitchen closing early...",
  },
  "request-cancellation": {
    title: "Request Cancellation — Reason Required",
    confirm: "Submit Request",
    busy: "Submitting...",
    placeholder: "e.g. Customer unreachable, item unavailable mid-prep...",
  },
};

function CancelReasonModal({
  orderId,
  session,
  mode,
  onDone,
  onClose,
}: {
  orderId: string;
  session: KdsSessionControls;
  mode: CancelMode;
  onDone: () => void;
  onClose: () => void;
}) {
  const copy = CANCEL_MODE_COPY[mode];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setErr("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (mode === "reject") {
        // Pre-accept rejection is a direct transition.
        await kdsAction(session, `${orderId}/status`, "POST", {
          status: "CANCELLED",
          reason: reason.trim(),
        });
      } else {
        // PRD §7.5: post-accept cancellation creates a request for Admin to
        // approve — it does not execute directly.
        await kdsAction(session, `${orderId}/request-cancellation`, "POST", {
          reason: reason.trim(),
        });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{copy.title}</h3>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={copy.placeholder}
          rows={3}
          className="kds-modal-input"
          style={{ resize: "vertical" }}
        />
        {err && <p className="surface-error" style={{ margin: "0.5rem 0 0" }}>{err}</p>}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={busy}>
            {busy ? copy.busy : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  No-Show Confirm Modal                                              */
/* ------------------------------------------------------------------ */

function NoShowModal({
  orderId,
  variant,
  session,
  onDone,
  onClose,
}: {
  orderId: string;
  variant: "NO_SHOW_PICKUP" | "NO_SHOW_DELIVERY";
  session: KdsSessionControls;
  onDone: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPickup = variant === "NO_SHOW_PICKUP";
  const message = isPickup
    ? "Are you sure the customer did not come to pick up this order?"
    : "Are you sure the delivery was not completed?";

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await kdsAction(session, `${orderId}/status`, "POST", { status: variant });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Confirm No-Show</h3>
        <p style={{ margin: "0 0 1rem", fontSize: "0.95rem", color: "#4b3d30" }}>{message}</p>
        {err && <p className="surface-error" style={{ margin: "0 0 0.5rem" }}>{err}</p>}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            No, go back
          </button>
          <button type="button" className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? "Processing..." : "Yes, mark as No-Show"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Driver Assign Modal                                                */
/* ------------------------------------------------------------------ */

function DriverAssignModal({
  orderId,
  session,
  onDone,
  onClose,
}: {
  orderId: string;
  session: KdsSessionControls;
  onDone: () => void;
  onClose: () => void;
}) {
  const [drivers, setDrivers] = useState<KdsDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selectedDriver = drivers.find((driver) => driver.user_id === selected) ?? null;

  useEffect(() => {
    (async () => {
      try {
        const res = await kdsJson<{ drivers: KdsDriver[] }>(session, "/api/v1/drivers/available", {
          locationId: DEFAULT_LOCATION_ID,
        });
        setDrivers(res.drivers ?? []);
      } catch {
        setErr("Failed to load available drivers");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const assign = async () => {
    if (!selected || !selectedDriver) return;
    setBusy(true);
    setErr(null);
    try {
      const busyOverride =
        selectedDriver.is_on_delivery ||
        selectedDriver.availability_status === "ON_DELIVERY";
      if (busyOverride) {
        const confirmed = window.confirm(
          `${selectedDriver.full_name} is already on delivery. Assign anyway?`,
        );
        if (!confirmed) {
          setBusy(false);
          return;
        }
      }
      await kdsAction(session, `${orderId}/assign-driver`, "POST", {
        driver_user_id: selected,
        busy_override: busyOverride,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Assign Driver</h3>
        <p className="kds-modal-copy">
          Pick a driver for this order. Drivers who are already out on delivery
          can still be assigned with confirmation.
        </p>
        {loading ? (
          <p className="surface-muted">Loading drivers...</p>
        ) : drivers.length === 0 ? (
          <div className="kds-driver-empty">
            <strong>No drivers added yet.</strong>
            <p className="surface-muted">
              Add active drivers from Admin &gt; Staff and they&apos;ll appear here.
            </p>
          </div>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="kds-modal-input"
            >
              <option value="">Select a driver...</option>
              {drivers.map((driver) => (
                <option key={driver.user_id} value={driver.user_id}>
                  {driver.full_name}{" "}
                  {driver.availability_status === "ON_DELIVERY"
                    ? "- On delivery"
                    : "- Available"}
                </option>
              ))}
            </select>

            {selectedDriver ? (
              <div className="kds-driver-meta">
                <div className="kds-driver-meta__row">
                  <strong>{selectedDriver.full_name}</strong>
                  <span
                    className={`kds-driver-pill${
                      selectedDriver.availability_status === "ON_DELIVERY"
                        ? " kds-driver-pill--busy"
                        : ""
                    }`}
                  >
                    {selectedDriver.availability_status === "ON_DELIVERY"
                      ? "On delivery"
                      : "Available"}
                  </span>
                </div>
                {selectedDriver.vehicle_type || selectedDriver.vehicle_identifier ? (
                  <p className="surface-muted" style={{ margin: "0.35rem 0 0" }}>
                    {[selectedDriver.vehicle_type, selectedDriver.vehicle_identifier]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {selectedDriver?.is_on_delivery ? (
              <div className="kds-driver-warning">
                Driver is already on delivery. You&apos;ll be asked to confirm
                before the assignment goes through.
              </div>
            ) : null}
          </>
        )}
        {err && <p className="surface-error" style={{ margin: "0.5rem 0 0" }}>{err}</p>}
        <div className="kds-modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={assign}
            disabled={busy || !selected}
          >
            {busy ? "Assigning..." : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delivery PIN Modal                                                 */
/* ------------------------------------------------------------------ */

// Kept in lockstep with `PIN_MAX_FAILED_ATTEMPTS` on the API side. The
// backend is the source of truth — this value is only used to render
// the initial "You have N attempts" hint when the modal first opens.
const PIN_TOTAL_ATTEMPTS = 3;

/**
 * PRD §7.8.5 — the driver clicks "Mark Delivered" from the KDS card,
 * this modal asks the customer-facing PIN, tracks remaining attempts
 * inline, and once the PIN record is locked falls through to a
 * "Complete without PIN" button that marks the order NO_PIN_DELIVERY.
 *
 * Uses a direct `verify-pin` endpoint (ok/remaining_attempts/locked)
 * so we don't have to decode attempt counts out of a 422 error body.
 */
function DeliveryPinModal({
  orderId,
  session,
  onDone,
  onClose,
}: {
  orderId: string;
  session: KdsSessionControls;
  onDone: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // While we're fetching the server-side PIN state on open. Prevents a
  // flash of the fresh PIN-input view for orders that are already locked.
  const [hydrating, setHydrating] = useState(true);

  // Hydrate from backend on open so a close/reopen or a page reload doesn't
  // lose the "locked" state — the client `locked` flag alone is just local
  // React state and resets every time the modal mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await kdsJson<{
          exists: boolean;
          verified: boolean;
          locked: boolean;
          failed_attempts: number;
          max_attempts: number;
          remaining_attempts: number;
        }>(session, `/api/v1/kds/orders/${orderId}/pin-status`, {
          method: "GET",
          locationId: DEFAULT_LOCATION_ID,
        });
        if (cancelled) return;

        if (status.verified) {
          // PIN is already cleared — just complete the delivery and close.
          await kdsAction(session, `${orderId}/complete-delivery`);
          if (cancelled) return;
          onDone();
          return;
        }
        if (status.locked) {
          setLocked(true);
          setRemaining(0);
          setErr(
            `All ${status.max_attempts} attempts used. You can now complete this delivery manually without PIN.`,
          );
        } else if (status.failed_attempts > 0) {
          // Previous session already burned some attempts — surface the
          // accurate count so the first submit hint is honest.
          setRemaining(status.remaining_attempts);
        }
      } catch {
        // Non-fatal — the modal will still work, the user just won't see
        // the prior-session attempt count until they submit once.
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // orderId is stable for a given open; `session` methods are stable
    // callbacks so we intentionally don't want to re-hydrate on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const submitPin = async () => {
    if (!/^\d{4}$/.test(pin)) {
      setErr("PIN must be exactly 4 digits.");
      return;
    }
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const result = await kdsJson<{
        ok: boolean;
        reason?: string;
        remaining_attempts?: number;
        locked?: boolean;
        renewed?: boolean;
      }>(session, `/api/v1/kds/orders/${orderId}/verify-pin`, {
        method: "POST",
        locationId: DEFAULT_LOCATION_ID,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (result.ok) {
        // PIN verified — complete the delivery the normal way.
        await kdsAction(session, `${orderId}/complete-delivery`);
        onDone();
        return;
      }

      if (result.reason === "EXPIRED") {
        setLocked(false);
        setRemaining(PIN_TOTAL_ATTEMPTS);
        setPin("");
        setErr(
          result.renewed
            ? "This PIN expired, and a fresh PIN was automatically issued to the customer. Ask for the updated code and try again."
            : "This PIN has expired. Ask the customer for the latest delivery PIN and try again.",
        );
        return;
      }

      if (result.locked) {
        setLocked(true);
        setRemaining(0);
        setErr(
          "All 3 attempts used. You can now complete this delivery manually without PIN.",
        );
        setPin("");
        return;
      }

      const remainingNow = result.remaining_attempts ?? 0;
      setRemaining(remainingNow);
      setPin("");
      if (remainingNow <= 0) {
        setLocked(true);
        setErr(
          "All 3 attempts used. You can now complete this delivery manually without PIN.",
        );
      } else if (remainingNow === 1) {
        setErr("Incorrect PIN. You have 1 attempt left.");
      } else {
        setErr(`Incorrect PIN. You have ${remainingNow} attempts left.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const completeWithoutPin = async () => {
    setBusy(true);
    setErr(null);
    setInfo("Completing delivery without PIN verification...");
    try {
      await kdsAction(
        session,
        `${orderId}/complete-delivery-without-pin`,
      );
      onDone();
    } catch (e) {
      setInfo(null);
      setErr(e instanceof Error ? e.message : "Could not complete delivery");
    } finally {
      setBusy(false);
    }
  };

  // Pre-attempt hint vs. mid-attempt countdown copy.
  const hintLine = locked
    ? "Manually complete this delivery — it will be recorded as No-PIN Delivery in the audit log."
    : remaining == null
      ? `Ask the customer for their 4-digit delivery PIN. You have ${PIN_TOTAL_ATTEMPTS} attempts.`
      : null;

  if (hydrating) {
    return (
      <div className="kds-modal-overlay" onClick={onClose}>
        <div className="kds-modal-card" onClick={(e) => e.stopPropagation()}>
          <h3>Verify Delivery PIN</h3>
          <p className="surface-muted" style={{ margin: "0.25rem 0 0" }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{locked ? "Complete Delivery — No PIN" : "Verify Delivery PIN"}</h3>
        {hintLine && (
          <p className="kds-modal-copy" style={{ margin: "0 0 0.75rem" }}>
            {hintLine}
          </p>
        )}

        {!locked && (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              className="kds-modal-input"
              style={{
                fontSize: "1.6rem",
                letterSpacing: "0.6rem",
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}
              autoFocus
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pin.length === 4 && !busy) {
                  void submitPin();
                }
              }}
            />
            {remaining != null && !err && (
              <p className="surface-muted" style={{ margin: "0.5rem 0 0" }}>
                {remaining === 1
                  ? "1 attempt left."
                  : `${remaining} attempts left.`}
              </p>
            )}
          </>
        )}

        {err && (
          <p className="surface-error" style={{ margin: "0.5rem 0 0" }}>
            {err}
          </p>
        )}
        {info && !err && (
          <p className="surface-muted" style={{ margin: "0.5rem 0 0" }}>
            {info}
          </p>
        )}

        <div className="kds-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {locked ? "Go back" : "Cancel"}
          </button>
          {locked ? (
            <button
              type="button"
              className="btn-danger"
              onClick={completeWithoutPin}
              disabled={busy}
            >
              {busy ? "Completing..." : "Complete without PIN"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={submitPin}
              disabled={busy || pin.length !== 4}
            >
              {busy ? "Verifying..." : "Verify & Deliver"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Order Card                                                         */
/* ------------------------------------------------------------------ */

function KdsOrderCard({
  order,
  session,
  onRefresh,
}: {
  order: KdsOrder;
  session: KdsSessionControls;
  onRefresh: () => void;
}) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState<CancelMode | null>(null);
  const [noShowModal, setNoShowModal] = useState<"NO_SHOW_PICKUP" | "NO_SHOW_DELIVERY" | null>(null);
  const [driverModal, setDriverModal] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (order.status !== "PLACED") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [order.status]);

  const runAction = async (fn: () => Promise<void>) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await fn();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  };

  const accept = () => runAction(() => kdsAction(session, `${order.id}/accept`));
  const setReady = () =>
    runAction(() => kdsAction(session, `${order.id}/status`, "POST", { status: "READY" }));
  const pickedUp = () =>
    runAction(() => kdsAction(session, `${order.id}/status`, "POST", { status: "PICKED_UP" }));
  const startDelivery = () => runAction(() => kdsAction(session, `${order.id}/start-delivery`));
  // "Mark Delivered" is now always gated through the PIN modal — the modal
  // itself calls /verify-pin + /complete-delivery or the no-PIN fallback.
  // We still surface `completeDelivery` errors via `actionError` by letting
  // the modal's onDone() trigger `onRefresh()`.

  const handleCancelRequestAction = (action: "APPROVE" | "DENY") =>
    runAction(() =>
      kdsAction(session, `${order.id}/cancel-request`, "POST", { action }),
    );

  // PRD §11.3: ±5 / ±10 / ±15 / −5 delta adjusts the ready ETA for live orders.
  const adjustEta = (deltaMinutes: number) =>
    runAction(() =>
      kdsAction(session, `${order.id}/eta-delta`, "POST", { delta_minutes: deltaMinutes }),
    );
  const placedEtaSecondsRemaining = getPlacedEtaSecondsRemaining(order, nowMs);
  const placedEtaWindowExpired =
    order.status === "PLACED" &&
    placedEtaSecondsRemaining != null &&
    placedEtaSecondsRemaining <= 0;
  const etaControlsVisible =
    order.status !== "CANCELLED" &&
    order.status !== "DELIVERED" &&
    order.status !== "PICKED_UP" &&
    order.status !== "NO_SHOW_PICKUP" &&
    order.status !== "NO_SHOW_DELIVERY";

  /* ----- Action buttons per status (PRD §7.5) ----- */
  const actions: React.ReactNode[] = [];

  if (order.status === "PLACED") {
    actions.push(
      <button key="accept" className="btn-primary" onClick={accept} disabled={actionBusy}>
        Accept
      </button>,
    );
    actions.push(
      <button key="cancel" className="btn-danger" onClick={() => setCancelModal("reject")} disabled={actionBusy}>
        Reject Order
      </button>,
    );
  }

  if (order.status === "PREPARING") {
    actions.push(
      <button key="ready" className="btn-primary" onClick={setReady} disabled={actionBusy}>
        Mark Ready
      </button>,
    );
  }

  if (order.status === "READY") {
    if (order.fulfillment_type === "PICKUP") {
      actions.push(
        <button key="pickup" className="btn-primary" onClick={pickedUp} disabled={actionBusy}>
          Picked Up
        </button>,
      );
      actions.push(
        <button
          key="noshow"
          className="btn-danger"
          onClick={() => setNoShowModal("NO_SHOW_PICKUP")}
          disabled={actionBusy}
        >
          No-Show
        </button>,
      );
    }
    if (order.fulfillment_type === "DELIVERY") {
      if (!order.assigned_driver_user_id) {
        actions.push(
          <button key="driver" className="btn-primary" onClick={() => setDriverModal(true)} disabled={actionBusy}>
            Assign Driver
          </button>,
        );
      } else {
        actions.push(
          <button key="start-delivery" className="btn-primary" onClick={startDelivery} disabled={actionBusy}>
            Start Delivery
          </button>,
        );
      }
    }
    actions.push(
      <button
        key="cancel"
        className="btn-danger"
        onClick={() => setCancelModal("request-cancellation")}
        disabled={actionBusy}
      >
        Request Cancellation
      </button>,
    );
  }

  if (order.status === "OUT_FOR_DELIVERY") {
    actions.push(
      <button
        key="delivered"
        className="btn-primary"
        onClick={() => setPinModal(true)}
        disabled={actionBusy}
      >
        Mark Delivered
      </button>,
    );
    actions.push(
      <button
        key="noshow"
        className="btn-danger"
        onClick={() => setNoShowModal("NO_SHOW_DELIVERY")}
        disabled={actionBusy}
      >
        No-Show
      </button>,
    );
  }

  /* ----- Pending cancellation request badge ----- */
  const hasPendingCancel = !!order.pending_cancel_request;

  /* ----- Pending add-items change request badge (Finding 5) ----- */
  const hasPendingChange = (order.pending_change_request_count ?? 0) > 0;

  return (
    <>
      <article
        style={{
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "0.9rem 1rem",
          background: hasPendingCancel
            ? "rgba(231,76,60,0.06)"
            : order.status === "PLACED" && order.requires_manual_review
              ? "rgba(245,166,35,0.1)"
              : "rgba(255,255,255,0.55)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {fulfillmentBadge(order.fulfillment_type)}
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>#{order.order_number}</h3>
              {hasPendingCancel && (
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.12rem 0.45rem",
                    borderRadius: "8px",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#fff",
                    background: "#e74c3c",
                  }}
                >
                  Cancel Requested
                </span>
              )}
              {hasPendingChange && (
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.12rem 0.45rem",
                    borderRadius: "8px",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#fff",
                    background: "#8e44ad",
                  }}
                >
                  📋 Add-Items Pending
                </span>
              )}
            </div>
            <p className="kds-order-card__customer">
              <span>{order.customer_name_snapshot ?? "Guest"}</span>
              {order.customer_phone_snapshot && (
                <span className="kds-order-card__customer-phone">
                  {formatKdsOrderPhone(order.customer_phone_snapshot)}
                </span>
              )}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p className="kds-order-card__total">{cents(order.final_payable_cents)}</p>
            <p className="kds-order-card__eta">ETA {formatKitchenTime(order.estimated_ready_at)}</p>
          </div>
        </div>

        {/* ETA delta controls (PRD §11.3) */}
        {etaControlsVisible && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              flexWrap: "wrap",
              margin: "0 0 0.6rem",
              fontSize: "0.8rem",
            }}
          >
            <span className="surface-muted" style={{ fontWeight: 600 }}>
              Adjust ETA:
            </span>
            {[-5, 5, 10, 15].map((delta) => (
              <button
                key={delta}
                className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.55rem" }}
                onClick={() => adjustEta(delta)}
                disabled={actionBusy || placedEtaWindowExpired}
              >
                {delta > 0 ? `+${delta}` : delta} min
              </button>
            ))}
            {order.status === "PLACED" && placedEtaSecondsRemaining != null && (
              <span className="surface-muted">
                {placedEtaWindowExpired
                  ? `Window closed after ${order.kds_auto_accept_seconds ?? 10}s.`
                  : `${placedEtaSecondsRemaining}s left in the PLACED window.`}
              </span>
            )}
          </div>
        )}

        {/* Customer notes */}
        {order.customer_order_notes && (
          <p style={{ margin: "0 0 0.6rem", fontStyle: "italic", fontSize: "0.85rem", color: "rgba(23,18,13,0.7)" }}>
            Note: {order.customer_order_notes}
          </p>
        )}

        {/* Pending cancel request details */}
        {hasPendingCancel && (
          <div
            style={{
              background: "rgba(231,76,60,0.08)",
              borderRadius: "10px",
              padding: "0.6rem 0.75rem",
              marginBottom: "0.6rem",
              fontSize: "0.85rem",
            }}
          >
            <strong>Cancel requested:</strong> {order.pending_cancel_request!.reason_text ?? "No reason given"}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                className="btn-danger"
                style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }}
                onClick={() => handleCancelRequestAction("APPROVE")}
                disabled={actionBusy}
              >
                Approve Cancel
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }}
                onClick={() => handleCancelRequestAction("DENY")}
                disabled={actionBusy}
              >
                Deny
              </button>
            </div>
          </div>
        )}

        {/* Items */}
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {order.items.map((item) => {
            const removed = item.modifiers.filter((m) => m.modifier_kind === "REMOVE_INGREDIENT");
            const addons = item.modifiers.filter((m) => m.modifier_kind !== "REMOVE_INGREDIENT");
            return (
              <div
                key={item.id}
                style={{
                  border: "1px solid rgba(23,18,13,0.06)",
                  borderRadius: "12px",
                  padding: "0.6rem 0.75rem",
                  background: "#fffaf4",
                  fontSize: "0.9rem",
                }}
              >
                <strong>{item.quantity}x {item.product_name_snapshot}</strong>
                {item.flavours.length > 0 && (
                  <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
                    {item.flavours
                      .slice()
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((f) => `${f.slot_no}. ${f.flavour_name_snapshot} (${f.placement.replace(/_/g, " ").toLowerCase()})`)
                      .join(" | ")}
                  </p>
                )}
                {removed.length > 0 && (
                  <p className="cart-line-mods-removed" style={{ fontSize: "0.8rem" }}>
                    {removed.map((m) => `No ${m.modifier_name_snapshot}`).join(", ")}
                  </p>
                )}
                {addons.length > 0 && (
                  <p className="cart-line-mods" style={{ margin: "0.15rem 0 0", fontSize: "0.8rem" }}>
                    Add-ons: {addons.map((m) => m.modifier_name_snapshot).join(", ")}
                  </p>
                )}
                {item.special_instructions && (
                  <p className="cart-line-instructions" style={{ margin: "0.15rem 0 0", fontSize: "0.8rem" }}>
                    {item.special_instructions}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="kds-order-actions">{actions}</div>
        )}
        {actionError && (
          <p className="surface-error" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
            {actionError}
          </p>
        )}
      </article>

      {/* Modals */}
      {cancelModal && (
        <CancelReasonModal
          orderId={order.id}
          session={session}
          mode={cancelModal}
          onDone={() => {
            setCancelModal(null);
            onRefresh();
          }}
          onClose={() => setCancelModal(null)}
        />
      )}
      {noShowModal && (
        <NoShowModal
          orderId={order.id}
          variant={noShowModal}
          session={session}
          onDone={() => {
            setNoShowModal(null);
            onRefresh();
          }}
          onClose={() => setNoShowModal(null)}
        />
      )}
      {driverModal && (
        <DriverAssignModal
          orderId={order.id}
          session={session}
          onDone={() => {
            setDriverModal(false);
            onRefresh();
          }}
          onClose={() => setDriverModal(false)}
        />
      )}
      {pinModal && (
        <DeliveryPinModal
          orderId={order.id}
          session={session}
          onDone={() => {
            setPinModal(false);
            onRefresh();
          }}
          onClose={() => setPinModal(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Busy Mode Control (PRD §11.2)                                      */
/* ------------------------------------------------------------------ */

type BusyModeState = {
  enabled: boolean;
  prep_minutes: number | null;
  default_prep_minutes: number;
};

function BusyModeControl({ session }: { session: KdsSessionControls }) {
  const [state, setState] = useState<BusyModeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await kdsJson<BusyModeState>(
        session,
        `/api/v1/kds/busy-mode`,
        { locationId: DEFAULT_LOCATION_ID },
      );
      setState(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load busy mode");
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await kdsJson<BusyModeState>(
        session,
        `/api/v1/kds/busy-mode`,
        {
          locationId: DEFAULT_LOCATION_ID,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: !state.enabled,
            // When turning ON and no saved prep minutes, default to +15 on top
            // of default_prep_minutes so admins can refine later.
            ...(!state.enabled && state.prep_minutes == null
              ? { prep_minutes: state.default_prep_minutes + 15 }
              : {}),
          }),
        },
      );
      setState(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      {state.enabled && (
        <span
          style={{
            background: "#e67e22",
            color: "#fff",
            padding: "0.25rem 0.6rem",
            borderRadius: "8px",
            fontWeight: 700,
            fontSize: "0.8rem",
            letterSpacing: "0.04em",
          }}
          title={
            state.prep_minutes != null
              ? `Busy mode ON — prep ${state.prep_minutes} min`
              : "Busy mode ON"
          }
        >
          BUSY
          {state.prep_minutes != null ? ` · ${state.prep_minutes}m` : ""}
        </span>
      )}
      <button
        type="button"
        className={state.enabled ? "btn-secondary" : "btn-primary"}
        onClick={toggle}
        disabled={busy}
        style={{ fontSize: "0.8rem" }}
      >
        {state.enabled ? "Turn off busy mode" : "Turn on busy mode"}
      </button>
      {error && <span className="surface-error" style={{ fontSize: "0.75rem" }}>{error}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KDS Station Login Screen                                           */
/* ------------------------------------------------------------------ */

const KDS_PIN_LENGTH = 5;
const KDS_KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "backspace"],
] as const;

function KdsFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="kds-page" style={{ minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "1rem 0 0.5rem",
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: "1.35rem",
            letterSpacing: "-0.02em",
            color: "#141008",
          }}
        >
          WINGS 4U{" "}
          <span
            style={{
              display: "inline-block",
              background:
                "linear-gradient(180deg, #c24914 0%, #9e3a0f 100%)",
              color: "#fff",
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "0.18rem 0.55rem",
              borderRadius: "6px",
              verticalAlign: "middle",
              marginLeft: "0.35rem",
              letterSpacing: "0.06em",
            }}
          >
            KITCHEN
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}

function KdsStatusScreen({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <KdsFrame>
      <section className="kds-gate">
        <div className="kds-modal-card" style={{ textAlign: "center" }}>
          <h1
            style={{
              margin: "0 0 0.75rem",
              fontSize: "1.4rem",
              fontWeight: 800,
              color: "#141008",
            }}
          >
            {title}
          </h1>
          <p className="kds-modal-copy" style={{ margin: 0 }}>{message}</p>
        </div>
      </section>
    </KdsFrame>
  );
}

function KdsLoginScreen({ session }: { session: SessionState }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = useCallback(
    async (nextCode: string) => {
      if (busy || nextCode.length !== KDS_PIN_LENGTH) return;

      setBusy(true);
      setError(null);

      try {
        const res = await apiFetch("/api/v1/auth/kds/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_code: nextCode,
            location_id: DEFAULT_LOCATION_ID,
          }),
        });
        const body = (await res.json().catch(() => null)) as KdsApiEnvelope<unknown> | null;
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
      if (busy || code.length >= KDS_PIN_LENGTH) return;
      const nextCode = `${code}${digit}`;
      setCode(nextCode);
      setError(null);
      if (nextCode.length === KDS_PIN_LENGTH) {
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
    <KdsFrame>
      <section className="kds-gate" aria-label="KDS employee login">
        <div className="kds-modal-card">
          <p
            className="kds-login-eyebrow"
            style={{
              margin: "0 0 0.25rem",
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8e2f08",
            }}
          >
            STATION ACCESS
          </p>
          <h1
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1.35rem",
              fontWeight: 800,
              color: "#141008",
            }}
          >
            Enter employee PIN
          </h1>
          <p className="kds-modal-copy">
            Store network verified. Use the store&apos;s 5-digit employee code
            to unlock the kitchen display.
          </p>

          <div
            className="kds-pin-display"
            aria-label="Entered PIN"
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "0.75rem",
              margin: "1.25rem 0",
            }}
          >
            {Array.from({ length: KDS_PIN_LENGTH }, (_, index) => (
              <div
                key={index}
                style={{
                  width: "2.4rem",
                  height: "2.4rem",
                  borderRadius: "12px",
                  border: "2px solid",
                  borderColor: code[index]
                    ? "#c24914"
                    : "rgba(23, 18, 13, 0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.4rem",
                  fontWeight: 800,
                  color: "#141008",
                  background: code[index]
                    ? "rgba(194, 73, 20, 0.08)"
                    : "rgba(255, 255, 255, 0.7)",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                aria-hidden="true"
              >
                {code[index] ? "•" : ""}
              </div>
            ))}
          </div>

          <div
            className="kds-keypad"
            role="group"
            aria-label="PIN keypad"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.5rem",
              maxWidth: "280px",
              margin: "0 auto 1rem",
            }}
          >
            {KDS_KEYPAD_ROWS.flat().map((key) => {
              if (key === "clear") {
                return (
                  <button
                    key={key}
                    type="button"
                    className="btn-secondary"
                    style={{
                      minHeight: "3rem",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      borderRadius: "12px",
                    }}
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
                    className="btn-secondary"
                    style={{
                      minHeight: "3rem",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      borderRadius: "12px",
                    }}
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
                  className="btn-secondary"
                  style={{
                    minHeight: "3rem",
                    fontSize: "1.15rem",
                    fontWeight: 700,
                    borderRadius: "12px",
                  }}
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
            className="btn-primary"
            style={{ width: "100%", minHeight: "2.75rem" }}
            onClick={() => void submitCode(code)}
            disabled={busy || code.length !== KDS_PIN_LENGTH}
          >
            {busy ? "Signing in..." : "Unlock kitchen display"}
          </button>

          {error ? (
            <p
              className="surface-error"
              style={{ margin: "0.75rem 0 0", textAlign: "center" }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </KdsFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Main KDS Client                                                    */
/* ------------------------------------------------------------------ */

function canAccessKds(session: SessionState): boolean {
  if (!session.authenticated || !session.user) return false;
  if (session.user.role === "ADMIN") return true;
  return (
    session.user.role === "STAFF" &&
    !session.isPosSession &&
    session.stationLocationId === DEFAULT_LOCATION_ID
  );
}

export function KdsClient() {
  const session = useSession();
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof createOrdersSocket> | null>(null);
  const sessionControls = useMemo<KdsSessionControls>(
    () => ({
      refresh: session.refresh,
      clear: session.clear,
    }),
    [session.clear, session.refresh],
  );

  const canUseBoard = session.loaded && canAccessKds(session);
  const needsPin = session.loaded && !canUseBoard;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await kdsJson<KdsOrder[]>(
        sessionControls,
        `/api/v1/kds/orders?statuses=${ALL_KDS_STATUSES.join(",")}`,
        { locationId: DEFAULT_LOCATION_ID },
      );
      setOrders(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load KDS orders");
    } finally {
      setLoading(false);
    }
  }, [sessionControls]);

  // Initial load — only if session is good
  useEffect(() => {
    if (!canUseBoard) return;
    void loadOrders();
  }, [canUseBoard, loadOrders]);

  // Socket.IO realtime — subscribe to location-level orders channel.
  // `subscribeToChannels` keeps the subscription alive across reconnects
  // so KDS updates come from realtime events after the initial load.
  useEffect(() => {
    if (!canUseBoard) return;

    const socket = createOrdersSocket();
    socketRef.current = socket;

    const refresh = () => void loadOrders();
    socket.on("order.placed", refresh);
    socket.on("order.accepted", refresh);
    socket.on("order.status_changed", refresh);
    socket.on("order.cancelled", refresh);
    socket.on("order.driver_assigned", refresh);
    socket.on("order.delivery_started", refresh);
    socket.on("order.eta_updated", refresh);
    socket.on("order.manual_review_required", refresh);
    socket.on("cancellation.requested", refresh);
    socket.on("cancellation.decided", refresh);
    // Finding 5: refresh KDS on add-items change request events
    socket.on("order.change_requested", refresh);
    socket.on("order.change_approved", refresh);
    socket.on("order.change_rejected", refresh);

    const disposeSubscription = subscribeToChannels(socket, [
      `orders:${DEFAULT_LOCATION_ID}`,
    ]);
    socket.connect();

    return () => {
      disposeSubscription();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [canUseBoard, loadOrders]);

  /* ---- Gate: show loading / PIN / customer-deny ---- */

  if (!session.loaded) {
    return (
      <KdsStatusScreen
        title="Checking session"
        message="Loading KDS access..."
      />
    );
  }

  if (needsPin) {
    // If the user has a CUSTOMER session, deny them instead of showing PIN
    if (
      session.authenticated &&
      session.user?.role === "CUSTOMER"
    ) {
      return (
        <KdsStatusScreen
          title="KDS unavailable"
          message="This station is reserved for authorized staff on the configured store network."
        />
      );
    }
    // No session or wrong session — show PIN unlock
    return <KdsLoginScreen session={session} />;
  }

  /* ---- Authenticated ADMIN / STAFF — render KDS board ---- */

  return (
    <section className="kds-page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Active Tickets</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <BusyModeControl session={sessionControls} />
          <button
            type="button"
            className="kds-refresh-btn"
            onClick={() => void loadOrders()}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && orders.length === 0 ? <p className="surface-muted">Loading kitchen tickets...</p> : null}
      {error ? <p className="surface-error" style={{ marginTop: 0 }}>{error}</p> : null}

      {/* Column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
          gap: "1rem",
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <div key={col.key}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                  padding: "0.4rem 0.75rem",
                  background: col.color,
                  borderRadius: "12px",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                }}
              >
                {col.label}
                <span
                  style={{
                    background: "rgba(255,255,255,0.3)",
                    borderRadius: "8px",
                    padding: "0.1rem 0.45rem",
                    fontSize: "0.8rem",
                  }}
                >
                  {colOrders.length}
                </span>
              </div>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {colOrders.length === 0 ? (
                  <p className="surface-muted" style={{ fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
                  No orders
                </p>
              ) : (
                colOrders.map((order) => (
                  <KdsOrderCard
                    key={order.id}
                    order={order}
                    session={sessionControls}
                    onRefresh={loadOrders}
                  />
                ))
              )}
            </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
