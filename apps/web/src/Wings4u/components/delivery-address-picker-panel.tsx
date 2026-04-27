"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { MdOutlineDelete, MdOutlineEdit } from "react-icons/md";
import {
  DELIVERY_ADDRESSES_UPDATED_EVENT,
  deliveryAddressDedupeKey,
  loadSavedAddresses,
  normalizeDeliveryPostalCode,
  removeSavedAddressById,
  saveDeliveryAddressDraft,
  type DeliveryAddressDraft,
  type SavedDeliveryAddress,
} from "@/lib/delivery-address";

function isSelectedRow(
  row: SavedDeliveryAddress,
  current: DeliveryAddressDraft | null,
): boolean {
  if (!current) return false;
  return deliveryAddressDedupeKey(row) === deliveryAddressDedupeKey(current);
}

export function DeliveryAddressPickerPanel({
  open,
  onClose,
  onAddNew,
  onEditAddress,
  currentAddress,
}: {
  open: boolean;
  onClose: () => void;
  /** Close the picker first, then open the shared address editor. */
  onAddNew: () => void;
  /** Load this row into the editor and replace it on save. */
  onEditAddress: (id: string) => void;
  currentAddress: DeliveryAddressDraft | null;
}) {
  const [saved, setSaved] = useState<SavedDeliveryAddress[]>([]);

  useEffect(() => {
    if (!open) return;

    function sync() {
      setSaved(loadSavedAddresses());
    }

    sync();
    window.addEventListener(DELIVERY_ADDRESSES_UPDATED_EVENT, sync);
    return () => window.removeEventListener(DELIVERY_ADDRESSES_UPDATED_EVENT, sync);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function selectAddress(addr: SavedDeliveryAddress) {
    saveDeliveryAddressDraft({
      line1: addr.line1.trim(),
      city: addr.city.trim(),
      postalCode: normalizeDeliveryPostalCode(addr.postalCode),
    });
    onClose();
  }

  function handleDelete(id: string, event: MouseEvent) {
    event.stopPropagation();
    removeSavedAddressById(id);
  }

  function handleEdit(id: string, event: MouseEvent) {
    event.stopPropagation();
    onEditAddress(id);
  }

  return (
    <div className="wk-method-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="wk-method-card wk-address-picker-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wk-address-picker-title"
      >
        <div className="wk-method-card-inner">
          <button
            type="button"
            className="wk-method-close"
            onClick={onClose}
            aria-label="Close"
          >
            {"\u00D7"}
          </button>

          <div className="wk-method-header">
            <h2 className="wk-method-title" id="wk-address-picker-title">
              Choose address
            </h2>
          </div>

          {saved.length === 0 ? (
            <p className="wk-address-picker-empty">No saved addresses yet.</p>
          ) : (
            <div className="wk-address-picker-list">
              {saved.map((addr) => (
                <div
                  key={addr.id}
                  className="wk-address-picker-row"
                  data-selected={isSelectedRow(addr, currentAddress) ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="wk-address-picker-row-select"
                    onClick={() => selectAddress(addr)}
                  >
                    <div className="wk-address-picker-row-line1">{addr.line1}</div>
                    <div className="wk-address-picker-row-meta">
                      {`${addr.city}, ${addr.postalCode}`}
                    </div>
                  </button>
                  <div className="wk-address-picker-row-actions">
                    <button
                      type="button"
                      className="wk-address-picker-icon-btn"
                      onClick={(e) => handleEdit(addr.id, e)}
                      aria-label="Edit address"
                    >
                      <MdOutlineEdit aria-hidden size={20} />
                    </button>
                    <button
                      type="button"
                      className="wk-address-picker-icon-btn wk-address-picker-icon-btn--danger"
                      onClick={(e) => handleDelete(addr.id, e)}
                      aria-label="Delete address"
                    >
                      <MdOutlineDelete aria-hidden size={20} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="button" className="wk-address-picker-add" onClick={onAddNew}>
            Add new address
          </button>
        </div>
      </div>
    </div>
  );
}
