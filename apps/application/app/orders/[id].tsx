import React, { useEffect, useMemo, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { MessageCircle, RefreshCw, Send } from "lucide-react-native";
import { useChat } from "../../src/hooks/use-chat";
import { useOrderDetail } from "../../src/hooks/use-order-detail";
import { useSession } from "../../src/context/session";
import { cents, orderStatusCustomerLabel, shortDate, shortTime } from "../../src/lib/format";
import { createOrdersSocket, subscribeToChannels } from "../../src/lib/realtime";
import type { ChatMessage, OrderItem } from "../../src/lib/types";

function paramToString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function itemSummary(item: OrderItem): string[] {
  const parts = [
    ...item.flavours.map((flavour) => flavour.flavour_name_snapshot),
    ...item.modifiers.map((modifier) => modifier.modifier_name_snapshot),
  ];
  if (item.special_instructions?.trim()) parts.push(item.special_instructions.trim());
  return parts.filter(Boolean);
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
  const orderId = paramToString(params.id);
  const order = useOrderDetail(orderId);
  const chat = useChat(orderId);
  const [messageDraft, setMessageDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const orderRefetch = order.refetch;
  const chatRefetch = chat.refetch;

  useEffect(() => {
    if (!orderId) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await createOrdersSocket();
      if (disposed) return;

      const refreshOrder = () => orderRefetch();
      const refreshChat = () => chatRefetch();
      socket.on("connect", () => setRealtimeConnected(true));
      socket.on("disconnect", () => setRealtimeConnected(false));
      socket.on("order.placed", refreshOrder);
      socket.on("order.accepted", refreshOrder);
      socket.on("order.status_changed", refreshOrder);
      socket.on("order.cancelled", refreshOrder);
      socket.on("order.driver_assigned", refreshOrder);
      socket.on("order.delivery_started", refreshOrder);
      socket.on("order.eta_updated", refreshOrder);
      socket.on("chat.message", refreshChat);
      socket.on("chat.read", refreshChat);

      const unsubscribe = subscribeToChannels(socket, [
        `order:${orderId}`,
        `chat:${orderId}`,
      ]);
      socket.connect();

      cleanup = () => {
        unsubscribe();
        socket.off("order.placed", refreshOrder);
        socket.off("order.accepted", refreshOrder);
        socket.off("order.status_changed", refreshOrder);
        socket.off("order.cancelled", refreshOrder);
        socket.off("order.driver_assigned", refreshOrder);
        socket.off("order.delivery_started", refreshOrder);
        socket.off("order.eta_updated", refreshOrder);
        socket.off("chat.message", refreshChat);
        socket.off("chat.read", refreshChat);
        socket.disconnect();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
      setRealtimeConnected(false);
    };
  }, [chatRefetch, orderId, orderRefetch]);

  const totalItems = useMemo(
    () => order.order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [order.order?.items],
  );

  const sendMessage = async () => {
    const body = messageDraft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await chat.sendMessage(body);
      setMessageDraft("");
    } finally {
      setSending(false);
    }
  };

  if (!orderId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Order id is missing.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
        ) : order.error ? (
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
                  <TouchableOpacity style={styles.iconButton} onPress={order.refetch}>
                    <RefreshCw size={18} color="#1A1A1A" />
                  </TouchableOpacity>
                </View>
                <View style={styles.realtimeRow}>
                  <View
                    style={[
                      styles.statusDot,
                      realtimeConnected && styles.statusDotConnected,
                    ]}
                  />
                  <Text style={styles.realtimeText}>
                    {realtimeConnected ? "Live updates connected" : "Connecting live updates"}
                  </Text>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Details</Text>
                <InfoRow label="Placed" value={shortDate(order.order.placed_at)} />
                <InfoRow label="Type" value={order.order.fulfillment_type} />
                <InfoRow label="Items" value={String(totalItems)} />
                {order.order.estimated_ready_at ? (
                  <InfoRow
                    label={
                      order.order.fulfillment_type === "PICKUP"
                        ? "Ready for pickup"
                        : "Estimated ready"
                    }
                    value={shortTime(order.order.estimated_ready_at)}
                  />
                ) : null}
                <InfoRow label="Total" value={cents(order.order.final_payable_cents)} />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Kitchen ticket</Text>
                {order.order.items.map((item) => {
                  const details = itemSummary(item);
                  return (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemTitle}>
                          {item.quantity}x {item.product_name_snapshot}
                        </Text>
                        {details.length ? (
                          <Text style={styles.itemMeta} numberOfLines={3}>
                            {details.join(" • ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.itemPrice}>{cents(item.line_total_cents)}</Text>
                    </View>
                  );
                })}
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

            <View style={styles.composer}>
              <TextInput
                style={styles.composerInput}
                value={messageDraft}
                onChangeText={setMessageDraft}
                placeholder="Message the store"
                placeholderTextColor="#999"
                editable={!chat.isClosed}
              />
              <TouchableOpacity
                style={[styles.sendButton, sending && styles.disabledButton]}
                onPress={sendMessage}
                disabled={sending || chat.isClosed}
              >
                {sending ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Send size={18} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>
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
    </SafeAreaView>
  );
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
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F4F4F4",
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
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 26 : 14,
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#EFEFEF",
  },
  composerInput: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#F6F6F6",
    paddingHorizontal: 16,
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "600",
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FF4D4D",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.65,
  },
});
