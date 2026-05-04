"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { useCart } from "@/lib/cart";
import {
  getRemovedIngredientsForApi,
  getCartItemUnitPrice,
  getCustomerVisibleInstructions,
  splitCartDescLine,
} from "@/lib/cart-item-utils";
import { buildLineSummary, splitSummaryForDisplay } from "@/lib/cart-line-summary";
import { cents } from "@/lib/format";
import {
  getDeliveryUnavailableMessage,
  isMinimumDeliverySubtotalError,
} from "@/lib/delivery-restrictions";
import { getLunchScheduleConflict } from "@/lib/lunch-hours";
import type {
  ActivePromo,
  CartBuilderPayload,
  CartItem,
  CartQuoteResponse,
  MenuResponse,
} from "@/lib/types";
import { CartOrderSettings } from "./cart-order-settings";
import { styles } from "../styles";

function isBuilderLine(payload?: CartBuilderPayload): boolean {
  return (
    payload?.builder_type === "WINGS" ||
    payload?.builder_type === "WING_COMBO" ||
    payload?.builder_type === "ITEM_CUSTOMIZATION" ||
    payload?.builder_type === "LUNCH_SPECIAL"
  );
}

function formatBxgyDetails(promo: ActivePromo): {
  summary: string;
  scopeLine: string | null;
} {
  const rule = promo.bxgyRule;
  if (!rule) return { summary: "Buy X Get Y", scopeLine: null };

  const summary = `Buy ${rule.requiredQty} Get ${rule.rewardQty} ${
    rule.rewardRule === "FREE" ? "Free" : rule.rewardRule
  }`;
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

  return {
    summary,
    scopeLine: `Buy: ${qualifying} -> Reward: ${reward}`,
  };
}

function cartLinePlaceholder(item: CartItem): string {
  if (
    item.builder_payload?.builder_type === "WINGS" ||
    item.builder_payload?.builder_type === "WING_COMBO"
  ) {
    return "\uD83C\uDF57";
  }

  const trimmed = item.name.trim();
  if (!trimmed) return "W4U";

  const first = trimmed[0]?.toUpperCase();
  return first && /[A-Z0-9]/.test(first) ? first : "W4U";
}

/**
 * Phase 13: cart-edit handoff. The cart page drops the cart line key into
 * sessionStorage and routes back to the menu, where MenuPage reads it on
 * mount, finds the matching item, and reopens its builder pre-filled.
 */
export const CART_EDIT_STORAGE_KEY = "wings4u.cart-edit-key";

/**
 * SessionStorage key used to carry the "apply 1lb of wings free" reward
 * intent from the cart page into the checkout page. Kept in session (not
 * the CartContext) so it doesn't leak across browser tabs or survive a
 * checkout success. The backend is the authority — this is just a hint.
 */
export const WINGS_REWARD_STORAGE_KEY = "wings4u.apply-wings-reward";

