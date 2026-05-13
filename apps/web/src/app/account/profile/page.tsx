"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, apiJson } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { useSession } from "@/lib/session";
import type { ActivePromo } from "@/lib/types";
import { AccountSkeleton } from "@/components/account-skeleton";
import { AccountSurfaceLinks } from "../account-surface-links";

import styles from "./profile.module.css";

type WalletSummary = {
  customer_user_id: string;
  balance_cents: number;
  lifetime_credit_cents: number;
  updated_at: string;
};

type WalletLedgerEntry = {
  id: string;
  amount_cents: number;
  balance_after_cents: number;
  entry_type: string;
  reason_text: string;
  order_id?: string | null;
  refund_request_id?: string | null;
  created_at: string;
};

type WalletLedgerResponse = {
  entries: WalletLedgerEntry[];
  next_cursor: string | null;
};

/** Wings-rewards stamp card summary (`GET /rewards/me`). */
type WingsRewardsSummary = {
  customer_user_id: string;
  available_stamps: number;
  lifetime_stamps: number;
  lifetime_redemptions: number;
  stamps_per_reward: number;
  updated_at: string;
};

/** A single stamp earn/redeem event (`GET /rewards/me/ledger`). */
type WingsStampEntry = {
  id: string;
  entry_type: "EARNED" | "REDEEMED" | string;
  delta_stamps: number;
  balance_after_stamps: number;
  pounds_awarded: number | null;
  reason_text: string;
  order_id: string | null;
  order_number: string | null;
  order_fulfillment_type: string | null;
  created_at: string;
};

type WingsStampLedgerResponse = {
  entries: WingsStampEntry[];
  next_cursor: string | null;
};

function formatPoints(points: number) {
  return new Intl.NumberFormat("en-US").format(points);
}

