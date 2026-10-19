import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useState } from "react";
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
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, Check, LifeBuoy, MessageCircle, RefreshCw, Star } from "lucide-react-native";
import { useChat } from "../../src/hooks/use-chat";
import { useOrderDetail } from "../../src/hooks/use-order-detail";
import { OrderReorderAction } from "../../src/components/order-history";
import { OrderHelpModal } from "../../src/components/order-help-modal";
import { OrderReviewModal } from "../../src/components/order-review-modal";
import { canUseOrderFeedback } from "../../src/lib/order-feedback";
import { getSessionGeneration } from "../../src/lib/token-store";
import { useSession } from "../../src/context/session";
import { cents, orderStatusCustomerLabel, shortTime, statusEventWhenLine } from "../../src/lib/format";
import { createOrdersSocket, subscribeToChannels } from "../../src/lib/realtime";
import { ACTIVE_STATUSES } from "../../src/lib/types";
import type { ChatMessage, OrderDetail } from "../../src/lib/types";

function paramToString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function statusHistory(order: OrderDetail) {
  const events: Array<{ id: string; to_status: string; created_at: string | null }> = [...(order.status_events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!events.some(event => event.to_status === 'PLACED')) events.push({ id: 'placed', to_status: 'PLACED', created_at: order.placed_at });
  const latest = events.find(event => event.to_status === order.status);
  return [latest ?? { id: 'current', to_status: order.status, created_at: order.status === 'PLACED' ? order.placed_at : order.status === 'ACCEPTED' ? order.accepted_at : order.status === 'READY' ? order.ready_at : order.status === 'CANCELLED' ? order.cancelled_at : order.completed_at },
    ...events.filter(event => event.id !== latest?.id)];
}

function messageAuthor(message: ChatMessage, userId: string | undefined): "me" | "staff" {
  return message.sender_user_id === userId || message.sender_surface === "CUSTOMER"
    ? "me"
    : "staff";
}

export default function OrderDetailScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const session = useSession();
  const focused = useIsFocused();
  const orderId = paramToString(params.id);
  const order = useOrderDetail(orderId);
  const chat = useChat(orderId);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => setHistoryOpen(false), [orderId]);
  const liveOrder = focused && order.order?.id === orderId && ACTIVE_STATUSES.has(order.order.status);
  const history = useMemo(() => order.order ? statusHistory(order.order) : [], [order.order]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [realtimeError, setRealtimeError] = useState(false);
  const [realtimeAttempt, setRealtimeAttempt] = useState(0);
  const sessionGeneration = getSessionGeneration();
  const [feedback, setFeedback] = useState<{ kind: 'help' | 'review'; context: string } | null>(null);
  const feedbackContext = JSON.stringify([orderId, order.order?.location_id, session.user?.id, getSessionGeneration(), focused]);
  useEffect(() => { setFeedback(null); }, [feedbackContext]);
  const feedbackEligible = focused && order.order && order.order.id === orderId && canUseOrderFeedback(order.order, session);
  useEffect(() => { if (!feedbackEligible) setFeedback(null); }, [feedbackEligible]);
  const orderRefetch = order.refetch;
  const chatRefetch = chat.refetch;

  useEffect(() => {
    if (!orderId || !liveOrder) return;
    setRealtimeConnected(false);
    setRealtimeError(false);
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await createOrdersSocket();
      if (disposed) { socket.disconnect(); return; }

      const refreshOrder = () => orderRefetch();
      const refreshChat = () => chatRefetch();
      const subscribed = new Set<string>();
      const onConnect = () => {
        subscribed.clear();
        setRealtimeConnected(false);
        setRealtimeError(false);
      };
      const onFailure = () => {
        if (disposed) return;
        subscribed.clear();
        setRealtimeConnected(false);
        setRealtimeError(true);
      };
      socket.on("connect", onConnect);
      socket.on("disconnect", onFailure);
      socket.on("connect_error", onFailure);
      socket.on("error", onFailure);
      socket.on("order.placed", refreshOrder);
      socket.on("order.accepted", refreshOrder);
      socket.on("order.status_changed", refreshOrder);
      socket.on("order.cancelled", refreshOrder);
      socket.on("order.driver_assigned", refreshOrder);
      socket.on("order.delivery_started", refreshOrder);
      socket.on("order.eta_updated", refreshOrder);
      socket.on("order.payment_updated", refreshOrder);
      socket.on("order.manual_review_required", refreshOrder);
      socket.on("chat.message", refreshChat);
      socket.on("chat.read", refreshChat);

      const unsubscribe = subscribeToChannels(socket, [
        `order:${orderId}`,
        `chat:${orderId}`,
      ], {
        onSubscribed: channel => {
          if (disposed) return;
          subscribed.add(channel);
          if (subscribed.size === 2) {
            setRealtimeConnected(true);
            setRealtimeError(false);
            // Recover updates missed during the initial handshake or reconnect.
            refreshOrder();
            refreshChat();
          }
        },
        onDenied: onFailure,
      });
      socket.connect();

      cleanup = () => {
        unsubscribe();
        socket.off("connect", onConnect);
        socket.off("disconnect", onFailure);
        socket.off("connect_error", onFailure);
        socket.off("error", onFailure);
        socket.off("order.placed", refreshOrder);
        socket.off("order.accepted", refreshOrder);
        socket.off("order.status_changed", refreshOrder);
        socket.off("order.cancelled", refreshOrder);
        socket.off("order.driver_assigned", refreshOrder);
        socket.off("order.delivery_started", refreshOrder);
        socket.off("order.eta_updated", refreshOrder);
        socket.off("order.payment_updated", refreshOrder);
        socket.off("order.manual_review_required", refreshOrder);
        socket.off("chat.message", refreshChat);
        socket.off("chat.read", refreshChat);
        socket.disconnect();
      };
    })().catch(() => {
      if (!disposed) {
        setRealtimeConnected(false);
        setRealtimeError(true);
      }
    });

    return () => {
      disposed = true;
      cleanup?.();
      setRealtimeConnected(false);
    };
  }, [chatRefetch, orderId, orderRefetch, liveOrder, sessionGeneration, realtimeAttempt]);

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
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                  {liveOrder ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh order" style={styles.iconButton} onPress={order.refetch}>
                    <RefreshCw size={18} color="#1A1A1A" />
                  </TouchableOpacity> : null}
                </View>
                {liveOrder ? <View style={styles.realtimeRow}>
                  <View
                    style={[
                      styles.statusDot,
                      realtimeConnected && styles.statusDotConnected,
                    ]}
                  />
                  <Text style={styles.realtimeText}>
                    {realtimeConnected ? "Live updates connected" : realtimeError ? "Live updates unavailable" : "Connecting live updates"}
                  </Text>
                  {realtimeError ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry live updates"
                    onPress={() => setRealtimeAttempt(attempt => attempt + 1)}>
                    <Text style={styles.realtimeText}>Retry</Text>
                  </TouchableOpacity> : null}
                </View> : null}
              </View>

              {order.error ? <View style={styles.refreshWarning}>
                <Text accessibilityLiveRegion="polite" style={styles.refreshWarningText}>Couldn't refresh order. Showing the last available details.</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry order refresh" accessibilityState={{ disabled: order.loading, busy: order.loading }}
                  disabled={order.loading} onPress={order.refetch} style={styles.refreshRetry}>
                  <Text style={styles.helpActionText}>Retry</Text>
                </TouchableOpacity>
              </View> : null}
              <OrderReorderAction order={order.order} />
              {feedbackEligible ? <View style={styles.feedbackActions}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Help" style={styles.helpAction}
                  onPress={() => setFeedback({ kind: 'help', context: feedbackContext })}>
                  <LifeBuoy size={18} color="#E53C3C" /><Text style={styles.helpActionText}>Help</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Rate Your Order" style={[styles.helpAction, styles.rateAction]}
                  onPress={() => setFeedback({ kind: 'review', context: feedbackContext })}>
                  <Star size={18} color="#FFF" /><Text style={[styles.helpActionText, styles.rateActionText]}>Rate Your Order</Text>
                </TouchableOpacity>
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
                <View style={styles.statusPanel}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={historyOpen ? 'Hide status updates' : 'View all status updates'}
                    accessibilityState={{ expanded: historyOpen }} onPress={() => setHistoryOpen(open => !open)} style={styles.statusTrigger}>
                    <View style={styles.chatHeader}><Text style={styles.statusLabel}>Order status</Text><ChevronDown size={18} color="#E53C3C" style={{ transform: [{ rotate: historyOpen ? '180deg' : '0deg' }] }} /></View>
                    {history.slice(0, 1).map(event => <StatusEntry key={event.id} status={orderStatusCustomerLabel(event.to_status, order.order!.fulfillment_type)} date={event.created_at} />)}
                  </TouchableOpacity>
                  {historyOpen ? <View style={styles.statusHistory}>
                    {history.slice(1).map(event => <StatusEntry key={event.id} status={orderStatusCustomerLabel(event.to_status, order.order!.fulfillment_type)} date={event.created_at} />)}
                  </View> : null}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.chatHeader}>
                  <Text style={styles.sectionTitle}>Chat</Text>
                  <MessageCircle size={18} color="#FF4D4D" />
                </View>
                {chat.loading && chat.messages.length === 0 ? (
                  <Text style={styles.mutedText}>Loading chat...</Text>
                ) : chat.messages.length === 0 ? (
                  <Text style={styles.mutedText}>No messages yet.</Text>
                ) : (
                  chat.messages.map((message) => {
                    const mine = messageAuthor(message, session.user?.id) === "me";
                    return (
                      <View
                        key={message.id}
                        style={[styles.messageBubble, mine && styles.messageBubbleMine]}
                      >
                        <Text style={[styles.messageText, mine && styles.messageTextMine]}>
                          {message.message_body}
                        </Text>
                        <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
                          {shortTime(message.created_at)}
                        </Text>
                      </View>
                    );
                  })
                )}
                {chat.error ? <Text style={styles.errorText}>{chat.error}</Text> : null}
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

function StatusEntry({ status, date }: { status: string; date: string | null }) {
  return <View style={styles.statusEntry}><View style={styles.timelineDot}><Check size={11} color="#FFF" /></View>
    <View style={styles.itemMain}><Text style={styles.statusTitle}>{status}</Text><Text style={styles.statusDate}>{date ? statusEventWhenLine(date) : ''}</Text></View></View>;
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
  refreshWarningText: { flex: 1, color: '#6B5A51', fontSize: 13, lineHeight: 19, paddingVertical: 10 },
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#F59E0B",
  },
  statusDotConnected: {
    backgroundColor: "#22C55E",
  },
  realtimeText: {
    color: "#DDD",
    fontSize: 12,
    fontWeight: "800",
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
  messageBubble: {
    alignSelf: "flex-start",
    maxWidth: "86%",
    backgroundColor: "#F4F4F4",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8,
  },
  messageBubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: "#FF4D4D",
  },
  messageText: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
  },
  messageTextMine: {
    color: "#FFF",
  },
  messageTime: {
    color: "#777",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 5,
  },
  messageTimeMine: {
    color: "rgba(255,255,255,0.78)",
  },
});
