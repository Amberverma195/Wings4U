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
import { useCallback, useEffect, useRef, useState } from "react";
import { useModalDialog } from "@/lib/use-modal-dialog";
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
  const [addressToRemove, setAddressToRemove] = useState<SavedDeliveryAddress | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const removeDialogRef = useRef<HTMLDivElement>(null);
  const cancelRemoveRef = useRef<HTMLButtonElement>(null);
  const removeInFlight = useRef(false);
  const addAddressRef = useRef<HTMLButtonElement>(null);
  const focusAfterRemoval = useRef(false);
  const closeRemoveDialog = () => {
    if (!removeInFlight.current) {
      setAddressToRemove(null);
      setRemoveError("");
    }
  };
  useModalDialog({
    dialogRef: removeDialogRef,
    initialFocusRef: cancelRemoveRef,
    active: addressToRemove !== null,
    onClose: closeRemoveDialog,
  });
  useEffect(() => {
    if (!addressToRemove && focusAfterRemoval.current) {
      focusAfterRemoval.current = false;
      addAddressRef.current?.focus();
    }
  }, [addressToRemove]);

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
      setDeliveryAddressAuthState(session.authenticated, session.user?.id);
      void syncSavedAddressesFromServer(session.refresh, session.clear).then(() => {
        setAddresses(loadSavedAddresses());
        setLoading(false);
      });
    }
  }, [session.loaded, session.authenticated, session.user?.id, session.refresh, session.clear]);

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

  const handleDelete = async () => {
    if (!addressToRemove || removeInFlight.current) return;
    removeInFlight.current = true;
    setRemoving(true);
    setRemoveError("");
    try {
      await removeSavedAddressByIdSync(addressToRemove.id, session.refresh, session.clear);
      setAddresses(loadSavedAddresses());
      focusAfterRemoval.current = true;
      setAddressToRemove(null);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "We couldn't remove this address. Please try again.");
    } finally {
      removeInFlight.current = false;
      setRemoving(false);
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

              <div className={styles.navLinksWrapper}>
                <nav className={styles.navLinks}>
                  <Link href="/account/profile" className={styles.navLink}>
                    <span>Profile</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <AccountSurfaceLinks
                    user={session.user}
                    navLinkClassName={styles.navLink}
                    navLinkArrowClassName={styles.navLinkArrow}
                  />
                  <Link href="/account" className={styles.navLink}>
                    <span>Account</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <Link href="/account/orders" className={styles.navLink}>
                    <span>Order History</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                    <span>Addresses</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </div>
                  <Link href="/account/cards" className={styles.navLink} style={{ display: "none" }}>
                    <span>My Cards</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <Link href="/account/support" className={styles.navLink}>
                    <span>Support</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <button onClick={handleLogout} className={`${styles.navLink} ${styles.navLinkLogout}`}>
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
                  <span className={styles.eyebrow}>Preferences</span>
                  <h2 className={styles.sectionTitle}>Saved Addresses</h2>
                </div>
                <button 
                  ref={addAddressRef}
                  className={styles.addBtn}
                  onClick={() => { setEditingAddressId(null); setShowAddModal(true); }}
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
                        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => { setRemoveError(""); setAddressToRemove(addr); }}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {addressToRemove && (
        <div className={styles.modalOverlay} onClick={(event) => {
          if (event.target === event.currentTarget) closeRemoveDialog();
        }}>
          <div ref={removeDialogRef} className={`${styles.modalContent} ${styles.removeDialog}`}
            role="alertdialog" aria-modal="true" aria-labelledby="remove-address-title"
            aria-describedby="remove-address-description" aria-busy={removing} tabIndex={-1}>
            <div className={styles.removeIcon} aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
              </svg>
            </div>
            <span className={styles.eyebrow}>Your address book</span>
            <h2 id="remove-address-title" className={styles.modalTitle}>Remove this address?</h2>
            <p id="remove-address-description" className={styles.modalDesc}>
              This address will be removed from your saved addresses. You can always add it again later.
            </p>
            <div className={styles.removeAddressPreview}>
              <span className={styles.addressLine1}>{addressToRemove.line1}</span>
              <span className={styles.addressCity}>{addressToRemove.city}, {addressToRemove.postalCode}</span>
            </div>
            {removeError && <p className={styles.removeError} role="alert">{removeError}</p>}
            <div className={styles.modalActions}>
              <button ref={cancelRemoveRef} type="button" className={styles.cancelBtn}
                aria-disabled={removing} onClick={closeRemoveDialog}>Keep address</button>
              <button type="button" className={styles.submitBtn} disabled={removing} onClick={handleDelete}>
                {removing ? "Removing…" : "Remove address"}
              </button>
            </div>
          </div>
        </div>
      )}

      <OrderMethodModal 
        open={showAddModal}
        addressOnly={true}
        addressContext="account"
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
