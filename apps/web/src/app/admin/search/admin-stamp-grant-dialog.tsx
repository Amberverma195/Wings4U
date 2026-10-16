"use client";

import { useRef, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch } from "../admin-api";
import { useAdminDialog } from "../use-admin-dialog";
import type { AdminStampGrantResult, StampGrantReason } from "../../../../../api/src/modules/admin/admin-customers.dto";

type PendingGrant = { stamps: number; reason: StampGrantReason; note?: string; request_id: string };
const pendingKey = (id: string) => `wings4u:pending-stamp-grant:${id}`;
function readPending(id: string): PendingGrant | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(id)) ?? "null") as PendingGrant | null;
    return value && typeof value.request_id === "string" && Number.isSafeInteger(value.stamps) &&
      ["WRONG_ORDER", "MISSING_ITEMS", "SERVICE_RECOVERY", "OTHER"].includes(value.reason) ? value : null;
  } catch { return null; }
}
function savePending(id: string, value: PendingGrant | null) {
  try { if (value) sessionStorage.setItem(pendingKey(id), JSON.stringify(value)); else sessionStorage.removeItem(pendingKey(id)); }
  catch { /* The mounted form still retains its key when browser storage is unavailable. */ }
}

export function AdminStampGrantDialog({ open, customerId, name, balance, threshold, onClose, onSuccess, onRefresh }: {
  open: boolean; customerId: string; name: string; balance: number; threshold: number;
  onClose: () => void; onSuccess: (grant: AdminStampGrantResult) => void; onRefresh: () => Promise<void>;
}) {
  const session = useSession();
  const [pending] = useState(() => readPending(customerId));
  const [amount, setAmount] = useState(pending ? String(pending.stamps) : "");
  const [reason, setReason] = useState<StampGrantReason | "">(pending?.reason ?? "");
  const [note, setNote] = useState(pending?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(!!pending);
  const [capChanged, setCapChanged] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(pending ? {
    fingerprint: JSON.stringify({ stamps: pending.stamps, reason: pending.reason, ...(pending.note ? { note: pending.note } : {}) }), id: pending.request_id,
  } : null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  const close = () => { if (!inFlight.current) onClose(); };
  useAdminDialog({ dialogRef, initialFocusRef: initialFocus, onClose: close, active: open });
  const capacity = Math.max(0, threshold - balance);
  const valid = /^\d+$/.test(amount) && Number.isSafeInteger(Number(amount)) && Number(amount) > 0 &&
    Number(amount) <= capacity && !!reason && (reason !== "OTHER" || !!note.trim());
  const submit = async () => {
    if (inFlight.current || (!valid && !uncertain)) return;
    inFlight.current = true; setBusy(true); setError(null); setCapChanged(false);
    const input = { stamps: Number(amount), reason, ...(note.trim() ? { note: note.trim() } : {}) };
    const fingerprint = JSON.stringify(input);
    try {
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
      savePending(customerId, { ...input, reason: reason as StampGrantReason, request_id: attempt.current.id });
      const res = await withSilentRefresh(() => adminApiFetch(`/api/v1/admin/customers/${customerId}/stamps/grant`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: attempt.current!.id }),
        signal: AbortSignal.timeout(30_000),
      }), session.refresh, session.clear);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const changed = body?.errors?.[0]?.code === "STAMP_CAP_CHANGED";
        setCapChanged(changed);
        // Server/connection failures may happen AFTER commit: keep the same key and immutable form.
        const remainsUncertain = res.status >= 500 || (uncertain && (res.status === 401 || res.status === 403));
        setUncertain(remainsUncertain);
        if (!remainsUncertain) { attempt.current = null; savePending(customerId, null); }
        throw new Error(body?.errors?.[0]?.message ?? `Unable to give stamps (${res.status}).`);
      }
      if (!body?.data) { setUncertain(true); throw new Error("Grant result could not be confirmed. Retry this same request."); }
      attempt.current = null; savePending(customerId, null); setUncertain(false); setAmount(""); setReason(""); setNote("");
      onSuccess(body.data as AdminStampGrantResult);
    } catch (e) {
      // Fetch can reject without any response; an existing attempt must remain retryable.
      if (attempt.current) setUncertain(true);
      setError(e instanceof Error ? e.message : "Unable to confirm the stamp grant. Retry this same request.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  if (!open) return null;
  return <div role="presentation" className="admin-stamp-grant-overlay" onMouseDown={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-stamp-grant-title" tabIndex={-1}
      className="admin-customer-modal admin-stamp-grant-modal" onMouseDown={event => event.stopPropagation()}>
      <header className="admin-customer-header"><div><p className="admin-customer-eyebrow">Wings Rewards</p>
        <h2 id="admin-stamp-grant-title">Give Stamps</h2><p>{name}</p>
        <p>Current balance: <strong>{balance}/{threshold}</strong> · Remaining capacity: <strong>{capacity}</strong></p>
      </div></header>
      <form className="admin-customer-body admin-stamp-grant-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor="admin-stamp-count">How many stamps?</label>
        <input ref={element => { if (!uncertain) initialFocus.current = element; }} id="admin-stamp-count" type="number" inputMode="numeric" min={1} max={capacity} step={1}
          required value={amount} disabled={busy || uncertain} onChange={event => setAmount(event.target.value)} />
        {amount && !/^\d+$/.test(amount) && <p className="surface-error">Use a positive whole number.</p>}
        {Number(amount) > capacity && <p className="surface-error">You can add at most {capacity} stamps.</p>}
        <label htmlFor="admin-stamp-reason">Reason</label>
        <select id="admin-stamp-reason" required value={reason} disabled={busy || uncertain} onChange={event => setReason(event.target.value as StampGrantReason)}>
          <option value="">Select a reason</option><option value="WRONG_ORDER">Wrong order</option>
          <option value="MISSING_ITEMS">Missing items</option><option value="SERVICE_RECOVERY">Service recovery</option><option value="OTHER">Other</option>
        </select>
        <label htmlFor="admin-stamp-note">{reason === "OTHER" ? "Explanation (required)" : "Internal note (optional)"}</label>
        <textarea id="admin-stamp-note" required={reason === "OTHER"} maxLength={1000} value={note} disabled={busy || uncertain}
          onChange={event => setNote(event.target.value)} />
        <p className="surface-muted">The reason and internal note are recorded for administrators and kept out of the customer email.</p>
        {error && <p role="alert" className="surface-error">{error}</p>}
        {uncertain && <p role="status">The request may have completed. Retry to check this same grant safely.</p>}
        {capChanged && <button type="button" className="btn-secondary" onClick={() => void onRefresh()}>Refresh rewards</button>}
        <div className="admin-customer-heading-row">
          <button ref={element => { if (uncertain) initialFocus.current = element; }} type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || (!valid && !uncertain)}>
            {busy ? "Adding stamps..." : uncertain ? "Retry same grant" : "Give Stamps"}</button>
        </div>
      </form>
    </div>
  </div>;
}
