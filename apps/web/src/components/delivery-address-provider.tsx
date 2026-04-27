"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AddressSavedToast } from "@/components/address-saved-toast";
import { DeliveryAddressPickerPanel } from "@/Wings4u/components/delivery-address-picker-panel";
import { OrderMethodModal } from "@/Wings4u/components/order-method-modal";
import {
  DELIVERY_ADDRESSES_UPDATED_EVENT,
  DELIVERY_ADDRESS_UPDATED_EVENT,
  loadDeliveryAddressDraft,
  loadSavedAddresses,
  normalizeDeliveryPostalCode,
  patchDeliveryAddressDraft,
  saveDeliveryAddressDraft,
  setDeliveryAddressAuthState,
  syncSavedAddressesFromServer,
  type DeliveryAddressDraft,
} from "@/lib/delivery-address";
import { useSession } from "@/lib/session";

type DeliveryAddressContextValue = {
  address: DeliveryAddressDraft | null;
  /** Replace the full saved draft (persists + updates listeners). */
  setAddress: (address: DeliveryAddressDraft) => void;
  /** Merge partial fields into the saved draft (persists + updates listeners). */
  updateAddress: (patch: Partial<DeliveryAddressDraft>) => void;
  /** Open the shared delivery-address modal (same form as onboarding step 2). */
  openAddressEditor: () => void;
  /** Open the saved-address picker; use “Add new address” inside to reach the editor. */
  openAddressPicker: () => void;
};

const DeliveryAddressContext = createContext<DeliveryAddressContextValue | null>(null);

export function useDeliveryAddress(): DeliveryAddressContextValue {
  const value = useContext(DeliveryAddressContext);
  if (!value) {
    throw new Error("useDeliveryAddress must be used within DeliveryAddressProvider");
  }
  return value;
}

export function DeliveryAddressProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [address, setAddressState] = useState<DeliveryAddressDraft | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [editingSavedAddressId, setEditingSavedAddressId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setAddressState(loadDeliveryAddressDraft());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Mirror session auth state into the address module so writes go to the DB
   * for signed-in users. On sign-in we pull the server list and replace the
   * local cache; on sign-out the cache is wiped by setDeliveryAddressAuthState.
   */
  useEffect(() => {
    if (!session.loaded) return;
    const changed = setDeliveryAddressAuthState(session.authenticated);
    if (session.authenticated) {
      void syncSavedAddressesFromServer();
    } else if (changed) {
      refresh();
    }
  }, [session.loaded, session.authenticated, session.user?.id, refresh]);

  useEffect(() => {
    function onSync() {
      refresh();
    }
    window.addEventListener("storage", onSync);
    window.addEventListener(DELIVERY_ADDRESS_UPDATED_EVENT, onSync);
    window.addEventListener(DELIVERY_ADDRESSES_UPDATED_EVENT, onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener(DELIVERY_ADDRESS_UPDATED_EVENT, onSync);
      window.removeEventListener(DELIVERY_ADDRESSES_UPDATED_EVENT, onSync);
    };
  }, [refresh]);

  const setAddress = useCallback((next: DeliveryAddressDraft) => {
    saveDeliveryAddressDraft(next);
    setAddressState(next);
  }, []);

  const updateAddress = useCallback((patch: Partial<DeliveryAddressDraft>) => {
    const next = patchDeliveryAddressDraft(patch);
    setAddressState(next);
  }, []);

  const openAddressEditor = useCallback(() => setAddressModalOpen(true), []);

  const openAddressPicker = useCallback(() => setAddressPickerOpen(true), []);

  const openAddressEditorForSavedId = useCallback((id: string) => {
    const row = loadSavedAddresses().find((a) => a.id === id);
    if (!row) return;
    saveDeliveryAddressDraft({
      line1: row.line1.trim(),
      city: row.city.trim(),
      postalCode: normalizeDeliveryPostalCode(row.postalCode),
    });
    setEditingSavedAddressId(id);
    setAddressPickerOpen(false);
    setAddressModalOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      address,
      setAddress,
      updateAddress,
      openAddressEditor,
      openAddressPicker,
    }),
    [address, setAddress, updateAddress, openAddressEditor, openAddressPicker],
  );

  return (
    <DeliveryAddressContext.Provider value={value}>
      {children}
      <AddressSavedToast />
      <DeliveryAddressPickerPanel
        open={addressPickerOpen}
        onClose={() => setAddressPickerOpen(false)}
        onAddNew={() => {
          setEditingSavedAddressId(null);
          setAddressPickerOpen(false);
          setAddressModalOpen(true);
        }}
        onEditAddress={openAddressEditorForSavedId}
        currentAddress={address}
      />
      <OrderMethodModal
        open={addressModalOpen}
        addressOnly
        defaultMethod="DELIVERY"
        editingSavedAddressId={editingSavedAddressId}
        onClose={() => {
          setEditingSavedAddressId(null);
          setAddressModalOpen(false);
        }}
        onContinue={() => {
          const reopenPickerAfterSave = editingSavedAddressId === null;
          setEditingSavedAddressId(null);
          setAddressModalOpen(false);
          refresh();
          if (reopenPickerAfterSave) {
            setAddressPickerOpen(true);
          }
        }}
      />
    </DeliveryAddressContext.Provider>
  );
}
