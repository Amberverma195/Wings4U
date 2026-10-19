import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useIsFocused, useRouter } from "expo-router";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react-native";
import { issueAffectsLine } from "../../src/lib/cart-validation";
import { useCart } from "../../src/context/cart";
import { useOrderSetup } from "../../src/context/order-setup";
import { useCheckoutPreparation } from "../../src/hooks/use-checkout-preparation";
import { usePromo } from "../../src/context/promo";
import { useCartPricing } from "../../src/hooks/use-cart-pricing";
import { CartCoupons } from "../../src/components/cart-coupons";
import {
  promoDiscountRows,
  wingsRewardBlockedReason,
} from "../../src/lib/promo-selection";
import { getCartItemSubtotal } from "../../src/lib/wing-builder-logic";
import type {
  CartBuilderPayload,
  CartItem,
} from "../../src/lib/types";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function lineSubtotal(item: CartItem): number {
  return getCartItemSubtotal(item);
}

function payloadSummary(payload: CartBuilderPayload | undefined): string[] {
  if (!payload) return [];
  if (payload.builder_type === "WINGS" || payload.builder_type === "WING_COMBO") {
    const parts = (payload.flavour_slots ?? []).map((slot) => slot.flavour_name);
    if (payload.extra_flavour) parts.push(`Extra: ${payload.extra_flavour.flavour_name}`);
    if (payload.salad_customization?.salad_name) {
      parts.push(`Salad: ${payload.salad_customization.salad_name}`);
      for (const r of payload.salad_customization.removed_ingredients ?? []) {
        parts.push(`No ${r.name}`);
      }
    }
    return parts;
  }
  if (payload.builder_type === "LUNCH_SPECIAL") {
    return [payload.child_name];
  }
  if (payload.builder_type === "ITEM_CUSTOMIZATION") {
    if (payload.side_pop_bundle) {
      return [`Combo: ${payload.side_pop_bundle.side_label} & ${payload.side_pop_bundle.pop_label}`];
    }
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

export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  const focused = useIsFocused();
  const orderSetup = useOrderSetup();
  const checkout = useCheckoutPreparation();
  const promo = usePromo();
  const pricing = useCartPricing({ locationId: cart.locationId, items: cart.items, fulfillmentType: cart.fulfillmentType,
    scheduledFor: cart.scheduledFor, driverTipPercent: cart.driverTipPercent,
    promoCode: promo.promoCode, applyWingsReward: promo.applyWingsReward },
    focused && cart.isCartHydrated && promo.hydrated !== false, promo.clearPromoCode);
  const { quote, error: quoteError, loading: quoteLoading, notice: promoNotice } = pricing;
  useEffect(() => { if (!focused) checkout.cancel(); }, [focused, checkout.cancel]);

  const localSubtotal = useMemo(
    () => cart.items.reduce((sum, item) => sum + lineSubtotal(item), 0),
    [cart.items],
  );

  const discountRows = useMemo(() => promoDiscountRows(quote), [quote]);
  const rewardBlockedReason = wingsRewardBlockedReason(promo.applyWingsReward, quote);
  const itemCount = cart.items.reduce((total, item) => total + item.quantity, 0);
  const checkoutDisabled = checkout.busy || cart.isCartHydrating || !orderSetup.ready || promo.hydrated === false ||
    Boolean(pricing.issue || rewardBlockedReason || quoteError?.includes('Minimum subtotal for delivery'));
  return (
    <SafeAreaView edges={["left", "right"]} style={styles.container}>
      {focused && <StatusBar style="dark" />}
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
            <ActivityIndicator color="#F97316" />
            <Text style={styles.centerText}>Loading cart...</Text>
          </View>
        ) : cart.items.length === 0 ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIcon}>
              <ShoppingBag size={32} color="#F97316" />
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
              <Text accessibilityRole="header" style={styles.orderTitle}>Your Order</Text>
              <Text style={styles.itemCount}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
              {cart.items.map((item, itemIndex) => {
                const details = itemDetails(item);
                const pricedLine = quote?.lines?.[itemIndex];
                const confirmedLineTotal = pricedLine?.menu_item_id === item.menu_item_id && pricedLine.quantity === item.quantity
                  ? pricedLine.line_total_cents : undefined;
                const issue = pricing.issue && issueAffectsLine(pricing.issue, item.menu_item_id, itemIndex) ? pricing.issue : null;
                return (
                  <View key={item.key} style={styles.cartLine}>
                    <View style={styles.cartLineTop}>
                      {item.image_url ? <Image source={{ uri: item.image_url }} accessibilityLabel={item.name} style={styles.itemImage} /> : null}
                      <View style={styles.cartLineInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {details.length > 0 ? (
                          <Text style={styles.itemDetails}>
                            {details.join(" • ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.itemPrice}>
                        {formatPrice(confirmedLineTotal ?? lineSubtotal(item))}
                      </Text>
                    </View>

                    {issue ? <Text accessibilityRole="alert" style={styles.quoteError}>{issue.message}</Text> : null}
                    <View style={styles.lineActions}>
                      <View style={styles.quantityControl}>
                        <TouchableOpacity
                          style={styles.iconButton}
                          accessibilityRole="button" accessibilityLabel={`Decrease ${item.name} quantity`}
                          onPress={() =>
                            cart.updateQuantity(item.key, item.quantity - 1)
                          }
                        >
                          <Minus size={16} color="#1A1A1A" />
                        </TouchableOpacity>
                        <Text style={styles.quantityText}>{item.quantity}</Text>
                        <TouchableOpacity
                          style={styles.iconButton}
                          accessibilityRole="button" accessibilityLabel={`Increase ${item.name} quantity`}
                          onPress={() =>
                            cart.updateQuantity(item.key, item.quantity + 1)
                          }
                        >
                          <Plus size={16} color="#1A1A1A" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.itemActions}>
                      <TouchableOpacity style={styles.editButton} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={() => router.push({ pathname: '/(tabs)/menu', params: { editKey: item.key, ts: String(Date.now()) } })}>
                        <Text>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityLabel={`Remove ${item.name}`}
                        style={styles.removeButton}
                        onPress={() => cart.removeItem(item.key)}
                      >
                        <Trash2 size={16} color="#F97316" />
                      </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={styles.summary}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Order Summary</Text>
              <CartCoupons active={focused} quote={quote} requestSelection={pricing.requestSelection} onValidated={pricing.acceptSelection} disabled={cart.isCartHydrating || promo.hydrated === false} />
              <Text style={styles.tipLabel}>{cart.fulfillmentType === 'DELIVERY' ? 'Add a tip for your driver' : 'Add a tip'}</Text>
              <View style={styles.tipRow}>{(['none', 10, 15, 20] as const).map(tip => <TouchableOpacity key={String(tip)} accessibilityRole="button"
                accessibilityLabel={tip === 'none' ? 'No tip' : 'Tip ' + tip + '%'} accessibilityState={{ selected: cart.driverTipPercent === tip }}
                style={[styles.tipButton, cart.driverTipPercent === tip && styles.tipActive]} onPress={() => cart.setDriverTipPercent(tip)}>
                <Text style={cart.driverTipPercent === tip ? styles.tipActiveText : styles.tipText}>{tip === 'none' ? 'None' : tip + '%'}</Text>
              </TouchableOpacity>)}</View>
              {rewardBlockedReason ? <Text style={styles.promoNotice}>{rewardBlockedReason}</Text> : null}
              {promoNotice ? <Text style={styles.promoNotice}>{promoNotice}</Text> : null}
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
                  {quoteLoading ? "Updating?" : quote ? formatPrice(quote.tax_cents) : "Calculated at checkout"}
                </Text>
              </View>
              {cart.fulfillmentType === 'DELIVERY' ? <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Delivery fee</Text>
                <Text style={styles.summaryValue}>{quote?.delivery_fee_waived ? <>
                  {quote.delivery_fee_stated_cents > 0 ? <Text style={{ textDecorationLine: 'line-through' }}>From $5 </Text> : null}Free
                </> : !quote || quote.delivery_fee_is_estimate ? 'From $5 — calculated at checkout' : formatPrice(quote.delivery_fee_cents)}</Text>
              </View> : null}
              {quote && quote.driver_tip_cents > 0 ? <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tip</Text><Text style={styles.summaryValue}>{formatPrice(quote.driver_tip_cents)}</Text></View> : null}
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{quote ? (quote.delivery_fee_is_estimate ? 'Estimated total' : 'Total') : 'Est. Subtotal'}</Text>
                <Text style={styles.totalValue}>
                  {quoteLoading
                    ? "..."
                    : formatPrice(quote?.final_payable_cents ?? localSubtotal)}
                </Text>
              </View>
              {quoteError ? (
                <View><Text accessibilityRole="alert" style={styles.quoteError}>{quoteError}</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={pricing.refresh}><Text>Retry pricing</Text></TouchableOpacity></View>
              ) : null}
              {checkout.error && checkout.error !== quoteError ? <Text style={styles.quoteError} accessibilityRole="alert">{checkout.error}</Text> : null}
            </View>

            <TouchableOpacity
              style={[styles.checkoutButtonInline,
                styles.checkoutButton,
                checkoutDisabled && styles.checkoutButtonDisabled,
              ]}
              disabled={checkoutDisabled}
              onPress={async () => { if (await checkout.prepare()) router.push("/checkout"); }}
            >
              <Text style={styles.checkoutButtonText}>{checkout.busy ? 'Checking order…' : 'Checkout'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      {cart.items.length > 0 ? (
        <View style={styles.checkoutDock}>
          <TouchableOpacity
            style={[
              styles.checkoutButton,
              checkoutDisabled && styles.checkoutButtonDisabled,
            ]}
            disabled={checkoutDisabled}
            onPress={async () => { if (await checkout.prepare()) router.push("/checkout"); }}
          >
            <Text style={styles.checkoutButtonText}>Checkout</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8c676",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    // Keep scroll content clear of the checkout dock above the tab bar.
    paddingBottom: 112,
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
    backgroundColor: "rgba(249,115,22,0.1)",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1A1A1A",
  },
  orderTitle: { fontSize: 28, fontWeight: '700', fontFamily: Platform?.OS === 'ios' ? 'Georgia' : 'serif', color: '#111827' },
  itemCount: { marginTop: 4, marginBottom: 16, color: '#666', fontSize: 14 },
  itemImage: { width: 64, height: 64, borderRadius: 12 },
  tipLabel: { fontSize: 14, fontWeight: '700', marginBottom: 10, color: '#30251E' },
  tipRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tipButton: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5E5' },
  tipActive: { backgroundColor: '#F97316', borderColor: '#F97316' },
  tipText: { fontWeight: '700', color: '#444' }, tipActiveText: { fontWeight: '800', color: '#FFF' },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    fontFamily: Platform?.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 10,
  },
  cartLine: {
    backgroundColor: "#FFF",
    borderRadius: 18,
    padding: 16,
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
    color: "#0C0300",
    fontSize: 16,
    fontWeight: "800",
  },
  itemDetails: {
    marginTop: 5,
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 19,
  },
  itemPrice: {
    color: "#EA580C",
    fontSize: 20,
    fontWeight: "800",
  },
  lineActions: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editButton: { minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F6F6F6",
    borderRadius: 999,
    padding: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    backgroundColor: "rgba(249,115,22,0.08)",
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
  summary: {
    marginTop: 10,
    backgroundColor: "#FFF",
    borderRadius: 18,
    padding: 20,
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
    flex: 1,
    paddingRight: 12,
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryValue: {
    maxWidth: '65%', textAlign: 'right', flexShrink: 1,
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
    flex: 1,
    paddingRight: 8,
    fontSize: 18,
    fontWeight: "900",
    color: "#1A1A1A",
  },
  totalValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#F97316",
  },
  quoteError: {
    marginTop: 12,
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
  primaryButton: {
    backgroundColor: "#F97316",
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 15,
  },
  checkoutButton: {
    marginTop: 14,
    width: "100%",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F97316",
  },
  checkoutButtonInline: {
    display: "none",
  },
  checkoutDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#f8c676",
    borderTopWidth: 1,
    borderTopColor: "#EEEEEE",
  },
  checkoutButtonDisabled: {
    opacity: 0.55,
  },
  checkoutButtonText: {
    color: "#FFF",
    fontWeight: "900",
  },
});
