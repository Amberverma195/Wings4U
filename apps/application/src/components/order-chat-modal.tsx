import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import type { UseChatResult } from '../hooks/use-chat';
import { ACTIVE_STATUSES, type OrderDetail } from '../lib/types';
import { relativeTime } from '../lib/format';
import { ORDER_CHAT_SUGGESTIONS } from '../lib/order-actions';
import { FeedbackButton, FeedbackError } from './order-feedback-sheet';

export function OrderChatModal({ order, chat, onClose, title = 'Order Chat' }: { order: OrderDetail; chat: UseChatResult; onClose: () => void; title?: string }) {
  const [draft, setDraft] = useState('');
  const [selectedHelper, setSelectedHelper] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const canSend = ACTIVE_STATUSES.has(order.status) && !chat.isClosed;
  const waiting = Boolean(chat.retryAt && chat.retryAt > Date.now());
  const initialLoading = chat.loading && !chat.messages.length;
  const disabled = !canSend || initialLoading || chat.sending || waiting;
  useEffect(() => { chat.refetch(); }, [chat.refetch]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const send = async () => {
    const body = selectedHelper || draft.trim();
    if (locked.current || disabled || !body) return;
    locked.current = true;
    setError(null);
    try {
      await chat.sendMessage(body);
      if (mounted.current) { setDraft(''); setSelectedHelper(null); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Message was not sent.');
    } finally { locked.current = false; }
  };
  const scrollToRecent = () => scroll.current?.scrollToEnd({ animated: true });
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.overlay}>
      <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.sheet} accessibilityViewIsModal importantForAccessibility="yes">
          <View style={s.header}>
            <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{title}{chat.isClosed ? ' (closed)' : ''}</Text><Text style={s.subtitle}>Order #{order.order_number}</Text></View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close chat" style={s.close} onPress={onClose}><X size={22} color="#FFF" /></TouchableOpacity>
          </View>
          <ScrollView ref={scroll} style={s.messages} contentContainerStyle={s.messageContent} onContentSizeChange={scrollToRecent}
            onLayout={scrollToRecent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {chat.loading && !chat.messages.length ? <ActivityIndicator accessibilityLabel="Loading chat" color="#C52B2B" /> : null}
            {!chat.loading && !chat.messages.length ? <Text style={s.muted}>{canSend ? 'No messages yet. Start a conversation.' : 'No chat messages for this order.'}</Text> : null}
            {chat.messages.map(message => {
              const mine = message.sender_surface === 'CUSTOMER';
              return <View key={message.id} style={[s.bubble, mine && s.mine]}>
                <Text style={[s.author, mine && s.white]}>{mine ? 'You' : message.sender_surface === 'DRIVER' ? 'Driver' : 'Staff'}</Text>
                <Text style={[s.body, mine && s.white]}>{message.message_body}</Text>
                <Text style={[s.time, mine && s.white]}>{relativeTime(message.created_at)}</Text>
              </View>;
            })}
          </ScrollView>
          <View style={s.composer}>
            <FeedbackError message={error ?? chat.error} />
            {!canSend ? (!chat.isClosed && !initialLoading && chat.messages.length ? <Text style={s.muted}>This order has ended. Chat is read-only.</Text> : null) : !initialLoading ? <>
              {!chat.loading && !chat.messages.length ? <View style={s.suggestions}>{ORDER_CHAT_SUGGESTIONS.map(text =>
                <TouchableOpacity key={text} accessibilityRole="button" accessibilityLabel={text} disabled={disabled || Boolean(selectedHelper && selectedHelper !== text)}
                  accessibilityState={{ disabled: disabled || Boolean(selectedHelper && selectedHelper !== text), selected: selectedHelper === text }}
                  onPress={() => setSelectedHelper(previous => previous === text ? null : text)} style={[s.suggestion, selectedHelper === text && s.selectedSuggestion]}><Text style={s.suggestionText}>{text}</Text></TouchableOpacity>)}</View> : null}
              <View style={s.inputRow}>
                <TextInput accessibilityLabel="Chat message" placeholder="Type a message…" placeholderTextColor="#666" multiline
                  value={selectedHelper || draft} onChangeText={value => { setDraft(value); setSelectedHelper(null); }} editable={!disabled} style={s.input} />
                {selectedHelper ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear selection" disabled={disabled} style={s.close}
                  onPress={() => setSelectedHelper(null)}><X size={20} color="#1A1A1A" /></TouchableOpacity> : null}
                <FeedbackButton label="Send" disabled={disabled || (!selectedHelper && !draft.trim())} busy={chat.sending} busyLabel="…" onPress={() => { void send(); }} />
              </View>
            </> : null}
            <FeedbackButton label="Close" secondary onPress={onClose} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '92%', backgroundColor: '#FFF', borderRadius: 24, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#252525' },
  heading: { flex: 1 }, title: { color: '#FFF', fontSize: 21, fontWeight: '900' }, subtitle: { color: '#EEE', marginTop: 4 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  messages: { flex: 1, backgroundColor: '#F6F6F6' }, messageContent: { padding: 16, gap: 10 },
  bubble: { alignSelf: 'flex-start', maxWidth: '86%', backgroundColor: '#FFF', borderRadius: 16, padding: 12, gap: 5 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#C52B2B' },
  author: { color: '#555', fontSize: 11, fontWeight: '800' }, body: { color: '#1A1A1A', fontSize: 15, lineHeight: 21 },
  time: { color: '#666', fontSize: 11 }, white: { color: '#FFF' }, muted: { color: '#666', fontSize: 14, lineHeight: 21 },
  composer: { padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: '#EEE' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggestion: { minHeight: 44, padding: 10, borderRadius: 14, backgroundColor: '#FFF0ED', justifyContent: 'center' },
  suggestionText: { color: '#A72424', fontWeight: '600', fontSize: 12 },
  selectedSuggestion: { borderWidth: 1, borderColor: '#C52B2B' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: { flex: 1, minHeight: 46, maxHeight: 110, padding: 12, borderWidth: 1, borderColor: '#CCC', borderRadius: 14, color: '#1A1A1A', fontSize: 15 },
});
