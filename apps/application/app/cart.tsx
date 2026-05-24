import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
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
import type {
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
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const quoteDependencyKey = useMemo(
    () =>
      JSON.stringify({
        items: buildQuotePayloadItems(cart.items),
        fulfillmentType: cart.fulfillmentType,
        scheduledFor: cart.scheduledFor,
        driverTipPercent: cart.driverTipPercent,
      }),
    [cart.driverTipPercent, cart.fulfillmentType, cart.items, cart.scheduledFor],
  );

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
            }),
          });
          if (!cancelled) {
            setQuote(envelope.data ?? null);
          }
        } catch (cause) {
          if (!cancelled) {
            setQuote(null);
            setQuoteError(
              cause instanceof Error ? cause.message : "Unable to price cart",
            );
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

  const setFulfillment = (type: FulfillmentType) => {
    cart.setFulfillmentType(type);
    if (type === "PICKUP") {
      cart.setDriverTipPercent("none");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
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

            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>
                  {formatPrice(quote?.item_subtotal_cents ?? localSubtotal)}
                </Text>
              </View>
              {(quote?.item_discount_total_cents ?? 0) > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Item discounts</Text>
                  <Text style={styles.discountValue}>
                    -{formatPrice(quote?.item_discount_total_cents ?? 0)}
                  </Text>
                </View>
              ) : null}
              {(quote?.order_discount_total_cents ?? 0) > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Order discounts</Text>
                  <Text style={styles.discountValue}>
                    -{formatPrice(quote?.order_discount_total_cents ?? 0)}
                  </Text>
                </View>
              ) : null}
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
