import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, Check, LifeBuoy, Star } from "lucide-react-native";
import { useChat } from "../../src/hooks/use-chat";
import { useOrderDetail } from "../../src/hooks/use-order-detail";
import { OrderReorderAction } from "../../src/components/order-history";
import { OrderTrackingDetails } from "../../src/components/order-tracking-details";
import { sortedStatusHistory, statusEventCopy } from "../../src/lib/order-tracking";
import { OrderActiveActions } from "../../src/components/order-active-actions";
import { OrderHelpModal } from "../../src/components/order-help-modal";
import { OrderReviewModal } from "../../src/components/order-review-modal";
import { canUseOrderFeedback } from "../../src/lib/order-feedback";
import { getSessionGeneration } from "../../src/lib/token-store";
import { useSession } from "../../src/context/session";
import { cents, orderStatusCustomerLabel, statusEventWhenLine } from "../../src/lib/format";
import { createOrdersSocket } from "../../src/lib/realtime";
import { startOrderRealtime, type OrderRealtimeHandle, type OrderRealtimeStatus } from "../../src/lib/order-realtime";
import { ACTIVE_STATUSES } from "../../src/lib/types";

/** Background refresh while live updates are not confirmed. */
const FALLBACK_REFRESH_MS = 30_000;

function paramToString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function OrderDetailScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const session = useSession();
  const focused = useIsFocused();
  const orderId = paramToString(params.id);
  const order = useOrderDetail(orderId);
  const chat = useChat(order.order?.id === orderId ? orderId : null, order.order?.location_id ?? null, order.order?.status ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => setHistoryOpen(false), [orderId]);
  const liveOrder = focused && order.order?.id === orderId && ACTIVE_STATUSES.has(order.order.status);
  const ownsOrder = session.loaded && session.authenticated && Boolean(session.user && ['CUSTOMER', 'ADMIN'].includes(session.user.role)) &&
    order.order?.customer_user_id === session.user?.id;
  const history = useMemo(() => order.order ? sortedStatusHistory(order.order) : [], [order.order]);
  const [realtimeStatus, setRealtimeStatus] = useState<OrderRealtimeStatus>("connecting");
  const realtimeRef = useRef<OrderRealtimeHandle | null>(null);
  const sessionGeneration = getSessionGeneration();
  const sessionRefresh = session.refresh;
  const [feedback, setFeedback] = useState<{ kind: 'help' | 'review'; context: string } | null>(null);
  const feedbackContext = JSON.stringify([orderId, order.order?.location_id, session.user?.id, getSessionGeneration(), focused]);
  useEffect(() => { setFeedback(null); }, [feedbackContext]);
  const feedbackEligible = focused && !order.error && order.order && order.order.id === orderId && canUseOrderFeedback(order.order, session);
  useEffect(() => { if (!feedbackEligible) setFeedback(null); }, [feedbackEligible]);
  const orderRefetch = order.refetch;
  const chatRefetch = chat.refetch;

  useEffect(() => {
    if (!orderId || !liveOrder) return;
    setRealtimeStatus("connecting");
    const realtime = startOrderRealtime({
      orderId,
      createSocket: createOrdersSocket,
      refreshSession: sessionRefresh,
      onStatus: setRealtimeStatus,
      onOrderChanged: orderRefetch,
      onChatChanged: chatRefetch,
    });
    realtimeRef.current = realtime;
    return () => {
      realtime.stop();
      if (realtimeRef.current === realtime) realtimeRef.current = null;
    };
  }, [chatRefetch, orderId, orderRefetch, liveOrder, sessionGeneration, sessionRefresh]);

  useEffect(() => {
    if (!liveOrder) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") realtimeRef.current?.resume();
    });
    return () => subscription.remove();
  }, [liveOrder]);

  useEffect(() => {
    if (!liveOrder || realtimeStatus === "live") return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") orderRefetch();
    }, FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveOrder, orderRefetch, realtimeStatus]);

  if (!orderId) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Order id is missing.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {order.loading && !order.order ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#FF4D4D" />
            <Text style={styles.mutedText}>Loading order...</Text>
          </View>
        ) : order.error && !order.order ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{order.error}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={order.refetch}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : order.order ? (
          <>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
              refreshControl={liveOrder ? <RefreshControl refreshing={order.loading} onRefresh={() => { order.refetch(); realtimeRef.current?.resume(); }} /> : undefined}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to my orders" style={styles.backButton} onPress={() => router.push("/(tabs)/orders")}><Text style={styles.helpActionText}>Back to my orders</Text></TouchableOpacity>
              <View style={styles.hero}>
                <View style={styles.heroTop}>
                  <View>
                    <Text style={styles.eyebrow}>Order #{order.order.order_number}</Text>
                    <Text style={styles.title}>
                      {orderStatusCustomerLabel(
                        order.order.status,
                        order.order.fulfillment_type,
                      )}
                    </Text>
                  </View>

                </View>
                {liveOrder && ownsOrder && !order.error && order.order.location_id ? <OrderActiveActions key={feedbackContext}
                  order={order.order} chat={chat} onRefresh={order.refetch} /> : null}
              </View>

              <OrderTrackingDetails key={feedbackContext} order={order.order} chat={chat} actionsAvailable={!order.error} />

              {order.error ? <View style={styles.refreshWarning}>
                <View style={styles.refreshWarningBody}>
                  <Text accessibilityLiveRegion="polite" style={styles.refreshWarningText}>Couldn't refresh order. Showing the last available details.</Text>
                  <Text style={styles.refreshWarningDetail}>{order.error}</Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry order refresh" accessibilityState={{ disabled: order.loading, busy: order.loading }}
                  disabled={order.loading} onPress={order.refetch} style={styles.refreshRetry}>
                  <Text style={styles.helpActionText}>Retry</Text>
                </TouchableOpacity>
              </View> : null}
              {!order.error ? <OrderReorderAction order={order.order} websiteOrderDetail /> : null}
              {feedbackEligible ? <View style={styles.feedbackActions}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Help" style={styles.helpAction}
                  onPress={() => setFeedback({ kind: 'help', context: feedbackContext })}>
                  <LifeBuoy size={18} color="#E53C3C" /><Text style={styles.helpActionText}>Help</Text>
                </TouchableOpacity>
                {order.order.items.length ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Rate your Order" style={[styles.helpAction, styles.rateAction]}
                  onPress={() => setFeedback({ kind: 'review', context: feedbackContext })}>
                  <Star size={18} color="#FFF" /><Text style={[styles.helpActionText, styles.rateActionText]}>Rate your Order</Text>
                </TouchableOpacity> : null}
              </View> : null}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Items</Text>
                {order.order.items.map(item => {
                  const removed = item.modifiers.filter(modifier => modifier.modifier_kind === 'REMOVE_INGREDIENT');
                  const added = item.modifiers.filter(modifier => modifier.modifier_kind !== 'REMOVE_INGREDIENT');
                  return <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemMain}>
                      <Text style={styles.itemTitle}>{item.product_name_snapshot} × {item.quantity}</Text>
                      {removed.length ? <Text style={styles.itemRemoved}>{removed.map(row => 'No ' + row.modifier_name_snapshot).join(', ')}</Text> : null}
                      {added.length ? <Text style={styles.itemMeta}>{added.map(row => row.modifier_name_snapshot).join(', ')}</Text> : null}
                      {item.flavours.length ? <Text style={styles.itemMeta}>{item.flavours.map(row => row.flavour_name_snapshot).join(', ')}</Text> : null}
                      {item.special_instructions ? <Text style={styles.itemInstructions}>{item.special_instructions}</Text> : null}
                    </View>
                    <Text style={styles.itemPrice}>{cents(item.line_total_cents)}</Text>
                  </View>;
                })}
                <View style={styles.summary}>
                  <InfoRow label="Subtotal" value={cents(order.order.item_subtotal_cents)} />
                  {(order.order.item_discount_total_cents + order.order.order_discount_total_cents) > 0 ? <InfoRow label="Discounts" value={'-' + cents(order.order.item_discount_total_cents + order.order.order_discount_total_cents)} /> : null}
                  {order.order.delivery_fee_cents > 0 ? <InfoRow label="Delivery fee" value={cents(order.order.delivery_fee_cents)} /> : null}
                  <InfoRow label={order.order.tax_rate_bps != null ? 'Tax (' + order.order.tax_rate_bps / 100 + '%)' : 'Tax'} value={cents(order.order.tax_cents)} />
                  {order.order.driver_tip_cents > 0 ? <InfoRow label="Driver tip" value={cents(order.order.driver_tip_cents)} /> : null}
                  {order.order.wallet_applied_cents > 0 ? <InfoRow label="Wallet credit" value={'-' + cents(order.order.wallet_applied_cents)} /> : null}
                  <View style={styles.summaryTotal}><Text style={styles.itemTitle}>Total</Text><Text style={styles.itemPrice}>{cents(order.order.final_payable_cents)}</Text></View>
                </View>
                {history.length ? <View style={styles.statusPanel}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={historyOpen ? 'Close status updates' : 'View all status updates'}
                    accessibilityState={{ expanded: historyOpen }} onPress={() => setHistoryOpen(open => !open)} style={styles.statusTrigger}>
                    <View style={styles.chatHeader}><Text style={styles.statusLabel}>Order status</Text><ChevronDown size={18} color="#E53C3C" style={{ transform: [{ rotate: historyOpen ? '180deg' : '0deg' }] }} /></View>
                    {history.slice(0, 1).map(event => <StatusEntry key={event.id} status={statusEventCopy(event, order.order!).title} detail={statusEventCopy(event, order.order!).detail} date={event.created_at} />)}
                  </TouchableOpacity>
                  {historyOpen ? <View style={styles.statusHistory}>
                    {history.map(event => <StatusEntry key={event.id} status={statusEventCopy(event, order.order!).title} detail={statusEventCopy(event, order.order!).detail} date={event.created_at} />)}
                  </View> : null}
                </View> : null}
              </View>

            </ScrollView>

          </>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>Order not found.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/")}>
              <Text style={styles.primaryButtonText}>Back to menu</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
      {feedbackEligible && feedback?.context === feedbackContext && order.order ? (
        feedback.kind === 'help' ? <OrderHelpModal key={feedbackContext} order={order.order} onClose={() => setFeedback(null)} /> :
          <OrderReviewModal key={feedbackContext} order={order.order} onClose={() => setFeedback(null)} />
      ) : null}
    </SafeAreaView>
  );
}

