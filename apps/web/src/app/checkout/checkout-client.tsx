"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CustomerAuth } from "@/components/customer-auth";
import { useDeliveryAddress } from "@/components/delivery-address-provider";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { useCart } from "@/lib/cart";
import {
  getCartItemUnitPrice,
  getCustomerVisibleInstructions,
  getRemovedIngredientsForApi,
  splitCartDescLine,
} from "@/lib/cart-item-utils";
import { buildLineSummary } from "@/lib/cart-line-summary";
import {
  FIXED_DELIVERY_CITY,
  hasCompleteDeliveryAddress,
} from "@/lib/delivery-address";
import {
  DELIVERY_BLOCKED_NO_SHOWS_MESSAGE,
  isMinimumDeliverySubtotalError,
} from "@/lib/delivery-restrictions";
import { cents, orderStatusCustomerLabel } from "@/lib/format";
import {
  getLunchScheduleConflict,
  LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE,
} from "@/lib/lunch-hours";
import {
  formatScheduleDateLabel,
  formatScheduleTimeLabel,
} from "@/lib/order-scheduling";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { CartQuoteResponse, CheckoutResponse } from "@/lib/types";
import type { ApiEnvelope } from "@wings4u/contracts";

import { ContactlessPreferenceCombo } from "./contactless-preference-combo";
import { deleteSavedCart } from "@/lib/saved-cart-api";
import { WINGS_REWARD_STORAGE_KEY } from "@/Wings4u/components/cart-page";

type CheckoutState =
  | { step: "review" }
  | { step: "submitting" }
  | { step: "success"; order: CheckoutResponse }
  | { step: "error"; message: string };

function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

function checkoutSummaryLineClass(line: string): string {
  return line.startsWith("No: ")
    ? "cart-line-mods cart-line-mods-removed"
    : "cart-line-mods";
}

/** Same label/value split + colors as cart line descriptions (`cartItemLineDesc*` in styles). */
function checkoutCartDescLine(line: string, className: string, lineKey: string) {
  const parts = splitCartDescLine(line);
  return (
    <p key={lineKey} className={className}>
      {parts ? (
        <>
          <span className="cart-line-desc-label">{parts.label}</span>
          <span className="cart-line-desc-value">{parts.value}</span>
        </>
      ) : (
        <span className="cart-line-desc-single">{line}</span>
      )}
    </p>
  );
}

