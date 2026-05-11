"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

import { useSession } from "@/lib/session";
import { 
  DELIVERY_ADDRESSES_UPDATED_EVENT,
  loadSavedAddresses, 
  removeSavedAddressByIdSync, 
  syncSavedAddressesFromServer,
  setDeliveryAddressAuthState,
  type SavedDeliveryAddress
} from "@/lib/delivery-address";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./addresses.module.css";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { OrderMethodModal } from "@/Wings4u/components/order-method-modal";
import { AccountSkeleton } from "@/components/account-skeleton";
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

export default function AddressesPage() {
  return (
    <RequireAuthModal ariaLabel="Sign in to manage your addresses">
      <AddressesContent />
    </RequireAuthModal>
  );
}

function AddressesContent() {
  const session = useSession();
  const [addresses, setAddresses] = useState<SavedDeliveryAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const router = useRouter();

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






  useEffect(() => {
    if (session.loaded) {
      setDeliveryAddressAuthState(session.authenticated);
      void syncSavedAddressesFromServer(session.refresh, session.clear).then(() => {
        setAddresses(loadSavedAddresses());
        setLoading(false);
      });
    }
  }, [session.loaded, session.authenticated, session.refresh, session.clear]);

  useEffect(() => {
    function handleSavedAddressesUpdated() {
      setAddresses(loadSavedAddresses());
    }

    window.addEventListener(DELIVERY_ADDRESSES_UPDATED_EVENT, handleSavedAddressesUpdated);
    return () => {
      window.removeEventListener(
        DELIVERY_ADDRESSES_UPDATED_EVENT,
        handleSavedAddressesUpdated,
      );
    };
  }, []);

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to remove this address?")) {
      removeSavedAddressByIdSync(id, session.refresh, session.clear);
      setAddresses(loadSavedAddresses());
    }
  };

  const handleEdit = (id: string) => {
    setEditingAddressId(id);
    setShowAddModal(true);
  };

  if (!session.loaded || loading || isLoggingOut) {
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
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
                <Link href="/account" className={styles.navLink}>
                  <span>My Account</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/orders" className={styles.navLink}>
                  <span>Order History</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                  <span>My Addresses</span>
                  <span className={styles.navLinkArrow}>→</span>
                </div>
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
            <section className={styles.section}>
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>Preferences</span>
                  <h2 className={styles.sectionTitle}>Saved Addresses</h2>
                </div>
                <button 
                  className={styles.addBtn}
                  onClick={() => setShowAddModal(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Address
                </button>
              </header>

              {addresses.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>You haven't saved any delivery addresses yet.</p>
                </div>
              ) : (
                <div className={styles.addressGrid}>
                  {addresses.map((addr) => (
                    <div key={addr.id} className={styles.addressCard}>
                      <div className={styles.addressInfo}>
                        <span className={styles.addressLine1}>{addr.line1}</span>
                        <span className={styles.addressCity}>{addr.city}, {addr.postalCode}</span>
                      </div>
                      <div className={styles.addressActions}>
                        <button className={styles.actionBtn} onClick={() => handleEdit(addr.id)}>Edit</button>
                        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => handleDelete(addr.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <OrderMethodModal 
        open={showAddModal}
        addressOnly={true}
        editingSavedAddressId={editingAddressId}
        onClose={() => {
          setShowAddModal(false);
          setEditingAddressId(null);
        }}
        onContinue={() => {
          setAddresses(loadSavedAddresses());
          setEditingAddressId(null);
          setShowAddModal(false);
        }}
        // I will add these props to OrderMethodModal in the next step
        refresh={session.refresh}
        clear={session.clear}
      />
    </div>
  );
}
