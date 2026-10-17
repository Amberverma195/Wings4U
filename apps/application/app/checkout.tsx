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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { initStripe, useStripe } from "@stripe/stripe-react-native";
import {
  CheckCircle2,
  CreditCard,
  MapPin,
  MessageSquareText,
  ShoppingBag,
  Wallet,
} from "lucide-react-native";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AuthSheet } from "../src/components/auth-sheet";
import { CheckoutEntryGuard } from "../src/components/checkout-entry-guard";
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
import { promoBenefitLabel } from "../src/lib/deals-display";
import type {
  ActivePromo,
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

function cartItemUnitCents(item: CartItem): number {
  return (
    item.base_price_cents +
    item.modifier_selections.reduce(
      (sum, selection) => sum + selection.price_delta_cents,
      0,
    )
  );
}

function cartItemDetails(item: CartItem): string[] {
  const details = [
    ...item.modifier_selections.map((selection) => selection.option_name),
    ...(item.removed_ingredients ?? []).map((ingredient) => `No ${ingredient.name}`),
  ];
  const payload = item.builder_payload;
  if (payload?.builder_type === "WINGS" || payload?.builder_type === "WING_COMBO") {
    details.unshift(...payload.flavour_slots.map((slot) => slot.flavour_name));
  }
  if (payload?.builder_type === "LUNCH_SPECIAL") {
    details.unshift(payload.child_name);
  }
  if (item.special_instructions.trim()) details.push(item.special_instructions.trim());
  return details;
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
  return <CheckoutEntryGuard><CheckoutScreenContent /></CheckoutEntryGuard>;
}

function CheckoutScreenContent() {
  const router = useRouter();
  const cart = useCart();
  const orderSetup = useOrderSetup();
  const promo = usePromo();
  const account = useAccountData();
  const session = useSession();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [promoNotice, setPromoNotice] = useState<string | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [contactlessPref, setContactlessPref] = useState<
    "" | "HAND_TO_ME" | "LEAVE_AT_DOOR" | "CALL_ON_ARRIVAL" | "TEXT_ON_ARRIVAL"
  >("");
  const line1 = orderSetup.deliveryAddress?.line1 ?? "";
  const postalCode = orderSetup.deliveryAddress?.postal_code ?? "";
  const setLine1 = (value: string) => orderSetup.setDeliveryAddress({ line1: value, city: FIXED_DELIVERY_CITY, postal_code: postalCode });
  const setPostalCode = (value: string) => orderSetup.setDeliveryAddress({ line1, city: FIXED_DELIVERY_CITY, postal_code: value });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authVisible, setAuthVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    defaultCollectionPreference("PICKUP"),
  );
  const submittingRef = useRef(false);
  const [stripeConfig, setStripeConfig] = useState<StripeConfigResponse | null>(null);
  const [deliveryQuote, setDeliveryQuote] =
    useState<DeliveryQuoteResponse | null>(null);
  const [deliveryQuoteStatus, setDeliveryQuoteStatus] =
    useState<DeliveryQuoteStatus>("idle");
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(
    null,
  );
  const [deliveryQuoteRetryNonce, setDeliveryQuoteRetryNonce] = useState(0);
  const pendingSubmitRef = useRef(false);
  const checkoutAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const paidIntentRef = useRef<{
    fingerprint: string;
    paymentIntentId: string;
  } | null>(null);

  const subtotal = useMemo(
    () =>
      cart.items.reduce(
        (sum, item) => sum + cartItemUnitCents(item) * item.quantity,
        0,
      ),
    [cart.items],
  );

  const subtotalForTip = quote?.item_subtotal_cents ?? subtotal;
  const tipCents = useMemo(() => {
    if (cart.driverTipPercent === "none") return 0;
    return Math.round((subtotalForTip * cart.driverTipPercent) / 100);
  }, [cart.driverTipPercent, subtotalForTip]);

  const applyCoupon = (code: string) => {
    setPromoNotice(null);
    promo.applyPromoCode(code);
  };

  const applyReward = () => {
    setPromoNotice(null);
    promo.redeemWingsReward();
  };

  const rewards = account.data.wingsRewards;
  const rewardEligible = Boolean(
    rewards &&
      rewards.stamps_per_reward > 0 &&
      rewards.available_stamps >= rewards.stamps_per_reward,
  );
  const availableCoupons: ActivePromo[] = account.data.promos.filter(
    (candidate) => !candidate.autoApply,
  );

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
  const deliveryQuoteReady =
    cart.fulfillmentType !== "DELIVERY" ||
    (deliveryQuoteStatus === "ready" && deliveryQuote !== null);

  const quoteKey = useMemo(
    () =>
      JSON.stringify({
        items: checkoutItems(cart.items),
        fulfillmentType: cart.fulfillmentType,
        scheduledFor: cart.scheduledFor,
        tipCents,
        deliveryQuoteToken: deliveryQuote?.delivery_quote_token ?? null,
        promoCode: promo.promoCode,
        applyWingsReward: promo.applyWingsReward,
      }),
    [
      cart.fulfillmentType,
      cart.items,
      cart.scheduledFor,
      deliveryQuote?.delivery_quote_token,
      tipCents,
      promo.promoCode,
      promo.applyWingsReward,
    ],
  );

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
          setDeliveryQuote(body.data);
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
    const timeout = setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      void (async () => {
        try {
          const envelope = await apiJson<CartQuoteResponse>("/api/v1/cart/quote", {
            method: "POST",
            locationId: cart.locationId,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location_id: cart.locationId,
              fulfillment_type: cart.fulfillmentType,
              items: checkoutItems(cart.items),
              scheduled_for: cart.scheduledFor ?? undefined,
              driver_tip_cents: tipCents,
              delivery_quote_token:
                cart.fulfillmentType === "DELIVERY"
                  ? deliveryQuote?.delivery_quote_token
                  : undefined,
              address_snapshot_json:
                cart.fulfillmentType === "DELIVERY"
                  ? deliveryAddress
                  : undefined,
              ...quotePromoParams(promo),
            }),
          });
          if (!cancelled) {
            setQuote(envelope.data ?? null);
          }
        } catch (cause) {
          if (!cancelled) {
            const message =
              cause instanceof Error ? cause.message : "Unable to quote order";
            // Drop a server-rejected promo and re-quote without it (mirrors web).
            if (isPromoRejectedQuoteError(message) && promo.promoCode) {
              promo.clearPromoCode();
              setPromoNotice(message);
            } else {
              setQuote(null);
              setQuoteError(message);
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
    tipCents,
  ]);

  const discountRows = useMemo(() => promoDiscountRows(quote), [quote]);
  const rewardBlockedReason = wingsRewardBlockedReason(promo.applyWingsReward, quote);
  const payableCents = quote?.final_payable_cents ?? subtotal;
  const onlinePaymentsEnabled = Boolean(
    stripeConfig?.online_payments_enabled && stripeConfig.configured,
  );
  const pricingBlock = checkoutPricingBlock({
    quoteLoading,
    quote,
    quoteError,
    promoCode: promo.promoCode,
    rewardBlockedReason,
  });
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
      if (!deliveryQuoteReady || !deliveryQuote || !quote) {
        setSubmitError(
          deliveryQuoteError ??
            "Wait for the delivery fee to be confirmed before placing the order.",
        );
        return;
      }
      if (!contactlessPref) {
        setSubmitError("Choose a delivery handoff preference.");
        return;
      }
    }

    if (!session.authenticated || session.needsProfileCompletion) {
      pendingSubmitRef.current = true;
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
    if (orderNotes.trim()) payload.special_instructions = orderNotes.trim();
    if (contactlessPref) payload.contactless_pref = contactlessPref;
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
      if (!res.ok || !body?.data) {
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
      checkoutAttemptRef.current = null;
      paidIntentRef.current = null;
      // Clear the applied promo/reward and refresh rewards + wallet so the
      // redeemed stamps / credit reflect immediately.
      promo.clearAll();
      void account.refresh("refresh");
      cart.clear();
      router.replace(`/orders/${order.id}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Unable to place order");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    account,
    orderSetup,
    cart,
    contactlessPref,
    deliveryAddress,
    deliveryQuote,
    deliveryQuoteError,
    deliveryQuoteReady,
    initPaymentSheet,
    line1,
    orderNotes,
    postalCode,
    presentPaymentSheet,
    promo,
    quote,
    router,
    session,
    onlinePaymentsEnabled,
    paymentMethod,
    pricingBlock,
    submitting,
    tipCents,
  ]);

  useEffect(() => {
    if (!pendingSubmitRef.current) return;
    if (!session.authenticated || session.needsProfileCompletion) return;
    pendingSubmitRef.current = false;
    void placeOrder();
  }, [placeOrder, session.authenticated, session.needsProfileCompletion]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
      <StatusBar style="dark" />
      <AuthSheet
        visible={authVisible}
        initialStep={session.authenticated ? "profile" : "login"}
        onComplete={() => {
          pendingSubmitRef.current = true;
        }}
        onClose={() => setAuthVisible(false)}
      />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {cart.items.length === 0 ? (
            <View style={styles.emptyState}>
              <ShoppingBag size={36} color="#FF4D4D" />
              <Text style={styles.emptyTitle}>Nothing to checkout</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/")}>
                <Text style={styles.primaryButtonText}>Browse menu</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.banner}>
                <CheckCircle2 size={22} color="#16A34A" />
                <View style={styles.bannerTextWrap}>
                  <Text style={styles.bannerTitle}>Review and place order</Text>
                  <Text style={styles.bannerText}>
                    New orders are sent to the kitchen as soon as checkout succeeds.
                  </Text>
                </View>
              </View>

              <Section title="Order details">
                <OrderSetupSummary />
              </Section>

              <Section title="Order">
                {cart.items.map((item) => {
                  const details = cartItemDetails(item);
                  return (
                    <View key={item.key} style={styles.lineRow}>
                      <View style={styles.lineMain}>
                        <Text style={styles.lineTitle}>
                          {item.quantity}x {item.name}
                        </Text>
                        {details.length ? (
                          <Text style={styles.lineMeta} numberOfLines={3}>
                            {details.join(" • ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.linePrice}>
                        {cents(cartItemUnitCents(item) * item.quantity)}
                      </Text>
                    </View>
                  );
                })}
              </Section>

              <Section title="Deals & rewards">
                {promo.promoCode ? (
                  <View style={styles.appliedRow}>
                    <View style={styles.appliedInfo}>
                      <Text style={styles.appliedLabel}>Promo code</Text>
                      <Text style={styles.appliedValue}>{promo.promoCode}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={promo.clearPromoCode}
                      style={styles.removeChip}
                    >
                      <Text style={styles.removeChipText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : promo.applyWingsReward ? (
                  <View style={styles.appliedRow}>
                    <View style={styles.appliedInfo}>
                      <Text style={styles.appliedLabel}>Reward</Text>
                      <Text style={styles.appliedValue}>Free 1lb wings</Text>
                    </View>
                    <TouchableOpacity
                      onPress={promo.clearWingsReward}
                      style={styles.removeChip}
                    >
                      <Text style={styles.removeChipText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {rewardBlockedReason ? (
                  <Text style={styles.promoNotice}>{rewardBlockedReason}</Text>
                ) : null}
                {promoNotice ? (
                  <Text style={styles.promoNotice}>{promoNotice}</Text>
                ) : null}

                {!session.authenticated ? (
                  <Text style={styles.dealsHint}>
                    Sign in from the Deals tab to use coupons and rewards.
                  </Text>
                ) : (
                  <>
                    {rewardEligible && !promo.applyWingsReward ? (
                      <TouchableOpacity style={styles.dealOption} onPress={applyReward}>
                        <View style={styles.dealOptionInfo}>
                          <Text style={styles.dealOptionTitle}>Free 1lb wings</Text>
                          <Text style={styles.dealOptionMeta}>Redeem your wings reward</Text>
                        </View>
                        <Text style={styles.applyText}>Apply</Text>
                      </TouchableOpacity>
                    ) : null}

                    {availableCoupons.map((coupon) => {
                      const applied = promo.promoCode === coupon.code;
                      return (
                        <TouchableOpacity
                          key={coupon.id}
                          style={styles.dealOption}
                          disabled={applied}
                          onPress={() => applyCoupon(coupon.code)}
                        >
                          <View style={styles.dealOptionInfo}>
                            <Text style={styles.dealOptionTitle}>{coupon.name}</Text>
                            <Text style={styles.dealOptionMeta}>
                              {coupon.code} • {promoBenefitLabel(coupon)}
                            </Text>
                          </View>
                          <Text style={[styles.applyText, applied && styles.appliedText]}>
                            {applied ? "Applied" : "Apply"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {availableCoupons.length === 0 &&
                    !rewardEligible &&
                    !promo.promoCode &&
                    !promo.applyWingsReward ? (
                      <Text style={styles.dealsHint}>No coupons available right now.</Text>
                    ) : null}
                  </>
                )}
              </Section>

              <Section title="Add a tip">
                <View style={styles.tipRow}>
                  {(["none", 10, 15, 20] as const).map((tip) => {
                    const active = cart.driverTipPercent === tip;
                    return (
                      <TouchableOpacity
                        key={String(tip)}
                        style={[styles.tipButton, active && styles.tipButtonActive]}
                        onPress={() => cart.setDriverTipPercent(tip)}
                      >
                        <Text
                          style={[
                            styles.tipButtonText,
                            active && styles.tipButtonTextActive,
                          ]}
                        >
                          {tip === "none" ? "None" : `${tip}%`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>

              {cart.fulfillmentType === "DELIVERY" ? (
                <Section title="Delivery">
                  <View style={styles.inputWithIcon}>
                    <MapPin size={18} color="#FF4D4D" />
                    <TextInput
                      style={styles.input}
                      value={line1}
                      onChangeText={setLine1}
                      placeholder="Street address"
                      placeholderTextColor="#999"
                    />
                  </View>
                  <View style={styles.rowGap}>
                    <TextInput
                      style={[styles.inputBox, styles.flexInput]}
                      value={FIXED_DELIVERY_CITY}
                      editable={false}
                    />
                    <TextInput
                      style={[styles.inputBox, styles.flexInput]}
                      value={postalCode}
                      onChangeText={setPostalCode}
                      placeholder="Postal code"
                      placeholderTextColor="#999"
                      autoCapitalize="characters"
                    />
                  </View>
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
                          onPress={() =>
                            setDeliveryQuoteRetryNonce((value) => value + 1)
                          }
                        >
                          <Text style={styles.deliveryActionText}>Retry</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deliveryActionButton}
                          onPress={() => orderSetup.openOrderSetup("PICKUP")}
                        >
                          <Text style={styles.deliveryActionText}>
                            Choose pickup
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.chipRow}>
                    {[
                      ["HAND_TO_ME", "Hand to me"],
                      ["LEAVE_AT_DOOR", "Leave at door"],
                      ["CALL_ON_ARRIVAL", "Call"],
                      ["TEXT_ON_ARRIVAL", "Text"],
                    ].map(([value, label]) => {
                      const active = contactlessPref === value;
                      return (
                        <TouchableOpacity
                          key={value}
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

              <Section title="Notes">
                <View style={styles.inputWithIcon}>
                  <MessageSquareText size={18} color="#FF4D4D" />
                  <TextInput
                    style={[styles.input, styles.notesInput]}
                    value={orderNotes}
                    onChangeText={setOrderNotes}
                    placeholder="Order notes"
                    placeholderTextColor="#999"
                    multiline
                  />
                </View>
              </Section>

              <Section title="Payment">
                {paymentOptions.map((option) => {
                  const active = paymentMethod === option.value;
                  const iconColor = active ? "#EA580C" : "#FF4D4D";
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
                      onPress={() => setPaymentMethod(option.value)}
                    />
                  );
                })}
              </Section>

              <Section title="Total">
                <SummaryRow label="Subtotal" value={cents(quote?.item_subtotal_cents ?? subtotal)} />
                {discountRows.map((row) => (
                  <SummaryRow
                    key={row.key}
                    label={row.label}
                    value={`-${cents(row.amountCents)}`}
                    discount
                  />
                ))}
                <SummaryRow label="Tax" value={quoteLoading ? "..." : cents(quote?.tax_cents ?? 0)} />
                {cart.fulfillmentType === "DELIVERY" ? (
                  <SummaryRow
                    label="Delivery"
                    value={
                      quoteLoading
                        ? "..."
                        : quote?.delivery_fee_waived
                          ? "Free"
                          : cents(quote?.delivery_fee_cents ?? 0)
                    }
                  />
                ) : null}
                {cart.driverTipPercent !== "none" ? (
                  <SummaryRow
                    label="Tip"
                    value={cents(quote?.driver_tip_cents ?? tipCents)}
                  />
                ) : null}
                <View style={styles.divider} />
                <SummaryRow
                  label="Payable"
                  value={quoteLoading ? "..." : cents(quote?.final_payable_cents ?? subtotal)}
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
                {quoteError ? <Text style={styles.errorText}>{quoteError}</Text> : null}
                {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
              </Section>

              <TouchableOpacity
                style={[
                  styles.placeButton,
                  (submitting ||
                    Boolean(pricingBlock) ||
                    (cart.fulfillmentType === "DELIVERY" && !deliveryQuoteReady)) &&
                    styles.disabledButton,
                ]}
                onPress={placeOrder}
                disabled={
                  submitting ||
                  Boolean(pricingBlock) ||
                  (cart.fulfillmentType === "DELIVERY" && !deliveryQuoteReady)
                }
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.placeButtonText}>
                    {paymentMethod === "ONLINE_CARD" ? "Pay and place order" : "Place order"}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
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
  value: string;
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
    backgroundColor: "#FAFAFA",
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  emptyState: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  emptyTitle: {
    color: "#1A1A1A",
    fontSize: 20,
    fontWeight: "900",
  },
  banner: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EFEFEF",
    padding: 14,
    marginTop: 14,
  },
  bannerTextWrap: {
    flex: 1,
  },
  bannerTitle: {
    color: "#1A1A1A",
    fontWeight: "900",
    fontSize: 15,
  },
  bannerText: {
    color: "#666",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  section: {
    marginTop: 16,
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EFEFEF",
    padding: 14,
  },
  sectionTitle: {
    color: "#1A1A1A",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F4F4F4",
    gap: 12,
  },
  lineMain: {
    flex: 1,
  },
  lineTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "900",
  },
  lineMeta: {
    color: "#777",
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  linePrice: {
    color: "#FF4D4D",
    fontSize: 14,
    fontWeight: "900",
  },
  inputWithIcon: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#F8F8F8",
    borderWidth: 1,
    borderColor: "#EFEFEF",
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    color: "#1A1A1A",
    fontSize: 15,
    fontWeight: "600",
  },
  notesInput: {
    minHeight: 82,
    textAlignVertical: "top",
    paddingTop: 14,
  },
  rowGap: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  inputBox: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#F8F8F8",
    borderWidth: 1,
    borderColor: "#EFEFEF",
    paddingHorizontal: 12,
    color: "#1A1A1A",
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
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E8E8E8",
  },
  chipActive: {
    backgroundColor: "#FF4D4D",
    borderColor: "#FF4D4D",
  },
  chipText: {
    color: "#555",
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
    borderColor: "#ECECEC",
    backgroundColor: "#FFF",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  paymentOptionActive: {
    borderColor: "rgba(234, 88, 12, 0.55)",
    backgroundColor: "#FFF",
    shadowColor: "rgba(234, 88, 12, 0.25)",
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
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F0",
  },
  paymentIconActive: {
    backgroundColor: "rgba(234, 88, 12, 0.12)",
  },
  paymentTextWrap: {
    flex: 1,
  },
  paymentTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentTitleActive: {
    color: "#9A3412",
  },
  paymentDetail: {
    color: "#777",
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  paymentDetailActive: {
    color: "#4B5563",
  },
  paymentRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#D9D9D9",
  },
  paymentRadioActive: {
    borderColor: "#EA580C",
    backgroundColor: "#EA580C",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 9,
  },
  summaryLabel: {
    color: "#666",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryValue: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "900",
  },
  totalLabel: {
    color: "#1A1A1A",
    fontSize: 17,
  },
  totalValue: {
    color: "#FF4D4D",
    fontSize: 20,
  },
  divider: {
    height: 1,
    backgroundColor: "#EFEFEF",
    marginVertical: 4,
  },
  deliveryStatusText: {
    color: "#666",
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
    borderColor: "#FF4D4D",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
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
  appliedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(22,163,74,0.08)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  appliedInfo: {
    flex: 1,
  },
  appliedLabel: {
    color: "#15803D",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  appliedValue: {
    color: "#166534",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  removeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(185,28,28,0.08)",
  },
  removeChipText: {
    color: "#B91C1C",
    fontWeight: "800",
    fontSize: 12,
  },
  promoNotice: {
    color: "#B45309",
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  dealsHint: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    paddingVertical: 4,
  },
  dealOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EFEFEF",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  dealOptionInfo: {
    flex: 1,
    paddingRight: 10,
  },
  dealOptionTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "800",
  },
  dealOptionMeta: {
    color: "#777",
    fontSize: 12,
    marginTop: 3,
    fontWeight: "600",
  },
  applyText: {
    color: "#FF4D4D",
    fontWeight: "900",
    fontSize: 13,
  },
  appliedText: {
    color: "#16A34A",
  },
  tipRow: {
    flexDirection: "row",
    gap: 8,
  },
  tipButton: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#EFEFEF",
  },
  tipButtonActive: {
    borderColor: "#FF4D4D",
    backgroundColor: "rgba(255,77,77,0.08)",
  },
  tipButtonText: {
    color: "#666",
    fontWeight: "800",
    fontSize: 13,
  },
  tipButtonTextActive: {
    color: "#FF4D4D",
  },
  primaryButton: {
    backgroundColor: "#FF4D4D",
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
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF4D4D",
    marginTop: 16,
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
