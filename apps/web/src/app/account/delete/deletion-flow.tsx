"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccountDeletionStatus, AccountDeletionVerification, AccountDeletionResult, ApiEnvelope } from "@wings4u/contracts";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import { CustomerAuth } from "@/components/customer-auth";
import { forgetDeletedAccount, leaveDeletedAccount } from "@/lib/account-deletion";
import styles from "../profile/profile.module.css";

async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? "Unable to process account deletion. Please try again.");
  return body.data;
}

export function AccountDeletionFlow() {
  const session = useSession();
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [step, setStep] = useState<"review" | "password" | "confirm" | "completed">("review");
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [forfeitRewards, setForfeitRewards] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  // Secrets never enter URLs, persistent storage, analytics, or session state.
  const proof = useRef<AccountDeletionVerification | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const owner = useRef(session.user?.id);
  owner.current = session.user?.id;

  useEffect(() => {
    const version = ++epoch.current;
    inFlight.current = false; setBusy(false);
    let cancelled = false;
    proof.current = null; requestId.current = null;
    setPassword(""); setConfirmation(""); setForfeitRewards(false); setStatus(null); setError("");
    setStep(current => current === "completed" ? current : "review");
    if (!session.loaded || !session.authenticated || session.user?.role !== "CUSTOMER") return;
    void withSilentRefresh(() => apiFetch("/api/v1/auth/account-deletion", { cache: "no-store" }), session.refresh, session.clear).then(read<AccountDeletionStatus>)
      .then(value => { if (!cancelled) setStatus(value); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load account status."); });
    return () => { cancelled = true; if (version === epoch.current) epoch.current++; proof.current = null; requestId.current = null; };
  }, [session.loaded, session.authenticated, session.user?.id, session.user?.role, reload]);

  function cancel() {
    if (inFlight.current) return;
    proof.current = null; requestId.current = null;
    setPassword(""); setConfirmation(""); setForfeitRewards(false); setError(""); setStep("review");
  }

  function completed() {
    proof.current = null; requestId.current = null; setStep("completed");
    forgetDeletedAccount(); session.clear(); leaveDeletedAccount();
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !password || !status?.enabled) return;
    inFlight.current = true; setBusy(true); setError("");
    const account = owner.current;
    const version = epoch.current;
    const enteredPassword = password;
    setPassword("");
    try {
      const value = await read<AccountDeletionVerification>(await withSilentRefresh(() => apiFetch("/api/v1/auth/account-deletion/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: enteredPassword }),
      }), session.refresh, session.clear));
      if (account !== owner.current || version !== epoch.current) return;
      proof.current = value;
      requestId.current = value.request_id;
      setStep("confirm");
    } catch (cause) {
      if (account === owner.current && version === epoch.current) setError(cause instanceof Error ? cause.message : "Password verification failed.");
    } finally { if (version === epoch.current) { inFlight.current = false; setBusy(false); } }
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || confirmation !== "DELETE" || !forfeitRewards || !proof.current || !requestId.current) return;
    if (Date.parse(proof.current.expires_at) <= Date.now()) {
      proof.current = null; requestId.current = null; setStep("password");
      setError("Verification expired. Re-enter your password."); return;
    }
    inFlight.current = true; setBusy(true); setError("");
    const account = owner.current;
    const version = epoch.current;
    try {
      const value = await read<AccountDeletionResult>(await apiFetch("/api/v1/auth/account", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization: proof.current.authorization, request_id: requestId.current,
          confirmation, forfeit_rewards: forfeitRewards }),
      }));
      if (account !== owner.current || version !== epoch.current) return;
      if (value.status === "resolution_required") {
        proof.current = null; requestId.current = null;
        setStatus(current => current && { ...current, status: "resolution_required", blockers: value.blockers });
        setConfirmation(""); setForfeitRewards(false); setStep("review");
      } else if (value.status === "completed") {
        completed();
      } else {
        throw new Error("Deletion has not been confirmed. Check your account status before trying again.");
      }
    } catch (cause) {
      if (account !== owner.current || version !== epoch.current) return;
      const pendingProof = proof.current;
      if (pendingProof) {
        try {
          const receipt = await read<{ status: string }>(await apiFetch("/api/v1/auth/account-deletion/receipt", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
              request_id: pendingProof.request_id, authorization: pendingProof.authorization }),
          }));
          if (account !== owner.current || version !== epoch.current) return;
          if (receipt.status === "completed") { completed(); return; }
        } catch { /* A failed status lookup cannot establish success. */ }
      }
      if (account === owner.current && version === epoch.current) setError(cause instanceof Error ? cause.message : "Deletion could not be confirmed. Please try again.");
    } finally { if (version === epoch.current) { inFlight.current = false; setBusy(false); } }
  }

  if (step === "completed") return <div role="status"><h2>Your account has been deleted.</h2>
    <p>You have been signed out on all devices.</p>
    <a href="/" className={styles.logoutCancelBtn}>Return home</a></div>;
  if (!session.loaded) return <p role="status">Checking your session…</p>;
  if (!session.authenticated) return showLogin ? <CustomerAuth mode="login" onCancel={() => setShowLogin(false)} /> :
    <button type="button" className={styles.saveBtn} onClick={() => setShowLogin(true)}>Sign in to delete account</button>;
  if (session.user?.role !== "CUSTOMER") return <p role="alert">Account deletion is available for customer accounts only.</p>;

  return (
    <div className={styles.accountDeletion} aria-busy={busy}>
      {error ? <p role="alert" className={styles.feedbackError}>{error}</p> : null}
      {!status ? <><p role="status">{error ? "Account status could not be loaded." : "Checking account status…"}</p>
        {error ? <button type="button" onClick={() => setReload(value => value + 1)}>Try again</button> : null}</> :
        !status.enabled ? <p role="status">Account deletion is not available yet. Your account and data have not been deleted.</p> : <>
          {status.blockers.length ? <div role="status"><h2>Resolve these items before deletion</h2>
            <ul>{status.blockers.map(blocker => <li key={blocker.code}>{blocker.message}</li>)}</ul>
            <p>Your account remains available. Deletion has not completed.</p>
            <button type="button" onClick={() => setReload(value => value + 1)}>Check again</button>
          </div> : null}
          {step === "review" ? <button type="button" className={styles.deleteAccountBtn}
            disabled={status.blockers.length > 0} onClick={() => setStep("password")}>Continue to verification</button> : null}
          {step === "password" ? <form onSubmit={verify} className={styles.form}>
            <h2>Verify it is you</h2>
            <label className={styles.field}>Current password<input type="password" autoComplete="current-password"
              value={password} maxLength={128} onChange={event => setPassword(event.target.value)} disabled={busy} required /></label>
            <p>If you need to set or reset your password, use Forgot password on the sign-in form.</p>
            <button type="submit" className={styles.saveBtn} disabled={busy || !password}>{busy ? "Verifying…" : "Verify password"}</button>
            <button type="button" className={styles.logoutCancelBtn} disabled={busy} onClick={cancel}>Keep My Account</button>
          </form> : null}
          {step === "confirm" ? <form onSubmit={remove} className={styles.form}>
            <h2>Final confirmation</h2>
            <p>Deletion is permanent. Your eligible personal data will be removed and all sessions will end.</p>
            <label><input type="checkbox" checked={forfeitRewards} disabled={busy}
              onChange={event => setForfeitRewards(event.target.checked)} /> I understand my saved information and rewards will be lost.</label>
            <label className={styles.field}>Type DELETE to confirm<input value={confirmation} autoComplete="off"
              onChange={event => setConfirmation(event.target.value)} disabled={busy} required /></label>
            <button type="button" className={styles.logoutCancelBtn} disabled={busy} onClick={cancel}>Keep My Account</button>
            <button type="submit" className={styles.deleteAccountBtn} disabled={busy || confirmation !== "DELETE" || !forfeitRewards}>
              {busy ? "Deleting…" : "Delete My Account"}</button>
            {error ? <button type="button" disabled={busy} onClick={() => { cancel(); setStep("password"); }}>Verify again</button> : null}
          </form> : null}
        </>}
      {step === "review" ? <Link href="/account/profile" className={styles.logoutCancelBtn}>Keep My Account</Link> : null}
    </div>
  );
}
