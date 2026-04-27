"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../admin-api";
import { PromoModal } from "./promo-modal";
import styles from "../menu/admin-menu.module.css";

const ADMIN_PROMOS_API_BASE = "/api/v1/admin/promos";

export type PromoCode = {
  id: string;
  code: string;
  name: string;
  discountType: "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";
  discountValue: number;
  minSubtotalCents: number;
  startsAt: string | null;
  endsAt: string | null;
  isOneTimePerCustomer: boolean;
  isActive: boolean;
  bxgyRule?: any;
  productTargets: { menuItemId: string }[];
  categoryTargets: { menuCategoryId: string }[];
  redemptions?: { id: string }[];
};

export function AdminPromosClient() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editPromoId, setEditPromoId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadPromos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminFetch<PromoCode[]>(ADMIN_PROMOS_API_BASE);
      setPromos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promo codes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromos();
  }, [loadPromos]);

  return (
    <>
      <section className="surface-card admin-section-lead">
        <div className="admin-section-lead__row">
          <div>
            <p className="surface-eyebrow">Admin Menu</p>
            <h1>Promo codes</h1>
            <p className="surface-muted">
              Manage discount codes, free delivery offers, and promotional rules.
            </p>
          </div>

          <div className="admin-section-lead__actions">
            <button
              type="button"
              className={styles.leadButtonPrimary}
              onClick={() => {
                setEditPromoId(null);
                setModalOpen(true);
              }}
            >
              Add Promo Code
            </button>
          </div>
        </div>
      </section>

      <div className={styles.container}>
        <section className={`surface-card ${styles.content}`} style={{ gridColumn: "1 / -1" }}>
          {error && <div className={styles.error}>{error}</div>}

          {loading ? (
            <div className={styles.loader}>Loading promos...</div>
          ) : promos.length === 0 ? (
            <div className={styles.emptyGrid}>
              No promo codes found. Click "+ Add Promo Code" to create one.
            </div>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Usage</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((promo) => (
                    <tr key={promo.id}>
                      <td style={{ fontWeight: 600 }}>{promo.code}</td>
                      <td>{promo.name}</td>
                      <td>
                        {promo.discountType === "PERCENT" && `${promo.discountValue}% Off`}
                        {promo.discountType === "FIXED_AMOUNT" && `$${(promo.discountValue / 100).toFixed(2)} Off`}
                        {promo.discountType === "FREE_DELIVERY" && `Free Delivery`}
                        {promo.discountType === "BXGY" && `Buy X Get Y`}
                      </td>
                      <td>
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            borderRadius: "1rem",
                            fontSize: "0.8rem",
                            backgroundColor: promo.isActive ? "rgba(0,255,0,0.1)" : "rgba(255,0,0,0.1)",
                            color: promo.isActive ? "green" : "red",
                          }}
                        >
                          {promo.isActive ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td>{promo.redemptions?.length || 0} times</td>
                      <td>
                        <button
                          type="button"
                          className={styles.leadButtonSecondary}
                          onClick={() => {
                            setEditPromoId(promo.id);
                            setModalOpen(true);
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {modalOpen && (
          <PromoModal
            promoId={editPromoId}
            onClose={() => setModalOpen(false)}
            onSaved={() => {
              setModalOpen(false);
              loadPromos();
            }}
          />
        )}
      </div>
    </>
  );
}