export function CheckoutClient() {
  const router = useRouter();
  const cart = useCart();
  const session = useSession();
  const { address, openAddressPicker } = useDeliveryAddress();
  const [state, setState] = useState<CheckoutState>({ step: "review" });
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  /**
   * Reward-redemption intent carried over from the cart page via
   * sessionStorage. If the user removed wings after checking out, the
   * server returns `wings_reward.applied: false` and the checkout summary
   * simply won't show the discount — no client-side re-validation needed.
   */
  const [applyWingsReward, setApplyWingsReward] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(WINGS_REWARD_STORAGE_KEY);
    setApplyWingsReward(raw === "1");
  }, []);

  const [promoApplied, setPromoApplied] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawPromo = window.sessionStorage.getItem("wings4u.promo-applied");
    if (rawPromo) {
      setPromoApplied(rawPromo);
    }
  }, []);
  const [contactlessPref, setContactlessPref] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryAddressError, setDeliveryAddressError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  /** Checkout order summary: line keys with expanded detail (default all collapsed). */
  const [checkoutLineExpanded, setCheckoutLineExpanded] = useState<Record<string, boolean>>({});
  const pendingSubmitRef = useRef(false);

  /** Sign-in modal: cursor-following amber rim, mirrors the login card behaviour. */
  const checkoutAuthCardRef = useRef<HTMLElement | null>(null);
  const updateCheckoutAuthCardRim = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = checkoutAuthCardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--rim-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--rim-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);
  const clearCheckoutAuthCardRim = useCallback(() => {
    const el = checkoutAuthCardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

  /** Lock background page scroll while the sign-in modal is open. Padding-right
   *  avoids a layout shift when the OS scrollbar disappears. */
  useEffect(() => {
    if (!showAuthModal || typeof document === "undefined") return;
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
  }, [showAuthModal]);

  const addressLine1 = address?.line1 ?? "";
  const addressPostal = address?.postalCode ?? "";
  const hasSelectedDeliveryAddress = hasCompleteDeliveryAddress(address);
  const scheduleDateLabel = formatScheduleDateLabel(
    cart.scheduledFor,
    cart.locationTimezone,
  );
  const scheduleTimeLabel = formatScheduleTimeLabel(
    cart.scheduledFor,
    cart.fulfillmentType,
    cart.schedulingConfig,
    cart.locationTimezone,
  );
  const lunchScheduleConflict = useMemo(
    () =>
      getLunchScheduleConflict({
        items: cart.items,
        scheduledFor: cart.scheduledFor,
        timezone: cart.locationTimezone,
      }),
    [cart.items, cart.locationTimezone, cart.scheduledFor],
  );
  const deliveryBlockedMessage =
    cart.fulfillmentType === "DELIVERY" &&
    quoteError === DELIVERY_BLOCKED_NO_SHOWS_MESSAGE
      ? quoteError
      : null;

  const fallbackSubtotal = useMemo(
    () =>
      cart.items.reduce(
        (sum, item) => sum + getCartItemUnitPrice(item) * item.quantity,
        0,
      ),
    [cart.items],
  );

  const subtotalForTip = quote?.item_subtotal_cents ?? fallbackSubtotal;
  const tipCents = useMemo(() => {
    if (cart.driverTipPercent === "none") return 0;
    return Math.round((subtotalForTip * cart.driverTipPercent) / 100);
  }, [cart.driverTipPercent, subtotalForTip]);

  /** Do not stay on checkout if delivery subtotal is below minimum — cart shows the fix. */
  useEffect(() => {
    if (isMinimumDeliverySubtotalError(quoteError)) {
      router.replace("/cart");
    }
  }, [quoteError, router]);

  useEffect(() => {
    if (cart.items.length === 0) return;
    void (async () => {
      try {
        const res = await apiFetch("/api/v1/cart/quote", {
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
            driver_tip_cents: tipCents,
            apply_wings_reward: applyWingsReward ? true : undefined,
            promo_code: promoApplied,
          }),
          locationId: cart.locationId,
        });
        const body = (await res.json()) as ApiEnvelope<CartQuoteResponse>;
        if (res.ok && body.data) {
          setQuote(body.data);
          setQuoteError(null);
          return;
        }
        setQuote(null);
        setQuoteError(getApiErrorMessage(body, `Quote failed (${res.status})`));
      } catch {
        /* quote is optional context; checkout will re-validate server-side */
      }
    })();
  }, [
    cart.fulfillmentType,
    cart.items,
    cart.locationId,
    cart.scheduledFor,
    tipCents,
    applyWingsReward,
    promoApplied,
  ]);

  const handleAuthComplete = useCallback(() => {
    setShowAuthModal(false);
    // Auth + profile complete — auto-resume the order submission
    pendingSubmitRef.current = true;
  }, []);

  // Auto-submit after auth completes
  useEffect(() => {
    if (pendingSubmitRef.current && session.authenticated && session.profileComplete) {
      pendingSubmitRef.current = false;
      void doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.authenticated, session.profileComplete]);

  useEffect(() => {
    if (cart.fulfillmentType !== "DELIVERY" || hasSelectedDeliveryAddress) {
      setDeliveryAddressError(null);
    }
  }, [cart.fulfillmentType, hasSelectedDeliveryAddress]);

  useEffect(() => {
    if (
      !lunchScheduleConflict &&
      state.step === "error" &&
      state.message === LUNCH_SPECIAL_SCHEDULE_CONFLICT_MESSAGE
    ) {
      setState({ step: "review" });
    }
  }, [lunchScheduleConflict, state]);

  const doSubmit = useCallback(async () => {
    setState({ step: "submitting" });
    const key = generateIdempotencyKey();

    const payload: Record<string, unknown> = {
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
    };

    if (notes.trim()) payload.special_instructions = notes.trim();
    if (contactlessPref) payload.contactless_pref = contactlessPref;
    if (cart.scheduledFor) payload.scheduled_for = cart.scheduledFor;
    if (tipCents > 0) payload.driver_tip_cents = tipCents;
    if (applyWingsReward) payload.apply_wings_reward = true;
    if (promoApplied) payload.promo_code = promoApplied;

    if (cart.fulfillmentType === "DELIVERY") {
      payload.address_snapshot_json = {
        line1: addressLine1.trim(),
        city: FIXED_DELIVERY_CITY,
        postal_code: addressPostal.trim(),
      };
    }

    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/checkout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify(payload),
            locationId: cart.locationId,
          }),
        session.refresh,
        session.clear,
      );

      const body = (await res.json()) as ApiEnvelope<CheckoutResponse> | Record<string, unknown>;

      if (!res.ok || !("data" in body) || !body.data) {
        const message = getApiErrorMessage(body, `Checkout failed (${res.status})`);
        setState({ step: "error", message });
        return;
      }

      const order = (body as ApiEnvelope<CheckoutResponse>).data as CheckoutResponse;
      
      // Phase 4: Mark saved cart as CONVERTED after successful checkout
      await deleteSavedCart(cart.locationId);
      
      cart.clear();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(WINGS_REWARD_STORAGE_KEY);
        window.sessionStorage.removeItem("wings4u.promo-applied");
      }
      setState({ step: "success", order });
    } catch (e) {
      setState({
        step: "error",
        message: e instanceof Error ? e.message : "Network error",
      });
    }
  }, [cart, notes, contactlessPref, addressLine1, addressPostal, session, tipCents, applyWingsReward, promoApplied]);

  const submit = useCallback(() => {
    if (lunchScheduleConflict) {
      setState({ step: "error", message: lunchScheduleConflict.message });
      return;
    }

    if (deliveryBlockedMessage) {
      setState({ step: "error", message: deliveryBlockedMessage });
      return;
    }

    if (isMinimumDeliverySubtotalError(quoteError)) {
      router.replace("/cart");
      return;
    }

    if (cart.fulfillmentType === "DELIVERY" && !hasSelectedDeliveryAddress) {
      setDeliveryAddressError("Confirm your delivery address before placing your order.");
      openAddressPicker();
      return;
    }

    // Not authenticated? Open auth modal
    if (!session.authenticated) {
      setShowAuthModal(true);
      return;
    }
    // Authenticated but profile incomplete? Open auth modal (skips to profile step)
    if (session.needsProfileCompletion) {
      setShowAuthModal(true);
      return;
    }
    // Ready to go
    setDeliveryAddressError(null);
    void doSubmit();
  }, [
    cart.fulfillmentType,
    doSubmit,
    deliveryBlockedMessage,
    hasSelectedDeliveryAddress,
    lunchScheduleConflict,
    openAddressPicker,
    session.authenticated,
    session.needsProfileCompletion,
    quoteError,
    router,
  ]);

  if (state.step === "success") {
    const order = state.order;
    const statusLabelText = orderStatusCustomerLabel(order.status, order.fulfillment_type);
    const readyTime = order.estimated_ready_at
      ? new Date(order.estimated_ready_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    return (
      <section className="surface-card checkout-success-panel">
        <div className="checkout-success">
          <div className="checkout-success-icon" aria-hidden>
            <span className="checkout-success-icon-pulse" />
            <span className="checkout-success-icon-pulse checkout-success-icon-pulse--delay" />
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12.75l4.25 4.25L19 7.5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p className="checkout-success-eyebrow">Confirmed</p>
          <h1 className="checkout-success-title">Order placed!</h1>
          <p className="checkout-success-subtitle">
            Thanks for the order — we&rsquo;re firing it up now.
          </p>

          <div className="checkout-success-order-number">
            <span className="checkout-success-order-hash">#</span>
            <span className="checkout-success-order-value">{order.order_number}</span>
          </div>

          <div className="checkout-success-stats">
            <div className="checkout-success-stat">
              <span className="checkout-success-stat-label">Status</span>
              <span className="checkout-success-stat-value checkout-success-stat-value--status">
                <span className="checkout-success-stat-dot" aria-hidden />
                {statusLabelText}
              </span>
            </div>
            {readyTime ? (
              <div className="checkout-success-stat">
                <span className="checkout-success-stat-label">
                  {order.fulfillment_type === "PICKUP" ? "Ready for pickup" : "Ready"}
                </span>
                <span className="checkout-success-stat-value">~{readyTime}</span>
              </div>
            ) : null}
          </div>

          <div className="checkout-success-actions">
            <Link
              href={`/orders/${order.id}`}
              className="cart-checkout-fire-btn checkout-page-inline-fire checkout-success-track"
            >
              <span className="btn-label">Track order {"\u2192"}</span>
            </Link>
            <Link href="/menu" className="checkout-success-secondary">
              <span className="checkout-success-secondary-arrow" aria-hidden>
                {"\u2190"}
              </span>
              <span>Order something else</span>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (cart.isCartHydrating && cart.items.length === 0) {
    return (
      <section className="surface-card">
        <div className="cart-empty">
          <h2>Restoring your cart…</h2>
          <p>Hang tight while we load your saved order.</p>
        </div>
      </section>
    );
  }

  if (cart.items.length === 0) {
    return (
      <section className="surface-card">
        <div className="cart-empty">
          <h2>Nothing to check out</h2>
          <p>Add items from the menu first.</p>
          <Link href="/order" className="cart-checkout-fire-btn checkout-page-inline-fire" style={{ textDecoration: "none" }}>
            <span className="btn-label">BACK TO MENU {"\u2192"}</span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card checkout-page-panel">
      <div className="checkout-page-back-row">
        <Link href="/cart" className="cart-back-to-menu-link">
          ← Back to cart
        </Link>
      </div>
      <h1 className="checkout-page-title">CHECKOUT</h1>
      <p className="checkout-page-lede">Review Your Order Below</p>

      <div className="checkout-schedule-summary">
        <div className="checkout-schedule-summary-row checkout-schedule-summary-row--primary">
          {cart.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} · {scheduleDateLabel}
        </div>
        <div className="checkout-schedule-summary-row checkout-schedule-summary-row--time">
          {scheduleTimeLabel}
        </div>
      </div>

      <div className="checkout-section checkout-order-summary-section">
        <h3>Order summary</h3>
        <hr className="checkout-order-summary-rule" aria-hidden="true" />
        {cart.items.map((item) => {
          const summaryLines = buildLineSummary(item);
          const instructionsForDisplay = getCustomerVisibleInstructions(item);
          const hasExpandableDetails =
            summaryLines.length > 0 || Boolean(instructionsForDisplay.trim());
          const isExpanded = Boolean(checkoutLineExpanded[item.key]);

          return (
            <div key={item.key} className="cart-line checkout-cart-line">
              <div className="cart-line-info checkout-cart-line-info">
                <div className="checkout-cart-line-header">
                  <div className="checkout-cart-line-title-wrap">
                    {hasExpandableDetails ? (
                      <button
                        type="button"
                        className={`checkout-cart-line-toggle${isExpanded ? " checkout-cart-line-toggle--open" : ""}`}
                        onClick={() =>
                          setCheckoutLineExpanded((prev) => ({
                            ...prev,
                            [item.key]: !prev[item.key],
                          }))
                        }
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded
                            ? `Hide details for ${item.name}`
                            : `Show details for ${item.name}`
                        }
                      >
                        <svg
                          className="checkout-cart-line-chevron"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    ) : null}
                    <h3>{item.name} × {item.quantity}</h3>
                  </div>
                  <span className="cart-line-price">
                    {cents(getCartItemUnitPrice(item) * item.quantity)}
                  </span>
                </div>
                {hasExpandableDetails && isExpanded ? (
                  <div className="checkout-cart-line-details">
                    {summaryLines.map((line, idx) =>
                      checkoutCartDescLine(
                        line,
                        checkoutSummaryLineClass(line),
                        `${item.key}-sum-${idx}`,
                      ),
                    )}
                    {instructionsForDisplay ? (
                      <p className="cart-line-instructions">
                        <span className="cart-line-instructions-label">Special instructions: </span>
                        <span className="cart-line-instructions-value">
                          &ldquo;{instructionsForDisplay}&rdquo;
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {quote && (
        <div className="quote-summary" style={{ marginTop: 0 }}>
          <div className="quote-row">
            <span>Subtotal</span>
            <span>{cents(quote.item_subtotal_cents)}</span>
          </div>
          {quote.wings_reward.applied && quote.wings_reward.discount_cents > 0 ? (
            <div className="quote-row" style={{ color: "#16a34a" }}>
              <span>Wings reward (1lb free)</span>
              <span>−{cents(quote.wings_reward.discount_cents)}</span>
            </div>
          ) : null}
          {quote.promo_discount_cents && quote.promo_discount_cents > 0 ? (
            <div className="quote-row" style={{ color: "#34d399" }}>
              <span>Promo code ({quote.applied_promo_code})</span>
              <span>−{cents(quote.promo_discount_cents)}</span>
            </div>
          ) : null}
          {cart.fulfillmentType === "DELIVERY" && (
            <div className="quote-row">
              <span>Delivery fee</span>
              <span>
                {quote.delivery_fee_waived && quote.delivery_fee_stated_cents > 0 ? (
                  <>
                    <span style={{ textDecoration: "line-through", opacity: 0.65, marginRight: 6 }}>
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
          {quote.driver_tip_cents > 0 && (
            <div className="quote-row">
              <span>Tip</span>
              <span>{cents(quote.driver_tip_cents)}</span>
            </div>
          )}
          <div className="quote-row">
            <span>Tax (13%)</span>
            <span>{cents(quote.tax_cents)}</span>
          </div>
          <div className="quote-row quote-total">
            <span>Total</span>
            <span>{cents(quote.final_payable_cents)}</span>
          </div>
        </div>
      )}

      {cart.fulfillmentType === "DELIVERY" && (
        <div className="checkout-section" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.5rem" }}>Delivery address</h3>
          <div className="checkout-field">
            <label>Street address</label>
            <input
              value={addressLine1}
              readOnly
              placeholder="123 Main St"
              aria-readonly="true"
              title="Address from your cart"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div className="checkout-field">
              <label>City</label>
              <input
                value={FIXED_DELIVERY_CITY}
                readOnly
                aria-readonly="true"
                title="Address from your cart"
              />
            </div>
            <div className="checkout-field">
              <label>Postal code</label>
              <input
                value={addressPostal}
                readOnly
                placeholder="N6A 1A1"
                aria-readonly="true"
                title="Address from your cart"
              />
            </div>
          </div>
          <div className="checkout-field checkout-field--contactless-combo">
            <ContactlessPreferenceCombo value={contactlessPref} onChange={setContactlessPref} />
          </div>
          {deliveryAddressError ? (
            <p className="surface-error" style={{ marginBottom: 0 }}>
              {deliveryAddressError}
            </p>
          ) : null}
        </div>
      )}

      <div className="checkout-section" style={{ marginTop: cart.fulfillmentType === "PICKUP" ? "1.5rem" : 0 }}>
        <div className="checkout-field">
          <label>Order notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special requests for the kitchen"
            rows={2}
          />
        </div>
      </div>

      {state.step === "error" && (
        <p className="surface-error" style={{ marginBottom: "1rem" }}>
          {state.message}
        </p>
      )}
      {lunchScheduleConflict && state.step !== "error" && (
        <p className="surface-error" style={{ marginBottom: "1rem" }}>
          {lunchScheduleConflict.message}
        </p>
      )}
      {deliveryBlockedMessage && state.step !== "error" && (
        <p className="surface-error" style={{ marginBottom: "1rem" }}>
          {deliveryBlockedMessage}
        </p>
      )}
      {quoteError &&
        !deliveryBlockedMessage &&
        quoteError !== lunchScheduleConflict?.message &&
        !isMinimumDeliverySubtotalError(quoteError) &&
        state.step !== "error" && (
          <p className="surface-error" style={{ marginBottom: "1rem" }}>
            {quoteError}
          </p>
        )}

      <button
        type="button"
        className="cart-checkout-fire-btn"
        disabled={
          state.step === "submitting" ||
          Boolean(
            lunchScheduleConflict ||
              deliveryBlockedMessage ||
              isMinimumDeliverySubtotalError(quoteError),
          )
        }
        onClick={submit}
      >
        <span className="btn-label">
          {state.step === "submitting" ? "PLACING ORDER…" : `Place order ${"\u2192"}`}
        </span>
      </button>

      {showAuthModal && (
        <div
          className="wk-checkout-auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to place your order"
        >
          <section
            ref={checkoutAuthCardRef}
            className="wk-auth-card"
            onMouseMove={updateCheckoutAuthCardRim}
            onMouseEnter={updateCheckoutAuthCardRim}
            onMouseLeave={clearCheckoutAuthCardRim}
          >
            <div className="wk-auth-card-glow" aria-hidden />
            <div className="wk-auth-card-rim" aria-hidden />
            <div className="wk-auth-card-body">
              <CustomerAuth
                mode="checkout"
                onComplete={handleAuthComplete}
                onCancel={() => setShowAuthModal(false)}
              />
            </div>
            <div className="wk-auth-card-fineprint">
              By continuing you agree to our{" "}
              <a href="/terms" className="wk-auth-card-link">
                Terms
              </a>{" "}
              &amp;{" "}
              <a href="/privacy" className="wk-auth-card-link">
                Privacy
              </a>
              .
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
