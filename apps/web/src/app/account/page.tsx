"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AccountSkeleton } from "@/components/account-skeleton";
import { AccountSurfaceLinks } from "./account-surface-links";

import styles from "./profile/profile.module.css"; // Reuse profile styles for consistency

function formatPhoneNumber(phone?: string | null) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length > 10) {
    const countryLength = digits.length - 10;
    const countryCode = digits.slice(0, countryLength);
    const main = digits.slice(countryLength);
    return `+${countryCode} (${main.slice(0, 3)})-${main.slice(3, 6)}-${main.slice(6)}`;
  }
  return phone;
}

export default function AccountPage() {
  const session = useSession();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (session.loaded && !session.authenticated) {
      router.push("/auth/login");
    }
    if (session.user) {
      setFullName(session.user.displayName);
      setEmail(session.user.email ?? "");
    }
  }, [session.loaded, session.authenticated, session.user, router]);

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 450);
  }, []);

  const handleSave = useCallback(async () => {
    setError("");
    setSuccess(false);

    if (fullName.trim().length < 4) {
      setError("Name must be at least 4 characters");
      triggerShake();
      return;
    }

    setBusy(true);
    try {
      const payload: Record<string, string> = { full_name: fullName.trim() };
      if (email.trim()) payload.email = email.trim();

      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/auth/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        session.refresh,
        session.clear,
      );
      const body = (await res.json()) as ApiEnvelope<{ profile_complete: boolean }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Save failed");
        return;
      }
      await session.refresh();
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [fullName, email, session, triggerShake]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    session.clear();
    router.replace("/");
  }, [session, router]);

  if (!session.loaded || isLoggingOut) {
    return <AccountSkeleton isLoggingOut={isLoggingOut} />;
  }

  return (
    <div className={styles.pageShell}>
      <main className={styles.hub}>
        <div className={styles.mainContainer}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.identityCard}>
              <h1 className={styles.name}>{session.user?.displayName ?? "Customer"}</h1>
              <div className={styles.phone}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
              </div>

              <nav className={styles.navLinks}>
                <Link href="/account/profile" className={styles.navLink}>
                  <span>My Profile</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <AccountSurfaceLinks
                  user={session.user}
                  navLinkClassName={styles.navLink}
                  navLinkArrowClassName={styles.navLinkArrow}
                />
                <Link href="/account" className={`${styles.navLink} ${styles.navLinkActive}`}>
                  <span>My Account</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/orders" className={styles.navLink}>
                  <span>Order History</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/addresses" className={styles.navLink}>
                  <span>My Addresses</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/cards" className={styles.navLink}>
                  <span>My Cards</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/support" className={styles.navLink}>
                  <span>Support</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <button onClick={handleLogout} className={styles.navLink} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ color: '#ef4444' }}>Logout</span>
                  <span className={styles.navLinkArrow} style={{ color: '#ef4444' }}>→</span>
                </button>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <div className={styles.contentStack}>
            <section className={styles.settingsCard}>
              <header className={styles.cardHeader}>
                <span className={styles.eyebrow}>Account</span>
                <h2>Settings</h2>
              </header>

              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void handleSave();
                }}
              >
                <label className={styles.field}>
                  <span>Full name</span>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Doe"
                  />
                </label>

                <label className={styles.field}>
                  <span>Email (optional)</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                  />
                </label>

                {session.user?.phone ? (
                  <label className={`${styles.field} ${styles.fieldReadonly}`}>
                    <span>Verified phone</span>
                    <input value={formatPhoneNumber(session.user.phone)} readOnly />
                  </label>
                ) : null}

                {error ? <p className={`${styles.feedback} ${styles.feedbackError}`}>{error}</p> : null}
                {success ? <p className={`${styles.feedback} ${styles.feedbackSuccess}`}>Profile updated!</p> : null}

                <button
                  className={`${styles.saveBtn}${shaking ? ` ${styles.saveBtnShake}` : ""}`}
                  type="submit"
                >
                  <span>{busy ? "Saving..." : "Save changes"}</span>
                </button>
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
