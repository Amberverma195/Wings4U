"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useSession } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { AccountSkeleton } from "@/components/account-skeleton";
import styles from "../addresses/addresses.module.css";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { AccountSurfaceLinks } from "../account-surface-links";

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

export default function CardsPage() {
  return (
    <RequireAuthModal ariaLabel="Sign in to manage your cards">
      <CardsContent />
    </RequireAuthModal>
  );
}

function CardsContent() {
  const session = useSession();
  const [cards, setCards] = useState<any[]>([]); // Mock state for UI presentation
  const [showAddModal, setShowAddModal] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const router = useRouter();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const updateRim = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--rim-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--rim-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  const clearRim = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

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

  const handleAddCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (cardNumber) {
      setCards([...cards, { id: Date.now().toString(), last4: cardNumber.slice(-4) || cardNumber }]);
      setShowAddModal(false);
      setCardNumber("");
      setExpiry("");
      setCvv("");
    }
  };

  const handleDelete = (id: string) => {
    setCards(cards.filter(c => c.id !== id));
  };

  return (
    <div className={styles.pageShell}>
      <main className={styles.hub}>
        <div className={styles.mainContainer}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.identityCard}>
              <h1 className={styles.name}>{session.user?.displayName ?? "Customer"}</h1>
              <div className={styles.phone}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
              </div>

              <div className={styles.navLinksWrapper}>
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
                  <Link href="/account" className={styles.navLink}>
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
                  <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                    <span>My Cards</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </div>
                  <Link href="/account/support" className={styles.navLink}>
                    <span>Support</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className={`${styles.navLink} ${styles.navLinkLogout}`}
                  >
                    <span>Logout</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </button>
                </nav>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className={styles.contentStack}>
            <section className={styles.section}>
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>Payments</span>
                  <h2 className={styles.sectionTitle}>Saved Cards</h2>
                </div>
                <button 
                  className={styles.addBtn}
                  onClick={() => setShowAddModal(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Card
                </button>
              </header>

              {cards.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>You haven't saved any payment cards yet.</p>
                </div>
              ) : (
                <div className={styles.addressGrid}>
                  {cards.map((card) => (
                    <div key={card.id} className={styles.addressCard}>
                      <div className={styles.addressInfo}>
                        <span className={styles.addressLine1}>•••• •••• •••• {card.last4}</span>
                        <span className={styles.addressCity}>Card</span>
                      </div>
                      <div className={styles.addressActions}>
                        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => handleDelete(card.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* Add Card Modal */}
      {showAddModal && (
        <div className="wk-method-overlay" onMouseDown={() => setShowAddModal(false)}>
          <div 
            className="wk-method-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div 
              className="wk-method-card-inner"
              ref={cardRef}
              onMouseMove={updateRim}
              onMouseEnter={updateRim}
              onMouseLeave={clearRim}
            >
              <div className="wk-auth-card-glow" aria-hidden />
              <div className="wk-auth-card-rim" aria-hidden />

              <button 
                className="wk-method-close" 
                onClick={() => setShowAddModal(false)}
              >
                {"\u00D7"}
              </button>
              
              <div className="wk-method-header">
                <div className="wk-method-step">PAYMENT METHOD</div>
                <h2 className="wk-method-title">Add New Card</h2>
              </div>

              <form className="wk-method-address-panel" onSubmit={handleAddCard}>
                <div className="wk-method-address-grid">
                  <label className="wk-method-address-field">
                    <span className="wk-method-address-label">Card Number</span>
                    <input 
                      type="text" 
                      className="wk-method-address-input" 
                      placeholder="0000 0000 0000 0000"
                      required
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                    />
                  </label>

                  <div className="wk-method-address-row">
                    <label className="wk-method-address-field">
                      <span className="wk-method-address-label">Expiry</span>
                      <input 
                        type="text" 
                        className="wk-method-address-input" 
                        placeholder="MM/YY"
                        required
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                      />
                    </label>
                    <label className="wk-method-address-field">
                      <span className="wk-method-address-label">CVV</span>
                      <input 
                        type="password" 
                        className="wk-method-address-input" 
                        placeholder="123"
                        required
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: '20px' }}>
                  <button 
                    type="submit" 
                    className="wk-method-continue"
                    disabled={!cardNumber}
                  >
                    <span className="wk-method-continue-label">Save Card</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
