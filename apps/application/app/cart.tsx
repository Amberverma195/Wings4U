import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react-native";
import { apiJson } from "../src/lib/api";
import { useCart, type CartContextValue } from "../src/context/cart";
import { usePromo } from "../src/context/promo";
import { useAccountData } from "../src/hooks/use-account-data";
import { useSession } from "../src/context/session";
import { promoBenefitLabel } from "../src/lib/deals-display";
import {
  isPromoRejectedQuoteError,
  promoDiscountRows,
  quotePromoParams,
  wingsRewardBlockedReason,
} from "../src/lib/promo-selection";
import type {
  ActivePromo,
  CartBuilderPayload,
  CartItem,
  CartQuoteResponse,
  FulfillmentType,
} from "../src/lib/types";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function lineSubtotal(item: CartItem): number {
  const modifiers = item.modifier_selections.reduce(
    (sum, selection) => sum + selection.price_delta_cents,
    0,
  );
  return (item.base_price_cents + modifiers) * item.quantity;
}

function driverTipCents(cart: CartContextValue): number {
  if (cart.fulfillmentType !== "DELIVERY" || cart.driverTipPercent === "none") {
    return 0;
  }
  const subtotal = cart.items.reduce((sum, item) => sum + lineSubtotal(item), 0);
  return Math.round((subtotal * cart.driverTipPercent) / 100);
}

function payloadSummary(payload: CartBuilderPayload | undefined): string[] {
  if (!payload) return [];
  if (payload.builder_type === "WINGS" || payload.builder_type === "WING_COMBO") {
    const flavours = payload.flavour_slots.map((slot) => slot.flavour_name);
    if (payload.extra_flavour) flavours.push(payload.extra_flavour.flavour_name);
    return flavours;
  }
  if (payload.builder_type === "LUNCH_SPECIAL") {
    return [payload.child_name];
  }
  return [];
}

function itemDetails(item: CartItem): string[] {
  const parts = [
    ...payloadSummary(item.builder_payload),
    ...item.modifier_selections.map((selection) => selection.option_name),
    ...(item.removed_ingredients ?? []).map((ingredient) => `No ${ingredient.name}`),
  ].filter(Boolean);
  if (item.special_instructions.trim()) {
    parts.push(item.special_instructions.trim());
  }
  return parts;
}

