import { SafeAreaView } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Linking from "expo-linking";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { initStripe, useStripe } from "@stripe/stripe-react-native";
import {
  CreditCard,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  MapPin,
  ShoppingBag,
  Wallet,
} from "lucide-react-native";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AuthSheet } from "../src/components/auth-sheet";
import { CheckoutEntryGuard } from "../src/components/checkout-entry-guard";
import { CheckoutConfirmation } from "../src/components/checkout-confirmation";
import { checkoutItemDetails } from "../src/lib/checkout-item-details";
import { cartPricingRecovery } from "../src/lib/cart-pricing-error";
import { useCart } from "../src/context/cart";
import { useOrderSetup } from "../src/context/order-setup";
import { OrderSetupSummary } from "../src/components/order-setup-summary";
import { usePromo } from "../src/context/promo";
import { useAccountData } from "../src/hooks/use-account-data";
import { useSession, withSilentRefresh } from "../src/context/session";
import { apiFetch, apiJson, getApiErrorMessage } from "../src/lib/api";
import { cents } from "../src/lib/format";
import { normalizeCanadianPostalCode, normalizeAddressText } from "../src/lib/delivery-address";
import {
  checkoutPricingBlock,
  paymentIntentPricingBlock,
  customerPaymentOptions,
  defaultCollectionPreference,
  type CustomerCollectionPreference,
} from "../src/lib/payment-options";
import {
  isPromoRejectedQuoteError,
  promoDiscountRows,
  quotePromoParams,
  wingsRewardBlockedReason,
} from "../src/lib/promo-selection";
import { requestCartQuote } from "../src/lib/cart-quote";
import { calculateCartSubtotal, getCartItemSubtotal } from "../src/lib/wing-builder-logic";
import type {
  CartItem,
  CartQuoteResponse,
  CheckoutResponse,
} from "../src/lib/types";

const FIXED_DELIVERY_CITY = "London";
const STRIPE_MERCHANT_IDENTIFIER = "merchant.com.wings4u";
const STRIPE_RETURN_URL = Linking.createURL("stripe-redirect");

type PaymentMethod = CustomerCollectionPreference | "ONLINE_CARD";

type StripeConfigResponse = {
  configured: boolean;
  online_payments_enabled?: boolean;
  publishable_key: string;
  currency: string;
  merchant_display_name: string;
};

type StripePaymentIntentResponse = StripeConfigResponse & {
  payment_intent_id: string | null;
  client_secret: string | null;
  amount_cents: number | null;
  message?: string;
  quote?: CartQuoteResponse;
};

type DeliveryQuoteResponse = {
  delivery_quote_token: string;
  delivery_fee_cents: number;
  expires_at: string;
  attribution: "Google Maps" | null;
};

type DeliveryQuoteStatus = "idle" | "loading" | "ready" | "error";

const CANADIAN_POSTAL_CODE_RE =
  /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

function provisionalPrice(amount: number): string {
  return Number.isSafeInteger(amount) && amount >= 0 ? cents(amount) : '—';
}

function checkoutItems(items: CartItem[]) {
  return items.map((item) => ({
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    modifier_selections: item.modifier_selections
      .map((selection) => selection.modifier_option_id)
      .filter((id): id is string => Boolean(id))
      .map((modifier_option_id) => ({ modifier_option_id })),
    removed_ingredients: item.removed_ingredients ?? [],
    special_instructions: item.special_instructions.trim() || undefined,
    builder_payload: item.builder_payload,
  }));
}

function makeIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2);
  return `mobile-${Date.now()}-${random}`;
}

function getApiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: Array<{ code?: string }> }).errors;
  return errors?.[0]?.code ?? null;
}

export default function CheckoutScreen() {
  const [completedOrder, setCompletedOrder] = useState<CheckoutResponse | null>(null);
  if (completedOrder) return <CheckoutConfirmation order={completedOrder} />;
  return <CheckoutEntryGuard><CheckoutScreenContent onSuccess={setCompletedOrder} /></CheckoutEntryGuard>;
}