export function CartPage() {
  const router = useRouter();
  const cart = useCart();
  const { setLocationTimezone, driverTipPercent, setDriverTipPercent } = cart;
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutValidating, setCheckoutValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [activePromos, setActivePromos] = useState<ActivePromo[]>([]);

  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState("");

  /**
   * Wings-rewards "1lb free" redemption. The user opts in via the Coupons
   * modal; the flag is sent to `/cart/quote` + `/checkout/place` so pricing
   * reflects the free-pound discount. If the user removes all wings from
   * the cart while the reward is applied, the server will silently drop
   * the discount and `quote.wings_reward.applied` comes back false — we
   * surface that as a banner so they can either add wings back or clear
   * the selection.
   */
  const [applyWingsReward, setApplyWingsReward] = useState(false);
  const [couponsModalOpen, setCouponsModalOpen] = useState(false);

  // Hydrate the reward intent from sessionStorage on mount so that if
  // the user navigates cart -> checkout -> back-to-cart their choice
  // sticks. Written back any time it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(WINGS_REWARD_STORAGE_KEY);
    if (raw === "1") setApplyWingsReward(true);
  }, []);

  useEffect(() => {
    if (applyWingsReward) {
      window.sessionStorage.setItem(WINGS_REWARD_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(WINGS_REWARD_STORAGE_KEY);
    }
  }, [applyWingsReward]);

  useEffect(() => {
    const rawPromo = window.sessionStorage.getItem("wings4u.promo-applied");
    if (rawPromo) {
      setPromoApplied(rawPromo);
      setPromoInput(rawPromo);
      setApplyWingsReward(false);
    }
  }, []);

  useEffect(() => {
    if (promoApplied) {
      window.sessionStorage.setItem("wings4u.promo-applied", promoApplied);
    } else {
      window.sessionStorage.removeItem("wings4u.promo-applied");
    }
  }, [promoApplied]);

  useEffect(() => {
    if (cart.items.length === 0) {
      setMenu(null);
      setMenuError(null);
      setMenuLoading(false);
      return;
    }

    let cancelled = false;
    async function loadMenu() {
      setMenuLoading(true);
      setMenuError(null);
      const query = new URLSearchParams({
        location_id: cart.locationId,
        fulfillment_type: cart.fulfillmentType,
      });
      if (cart.scheduledFor) {
        query.set("scheduled_for", cart.scheduledFor);
      }
      try {
        const [env, promosEnv] = await Promise.all([
          apiJson<MenuResponse>(`/api/v1/menu?${query.toString()}`, {
            locationId: cart.locationId,
          }),
          apiJson<ActivePromo[]>("/api/v1/promotions/active", {
            locationId: cart.locationId,
          }).catch(() => ({ data: [] })),
        ]);
        
        if (!cancelled) {
          if (!env.data) {
            setMenuError("Menu response missing data");
            setMenu(null);
          } else {
            setMenu(env.data);
            setLocationTimezone(env.data.location.timezone);
          }
          setActivePromos(promosEnv.data ?? []);
        }
      } catch (cause) {
        if (!cancelled) {
          setMenuError(cause instanceof Error ? cause.message : "Failed to load menu");
          setMenu(null);
        }
      } finally {
        if (!cancelled) {
          setMenuLoading(false);
        }
      }
    }
    void loadMenu();
    return () => {
      cancelled = true;
    };
  }, [
    cart.items.length,
    cart.locationId,
    cart.fulfillmentType,
    cart.scheduledFor,
    setLocationTimezone,
  ]);

  const lunchScheduleConflict = useMemo(
    () =>
      getLunchScheduleConflict({
        items: cart.items,
        scheduledFor: cart.scheduledFor,
        timezone: menu?.location.timezone ?? cart.locationTimezone,
      }),
    [cart.items, cart.locationTimezone, cart.scheduledFor, menu?.location.timezone],
  );
  const deliveryBlockedMessage =
    cart.fulfillmentType === "DELIVERY" &&
    (getDeliveryUnavailableMessage(menu) ??
      (quoteError?.includes("Delivery is currently unavailable") ||
      quoteError?.includes("Delivery is unavailable")
        ? quoteError
        : null));

  const fallbackSubtotal = useMemo(
    () =>
      cart.items.reduce(
        (sum, item) => sum + getCartItemUnitPrice(item) * item.quantity,
        0,
      ),
    [cart.items],
  );

  /** Block checkout until item subtotal meets location minimum for delivery (matches server cart quote). */
  const deliveryMinimumBlocked = useMemo(() => {
    if (cart.fulfillmentType !== "DELIVERY") return false;
    if (isMinimumDeliverySubtotalError(quoteError)) return true;
    const minCents = menu?.location.minimum_delivery_subtotal_cents ?? 0;
    if (minCents <= 0) return false;
    const itemSubtotal = quote?.item_subtotal_cents ?? fallbackSubtotal;
    return itemSubtotal < minCents;
  }, [
    cart.fulfillmentType,
    quoteError,
    menu?.location.minimum_delivery_subtotal_cents,
    quote?.item_subtotal_cents,
    fallbackSubtotal,
  ]);

  const subtotalForTip = quote?.item_subtotal_cents ?? fallbackSubtotal;
  const tipCents = useMemo(() => {
    if (driverTipPercent === "none") return 0;
    return Math.round((subtotalForTip * driverTipPercent) / 100);
  }, [driverTipPercent, subtotalForTip]);

  const totalCartItemUnits = useMemo(
    () => cart.items.reduce((sum, line) => sum + line.quantity, 0),
    [cart.items],
  );

  const fetchQuote = useCallback(async () => {
    if (cart.items.length === 0) {
      setQuote(null);
      return;
    }
    setLoading(true);
    setQuoteError(null);
    try {
      const env = await apiJson<CartQuoteResponse>("/api/v1/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: cart.locationId,
          fulfillment_type: cart.fulfillmentType,
          items: cart.items.map((item) => ({
            menu_item_id: item.menu_item_id,
            quantity: item.quantity,
            modifier_selections: item.modifier_selections.map((modifier) => ({
              modifier_option_id: modifier.modifier_option_id,
            })),
            removed_ingredients: getRemovedIngredientsForApi(item),
            special_instructions: item.special_instructions || undefined,
            builder_payload: item.builder_payload,
          })),
          scheduled_for: cart.scheduledFor ?? undefined,
          promo_code: promoApplied.trim() || undefined,
          driver_tip_cents: tipCents,
          apply_wings_reward:
            applyWingsReward && !promoApplied.trim() ? true : undefined,
        }),
        locationId: cart.locationId,
      });
      setQuote(env.data);
    } catch (cause) {
      setQuoteError(cause instanceof Error ? cause.message : "Quote failed");
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [
    cart.fulfillmentType,
    cart.items,
    cart.locationId,
    cart.scheduledFor,
    promoApplied,
    tipCents,
    applyWingsReward,
  ]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchQuote(), 300);
    return () => clearTimeout(debounceRef.current);
  }, [fetchQuote]);

  // Lock body scroll + wire Escape while the Coupons modal is open.
  useEffect(() => {
    if (!couponsModalOpen || typeof document === "undefined") return;
    const { body, documentElement } = document;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setCouponsModalOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [couponsModalOpen]);

  const wingsReward = quote?.wings_reward;
  const confirmedPromoCodes = new Set(
    (quote?.applied_promo_code ?? "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
  /**
   * Whether the "Get 1lb of wings free" reward card should be shown in the
   * Coupons modal. Shown when the customer has collected 8+ stamps, even
   * if they don't currently have wings in cart — in that case the card
   * renders with a friendly "Add 1lb of wings first" disabled state so
   * the customer knows the reward exists and what to do to redeem it.
   */
  const showWingsRewardCard = Boolean(
    wingsReward && wingsReward.available_stamps >= 8,
  );
  const wingsRewardBlockedReason: string | null = (() => {
    if (!applyWingsReward) return null;
    if (!quote) return null;
    if (quote.wings_reward.applied) return null;
    if (quote.wings_reward.not_eligible_reason === "NO_WINGS_IN_CART") {
      return "Add 1lb of wings to use this reward.";
    }
    if (quote.wings_reward.not_eligible_reason === "NOT_ENOUGH_STAMPS") {
      return "You no longer have 8 stamps — collect 8 pounds of wings to redeem.";
    }
    if (quote.wings_reward.not_eligible_reason === "NOT_SIGNED_IN") {
      return "Sign in to apply this reward.";
    }
    return null;
  })();

  const hydratingSurface = (
    <div style={styles.cartPageShell}>
      <div style={{ ...styles.menuPage, ...styles.cartMenuPageEmpty }}>
        <div style={styles.cartMenuSurfaceEmpty}>
          <div style={styles.cartMenuInner}>
            <div style={styles.cartEmptyYellowPanel}>
              <h1 style={styles.cartOrderTitle}>YOUR ORDER</h1>
              <div style={styles.cartEmptyPanelBody}>
                <h2 style={styles.cartEmptyTitle}>RESTORING YOUR CART…</h2>
                <p style={styles.cartEmptySub}>Loading your saved order from this browser session.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (cart.isCartHydrating && cart.items.length === 0) {
    return hydratingSurface;
  }

  const emptySurface = (
    <div style={styles.cartPageShell}>
      <div style={{ ...styles.menuPage, ...styles.cartMenuPageEmpty }}>
        <div style={styles.cartMenuSurfaceEmpty}>
          <div style={styles.cartMenuInner}>
            <div style={styles.cartEmptyYellowPanel}>
              <h1 style={styles.cartOrderTitle}>YOUR ORDER</h1>
              <div style={styles.cartEmptyPanelBody}>
                <h2 style={styles.cartEmptyTitle}>YOUR CART IS EMPTY</h2>
                <p style={styles.cartEmptySub}>Browse the menu and grab some wings.</p>
                <Link
                  href={`/order?fulfillment_type=${cart.fulfillmentType}`}
                  className="fire-btn"
                  style={{ marginTop: 20, textDecoration: "none" }}
                >
                  <span className="btn-label">
                    BACK TO MENU {"\u2192"}
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (cart.items.length === 0) {
    return emptySurface;
  }

  return (
    <div style={styles.cartPageShell}>
      <div style={styles.menuPage}>
      <div style={styles.cartMenuSurface}>
        <div style={styles.cartMenuInner}>
          {menuError && (
            <p style={{ ...styles.menuSub, color: "#8b2b2b", marginBottom: 12 }}>{menuError}</p>
          )}
          {menuLoading && !menu && (
            <p style={{ ...styles.menuSub, marginBottom: 12, color: "#5c432f" }}>Loading order settings…</p>
          )}

          <div style={styles.cartOrderTopRow}>
            <header style={styles.cartOrderHeaderBlock}>
              <h1 style={styles.cartOrderTitleLeft}>YOUR ORDER</h1>
              <p style={styles.cartItemCountLabel}>
                {totalCartItemUnits === 1
                  ? "1 item in your cart"
                  : `${totalCartItemUnits} items in your cart`}
              </p>
              <Link
                href={`/order?fulfillment_type=${cart.fulfillmentType}`}
                className="cart-back-to-menu-link"
              >
                <span className="cart-back-arrow">←</span> Back to the menu
              </Link>
            </header>
            <div
              className="wk-cart-order-settings-top"
              style={styles.cartOrderSettingsSlot}
            >
              <CartOrderSettings menu={menu} />
            </div>
          </div>
          <div style={styles.cartOrderAccentLineTrack} aria-hidden>
            <div style={styles.cartOrderAccentLine} />
          </div>

          <div style={styles.cartLayoutRow}>
            <div style={styles.cartItemsColumn}>
          {cart.items.map((item) => {
            const summaryLines = buildLineSummary(item);
            const { description } = splitSummaryForDisplay(summaryLines);
            const instructionsForDisplay = getCustomerVisibleInstructions(item);
            const lineTotal = getCartItemUnitPrice(item) * item.quantity;
            const canEdit = isBuilderLine(item.builder_payload);

            return (
              <div key={item.key} className="wk-cart-line-card" style={styles.cartItemLineCard}>
                <div className="wk-cart-line-card-row">
                  <div className="wk-cart-line-thumb" style={styles.cartItemThumbWrap}>
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        style={styles.cartItemThumbImage}
                      />
                    ) : (
                      <div
                        className="wk-cart-line-thumb-placeholder"
                        style={styles.cartItemThumbPlaceholder}
                        aria-hidden="true"
                      >
                        {cartLinePlaceholder(item)}
                      </div>
                    )}
                  </div>

                  <div className="wk-cart-line-card-body" style={styles.cartItemCardBody}>
                    <div style={styles.cartItemTitleRow}>
                      <h3 style={styles.cartItemNameLight}>{item.name}</h3>
                      <span style={styles.cartItemPriceTop}>{cents(lineTotal)}</span>
                    </div>

                    {description.map((line, lineIndex) => {
                      const parts = splitCartDescLine(line);
                      return (
                        <p key={lineIndex} style={styles.cartItemLineDesc}>
                          {parts ? (
                            <>
                              <span style={styles.cartItemLineDescLabel}>{parts.label}</span>
                              <span style={styles.cartItemLineDescValue}>{parts.value}</span>
                            </>
                          ) : (
                            <span style={styles.cartItemLineDescSingle}>{line}</span>
                          )}
                        </p>
                      );
                    })}

                    {instructionsForDisplay ? (
                      <div style={styles.cartItemNoteRow}>
                        <span style={styles.cartItemNoteLabel}>Special instructions: </span>
                        <span style={styles.cartItemNoteValue}>
                          &ldquo;{instructionsForDisplay}&rdquo;
                        </span>
                      </div>
                    ) : null}

                    <div className="wk-cart-line-footer" style={styles.cartItemFooterRow}>
                      <div className="cart-item-qty-wrap" style={styles.cartItemQtyGroup}>
                        <button
                          type="button"
                          className="cart-item-qty-btn"
                          onClick={() => cart.updateQuantity(item.key, item.quantity - 1)}
                          aria-label={`Decrease ${item.name}`}
                        >
                          −
                        </button>
                        <span className="cart-item-qty-value" style={styles.cartItemQtyValue}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          className="cart-item-qty-btn"
                          onClick={() => cart.updateQuantity(item.key, item.quantity + 1)}
                          aria-label={`Increase ${item.name}`}
                        >
                          +
                        </button>
                      </div>
                      <div className="wk-cart-line-actions" style={styles.cartItemActionRow}>
                        {canEdit && (
                          <button
                            type="button"
                            className="cart-line-btn-edit"
                            style={styles.cartItemBtnEdit}
                            onClick={() => {
                              if (typeof window !== "undefined") {
                                window.sessionStorage.setItem(CART_EDIT_STORAGE_KEY, item.key);
                              }
                              router.push(`/order?fulfillment_type=${cart.fulfillmentType}`);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="cart-line-btn-remove"
                          style={styles.cartItemBtnRemove}
                          onClick={() => cart.removeItem(item.key)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
            </div>

            <div className="wk-cart-right-column" style={styles.cartRightColumn}>
              <aside aria-label="Order summary">
              <div style={styles.cartOrderSummaryCard}>
                <h2 style={styles.cartOrderSummaryTitle}>Order Summary</h2>

                {/* See Coupons — opens the Coupons modal where available
                    rewards (e.g. "Get 1lb of wings free") live. We keep
                    this button visible even when no coupons are live so
                    users learn the entry point; the modal itself shows
                    an empty state if there's nothing to redeem. */}
                <button
                  type="button"
                  className="cart-see-coupons-btn"
                  style={styles.cartSeeCouponsBtn}
                  onClick={() => setCouponsModalOpen(true)}
                >
                  <span style={styles.cartSeeCouponsIcon} aria-hidden>🎁</span>
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {applyWingsReward && wingsReward?.applied
                      ? "1lb of wings free · Applied"
                      : "See coupons & rewards"}
                  </span>
                  <span aria-hidden>→</span>
                </button>

                {wingsRewardBlockedReason ? (
                  <p style={styles.cartRewardBlockedNote}>
                    {wingsRewardBlockedReason}
                  </p>
                ) : null}

                <div style={styles.cartPromoRow}>
                  <input
                    type="text"
                    placeholder="Promo code"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    style={styles.cartPromoInput}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="cart-promo-apply-btn"
                    style={styles.cartPromoApplyBtn}
                    onClick={() => {
                      const trimmed = promoInput.trim();
                      if (!trimmed) return;
                      setApplyWingsReward(false);
                      setPromoApplied(trimmed);
                    }}
                  >
                    Apply
                  </button>
                </div>

                <p style={styles.cartTipLabel}>
                  {cart.fulfillmentType === "DELIVERY" ? "Add a tip for your driver" : "Add a tip"}
                </p>
                <div style={styles.cartTipSegmentRow}>
                  {(
                    [
                      { id: "none" as const, label: "None" },
                      { id: 10 as const, label: "10%" },
                      { id: 15 as const, label: "15%" },
                      { id: 20 as const, label: "20%" },
                    ] as const
                  ).map((seg) => {
                    const active = driverTipPercent === seg.id;
                    return (
                      <button
                        key={String(seg.id)}
                        type="button"
                        className={`cart-tip-seg-btn${active ? " cart-tip-seg-btn--active" : ""}`}
                        onClick={() => setDriverTipPercent(seg.id)}
                      >
                        <span className="cart-tip-seg-btn__label">{seg.label}</span>
                      </button>
                    );
                  })}
                </div>

                <hr style={styles.cartOrderSummaryDivider} />

                <div style={styles.cartSummaryBox}>
                  <div style={{ ...styles.cartSummaryRow, marginTop: 0 }}>
                    <span>{quote ? "Subtotal" : "Items subtotal"}</span>
                    <span style={styles.cartSummaryAmount}>
                      {cents(quote?.item_subtotal_cents ?? fallbackSubtotal)}
                    </span>
                  </div>
                  {quote?.wings_reward.applied &&
                  quote.wings_reward.discount_cents > 0 ? (
                    <div style={styles.cartSummaryRow}>
                      <span>Wings reward (1lb free)</span>
                      <span
                        style={{
                          ...styles.cartSummaryAmount,
                          color: "#34d399",
                        }}
                      >
                        −{cents(quote.wings_reward.discount_cents)}
                      </span>
                    </div>
                  ) : null}
                  {quote && cart.fulfillmentType === "DELIVERY" && (
                    <div style={styles.cartSummaryRow}>
                      <span>Delivery fee</span>
                      <span style={styles.cartSummaryAmount}>
                        {quote.delivery_fee_waived && quote.delivery_fee_stated_cents > 0 ? (
                          <>
                            <span
                              style={{
                                textDecoration: "line-through",
                                opacity: 0.65,
                                marginRight: 6,
                              }}
                            >
                              {cents(quote.delivery_fee_stated_cents)}
                            </span>
                            Free
                          </>
                        ) : (
                          cents(quote.delivery_fee_cents)
                        )}
                      </span>
                    </div>
                  )}
                  {quote?.promo_discount_cents && quote.promo_discount_cents > 0 ? (
                    <div style={styles.cartSummaryRow}>
                      <span>Promo code ({quote.applied_promo_code})</span>
                      <span
                        style={{
                          ...styles.cartSummaryAmount,
                          color: "#34d399",
                        }}
                      >
                        −{cents(quote.promo_discount_cents)}
                      </span>
                    </div>
                  ) : null}
                  {quote && quote.driver_tip_cents > 0 && (
                    <div style={styles.cartSummaryRow}>
                      <span>Tip</span>
                      <span style={styles.cartSummaryAmount}>
                        {cents(quote.driver_tip_cents)}
                      </span>
                    </div>
                  )}
                  {quote && (
                    <div style={styles.cartSummaryRow}>
                      <span>Tax (13%)</span>
                      <span style={styles.cartSummaryAmount}>{cents(quote.tax_cents)}</span>
                    </div>
                  )}
                  <div
                    style={{
                      ...styles.cartSummaryTotal,
                      marginTop: 12,
                      alignItems: "center",
                    }}
                  >
                    <span style={styles.cartOrderSummaryTotalLabel}>
                      {quote ? "TOTAL" : "EST. SUBTOTAL"}
                    </span>
                    <span style={styles.cartOrderSummaryTotalValue}>
                      {cents(quote?.final_payable_cents ?? fallbackSubtotal)}
                    </span>
                  </div>
                  {!quote && !loading && (
                    <p style={{ ...styles.cartItemDescLine, marginTop: 4, fontSize: 12 }}>
                      Tax and fees calculated at checkout
                    </p>
                  )}
                  {loading && !quote && (
                    <p style={{ ...styles.cartItemDescLine, marginTop: 4 }}>Updating totals…</p>
                  )}
                  {lunchScheduleConflict ? (
                    <p style={{ ...styles.cartLineRemoved, marginTop: 4 }}>
                      {lunchScheduleConflict.message}
                    </p>
                  ) : null}
                  {deliveryBlockedMessage ? (
                    <p style={{ ...styles.cartLineRemoved, marginTop: 4 }}>
                      {deliveryBlockedMessage}
                    </p>
                  ) : null}
                  {quoteError &&
                    quoteError !== lunchScheduleConflict?.message &&
                    quoteError !== deliveryBlockedMessage && (
                    <p style={{ ...styles.cartLineRemoved, marginTop: 4 }}>{quoteError}</p>
                  )}
                  {deliveryMinimumBlocked &&
                    !isMinimumDeliverySubtotalError(quoteError) &&
                    menu &&
                    (menu.location.minimum_delivery_subtotal_cents ?? 0) > 0 && (
                      <p style={{ ...styles.cartLineRemoved, marginTop: 4 }}>
                        Minimum order for delivery is{" "}
                        {cents(menu.location.minimum_delivery_subtotal_cents)}. Add items to your
                        cart to check out.
                      </p>
                    )}
                </div>

                <button
                  type="button"
                  className="cart-checkout-fire-btn"
                  onClick={async () => {
                    if (lunchScheduleConflict || deliveryBlockedMessage || deliveryMinimumBlocked)
                      return;

                    setCheckoutValidating(true);
                    setQuoteError(null);
                    try {
                      const env = await apiJson<CartQuoteResponse>("/api/v1/cart/quote", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          location_id: cart.locationId,
                          fulfillment_type: cart.fulfillmentType,
                          items: cart.items.map((item) => ({
                            menu_item_id: item.menu_item_id,
                            quantity: item.quantity,
                            modifier_selections: item.modifier_selections.map((modifier) => ({
                              modifier_option_id: modifier.modifier_option_id,
                            })),
                            removed_ingredients: getRemovedIngredientsForApi(item),
                            special_instructions: item.special_instructions || undefined,
                            builder_payload: item.builder_payload,
                          })),
                          scheduled_for: cart.scheduledFor ?? undefined,
                          promo_code: promoApplied.trim() || undefined,
                          driver_tip_cents: tipCents,
                          apply_wings_reward:
                            applyWingsReward && !promoApplied.trim() ? true : undefined,
                        }),
                        locationId: cart.locationId,
                      });
                      setQuote(env.data);
                      router.push("/checkout");
                    } catch (cause) {
                      setQuoteError(cause instanceof Error ? cause.message : "Failed to validate cart");
                    } finally {
                      setCheckoutValidating(false);
                    }
                  }}
                  disabled={Boolean(
                    lunchScheduleConflict ||
                      deliveryBlockedMessage ||
                      deliveryMinimumBlocked ||
                      checkoutValidating,
                  )}
                >
                  <span className="btn-label">{checkoutValidating ? "VALIDATING..." : "CHECKOUT \u2192"}</span>
                </button>
              </div>
            </aside>
            </div>
          </div>
        </div>
      </div>
      </div>

      {couponsModalOpen ? (
        <div
          style={styles.couponsModalOverlay}
          onMouseDown={() => setCouponsModalOpen(false)}
          role="presentation"
        >
          <div
            style={styles.couponsModalCard}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="coupons-modal-title"
          >
            <header style={styles.couponsModalHeader}>
              <p style={styles.couponsModalEyebrow}>Coupons</p>
              <div style={styles.couponsModalTitleRow}>
                <div style={styles.couponsModalTitleBlock}>
                  <h2 id="coupons-modal-title" style={styles.couponsModalTitle}>
                    Available Coupons
                  </h2>
                  <p style={styles.couponsModalSubtitle}>
                    Active promotions and special offers currently available for your account.
                  </p>
                </div>
                <button
                  type="button"
                  style={styles.couponsModalClose}
                  onClick={() => setCouponsModalOpen(false)}
                  aria-label="Close coupons"
                >
                  ✕
                </button>
              </div>
            </header>

            {showWingsRewardCard ? (
              <button
                type="button"
                disabled={applyWingsReward}
                onClick={() => {
                  setApplyWingsReward(true);
                  setPromoInput("");
                  setPromoApplied("");
                  setCouponsModalOpen(false);
                }}
                style={{
                  ...styles.couponCard,
                  ...(applyWingsReward ? styles.couponCardApplied : null),
                }}
              >
                <div style={styles.couponCardIcon} aria-hidden>
                  🍗
                </div>
                <div style={styles.couponCardBody}>
                  <strong style={styles.couponCardTitle}>
                    Get 1lb of wings free
                  </strong>
                  <span style={styles.couponCardSubtitle}>From My Rewards</span>
                  <span style={styles.couponCardMeta}>
                    {wingsReward && wingsReward.pounds_in_cart >= 1
                      ? "Ready to redeem — applies to the cheapest pound in your cart."
                      : "Add 1lb of wings to your cart to redeem."}
                  </span>
                </div>
                <div style={styles.couponCardAction}>
                  {applyWingsReward ? "Applied ✓" : "Apply"}
                </div>
              </button>
            ) : null}

            {activePromos.map((promo) => {
              const isApplied = confirmedPromoCodes.has(promo.code.toUpperCase());
              const isAutomatic = Boolean(promo.autoApply);
              const bxgyDetails =
                promo.discountType === "BXGY" ? formatBxgyDetails(promo) : null;
              const redeemTypeLabel =
                promo.eligibleFulfillmentType === "PICKUP"
                  ? "Pickup only"
                  : promo.eligibleFulfillmentType === "DELIVERY"
                    ? "Delivery only"
                    : null;
              return (
                <button
                  key={promo.id}
                  type="button"
                  disabled={isApplied || isAutomatic}
                  onClick={() => {
                    if (isAutomatic) return;
                    setApplyWingsReward(false);
                    setPromoInput(promo.code);
                    setPromoApplied(promo.code);
                    setCouponsModalOpen(false);
                  }}
                  style={{
                    ...styles.couponCard,
                    ...(isApplied ? styles.couponCardApplied : null),
                    marginTop: 12,
                  }}
                >
                  <div style={styles.couponCardIcon} aria-hidden>🏷️</div>
                  <div style={styles.couponCardBody}>
                    <strong style={styles.couponCardTitle}>{promo.code}</strong>
                    <span style={styles.couponCardSubtitle}>{promo.name}</span>
                    <span style={styles.couponCardMeta}>
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
                        (bxgyDetails?.summary ?? `Buy X Get Y`)}
                      {promo.minSubtotalCents > 0 && ` (Min $${(promo.minSubtotalCents / 100).toFixed(2)})`}
                    </span>
                    {bxgyDetails?.scopeLine ? (
                      <span style={styles.couponCardMeta}>
                        {bxgyDetails.scopeLine}
                      </span>
                    ) : null}
                    {redeemTypeLabel ? (
                      <span style={styles.couponCardMeta}>{redeemTypeLabel}</span>
                    ) : null}
                  </div>
                  {isAutomatic ? (
                    <div style={styles.couponCardAction}>Auto</div>
                  ) : null}
                  <div
                    style={{
                      ...styles.couponCardAction,
                      display: isAutomatic ? "none" : undefined,
                    }}
                  >
                    {isApplied ? "Applied ✓" : "Apply"}
                  </div>
                </button>
              );
            })}

            {!showWingsRewardCard && activePromos.length === 0 ? (
              <div style={styles.couponsEmpty}>
                <div style={styles.couponsEmptyIcon} aria-hidden>
                  🏷️
                </div>
                <p style={styles.couponsEmptyTitle}>No coupons yet</p>
                <p style={styles.couponsEmptyDesc}>
                  Check back later for special offers and discounts.
                </p>
              </div>
            ) : null}

            {applyWingsReward || promoApplied ? (
              <button
                type="button"
                onClick={() => {
                  setApplyWingsReward(false);
                  setPromoApplied("");
                  setPromoInput("");
                }}
                style={{ ...styles.couponRemoveBtn, marginTop: 16 }}
              >
                Clear all rewards
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