function StatusEntry({ status, date, detail }: { status: string; date: string | null; detail?: string | null }) {
  return <View style={styles.statusEntry}><View style={styles.timelineDot}><Check size={11} color="#FFF" /></View>
    <View style={styles.itemMain}><Text style={styles.statusTitle}>{status}</Text><Text style={styles.statusDate}>{date ? statusEventWhenLine(date) : ''}</Text>{detail ? <Text style={styles.itemMeta}>{detail}</Text> : null}</View></View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  itemRemoved: { marginTop: 4, color: '#E53C3C', fontSize: 12, lineHeight: 18 },
  itemInstructions: { marginTop: 6, color: '#777', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  summary: { backgroundColor: '#F6F6F6', borderRadius: 14, paddingHorizontal: 12, marginTop: 14 },
  summaryTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#E5E5E5', paddingVertical: 14 },
  statusPanel: { borderWidth: 1, borderColor: '#FF4D4D', borderRadius: 14, marginTop: 14, overflow: 'hidden' },
  statusTrigger: { padding: 14, minHeight: 44 },
  statusLabel: { color: '#777', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700' },
  statusEntry: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  statusTitle: { color: '#1A1A1A', fontSize: 13, fontWeight: '700' },
  statusDate: { color: '#777', fontSize: 11, marginTop: 5 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center' },
  statusHistory: { marginHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  refreshWarning: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#FFF0ED' },
  refreshWarningBody: { flex: 1, paddingVertical: 10 },
  refreshWarningText: { color: '#6B5A51', fontSize: 13, lineHeight: 19 },
  refreshWarningDetail: { marginTop: 2, color: '#8A776D', fontSize: 11, lineHeight: 16 },
  refreshRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  feedbackActions: { flexDirection: 'row', gap: 10 },
  helpAction: { flex: 1, minHeight: 44, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
    borderColor: '#FF4D4D', backgroundColor: '#FFF', flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  helpActionText: { flexShrink: 1, textAlign: 'center', color: '#E53C3C', fontWeight: '800', fontSize: 14 },
  rateAction: { backgroundColor: '#FF4D4D' }, rateActionText: { color: '#FFF' },
  container: {
    flex: 1,
    backgroundColor: "#FAFAFA",
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  mutedText: {
    color: "#777",
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  primaryButton: {
    backgroundColor: "#FF4D4D",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
  },
  hero: {
    marginTop: 14,
    backgroundColor: "#1A1A1A",
    borderRadius: 18,
    padding: 18,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    color: "#FFB3B3",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 20,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
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
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#F4F4F4",
  },
  infoLabel: {
    color: "#666",
    fontSize: 13,
    fontWeight: "700",
  },
  infoValue: {
    flex: 1,
    color: "#1A1A1A",
    textAlign: "right",
    fontSize: 13,
    fontWeight: "900",
  },
  itemRow: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: "#F6F6F6",
  },
  itemMain: {
    flex: 1,
  },
  itemTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "900",
  },
  itemMeta: {
    marginTop: 4,
    color: "#777",
    fontSize: 12,
    lineHeight: 17,
  },
  itemPrice: {
    color: "#FF4D4D",
    fontSize: 14,
    fontWeight: "900",
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