function CheckoutScreenContent({ onSuccess }: { onSuccess: (order: CheckoutResponse) => void }) {
  const router = useRouter();
  const cart = useCart();
  const orderSetup = useOrderSetup();
  const promo = usePromo();
  const account = useAccountData();
  const session = useSession();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [pricedQuoteKey, setPricedQuoteKey] = useState<string | null>(null);
  const [lastDisplayPrice, setLastDisplayPrice] = useState<{ key: string; quote: CartQuoteResponse } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRecovery, setQuoteRecovery] = useState<ReturnType<typeof cartPricingRecovery>>('retry');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pricingRetry, setPricingRetry] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [promoNotice, setPromoNotice] = useState<string | null>(null);
  const [contactlessPref, setContactlessPref] = useState<
    "" | "HAND_TO_ME" | "LEAVE_AT_DOOR" | "CALL_ON_ARRIVAL" | "TEXT_ON_ARRIVAL"
  >("");
  const line1 = orderSetup.deliveryAddress?.line1 ?? "";
  const postalCode = orderSetup.deliveryAddress?.postal_code ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authVisible, setAuthVisible] = useState(false);
  const [authInitialStep, setAuthInitialStep] = useState<'login' | 'profile'>('login');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    defaultCollectionPreference("PICKUP"),
  );
  const submittingRef = useRef(false);
  const [stripeConfig, setStripeConfig] = useState<StripeConfigResponse | null>(null);
  const [deliveryQuote, setDeliveryQuote] =
    useState<DeliveryQuoteResponse | null>(null);
  const [deliveryQuoteStatus, setDeliveryQuoteStatus] =
    useState<DeliveryQuoteStatus>("idle");
  const [pricedDeliveryKey, setPricedDeliveryKey] = useState<string | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(
    null,
  );
  const [deliveryQuoteRetryNonce, setDeliveryQuoteRetryNonce] = useState(0);
  const pendingSubmitRef = useRef(false);
  const authCompletedRef = useRef(false);
  const pendingAuthReview = useRef<{ key: string; total: number } | null>(null);
  const checkoutAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const paidIntentRef = useRef<{
    fingerprint: string;
    paymentIntentId: string;
  } | null>(null);

  const deliveryAddress = useMemo(
    () => ({
      line1: normalizeAddressText(line1),
      city: FIXED_DELIVERY_CITY,
      postal_code: normalizeCanadianPostalCode(postalCode),
    }),
    [line1, postalCode],
  );
  const hasCompleteDeliveryAddress =
    deliveryAddress.line1.length > 0 &&
    CANADIAN_POSTAL_CODE_RE.test(deliveryAddress.postal_code);
  const deliveryContextKey = JSON.stringify({
    locationId: cart.locationId, fulfillmentType: cart.fulfillmentType, scheduledFor: cart.scheduledFor,
    customer: session.authenticated ? session.user?.id ?? "authenticated" : "guest",
    address: cart.fulfillmentType === 'DELIVERY' ? deliveryAddress : null,
  });
  const deliveryQuoteReady =
    cart.fulfillmentType !== "DELIVERY" ||
    (deliveryQuoteStatus === "ready" && deliveryQuote !== null && pricedDeliveryKey === deliveryContextKey &&
      Number.isFinite(Date.parse(deliveryQuote.expires_at)) && Date.parse(deliveryQuote.expires_at) > Date.now());

  const quoteKey = useMemo(
    () =>
      JSON.stringify({
        locationId: cart.locationId,
        customerKey: session.authenticated ? session.user?.id ?? "authenticated" : "guest",
        items: checkoutItems(cart.items),
        fulfillmentType: cart.fulfillmentType,
        scheduledFor: cart.scheduledFor,
        // Key the selection, not a tip derived from the previous server subtotal.
        driverTipPercent: cart.driverTipPercent,
        deliveryQuoteToken: cart.fulfillmentType === "DELIVERY" && deliveryQuoteReady ? deliveryQuote?.delivery_quote_token : null,
        deliveryAddress: cart.fulfillmentType === 'DELIVERY' ? deliveryAddress : null,
        promoCode: promo.promoCode,
        applyWingsReward: promo.applyWingsReward,
      }),
    [
      cart.locationId,
      session.authenticated,
      session.user?.id,
      cart.fulfillmentType,
      cart.items,
      cart.scheduledFor,
      deliveryAddress,
      deliveryQuote?.delivery_quote_token,
      deliveryQuoteReady,
      cart.driverTipPercent,
      promo.promoCode,
      promo.applyWingsReward,
    ],
  );
  const latestCheckoutKey = useRef(quoteKey);
  latestCheckoutKey.current = quoteKey;
  // Selection changes may retain previous prices for display. Every cart,
  // account, address, schedule and delivery-token input still has to match.
  const displayPriceKey = useMemo(() => JSON.stringify({ ...JSON.parse(quoteKey),
    driverTipPercent: null, promoCode: null, applyWingsReward: null }), [quoteKey]);
  const authReviewKey = JSON.stringify({ locationId: cart.locationId, items: checkoutItems(cart.items),
    fulfillmentType: cart.fulfillmentType, scheduledFor: cart.scheduledFor, deliveryAddress,
    driverTipPercent: cart.driverTipPercent, promoCode: promo.promoCode, applyWingsReward: promo.applyWingsReward });
  const quoteSelection = async (selection: { promoCode: string | null; applyWingsReward: boolean }) => {
    const start = quoteKey;
    const request: typeof apiJson = async (path, init) => {
      try { return await apiJson(path, init); }
      catch (error) {
        if ((error as { status?: number }).status !== 401 || !session.authenticated || latestCheckoutKey.current !== start) throw error;
        if (!await session.refresh() || latestCheckoutKey.current !== start) throw error;
        return apiJson(path, init);
      }
    };
    const priced = await requestCartQuote({ locationId: cart.locationId, items: cart.items,
      fulfillmentType: cart.fulfillmentType, scheduledFor: cart.scheduledFor, driverTipPercent: cart.driverTipPercent,
      ...selection, deliveryQuoteToken: cart.fulfillmentType === 'DELIVERY' ? deliveryQuote?.delivery_quote_token : undefined,
      deliveryAddress: cart.fulfillmentType === 'DELIVERY' ? deliveryAddress : undefined }, request);
    if (latestCheckoutKey.current !== start) throw new Error('Your cart or account changed. Please review your total again.');
    const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;
    if (![priced.item_subtotal_cents, priced.tax_cents, priced.driver_tip_cents, priced.final_payable_cents].every(validAmount) ||
      !Array.isArray(priced.lines) || priced.lines.length !== cart.items.length ||
      priced.lines.some((line, index) => line.menu_item_id !== cart.items[index].menu_item_id ||
        line.quantity !== cart.items[index].quantity || !validAmount(line.line_total_cents)) ||
      (cart.fulfillmentType === 'DELIVERY' && !validAmount(priced.delivery_fee_cents))) {
      throw new Error('The order total could not be confirmed. Please retry pricing.');
    }
    if (cart.fulfillmentType === 'DELIVERY' && priced.delivery_fee_is_estimate) {
      throw new Error('Wait for the exact delivery fee to be confirmed before placing the order.');
    }
    return priced;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const envelope = await apiJson<StripeConfigResponse>(
          "/api/v1/payments/stripe/config",
        );
        if (cancelled) return;
        const config = envelope.data ?? null;
        setStripeConfig(config);
        if (
          config?.online_payments_enabled &&
          config.configured &&
          config.publishable_key
        ) {
          await initStripe({
            publishableKey: config.publishable_key,
            merchantIdentifier: STRIPE_MERCHANT_IDENTIFIER,
          });
        }
      } catch {
        if (!cancelled) setStripeConfig(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      cart.fulfillmentType !== "DELIVERY" ||
      !cart.isCartHydrated ||
      cart.isCartHydrating ||
      cart.items.length === 0 ||
      !hasCompleteDeliveryAddress
    ) {
      setDeliveryQuote(null);
      setDeliveryQuoteStatus("idle");
      setDeliveryQuoteError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // An address/time change immediately invalidates the previous delivery token.
    setDeliveryQuote(null);
    setDeliveryQuoteStatus("loading");
    setDeliveryQuoteError(null);
    const timeout = setTimeout(() => {
      setDeliveryQuote(null);
      setDeliveryQuoteStatus("loading");
      setDeliveryQuoteError(null);
      void (async () => {
        try {
          const response = await apiFetch("/api/v1/delivery/quote", {
            method: "POST",
            locationId: cart.locationId,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location_id: cart.locationId,
              address_snapshot_json: deliveryAddress,
              scheduled_for: cart.scheduledFor ?? undefined,
            }),
            signal: controller.signal,
          });
          const body = (await response.json().catch(() => null)) as
            | ApiEnvelope<DeliveryQuoteResponse>
            | null;
          if (cancelled) return;
          if (!response.ok || !body?.data) {
            setDeliveryQuoteStatus("error");
            setDeliveryQuoteError(
              getApiErrorMessage(
                body,
                `Delivery estimate failed (${response.status})`,
              ),
            );
            return;
          }
          if (!body.data.delivery_quote_token || !Number.isFinite(Date.parse(body.data.expires_at)) || Date.parse(body.data.expires_at) <= Date.now()) {
            throw new Error('Delivery quote is invalid or expired. Retry to confirm the delivery fee.');
          }
          setDeliveryQuote(body.data);
          setPricedDeliveryKey(deliveryContextKey);
          setDeliveryQuoteStatus("ready");
          setDeliveryQuoteError(null);
        } catch (cause) {
          if (cancelled) return;
          setDeliveryQuoteStatus("error");
          setDeliveryQuoteError(
            cause instanceof Error
              ? cause.message
              : "Delivery could not be confirmed. Retry or choose pickup.",
          );
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    cart.fulfillmentType,
    cart.isCartHydrated,
    cart.isCartHydrating,
    cart.items.length,
    cart.locationId,
    deliveryAddress,
    cart.scheduledFor,
    deliveryQuoteRetryNonce,
    hasCompleteDeliveryAddress,
    deliveryContextKey,
  ]);

  useEffect(() => {
    if (!deliveryQuote) return;
    const delay = new Date(deliveryQuote.expires_at).getTime() - Date.now();
    if (delay <= 0) {
      setDeliveryQuote(null);
      setDeliveryQuoteRetryNonce((value) => value + 1);
      return;
    }
    const timeout = setTimeout(() => {
      setDeliveryQuote(null);
      setDeliveryQuoteRetryNonce((value) => value + 1);
    }, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [deliveryQuote]);

  useEffect(() => {
    if (cart.items.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (cart.fulfillmentType === "DELIVERY" && !deliveryQuoteReady) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(deliveryQuoteStatus === "loading");
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    const timeout = setTimeout(() => {
      setQuoteError(null);
      void (async () => {
        try {
          const nextQuote = await quoteSelection(promo);
          if (!cancelled) {
            setQuote(nextQuote);
            setPricedQuoteKey(quoteKey);
          }
        } catch (cause) {
          if (!cancelled) {
            const message =
              cause instanceof Error ? cause.message : "Unable to quote order";
            const code = getApiErrorCode((cause as { body?: unknown })?.body);
            if (code === 'DELIVERY_QUOTE_EXPIRED' || code === 'INVALID_DELIVERY_QUOTE') {
              setDeliveryQuote(null);
              setDeliveryQuoteStatus("error");
              setDeliveryQuoteError(message);
            }
            // Drop a server-rejected promo and re-quote without it (mirrors web).
            if (isPromoRejectedQuoteError(message) && promo.promoCode) {
              promo.clearPromoCode();
              setPromoNotice(message);
            } else {
              setQuote(null);
              setQuoteError(message);
              setQuoteRecovery(cartPricingRecovery(cause));
            }
          }
        } finally {
          if (!cancelled) setQuoteLoading(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [
    cart,
    deliveryAddress,
    deliveryQuote?.delivery_quote_token,
    deliveryQuoteReady,
    deliveryQuoteStatus,
    promo,
    quoteKey,
    pricingRetry,
  ]);

  const currentQuote = pricedQuoteKey === quoteKey && deliveryQuoteReady && !quoteLoading && !quoteError &&
    !(cart.fulfillmentType === 'DELIVERY' && quote?.delivery_fee_is_estimate) &&
    promo.hydrated !== false && session.loaded !== false ? quote : null;
  const tipCents = currentQuote?.driver_tip_cents ?? 0;
  const rewardBlockedReason = wingsRewardBlockedReason(promo.applyWingsReward, currentQuote);
  const onlinePaymentsEnabled = Boolean(
    stripeConfig?.online_payments_enabled && stripeConfig.configured,
  );
  const pricingBlock = checkoutPricingBlock({
    quoteIsCurrent: pricedQuoteKey === quoteKey && promo.hydrated !== false && session.loaded !== false,
    quoteLoading,
    quote: currentQuote,
    quoteError,
    promoCode: promo.promoCode,
    rewardBlockedReason,
  });
  useEffect(() => {
    if (currentQuote && !pricingBlock) setLastDisplayPrice({ key: displayPriceKey, quote: currentQuote });
  }, [currentQuote, pricingBlock, displayPriceKey]);
  const detailsReady = orderSetup.ready && orderSetup.confirmed && cart.isCartHydrated && !cart.isCartHydrating &&
    (cart.fulfillmentType !== 'DELIVERY' || hasCompleteDeliveryAddress);
  const pricingFailed = Boolean(quoteError || deliveryQuoteError);
  const displayQuote = !detailsReady ? null : currentQuote ?? (session.loaded && promo.hydrated !== false && !pricingFailed &&
    deliveryQuoteReady && lastDisplayPrice?.key === displayPriceKey ? lastDisplayPrice.quote : null);
  const displayOnly = Boolean(displayQuote && !currentQuote);
  const provisionalSubtotal = useMemo(() => calculateCartSubtotal(cart.items), [cart.items]);
  const displayDiscountRows = useMemo(() => promoDiscountRows(displayQuote), [displayQuote]);
  const totalStatus = pricingFailed ? 'Total unavailable' : !detailsReady ? 'Review order details' :
    cart.fulfillmentType === 'DELIVERY' && !deliveryQuoteReady ? 'Confirming delivery fee' : 'Confirming total';
  const paymentOptions = customerPaymentOptions(cart.fulfillmentType);

  useEffect(() => {
    setPaymentMethod((current) => {
      const allowed = customerPaymentOptions(cart.fulfillmentType).some(
        (option) => option.value === current,
      );
      return allowed ? current : defaultCollectionPreference(cart.fulfillmentType);
    });
  }, [cart.fulfillmentType]);

  const placeOrder = useCallback(async () => {
    if (cart.items.length === 0 || submittingRef.current) return;
    if (!orderSetup.getConfirmedSetup()) {
      pendingSubmitRef.current = false;
      setSubmitError('Confirm your order details again before placing the order.');
      return;
    }
    if (pricingBlock) {
      setSubmitError(pricingBlock);
      return;
    }

    if (cart.fulfillmentType === "DELIVERY") {
      if (!line1.trim() || !postalCode.trim()) {
        setSubmitError("Enter your delivery address before placing the order.");
        return;
      }
      if (!deliveryQuoteReady || !deliveryQuote || !currentQuote) {
        setSubmitError(
          deliveryQuoteError ??
            "Wait for the delivery fee to be confirmed before placing the order.",
        );
        return;
      }
    }

    if (!session.authenticated || session.needsProfileCompletion) {
      authCompletedRef.current = false;
      pendingAuthReview.current = { key: authReviewKey, total: currentQuote!.final_payable_cents };
      pendingSubmitRef.current = true;
      setAuthInitialStep(session.authenticated && session.needsProfileCompletion ? 'profile' : 'login');
      setAuthVisible(true);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const payload: Record<string, unknown> = {
      location_id: cart.locationId,
      fulfillment_type: cart.fulfillmentType,
      items: checkoutItems(cart.items),
    };
    if (cart.scheduledFor) payload.scheduled_for = cart.scheduledFor;
    if (tipCents > 0) payload.driver_tip_cents = tipCents;
    if (cart.fulfillmentType === 'DELIVERY' && contactlessPref) payload.contactless_pref = contactlessPref;
    if (cart.fulfillmentType === "DELIVERY") {
      payload.address_snapshot_json = deliveryAddress;
      payload.delivery_quote_token = deliveryQuote!.delivery_quote_token;
    }
    payload.payment_method =
      onlinePaymentsEnabled && paymentMethod === "ONLINE_CARD"
        ? "ONLINE_CARD"
        : "PAY_AT_STORE";
    if (paymentMethod !== "ONLINE_CARD") {
      payload.collection_preference = paymentMethod;
    }
    const promoParams = quotePromoParams(promo);
    if (promoParams.promo_code) payload.promo_code = promoParams.promo_code;
    if (promoParams.apply_wings_reward) payload.apply_wings_reward = true;

    const logicalPayload = { ...payload };
    delete logicalPayload.delivery_quote_token;
    const submissionFingerprint = JSON.stringify(logicalPayload);
    if (
      !checkoutAttemptRef.current ||
      checkoutAttemptRef.current.fingerprint !== submissionFingerprint
    ) {
      checkoutAttemptRef.current = {
        fingerprint: submissionFingerprint,
        idempotencyKey: makeIdempotencyKey(),
      };
    }

    try {
      // Revalidate immediately before payment/order submission. Quotes never redeem stamps.
      const freshQuote = await quoteSelection(promo);
      const block = checkoutPricingBlock({ quoteLoading: false, quote: freshQuote, quoteError: null,
        promoCode: promo.promoCode, rewardBlockedReason: wingsRewardBlockedReason(promo.applyWingsReward, freshQuote) });
      if (block) { setQuote(freshQuote); setPricedQuoteKey(quoteKey); throw new Error(block); }
      if (freshQuote.final_payable_cents !== currentQuote?.final_payable_cents || freshQuote.driver_tip_cents !== currentQuote?.driver_tip_cents) {
        setQuote(freshQuote); setPricedQuoteKey(quoteKey);
        throw new Error('Your order total changed. Please review the updated total before placing your order.');
      }
      let stripePaymentIntentId =
        paidIntentRef.current?.fingerprint === submissionFingerprint
          ? paidIntentRef.current.paymentIntentId
          : null;
      if (onlinePaymentsEnabled && paymentMethod === "ONLINE_CARD") {
        if (!stripePaymentIntentId) {
          const intentRes = await withSilentRefresh(
          () =>
            apiFetch("/api/v1/payments/stripe/payment-intent", {
              method: "POST",
              locationId: cart.locationId,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                location_id: cart.locationId,
                fulfillment_type: cart.fulfillmentType,
                items: checkoutItems(cart.items),
                scheduled_for: cart.scheduledFor ?? undefined,
                driver_tip_cents: tipCents,
                delivery_quote_token: deliveryQuote?.delivery_quote_token,
                address_snapshot_json:
                  cart.fulfillmentType === "DELIVERY"
                    ? deliveryAddress
                    : undefined,
                ...quotePromoParams(promo),
              }),
            }),
          session.refresh,
          session.clear,
        );
          const intentBody = (await intentRes.json().catch(() => null)) as
          | ApiEnvelope<StripePaymentIntentResponse>
          | null;
          const intent = intentBody?.data;
          if (!intentRes.ok || !intent) {
            throw new Error(getApiErrorMessage(intentBody, `Payment setup failed (${intentRes.status})`));
          }
          if (!intent.configured || !intent.client_secret || !intent.payment_intent_id) {
            throw new Error(intent.message ?? "Online card payments are not configured yet.");
          }
          const paymentBlock = paymentIntentPricingBlock(intent.amount_cents, intent.quote, freshQuote, promo);
          if (paymentBlock) {
            if (intent.quote) { setQuote(intent.quote); setPricedQuoteKey(quoteKey); }
            throw new Error(paymentBlock);
          }

          await initStripe({
            publishableKey: intent.publishable_key,
            merchantIdentifier: STRIPE_MERCHANT_IDENTIFIER,
          });

          const sheet = await initPaymentSheet({
            merchantDisplayName: intent.merchant_display_name || "Wings4U",
            paymentIntentClientSecret: intent.client_secret,
            returnURL: STRIPE_RETURN_URL,
          });
          if (sheet.error) {
            throw new Error(sheet.error.message);
          }

          if (latestCheckoutKey.current !== quoteKey) throw new Error('Your cart or account changed. Review your total before payment.');
          const payment = await presentPaymentSheet();
          if (payment.error) {
            throw new Error(payment.error.message || "Payment was cancelled.");
          }
          stripePaymentIntentId = intent.payment_intent_id;
          paidIntentRef.current = {
            fingerprint: submissionFingerprint,
            paymentIntentId: stripePaymentIntentId,
          };
        }
      } else {
        paidIntentRef.current = null;
      }

      if (stripePaymentIntentId) {
        payload.stripe_payment_intent_id = stripePaymentIntentId;
      }

      if (latestCheckoutKey.current !== quoteKey) throw new Error('Your cart or account changed. Review your order before continuing.');

      const idempotencyKey = checkoutAttemptRef.current.idempotencyKey;
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/checkout", {
            method: "POST",
            locationId: cart.locationId,
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(payload),
          }),
        session.refresh,
        session.clear,
      );
      const body = (await res.json().catch(() => null)) as
        | ApiEnvelope<CheckoutResponse>
        | null;
      if (!res.ok || !body?.data?.id) {
        const errorCode = getApiErrorCode(body);
        if (
          errorCode === "DELIVERY_QUOTE_EXPIRED" ||
          errorCode === "INVALID_DELIVERY_QUOTE"
        ) {
          setDeliveryQuote(null);
          setDeliveryQuoteRetryNonce((value) => value + 1);
        }
        throw new Error(getApiErrorMessage(body, `Checkout failed (${res.status})`));
      }
      const order = body.data;
      // Confirmation lives above the entry guard: clearing a scheduled cart may
      // invalidate setup, but must never hide a successfully created order.
      onSuccess(order);
      checkoutAttemptRef.current = null;
      paidIntentRef.current = null;
      // Clear the applied promo/reward and refresh rewards + wallet so the
      // redeemed stamps / credit reflect immediately.
      promo.clearAll();
      void account.refresh("refresh");
      cart.clear();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to place order";
      const code = getApiErrorCode((cause as { body?: unknown })?.body);
      if (code === 'DELIVERY_QUOTE_EXPIRED' || code === 'INVALID_DELIVERY_QUOTE') {
        setDeliveryQuote(null); setDeliveryQuoteRetryNonce(value => value + 1);
      }
      if (promo.promoCode && isPromoRejectedQuoteError(message)) { promo.clearPromoCode(); setPromoNotice(message); setQuote(null); }
      setSubmitError(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    account,
    authReviewKey,
    onSuccess,
    orderSetup,
    cart,
    contactlessPref,
    deliveryAddress,
    deliveryQuote,
    deliveryQuoteError,
    deliveryQuoteReady,
    initPaymentSheet,
    line1,
    postalCode,
    presentPaymentSheet,
    promo,
    currentQuote,
    router,
    session,
    onlinePaymentsEnabled,
    paymentMethod,
    pricingBlock,
    quoteKey,
    submitting,
    tipCents,
  ]);

  useEffect(() => {
    if (!pendingSubmitRef.current) return;
    if (authVisible || !session.authenticated || session.needsProfileCompletion || !currentQuote || pricingBlock || !orderSetup.getConfirmedSetup()) return;
    pendingSubmitRef.current = false;
    if (pendingAuthReview.current?.key !== authReviewKey || pendingAuthReview.current?.total !== currentQuote.final_payable_cents) {
      setSubmitError('Your order changed after sign-in. Please review the details and total before placing your order.');
      return;
    }
    void placeOrder();
  }, [placeOrder, session.authenticated, session.needsProfileCompletion, currentQuote, pricingBlock, orderSetup, authVisible, authReviewKey]);

  const placeDisabled = submitting || Boolean(pricingBlock) || !orderSetup.ready || !orderSetup.confirmed ||
    cart.isCartHydrating || !cart.isCartHydrated || (cart.fulfillmentType === 'DELIVERY' && !deliveryQuoteReady);
  const recovery = quoteRecovery;

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
      <StatusBar style="dark" />
      <AuthSheet
        visible={authVisible}
        initialStep={authInitialStep}
        onComplete={() => {
          authCompletedRef.current = true;
          setPricingRetry(value => value + 1);
        }}
        onClose={() => { if (!authCompletedRef.current) pendingSubmitRef.current = false; authCompletedRef.current = false; setAuthVisible(false); }}
      />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {cart.items.length === 0 ? (
            <View style={styles.emptyState}>
              <ShoppingBag size={36} color="#E53C3C" />
              <Text style={styles.emptyTitle}>Nothing to checkout</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/")}>
                <Text style={styles.primaryButtonText}>Browse menu</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Cart" style={styles.backButton} onPress={() => router.replace('/(tabs)/cart')}>
                <ArrowLeft size={18} color="#30241F" /><Text style={styles.backText}>Back to Cart</Text>
              </TouchableOpacity>
              <Text accessibilityRole="header" style={styles.pageTitle}>CHECKOUT</Text>
              <Text style={styles.pageSubtitle}>A few details, then the good stuff.</Text>
              <View style={styles.orderDetailsBar}>
                <OrderSetupSummary singleLine readOnly />
              </View>

              <Section title="Your order">
                {!displayQuote ? <Text style={styles.lineMeta}>Estimated item prices</Text> : null}
                {cart.items.map((item, index) => {
                  const details = checkoutItemDetails(item);
                  const expanded = expandedItems.has(item.key);
                  const line = displayQuote?.lines[index];
                  return (
                    <View key={item.key} style={styles.lineRow}>
                      <View style={styles.lineMain}>
                        <Text style={styles.lineTitle}>
                          {item.quantity}x {item.name}
                        </Text>
                        {details.length ? (
                          <>
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} details for ${item.name}`} accessibilityState={{ expanded }} style={styles.detailToggle}
                              onPress={() => setExpandedItems(previous => { const next = new Set(previous); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })}>
                              <Text style={styles.deliveryActionText}>{expanded ? 'Hide details' : 'View details'}</Text>
                              {expanded ? <ChevronUp size={14} color="#E53C3C" /> : <ChevronDown size={14} color="#E53C3C" />}
                            </TouchableOpacity>
                            {expanded && details.map((detail, i) => <Text key={i} style={styles.lineMeta}>{detail}</Text>)}
                          </>
                        ) : null}
                      </View>
                      <Text style={styles.linePrice} accessibilityLabel={`${displayQuote ? 'Item price' : 'Estimated item price'} for ${item.name}`}>
                        {line && Number.isFinite(line.line_total_cents) ? cents(line.line_total_cents) : provisionalPrice(getCartItemSubtotal(item))}
                      </Text>
                    </View>
                  );
                })}
              </Section>

              {cart.fulfillmentType === "DELIVERY" ? (
                <Section title="Delivery">
                  <View style={styles.addressCard}>
                    <MapPin size={20} color="#E53C3C" />
                    <View style={styles.lineMain}>
                      <Text style={styles.lineTitle}>{line1 || 'Choose a delivery address'}</Text>
                      <Text style={styles.lineMeta}>{deliveryAddress.city}, {deliveryAddress.postal_code}</Text>
                    </View>
                  </View>
                  <TouchableOpacity accessibilityRole="button" style={styles.detailToggle} onPress={() => orderSetup.openOrderSetup('DELIVERY')}>
                    <Text style={styles.deliveryActionText}>Change Address</Text>
                  </TouchableOpacity>
                  {deliveryQuoteStatus === "loading" ? (
                    <Text style={styles.deliveryStatusText}>
                      Estimating delivery fee…
                    </Text>
                  ) : null}
                  {deliveryQuoteStatus === "ready" &&
                  deliveryQuote?.attribution ? (
                    <Text style={styles.deliveryStatusText}>
                      Calculated using {deliveryQuote.attribution}
                    </Text>
                  ) : null}
                  {deliveryQuoteError ? (
                    <View style={styles.deliveryErrorBlock}>
                      <Text style={styles.errorText}>{deliveryQuoteError}</Text>
                      <View style={styles.deliveryActions}>
                        <TouchableOpacity
                          style={styles.deliveryActionButton}
                          accessibilityRole="button"
                          onPress={() =>
                            setDeliveryQuoteRetryNonce((value) => value + 1)
                          }
                        >
                          <Text style={styles.deliveryActionText}>Retry</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deliveryActionButton}
                          accessibilityRole="button"
                          onPress={() => orderSetup.openOrderSetup("PICKUP")}
                        >
                          <Text style={styles.deliveryActionText}>
                            Choose pickup
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                  <Text style={styles.fieldLabel}>Delivery handoff (optional)</Text>
                  <View style={styles.chipRow}>
                    {[
                      ["", "None"],
                      ["HAND_TO_ME", "Hand to me"],
                      ["LEAVE_AT_DOOR", "Leave at door"],
                      ["CALL_ON_ARRIVAL", "Call on arrival"],
                      ["TEXT_ON_ARRIVAL", "Text on arrival"],
                    ].map(([value, label]) => {
                      const active = contactlessPref === value;
                      return (
                        <TouchableOpacity
                          key={value}
                          accessibilityRole="button"
                          accessibilityLabel={`Delivery handoff: ${label}`}
                          accessibilityState={{ selected: active }}
                          disabled={submitting}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() => setContactlessPref(value as typeof contactlessPref)}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Section>
              ) : null}

              <Section title="Total">
                {!displayQuote ? <View accessibilityLabel="Checkout pricing status" accessibilityLiveRegion="polite" style={styles.totalStatus}>
                  {!pricingFailed && detailsReady ? <ActivityIndicator accessibilityLabel={totalStatus} color="#E53C3C" size="small" /> : null}
                  <Text style={[styles.deliveryStatusText, styles.totalStatusText]}>{totalStatus}</Text>
                </View> : null}
                {displayOnly ? <Text accessibilityLiveRegion="polite" style={styles.lineMeta}>Previous prices. Your new total is being confirmed.</Text> : null}
                <SummaryRow label={displayQuote ? 'Subtotal' : 'Estimated subtotal'} value={displayQuote ? cents(displayQuote.item_subtotal_cents) : provisionalPrice(provisionalSubtotal)} />
                {displayDiscountRows.map((row) => (
                  <SummaryRow
                    key={row.key}
                    label={row.label}
                    value={`-${cents(row.amountCents)}`}
                    discount
                  />
                ))}
                <SummaryRow label="Tax" value={displayQuote ? cents(displayQuote.tax_cents) : '—'} />
                {cart.fulfillmentType === "DELIVERY" ? (
                  <SummaryRow
                    label="Delivery"
                    value={
                      !displayQuote
                        ? (deliveryQuoteStatus === 'error' ? 'Unavailable' : '—')
                        : displayQuote.delivery_fee_waived
                          ? <>{displayQuote.delivery_fee_stated_cents > 0 ? <Text style={{ textDecorationLine: "line-through" }}>{cents(displayQuote.delivery_fee_stated_cents)} </Text> : null}Free</>
                          : cents(displayQuote.delivery_fee_cents)
                    }
                  />
                ) : null}
                {(displayQuote ? displayQuote.driver_tip_cents > 0 : cart.driverTipPercent !== 'none') ? (
                  <SummaryRow
                    label="Tip"
                    value={displayQuote ? cents(displayQuote.driver_tip_cents) : '—'}
                  />
                ) : null}
                <View style={styles.divider} />
                <SummaryRow
                  label="Payable"
                  value={displayQuote ? cents(displayQuote.final_payable_cents) : pricingFailed ? 'Unavailable' : '—'}
                  total
                />
                {rewardBlockedReason ? (
                  <Text style={styles.noticeText}>{rewardBlockedReason}</Text>
                ) : null}
                {promoNotice ? (
                  <Text style={styles.noticeText}>{promoNotice}</Text>
                ) : null}
                {pricingBlock &&
                pricingBlock !== quoteError &&
                pricingBlock !== rewardBlockedReason ? (
                  <Text style={styles.noticeText}>{pricingBlock}</Text>
                ) : null}
                {quoteError ? <Text accessibilityRole="alert" style={styles.errorText}>{quoteError}</Text> : null}
                {quoteError ? <View style={styles.deliveryActions}>
                  <TouchableOpacity style={styles.deliveryActionButton} accessibilityRole="button" onPress={() => {
                    if (recovery === 'sign_in') { pendingSubmitRef.current = false; authCompletedRef.current = false; setAuthInitialStep('login'); setAuthVisible(true); }
                    else if (recovery === 'add_items') router.push('/(tabs)/menu');
                    else if (['time', 'delivery', 'review'].includes(recovery)) orderSetup.openOrderSetup(cart.fulfillmentType);
                    else if (recovery === 'items') router.push('/(tabs)/cart');
                    else { setQuoteError(null); setPricingRetry(value => value + 1); }
                  }}><Text style={styles.deliveryActionText}>{recovery === 'sign_in' ? 'Sign in' : recovery === 'add_items' ? 'Add more items' : ['time', 'delivery', 'review'].includes(recovery) ? 'Change Order Details' : recovery === 'items' ? 'Review cart items' : 'Retry pricing'}</Text></TouchableOpacity>
                </View> : null}
                {submitError ? <Text accessibilityRole="alert" style={styles.errorText}>{submitError}</Text> : null}
              </Section>

              <Section title="Payment">
                {paymentOptions.map((option) => {
                  const active = paymentMethod === option.value;
                  const iconColor = active ? "#E53C3C" : "#75665C";
                  return (
                    <PaymentOption
                      key={option.value}
                      title={option.title}
                      detail={option.detail}
                      icon={
                        option.value === "CARD_ON_DELIVERY" ? (
                          <CreditCard size={20} color={iconColor} />
                        ) : (
                          <Wallet size={20} color={iconColor} />
                        )
                      }
                      active={active}
                      disabled={submitting}
                      onPress={() => setPaymentMethod(option.value)}
                    />
                  );
                })}
              </Section>

            </>
          )}
        </ScrollView>
        {cart.items.length > 0 && <View style={styles.checkoutDock}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={paymentMethod === 'ONLINE_CARD' ? 'Pay and place order' : 'Place order'} accessibilityState={{ disabled: placeDisabled, busy: submitting }}
            style={[styles.placeButton, placeDisabled && styles.disabledButton]} onPress={placeOrder} disabled={placeDisabled}>
            {submitting ? <><ActivityIndicator color="#FFFFFF" /><Text style={styles.placeButtonText}>Placing order...</Text></> : <Text style={styles.placeButtonText}>{paymentMethod === 'ONLINE_CARD' ? 'Pay and place order' : 'Place order'}</Text>}
          </TouchableOpacity>
        </View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PaymentOption({
  title,
  detail,
  icon,
  active,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.paymentOption,
        active && styles.paymentOptionActive,
        disabled && styles.paymentOptionDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      activeOpacity={0.85}
    >
      <View style={[styles.paymentIcon, active && styles.paymentIconActive]}>
        {icon}
      </View>
      <View style={styles.paymentTextWrap}>
        <Text style={[styles.paymentTitle, active && styles.paymentTitleActive]}>
          {title}
        </Text>
        <Text style={[styles.paymentDetail, active && styles.paymentDetailActive]}>
          {detail}
        </Text>
      </View>
      <View style={[styles.paymentRadio, active && styles.paymentRadioActive]} />
    </TouchableOpacity>
  );
}

function SummaryRow({
  label,
  value,
  total,
  discount,
}: {
  label: string;
  value: React.ReactNode;
  total?: boolean;
  discount?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, total && styles.totalLabel]}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          total && styles.totalValue,
          discount && styles.discountValue,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF9F5",
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backText: { color: '#75665C', fontSize: 13, fontWeight: '600' },
  pageTitle: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 32, color: '#30241F', marginTop: 12, letterSpacing: 1 },
  pageSubtitle: { color: '#75665C', marginTop: 8, marginBottom: 8, fontSize: 14, lineHeight: 21 },
  orderDetailsBar: { padding: 16, backgroundColor: '#FFF0EA', borderRadius: 18, marginTop: 16, borderWidth: 1, borderColor: '#EFE4DE' },
  detailToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  fieldLabel: { color: '#75665C', fontSize: 13, marginTop: 16, fontWeight: '600' },
  checkoutDock: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EFE4DE' },
  totalStatus: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  totalStatusText: { flexShrink: 1, marginTop: 0 },
  emptyState: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  emptyTitle: {
    color: "#30241F",
    fontSize: 20,
    fontWeight: "900",
  },
  section: {
    marginTop: 16,
    backgroundColor: "#FFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFE4DE",
    padding: 18,
  },
  sectionTitle: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: "#30241F",
    fontSize: 21,
    fontWeight: "700",
    marginBottom: 12,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#EFE4DE",
    gap: 12,
  },
  lineMain: {
    flex: 1,
  },
  lineTitle: {
    color: "#30241F",
    fontSize: 14,
    fontWeight: "900",
  },
  lineMeta: {
    color: "#75665C",
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  linePrice: {
    flexShrink: 1,
    maxWidth: "40%",
    textAlign: "right",    color: "#E53C3C",
    fontSize: 14,
    fontWeight: "900",
  },
  rowGap: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  inputBox: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#F6EEE9",
    borderWidth: 1,
    borderColor: "#EFE4DE",
    paddingHorizontal: 12,
    color: "#30241F",
    fontWeight: "700",
  },
  flexInput: {
    flex: 1,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chip: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#EFE4DE",
  },
  chipActive: {
    backgroundColor: "#E53C3C",
    borderColor: "#E53C3C",
  },
  chipText: {
    color: "#75665C",
    fontSize: 12,
    fontWeight: "800",
  },
  chipTextActive: {
    color: "#FFF",
  },
  paymentOption: {
    minHeight: 72,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#EFE4DE",
    backgroundColor: "#FFF",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  paymentOptionActive: {
    borderColor: "#E53C3C",
    backgroundColor: "#FFF",
    shadowColor: "rgba(229, 60, 60, 0.12)",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  paymentOptionDisabled: {
    opacity: 0.52,
  },
  paymentIcon: {
    width: 42,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0EA",
  },
  paymentIconActive: {
    backgroundColor: "#FFF0EA",
  },
  paymentTextWrap: {
    flex: 1,
  },
  paymentTitle: {
    color: "#30241F",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentTitleActive: {
    color: "#E53C3C",
  },
  paymentDetail: {
    color: "#75665C",
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  paymentDetailActive: {
    color: "#75665C",
  },
  paymentRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#D9D9D9",
  },
  paymentRadioActive: {
    borderColor: "#E53C3C",
    backgroundColor: "#E53C3C",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 9,
    gap: 12,
  },
  summaryLabel: {
    flexShrink: 1,
    color: "#75665C",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryValue: {
    flexShrink: 1,
    textAlign: 'right',
    color: "#30241F",
    fontSize: 14,
    fontWeight: "900",
  },
  totalLabel: {
    color: "#30241F",
    fontSize: 17,
  },
  totalValue: {
    color: "#E53C3C",
    fontSize: 20,
  },
  divider: {
    height: 1,
    backgroundColor: "#EFE4DE",
    marginVertical: 4,
  },
  deliveryStatusText: {
    color: "#75665C",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },
  deliveryErrorBlock: {
    marginTop: 2,
  },
  deliveryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  deliveryActionButton: {
    borderWidth: 1,
    borderColor: "#E53C3C",
    borderRadius: 9,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 10,
  },
  deliveryActionText: {
    color: "#B91C1C",
    fontSize: 12,
    fontWeight: "800",
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 8,
  },
  noticeText: {
    color: "#B45309",
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 8,
  },
  discountValue: {
    color: "#16A34A",
  },
  primaryButton: {
    backgroundColor: "#E53C3C",
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "900",
  },
  placeButton: {
    minHeight: 54,
    paddingVertical: 14,
    paddingHorizontal: 16,
    width: "100%",
    maxWidth: 608,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E53C3C",
    marginTop: 10,
  },
  disabledButton: {
    opacity: 0.65,
  },
  placeButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
  },
});
