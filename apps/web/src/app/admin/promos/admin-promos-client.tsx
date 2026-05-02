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

type FirstOrderDeal = {
  couponCode: string;
  enabled: boolean;
  freeDelivery: boolean;
  percentOff: number | null;
  fixedAmountCents: number | null;
};

const emptyFirstOrderDeal: FirstOrderDeal = {
  couponCode: "MYFIRSTORDER",
  enabled: false,
  freeDelivery: false,
  percentOff: null,
  fixedAmountCents: null,
};

function normalizeFirstOrderDeal(
  deal: Partial<FirstOrderDeal> | null | undefined,
): FirstOrderDeal {
  return {
    couponCode: deal?.couponCode?.trim() || emptyFirstOrderDeal.couponCode,
    enabled: Boolean(deal?.enabled),
    freeDelivery: Boolean(deal?.freeDelivery),
    percentOff:
      typeof deal?.percentOff === "number" ? deal.percentOff : null,
    fixedAmountCents:
      typeof deal?.fixedAmountCents === "number"
        ? deal.fixedAmountCents
        : null,
  };
}

export function AdminPromosClient() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [firstOrderDeal, setFirstOrderDeal] =
    useState<FirstOrderDeal>(emptyFirstOrderDeal);
  const [loading, setLoading] = useState(true);
  const [savingDeal, setSavingDeal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealMessage, setDealMessage] = useState<string | null>(null);

  const [editPromoId, setEditPromoId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadPromos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [promoData, dealData] = await Promise.all([
        adminFetch<PromoCode[]>(ADMIN_PROMOS_API_BASE),
        adminFetch<FirstOrderDeal>(`${ADMIN_PROMOS_API_BASE}/first-order-deal`),
      ]);
      setPromos(promoData);
      setFirstOrderDeal(normalizeFirstOrderDeal(dealData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promo codes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromos();
  }, [loadPromos]);

  const saveFirstOrderDeal = async () => {
    try {
      setSavingDeal(true);
      setError(null);
      setDealMessage(null);
      const saved = await adminFetch<FirstOrderDeal>(
        `${ADMIN_PROMOS_API_BASE}/first-order-deal`,
        {
          method: "PUT",
          body: JSON.stringify(firstOrderDeal),
        },
      );
      setFirstOrderDeal(normalizeFirstOrderDeal(saved));
      setDealMessage("First-order deal saved");
      window.setTimeout(() => setDealMessage(null), 2500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save first-order deal",
      );
    } finally {
      setSavingDeal(false);
    }
  };

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
          <div className={styles.formSection}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                alignItems: "flex-start",
              }}
            >
              <div>
                <h3>First-order deal</h3>
                <p className="surface-muted" style={{ margin: "0.55rem 0 0" }}>
                  Automatically applies to signed-in customers with zero non-cancelled orders.
                </p>
              </div>
              <label className={styles.checkbox} style={{ marginTop: "0.15rem" }}>
                <input
                  type="checkbox"
                  checked={firstOrderDeal.enabled}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enable deal
              </label>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="first-order-coupon-code">Coupon code</label>
                <input
                  id="first-order-coupon-code"
                  className={styles.formInput}
                  type="text"
                  value={firstOrderDeal.couponCode}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      couponCode: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={firstOrderDeal.freeDelivery}
                  disabled={!firstOrderDeal.enabled}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      freeDelivery: event.target.checked,
                    }))
                  }
                />
                Free delivery
              </label>
            </div>

            <div className={styles.formRow}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={(firstOrderDeal.percentOff ?? 0) > 0}
                  disabled={!firstOrderDeal.enabled}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      percentOff: event.target.checked ? deal.percentOff ?? 10 : null,
                    }))
                  }
                />
                Percent off
              </label>
              <div className={styles.formGroup}>
                <label htmlFor="first-order-percent">Percent</label>
                <input
                  id="first-order-percent"
                  className={styles.formInput}
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  disabled={!firstOrderDeal.enabled || !(firstOrderDeal.percentOff ?? 0)}
                  value={firstOrderDeal.percentOff ?? ""}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      percentOff: event.target.value
                        ? Number(event.target.value)
                        : null,
                    }))
                  }
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={(firstOrderDeal.fixedAmountCents ?? 0) > 0}
                  disabled={!firstOrderDeal.enabled}
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      fixedAmountCents: event.target.checked
                        ? deal.fixedAmountCents ?? 500
                        : null,
                    }))
                  }
                />
                Dollar amount off
              </label>
              <div className={styles.formGroup}>
                <label htmlFor="first-order-fixed">Amount</label>
                <input
                  id="first-order-fixed"
                  className={styles.formInput}
                  type="number"
                  min="0.01"
                  step="0.01"
                  disabled={!firstOrderDeal.enabled || !(firstOrderDeal.fixedAmountCents ?? 0)}
                  value={
                    firstOrderDeal.fixedAmountCents
                      ? (firstOrderDeal.fixedAmountCents / 100).toFixed(2)
                      : ""
                  }
                  onChange={(event) =>
                    setFirstOrderDeal((deal) => ({
                      ...deal,
                      fixedAmountCents: event.target.value
                        ? Math.round(Number(event.target.value) * 100)
                        : null,
                    }))
                  }
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button
                type="button"
                className={styles.leadButtonPrimary}
                disabled={savingDeal}
                onClick={saveFirstOrderDeal}
              >
                {savingDeal ? "Saving..." : "Save First-Order Deal"}
              </button>
              {dealMessage && (
                <span className="surface-muted" role="status">
                  {dealMessage}
                </span>
              )}
            </div>
          </div>
        </section>

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
