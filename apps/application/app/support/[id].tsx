import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession, withSilentRefresh } from '../../src/context/session';
import { apiFetch, getApiErrorMessage } from '../../src/lib/api';
import { DEFAULT_LOCATION_ID } from '../../src/lib/env';
import { getSessionGeneration } from '../../src/lib/token-store';
import { feedbackStyles as styles } from '../../src/components/order-feedback-sheet';

type Ticket = { id: string; subject: string; description: string; status: string; messages: Array<{
  id: string; message_body: string; author_user_id: string;
}> };

export default function SupportTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const generation = getSessionGeneration();
  const current = useRef({ id, generation, mounted: true });
  current.current = { id, generation, mounted: true };
  useEffect(() => () => { current.current.mounted = false; }, []);
  const request = useCallback(async (suffix = '', body?: object) => {
    const response = await withSilentRefresh(() => apiFetch('/api/v1/support/tickets/' + id + suffix, {
      locationId: DEFAULT_LOCATION_ID,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }), session.refresh, session.clear);
    const result = await response.json();
    if (!response.ok) throw new Error(getApiErrorMessage(result, 'Unable to update ticket'));
    return result.data;
  }, [id, session.refresh, session.clear]);
  const load = useCallback(async () => {
    const owner = { id, generation };
    try {
      const data = await request();
      if (current.current.mounted && current.current.id === owner.id && getSessionGeneration() === owner.generation) setTicket(data);
    } catch (cause) {
      if (current.current.mounted && getSessionGeneration() === owner.generation) setError(cause instanceof Error ? cause.message : 'Unable to load ticket');
    }
  }, [request, id, generation]);
  useEffect(() => { setTicket(null); setReply(''); setError(null); if (session.authenticated) void load(); }, [load, session.authenticated]);
  const needsReopen = ticket?.status === 'RESOLVED' || ticket?.status === 'CLOSED';
  const submit = async () => {
    if (locked.current || !ticket || (!needsReopen && !reply.trim())) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      await request(needsReopen ? '/reopen' : '/messages', needsReopen ? {} : { message_body: reply.trim() });
      if (getSessionGeneration() !== generation || !current.current.mounted) return;
      if (!needsReopen) setReply('');
      await load();
    } catch (cause) {
      if (getSessionGeneration() === generation && current.current.mounted) setError(cause instanceof Error ? cause.message : 'Unable to update ticket');
    } finally { locked.current = false; if (current.current.mounted) setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF8F3' }}><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={styles.secondaryText}>Back to support</Text></TouchableOpacity>
    {error ? <Text accessibilityRole="alert" style={styles.text}>{error}</Text> : null}
    {!ticket && !error ? <ActivityIndicator /> : null}
    {ticket ? <>
      <Text style={styles.label}>{ticket.subject}</Text><Text style={styles.muted}>{ticket.status.replace(/_/g, ' ')}</Text>
      <Text style={styles.text}>{ticket.description}</Text>
      {ticket.messages.map(message => <Text key={message.id} style={styles.card}>{message.message_body}</Text>)}
      <TextInput accessibilityLabel="Reply to support" style={styles.input} multiline maxLength={10000} value={reply} onChangeText={setReply} editable={!busy} placeholder="Add more information" />
      <TouchableOpacity accessibilityRole="button" disabled={busy || (!needsReopen && !reply.trim())} onPress={() => void submit()} style={styles.card}>
        <Text style={styles.secondaryText}>{busy ? 'Please wait...' : needsReopen ? 'Reopen ticket' : 'Send reply'}</Text>
      </TouchableOpacity>
    </> : null}
  </ScrollView></SafeAreaView>;
}
