import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { CheckCircle2, MapPin, MessageSquareText, ShoppingBag } from "lucide-react-native";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AuthSheet } from "../src/components/auth-sheet";
import { useCart } from "../src/context/cart";
import { useSession, withSilentRefresh } from "../src/context/session";
import { apiFetch, apiJson, getApiErrorMessage } from "../src/lib/api";
import { cents } from "../src/lib/format";
import type { CartItem, CartQuoteResponse, CheckoutResponse } from "../src/lib/types";

const FIXED_DELIVERY_CITY = "London";

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

export default function CheckoutScreen() {
  const router = useRouter();
  const cart = useCart();
  const session = useSession();
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");
  const [contactlessPref, setContactlessPref] = useState<
    "" | "HAND_TO_ME" | "LEAVE_AT_DOOR" | "CALL_ON_ARRIVAL" | "TEXT_ON_ARRIVAL"
  >("");
  const [line1, setLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authVisible, setAuthVisible] = useState(false);
  const pendingSubmitRef = useRef(false);

  const subtotal = useMemo(
    () =>
      cart.items.reduce(
        (sum, item) => sum + cartItemUnitCents(item) * item.quantity,
        0,
      ),
    [cart.items],
  );

  const tipCents = useMemo(() => {
    if (cart.fulfillmentType !== "DELIVERY" || cart.driverTipPercent === "none") {
      return 0;
    }
    return Math.round((subtotal * cart.driverTipPercent) / 100);
  }, [cart.driverTipPercent, cart.fulfillmentType, subtotal]);

  const quoteKey = useMemo(
    () =>
      JSON.stringify({
        items: checkoutItems(cart.items),
        fulfillmentType: cart.fulfillmentType,
        scheduledFor: cart.scheduledFor,
        tipCents,
      }),
    [cart.fulfillmentType, cart.items, cart.scheduledFor, tipCents],
  );

  useEffect(() => {
    if (cart.items.length === 0) {
      setQuote(null);
      setQuoteError(null);
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
            }),
          });
          if (!cancelled) {
            setQuote(envelope.data ?? null);
          }
        } catch (cause) {
          if (!cancelled) {
            setQuote(null);
            setQuoteError(cause instanceof Error ? cause.message : "Unable to quote order");
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
  }, [cart, quoteKey, tipCents]);

  const placeOrder = useCallback(async () => {
    if (cart.items.length === 0 || submitting) return;

    if (cart.fulfillmentType === "DELIVERY") {
      if (!line1.trim() || !postalCode.trim()) {
        setSubmitError("Enter your delivery address before placing the order.");
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
      payload.address_snapshot_json = {
        line1: line1.trim(),
        city: FIXED_DELIVERY_CITY,
        postal_code: postalCode.trim().toUpperCase(),
      };
    }

    const idempotencyKey = makeIdempotencyKey();
    try {
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
        throw new Error(getApiErrorMessage(body, `Checkout failed (${res.status})`));
      }
      const order = body.data;
      cart.clear();
      router.replace(`/orders/${order.id}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Unable to place order");
    } finally {
      setSubmitting(false);
    }
  }, [
    cart,
    contactlessPref,
    line1,
    orderNotes,
    postalCode,
    router,
    session,
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
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <AuthSheet
        visible={authVisible}
        initialStep={session.authenticated ? "profile" : "phone"}
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

              <Section title="Total">
                <SummaryRow label="Subtotal" value={cents(quote?.item_subtotal_cents ?? subtotal)} />
                <SummaryRow label="Tax" value={quoteLoading ? "..." : cents(quote?.tax_cents ?? 0)} />
                {cart.fulfillmentType === "DELIVERY" ? (
                  <>
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
                    <SummaryRow label="Tip" value={cents(quote?.driver_tip_cents ?? tipCents)} />
                  </>
                ) : null}
                <View style={styles.divider} />
                <SummaryRow
                  label="Payable"
                  value={quoteLoading ? "..." : cents(quote?.final_payable_cents ?? subtotal)}
                  total
                />
                {quoteError ? <Text style={styles.errorText}>{quoteError}</Text> : null}
                {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
              </Section>

              <TouchableOpacity
                style={[styles.placeButton, submitting && styles.disabledButton]}
                onPress={placeOrder}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.placeButtonText}>Place order</Text>
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

function SummaryRow({
  label,
  value,
  total,
}: {
  label: string;
  value: string;
  total?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, total && styles.totalLabel]}>{label}</Text>
      <Text style={[styles.summaryValue, total && styles.totalValue]}>{value}</Text>
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
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 8,
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