function buildQuotePayloadItems(items: CartItem[]) {
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

export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  const promo = usePromo();
  const account = useAccountData();
  const session = useSession();
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [promoNotice, setPromoNotice] = useState<string | null>(null);

  const quoteDependencyKey = useMemo(
    () =>
      JSON.stringify({
        items: buildQuotePayloadItems(cart.items),
        fulfillmentType: cart.fulfillmentType,
        scheduledFor: cart.scheduledFor,
        driverTipPercent: cart.driverTipPercent,
        promoCode: promo.promoCode,
        applyWingsReward: promo.applyWingsReward,
      }),
    [
      cart.driverTipPercent,
      cart.fulfillmentType,
      cart.items,
      cart.scheduledFor,
      promo.promoCode,
      promo.applyWingsReward,
    ],
  );

  const applyCoupon = (code: string) => {
    setPromoNotice(null);
    promo.applyPromoCode(code);
  };

  const applyReward = () => {
    setPromoNotice(null);
    promo.redeemWingsReward();
  };

  useEffect(() => {
    if (cart.items.length === 0) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
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
              items: buildQuotePayloadItems(cart.items),
              scheduled_for: cart.scheduledFor ?? undefined,
              driver_tip_cents: driverTipCents(cart),
              ...quotePromoParams(promo),
            }),
          });
          if (!cancelled) {
            setQuote(envelope.data ?? null);
          }
        } catch (cause) {
          if (!cancelled) {
            const message =
              cause instanceof Error ? cause.message : "Unable to price cart";
            // Server rejected the selected promo (invalid/expired/not eligible).
            // Drop it and let the effect re-quote without the code, keeping the
            // last good quote on screen meanwhile. Mirrors the website.
            if (isPromoRejectedQuoteError(message) && promo.promoCode) {
              promo.clearPromoCode();
              setPromoNotice(message);
            } else {
              setQuote(null);
              setQuoteError(message);
            }
          }
        } finally {
          if (!cancelled) {
            setQuoteLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [cart, quoteDependencyKey]);

  const localSubtotal = useMemo(
    () => cart.items.reduce((sum, item) => sum + lineSubtotal(item), 0),
    [cart.items],
  );

  const discountRows = useMemo(() => promoDiscountRows(quote), [quote]);
  const rewardBlockedReason = wingsRewardBlockedReason(promo.applyWingsReward, quote);
  const rewards = account.data.wingsRewards;
  const rewardEligible = Boolean(
    rewards &&
      rewards.stamps_per_reward > 0 &&
      rewards.available_stamps >= rewards.stamps_per_reward,
  );
  const availableCoupons: ActivePromo[] = account.data.promos.filter(
    (candidate) => !candidate.autoApply,
  );

  const setFulfillment = (type: FulfillmentType) => {
    cart.setFulfillmentType(type);
    if (type === "PICKUP") {
      cart.setDriverTipPercent("none");
    }
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          cart.items.length === 0 && styles.emptyContent,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {cart.isCartHydrating ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#FF4D4D" />
            <Text style={styles.centerText}>Loading cart...</Text>
          </View>
        ) : cart.items.length === 0 ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIcon}>
              <ShoppingBag size={32} color="#FF4D4D" />
            </View>
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push("/")}
            >
              <Text style={styles.primaryButtonText}>Browse menu</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order type</Text>
              <View style={styles.segmented}>
                {(["PICKUP", "DELIVERY"] as const).map((type) => {
                  const active = cart.fulfillmentType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.segment, active && styles.segmentActive]}
                      onPress={() => setFulfillment(type)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {type === "PICKUP" ? "Pickup" : "Delivery"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {cart.fulfillmentType === "DELIVERY" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Driver tip</Text>
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
                          {tip === "none" ? "No tip" : `${tip}%`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Items</Text>
              {cart.items.map((item) => {
                const details = itemDetails(item);
                return (
                  <View key={item.key} style={styles.cartLine}>
                    <View style={styles.cartLineTop}>
                      <View style={styles.cartLineInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {details.length > 0 ? (
                          <Text style={styles.itemDetails} numberOfLines={3}>
                            {details.join(" • ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.itemPrice}>
                        {formatPrice(lineSubtotal(item))}
                      </Text>
                    </View>

                    <View style={styles.lineActions}>
                      <View style={styles.quantityControl}>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={() =>
                            cart.updateQuantity(item.key, item.quantity - 1)
                          }
                        >
                          <Minus size={16} color="#1A1A1A" />
                        </TouchableOpacity>
                        <Text style={styles.quantityText}>{item.quantity}</Text>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={() =>
                            cart.updateQuantity(item.key, item.quantity + 1)
                          }
                        >
                          <Plus size={16} color="#1A1A1A" />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => cart.removeItem(item.key)}
                      >
                        <Trash2 size={16} color="#FF4D4D" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Deals & rewards</Text>

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
                    <TouchableOpacity
                      style={styles.dealOption}
                      onPress={applyReward}
                    >
                      <View style={styles.dealOptionInfo}>
                        <Text style={styles.dealOptionTitle}>Free 1lb wings</Text>
                        <Text style={styles.dealOptionMeta}>
                          Redeem your wings reward
                        </Text>
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
                        <Text
                          style={[styles.applyText, applied && styles.appliedText]}
                        >
                          {applied ? "Applied" : "Apply"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {availableCoupons.length === 0 &&
                  !rewardEligible &&
                  !promo.promoCode &&
                  !promo.applyWingsReward ? (
                    <Text style={styles.dealsHint}>
                      No coupons available right now.
                    </Text>
                  ) : null}
                </>
              )}
            </View>

            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>
                  {formatPrice(quote?.item_subtotal_cents ?? localSubtotal)}
                </Text>
              </View>
              {discountRows.map((row) => (
                <View key={row.key} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{row.label}</Text>
                  <Text style={styles.discountValue}>
                    -{formatPrice(row.amountCents)}
                  </Text>
                </View>
              ))}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tax</Text>
                <Text style={styles.summaryValue}>
                  {quoteLoading ? "..." : formatPrice(quote?.tax_cents ?? 0)}
                </Text>
              </View>
              {cart.fulfillmentType === "DELIVERY" ? (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Delivery</Text>
                    <Text style={styles.summaryValue}>
                      {quoteLoading
                        ? "..."
                        : quote?.delivery_fee_waived
                          ? "Free"
                          : formatPrice(quote?.delivery_fee_cents ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Tip</Text>
                    <Text style={styles.summaryValue}>
                      {formatPrice(quote?.driver_tip_cents ?? driverTipCents(cart))}
                    </Text>
                  </View>
                </>
              ) : null}
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>
                  {quoteLoading
                    ? "..."
                    : formatPrice(quote?.final_payable_cents ?? localSubtotal)}
                </Text>
              </View>
              {quoteError ? (
                <Text style={styles.quoteError}>{quoteError}</Text>
              ) : null}
            </View>

            <View style={styles.footerActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push("/")}
              >
                <Text style={styles.secondaryButtonText}>Add more</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.checkoutButton}
                onPress={() => router.push("/checkout")}
              >
                <Text style={styles.checkoutButtonText}>Checkout</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.clearButton} onPress={cart.clear}>
              <Text style={styles.clearButtonText}>Clear cart</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FAFAFA",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  emptyContent: {
    flexGrow: 1,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  centerText: {
    color: "#666",
    fontWeight: "600",
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,77,77,0.1)",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1A1A1A",
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 10,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#EFEFEF",
  },
  segment: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  segmentActive: {
    backgroundColor: "#FF4D4D",
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#666",
  },
  segmentTextActive: {
    color: "#FFF",
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
  cartLine: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F1F1F1",
  },
  cartLineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  cartLineInfo: {
    flex: 1,
  },
  itemName: {
    color: "#1A1A1A",
    fontSize: 15,
    fontWeight: "800",
  },
  itemDetails: {
    marginTop: 5,
    color: "#777",
    fontSize: 12,
    lineHeight: 17,
  },
  itemPrice: {
    color: "#FF4D4D",
    fontSize: 15,
    fontWeight: "800",
  },
  lineActions: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F6F6F6",
    borderRadius: 999,
    padding: 4,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  quantityText: {
    minWidth: 34,
    textAlign: "center",
    color: "#1A1A1A",
    fontWeight: "800",
    fontSize: 14,
  },
  removeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,77,77,0.08)",
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
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F1F1F1",
  },
  dealOptionInfo: {
    flex: 1,
    paddingRight: 12,
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
  },
  applyText: {
    color: "#FF4D4D",
    fontWeight: "900",
    fontSize: 13,
  },
  appliedText: {
    color: "#16A34A",
  },
  summary: {
    marginTop: 10,
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#F1F1F1",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  summaryLabel: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryValue: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "800",
  },
  discountValue: {
    color: "#16A34A",
    fontSize: 14,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: "#EFEFEF",
    marginVertical: 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1A1A1A",
  },
  totalValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FF4D4D",
  },
  quoteError: {
    marginTop: 12,
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
  footerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    backgroundColor: "#FF4D4D",
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
  },
  secondaryButtonText: {
    color: "#FFF",
    fontWeight: "800",
  },
  clearButton: {
    marginTop: 10,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,77,77,0.08)",
  },
  clearButtonText: {
    color: "#FF4D4D",
    fontWeight: "800",
  },
  checkoutButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF4D4D",
  },
  checkoutButtonText: {
    color: "#FFF",
    fontWeight: "900",
  },
});