function formatEntryType(entryType: string) {
  return entryType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBxgyPromoDetails(promo: ActivePromo): string | null {
  const rule = promo.bxgyRule;
  if (!rule) return null;

  const qualifying =
    rule.qualifyingLabel ||
    rule.qualifyingSize?.label ||
    (rule.qualifyingProductId || rule.qualifyingCategoryId
      ? "Selected items"
      : "Any item");
  const reward =
    rule.rewardLabel ||
    rule.rewardSize?.label ||
    (rule.rewardProductId || rule.rewardCategoryId
      ? "Selected items"
      : "Any item");

  return `Buy ${rule.requiredQty}: ${qualifying} -> Get ${rule.rewardQty}: ${reward}`;
}

function getInitials(name?: string | null) {
  if (!name) return "W4U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "W4U";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return ((first + last) || first).toUpperCase();
}

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

export default function ProfilePage() {
  const session = useSession();
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [wingsRewards, setWingsRewards] = useState<WingsRewardsSummary | null>(null);
  const [wingsLedger, setWingsLedger] = useState<WingsStampEntry[]>([]);
  const [promos, setPromos] = useState<ActivePromo[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [stampsModalOpen, setStampsModalOpen] = useState(false);
  const [hubTab, setHubTab] = useState<"rewards" | "coupons">("rewards");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);


  useEffect(() => {
    if (session.loaded && !session.authenticated) {
      router.push("/auth/login");
    }
  }, [session.loaded, session.authenticated, router]);

  useEffect(() => {
    if (!session.loaded || !session.authenticated) {
      return;
    }

    let cancelled = false;

    async function loadRewards() {
      setRewardsLoading(true);
      setRewardsError("");

      try {
        const [walletEnvelope, ledgerEnvelope, wingsEnvelope, wingsLedgerEnv, promosEnvelope] =
          await Promise.all([
            apiJson<WalletSummary>("/api/v1/wallets/me"),
            apiJson<WalletLedgerResponse>(
              "/api/v1/wallets/me/ledger?limit=6",
            ),
            apiJson<WingsRewardsSummary>("/api/v1/rewards/me"),
            apiJson<WingsStampLedgerResponse>(
              "/api/v1/rewards/me/ledger?limit=20",
            ),
            apiJson<ActivePromo[]>("/api/v1/promotions/active", {
              locationId: DEFAULT_LOCATION_ID,
            }).catch(() => ({ data: [] })),
          ]);

        if (cancelled) {
          return;
        }

        setWallet(walletEnvelope.data ?? null);
        setLedger(ledgerEnvelope.data?.entries ?? []);
        setWingsRewards(wingsEnvelope.data ?? null);
        setWingsLedger(wingsLedgerEnv.data?.entries ?? []);
        setPromos(promosEnvelope.data ?? []);
      } catch (e) {
        if (cancelled) {
          return;
        }

        setRewardsError(e instanceof Error ? e.message : "Unable to load rewards right now.");
      } finally {
        if (!cancelled) {
          setRewardsLoading(false);
        }
      }
    }

    void loadRewards();

    return () => {
      cancelled = true;
    };
  }, [session.loaded, session.authenticated]);

  // Wings-rewards progress: stamps earned toward the next free-wings unlock.
  // `stamps_per_reward` comes from the API (currently 8) so we don't duplicate
  // the constant on the client.
  const stampsPerReward = wingsRewards?.stamps_per_reward ?? 8;
  const availableStamps = Math.min(
    wingsRewards?.available_stamps ?? 0,
    stampsPerReward,
  );
  const lifetimeStamps = wingsRewards?.lifetime_stamps ?? 0;
  const lifetimeRedemptions = wingsRewards?.lifetime_redemptions ?? 0;
  const stampsProgressPercent = Math.min(
    100,
    (availableStamps / stampsPerReward) * 100,
  );
  const stampsToNextReward = Math.max(0, stampsPerReward - availableStamps);
  const rewardReady = availableStamps >= stampsPerReward;

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



  const initials = useMemo(() => getInitials(session.user?.displayName), [session.user?.displayName]);

  // Progress ring math: r=52, stroke=10 inside 120-vbox keeps a comfortable padding for the cap.
  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDash = (stampsProgressPercent / 100) * ringCircumference;

  // Lock body scroll while profile modals are open (same pattern
  // used by the checkout auth overlay and the order-method modal).
  useEffect(() => {
    if ((!stampsModalOpen && !logoutConfirmOpen) || typeof document === "undefined") return;
    const { body, documentElement } = document;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [logoutConfirmOpen, stampsModalOpen]);

  useEffect(() => {
    if (!stampsModalOpen && !logoutConfirmOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setStampsModalOpen(false);
        setLogoutConfirmOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [logoutConfirmOpen, stampsModalOpen]);

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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
              </div>

              
              <div className={styles.navLinksWrapper}>
                <nav className={styles.navLinks}>
                  <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                    <span>My Profile</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </div>
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
                  <Link href="/account/cards" className={styles.navLink}>
                    <span>My Cards</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <Link href="/account/support" className={styles.navLink}>
                    <span>Support</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setLogoutConfirmOpen(true)}
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
            {/* Wings-rewards stamp card — entire section is clickable to
                 reveal the full stamp history modal. */}
            <section
              className={`${styles.section} ${styles.wingsRewardsSection}`}
            >
              <header className={styles.sectionHeader}>
                <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHubTab("rewards"); }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: hubTab === "rewards" ? "#f97316" : "#9ca3af",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.15em",
                    }}
                  >
                    Rewards hub
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHubTab("coupons"); }}
                    className={styles.hubTabButton}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: hubTab === "coupons" ? "#f97316" : "#9ca3af",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.15em",
                    }}
                  >
                    <span>Coupons</span>
                    <span
                      className={styles.hubTabCount}
                      data-active={hubTab === "coupons"}
                    >
                      {promos.length}
                    </span>
                  </button>
                </div>
                
                <h2 className={styles.sectionTitle}>
                  {hubTab === "rewards" 
                    ? (rewardReady ? "Your free wings are ready" : "Free wings stamp card")
                    : "Available Coupons"
                  }
                </h2>
                <p className={styles.sectionDesc}>
                  {hubTab === "rewards"
                    ? (rewardReady
                        ? "You've collected all 8 stamps. Redeem at checkout for 1lb of wings, on us."
                        : `Earn 1 stamp for every pound of wings you order. Collect ${stampsPerReward} stamps to unlock 1lb of wings free.`)
                    : "Active promotions and special offers currently available for your account."
                  }
                </p>
              </header>

              {hubTab === "rewards" ? (
                <>
                  <div className={styles.rewardsGrid}>
                    <div className={styles.pointsCard}>
                      <span className={styles.pointsNum}>
                        {availableStamps}
                        <span className={styles.stampsDenominator}>
                          /{stampsPerReward}
                        </span>
                      </span>
                      <span className={styles.pointsLabel}>Stamps collected</span>
                      <span className={styles.pointsCredit}>
                        {rewardReady
                          ? "🎉 Ready to redeem"
                          : `${stampsToNextReward} more to go`}
                      </span>
                    </div>

                    <div
                      className={styles.progressRing}
                      role="img"
                      aria-label={`${availableStamps} of ${stampsPerReward} stamps collected`}
                    >
                      <svg viewBox="0 0 120 120">
                        <defs>
                          <linearGradient id="profile-ring-gradient-v2" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#f97316" />
                            <stop offset="100%" stopColor="#fb923c" />
                          </linearGradient>
                        </defs>
                        <circle cx="60" cy="60" r={ringRadius} className={styles.ringTrack} />
                        <circle
                          cx="60"
                          cy="60"
                          r={ringRadius}
                          className={styles.ringProgress}
                          strokeDasharray={`${ringDash} ${ringCircumference}`}
                        />
                      </svg>
                      <div className={styles.ringText}>
                        <strong style={{ fontSize: "1.75rem" }} aria-hidden>
                          {rewardReady ? "🎁" : "🍗"}
                        </strong>
                        <span>
                          {availableStamps}/{stampsPerReward}
                        </span>
                      </div>
                    </div>

                    <div className={`${styles.pointsCard} ${styles.pointsBlockSecondary}`}>
                      <span
                        className={styles.pointsNum}
                        style={{ fontSize: "2rem", color: "#6b7280" }}
                      >
                        {formatPoints(lifetimeRedemptions)}
                      </span>
                      <span className={styles.pointsLabel}>Free pounds unlocked</span>
                      <span className={styles.pointsCredit}>
                        {lifetimeStamps} stamps earned all-time
                      </span>
                    </div>
                  </div>

                  <div className={styles.stampRow} aria-hidden>
                    {Array.from({ length: stampsPerReward }).map((_, idx) => {
                      const filled = idx < availableStamps;
                      return (
                        <div
                          key={idx}
                          className={`${styles.stampSlot} ${
                            filled ? styles.stampSlotFilled : ""
                          }`}
                        >
                          {filled ? "🍗" : idx + 1}
                        </div>
                      );
                    })}
                  </div>

                  <button 
                    type="button"
                    className={styles.sectionTapHint}
                    onClick={() => setStampsModalOpen(true)}
                    style={{ 
                      background: "none", 
                      border: "none", 
                      width: "100%", 
                      textAlign: "right",
                      cursor: "pointer",
                      padding: "1rem 0 0 0"
                    }}
                  >
                    View history
                    <span aria-hidden>  →</span>
                  </button>
                </>
              ) : (
                <div style={{ marginTop: "1rem" }}>
                  {rewardsLoading ? (
                    <p className={styles.emptyState}>Loading coupons...</p>
                  ) : promos.length === 0 ? (
                    <div className={styles.stampEmptyState}>
                      <div className={styles.stampEmptyIcon} aria-hidden>🏷️</div>
                      <p className={styles.stampEmptyTitle}>No coupons yet</p>
                      <p className={styles.stampEmptyDesc}>Check back later for special offers and discounts.</p>
                    </div>
                  ) : (
                    <ul className={styles.stampHistoryList}>
                      {promos.map((promo) => {
                        const bxgyDetails =
                          promo.discountType === "BXGY"
                            ? formatBxgyPromoDetails(promo)
                            : null;
                        const redeemType =
                          promo.eligibleFulfillmentType === "PICKUP"
                            ? "Pickup only"
                            : promo.eligibleFulfillmentType === "DELIVERY"
                              ? "Delivery only"
                              : null;

                        return (
                        <li key={promo.id} className={styles.stampHistoryItem}>
                          <div className={`${styles.stampHistoryIcon} ${styles.stampHistoryIconEarn}`} aria-hidden>
                            🏷️
                          </div>
                          <div className={styles.stampHistoryBody}>
                            <strong className={styles.stampHistoryBodyTitle} style={{ fontSize: "1.1rem" }}>{promo.code}</strong>
                            <span className={styles.stampHistoryReason}>{promo.name}</span>
                            {promo.minSubtotalCents > 0 && (
                              <span className={styles.stampHistoryReason} style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.2rem" }}>
                                Min order: ${(promo.minSubtotalCents / 100).toFixed(2)}
                              </span>
                            )}
                            {promo.endsAt && (
                              <span className={styles.stampHistoryReason} style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.2rem" }}>
                                Ends: {new Date(promo.endsAt).toLocaleDateString()}
                              </span>
                            )}
                            {bxgyDetails ? (
                              <span className={styles.stampHistoryReason} style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.2rem" }}>
                                {bxgyDetails}
                              </span>
                            ) : null}
                            {redeemType ? (
                              <span className={styles.stampHistoryReason} style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.2rem" }}>
                                {redeemType}
                              </span>
                            ) : null}
                          </div>
                          <div className={styles.stampHistoryDelta}>
                            <strong className={styles.stampHistoryDeltaEarn} style={{ fontSize: "1.15rem" }}>
                              {promo.benefitSummary ||
                                (promo.discountType === "PERCENT" && `${promo.discountValue}% OFF`)}
                              {!promo.benefitSummary &&
                                promo.discountType === "FIXED_AMOUNT" &&
                                `$${(promo.discountValue / 100).toFixed(2)} OFF`}
                              {!promo.benefitSummary &&
                                promo.discountType === "FREE_DELIVERY" &&
                                `FREE DELIVERY`}
                              {!promo.benefitSummary &&
                                promo.discountType === "BXGY" &&
                                (bxgyDetails ? "BXGY" : `BOGO`)}
                            </strong>
                            <button
                              type="button"
                              className={styles.copyBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                toast.success('Coupon Copied In ClipBoard');
                                navigator.clipboard.writeText(promo.code);
                              }}
                              title="Copy code"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </button>
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>

          </div>
        </div>
      </main>

      {stampsModalOpen ? (
        <div
          className={styles.stampModalOverlay}
          onMouseDown={() => setStampsModalOpen(false)}
          role="presentation"
        >
          <div
            className={styles.stampModalCard}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stamps-modal-title"
          >
            <header className={styles.stampModalHeader}>
              <div>
                <span className={styles.eyebrow}>Rewards hub</span>
                <h2 id="stamps-modal-title" className={styles.stampModalTitle}>
                  Your wings stamp card
                </h2>
              </div>
              <button
                type="button"
                className={styles.stampModalClose}
                onClick={() => setStampsModalOpen(false)}
                aria-label="Close stamp history"
              >
                ✕
              </button>
            </header>

            <div className={styles.stampModalSummary}>
              <div className={styles.stampModalStat}>
                <span className={styles.stampModalStatValue}>
                  {availableStamps}/{stampsPerReward}
                </span>
                <span className={styles.stampModalStatLabel}>
                  Stamps collected
                </span>
              </div>
              <div className={styles.stampModalStat}>
                <span className={styles.stampModalStatValue}>
                  {lifetimeStamps}
                </span>
                <span className={styles.stampModalStatLabel}>
                  Lifetime stamps
                </span>
              </div>
              <div className={styles.stampModalStat}>
                <span className={styles.stampModalStatValue}>
                  {lifetimeRedemptions}
                </span>
                <span className={styles.stampModalStatLabel}>
                  Free pounds redeemed
                </span>
              </div>
            </div>

            <div className={styles.stampRow} aria-hidden>
              {Array.from({ length: stampsPerReward }).map((_, idx) => {
                const filled = idx < availableStamps;
                return (
                  <div
                    key={idx}
                    className={`${styles.stampSlot} ${
                      filled ? styles.stampSlotFilled : ""
                    }`}
                  >
                    {filled ? "🍗" : idx + 1}
                  </div>
                );
              })}
            </div>


            <section className={styles.stampHistorySection}>
              <h3 className={styles.stampHistoryTitle}>Stamp history</h3>
              {rewardsLoading ? (
                <p className={styles.emptyState}>Loading history...</p>
              ) : wingsLedger.length === 0 ? (
                <div className={styles.stampEmptyState}>
                  <div className={styles.stampEmptyIcon} aria-hidden>
                    🍗
                  </div>
                  <p className={styles.stampEmptyTitle}>No stamps yet</p>
                  <p className={styles.stampEmptyDesc}>
                    Order a pound of wings on pickup or delivery — your first
                    stamp lands here the moment the order wraps up.
                  </p>
                </div>
              ) : (
                <ul className={styles.stampHistoryList}>
                  {wingsLedger.map((entry) => {
                    const isEarn = entry.entry_type === "EARNED";
                    const icon = isEarn ? "🍗" : "🎁";
                    const accent = isEarn
                      ? styles.stampHistoryIconEarn
                      : styles.stampHistoryIconRedeem;
                    const orderLabel = entry.order_number
                      ? `Order #${entry.order_number}`
                      : null;
                    return (
                      <li key={entry.id} className={styles.stampHistoryItem}>
                        <div
                          className={`${styles.stampHistoryIcon} ${accent}`}
                          aria-hidden
                        >
                          {icon}
                        </div>
                        <div className={styles.stampHistoryBody}>
                          <strong className={styles.stampHistoryBodyTitle}>
                            {isEarn
                              ? `Earned ${Math.abs(entry.delta_stamps)} stamp${
                                  Math.abs(entry.delta_stamps) === 1 ? "" : "s"
                                }`
                              : "Redeemed 1lb of wings free"}
                          </strong>
                          <span className={styles.stampHistoryMeta}>
                            {new Date(entry.created_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                            {orderLabel ? `   ${orderLabel}` : ""}
                          </span>
                          <span className={styles.stampHistoryReason}>
                            {entry.reason_text}
                          </span>
                        </div>
                        <div className={styles.stampHistoryDelta}>
                          <strong
                            className={
                              isEarn
                                ? styles.stampHistoryDeltaEarn
                                : styles.stampHistoryDeltaRedeem
                            }
                          >
                            {isEarn ? "+" : ""}
                            {entry.delta_stamps}
                          </strong>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {logoutConfirmOpen ? (
        <div
          className={styles.logoutModalOverlay}
          onMouseDown={() => setLogoutConfirmOpen(false)}
          role="presentation"
        >
          <div
            className={styles.logoutModalCard}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
            aria-describedby="logout-modal-desc"
          >
            <span className={styles.eyebrow}>Account</span>
            <h2 id="logout-modal-title" className={styles.logoutModalTitle}>
              Log out of Wings 4 U?
            </h2>
            <p id="logout-modal-desc" className={styles.logoutModalText}>
              You will be signed out.
            </p>
            <div className={styles.logoutModalActions}>
              <button
                type="button"
                className={styles.logoutCancelBtn}
                onClick={() => setLogoutConfirmOpen(false)}
              >
                Stay signed in
              </button>
              <button
                type="button"
                className="fire-btn"
                style={{
                  fontSize: '14px',
                  padding: '10px 28px',
                  minWidth: '140px',
                  marginLeft: '0.5rem'
                }}
                onClick={handleLogout}
              >
                <span className="btn-label">Yes, log out</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
