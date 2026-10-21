import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, describeApiFailure, getApiErrorMessage } from '../lib/api';
import { useSession, withSilentRefresh } from '../context/session';
import { getSessionGeneration } from '../lib/token-store';
import { ACTIVE_STATUSES, type ChatResponse, type ChatMessage, type OrderStatus } from '../lib/types';

export type UseChatResult = {
  messages: ChatMessage[];
  conversationId: string | null;
  isClosed: boolean;
  loading: boolean;
  sending: boolean;
  retryAt: number | null;
  error: string | null;
  sendMessage: (body: string) => Promise<void>;
  refetch: () => void;
};

type ChatState = { identity: string; data: ChatResponse | null; loading: boolean; error: string | null };

/** No requests until the order supplies its location. Responses belong to one login and order. */
export function useChat(orderId: string | null, locationId: string | null, status: OrderStatus | null): UseChatResult {
  const session = useSession();
  const { refresh, clear } = session;
  const generation = getSessionGeneration();
  const identity = JSON.stringify([orderId, locationId, session.user?.id, generation, session.authenticated]);
  const enabled = Boolean(orderId && locationId && session.loaded && session.authenticated);
  const latest = useRef({ identity, enabled, status, closed: false });
  const mounted = useRef(true);
  const [state, setState] = useState<ChatState>({ identity, data: null, loading: enabled, error: null });
  const visible = enabled && state.identity === identity;
  latest.current = { identity, enabled, status, closed: visible && Boolean(state.data?.is_closed) };
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce(value => value + 1), []);
  const flight = useRef({ identity, busy: false, retryAt: null as number | null });
  if (flight.current.identity !== identity) flight.current = { identity, busy: false, retryAt: null };
  const [sendingIdentity, setSendingIdentity] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<{ identity: string; until: number } | null>(null);
  const retryAt = cooldown?.identity === identity ? cooldown.until : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setCooldown(null), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [identity, retryAt]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const current = () => !disposed && mounted.current && latest.current.identity === identity && generation === getSessionGeneration();
    setState(previous => ({ identity, data: previous.identity === identity ? previous.data : null, loading: true, error: null }));
    void (async () => {
      try {
        const response = await withSilentRefresh(() => {
          if (!current()) throw new Error('Your session or order changed.');
          return apiFetch(`/api/v1/orders/${orderId}/chat`, { locationId: locationId!, expectedSessionGeneration: generation });
        }, refresh, clear);
        const envelope = await response.json().catch(() => null) as { data?: ChatResponse } | null;
        if (!response.ok) throw new Error(describeApiFailure(response.status, envelope, 'Unable to load chat.'));
        if (!envelope?.data) throw new Error('Unable to load chat. Please try again.');
        if (current()) setState({ identity, data: { ...envelope.data,
          messages: [...envelope.data.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)) }, loading: false, error: null });
      } catch {
        // Like website OrderChat, loading failures retain the last transcript
        // (or the initial empty state). Sending failures are shown separately.
        if (current()) setState(previous => ({ ...previous, loading: false }));
      }
    })();
    return () => { disposed = true; };
  }, [identity, enabled, nonce, refresh, clear]);

  const sendMessage = useCallback(async (body: string) => {
    const current = () => mounted.current && latest.current.identity === identity && latest.current.enabled && generation === getSessionGeneration();
    const sendAllowed = () => current() && Boolean(latest.current.status && ACTIVE_STATUSES.has(latest.current.status)) && !latest.current.closed;
    if (!body.trim()) throw new Error('Enter a message.');
    if (!sendAllowed()) throw new Error('Chat is closed for this order.');
    const attempt = flight.current;
    if (attempt.busy) throw new Error('A message is already being sent.');
    if (attempt.retryAt && attempt.retryAt > Date.now()) throw new Error('Too many messages. Please wait before sending again.');
    attempt.busy = true;
    setSendingIdentity(identity);
    setState(previous => ({ ...previous, error: null }));
    const limitUntil = (until: number) => {
      attempt.retryAt = until;
      setCooldown({ identity, until });
    };
    // Rate-limit decisions come from the server; never retry a rejected POST automatically.
    try {
      const response = await withSilentRefresh(() => {
        if (!sendAllowed()) throw new Error('Your session, order or conversation changed.');
        return apiFetch(`/api/v1/orders/${orderId}/chat`, { method: 'POST', locationId: locationId!,
          expectedSessionGeneration: generation, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_body: body.trim() }) });
      }, refresh, clear);
      const envelope = await response.json().catch(() => null);
      if (!current()) throw new Error('Your session or order changed.');
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(response.headers?.get('Retry-After') ?? envelope?.errors?.[0]?.retry_after_seconds ?? envelope?.retry_after_seconds);
          if (Number.isFinite(seconds) && seconds > 0) limitUntil(Date.now() + seconds * 1000);
        }
        if (response.status === 409) refetch();
        throw new Error(getApiErrorMessage(envelope, `Send failed (${response.status})`));
      }
      refetch();
    } catch (cause) {
      if (current()) setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : String(cause) }));
      throw cause;
    } finally {
      attempt.busy = false;
      if (current()) setSendingIdentity(null);
    }
  }, [identity, generation, orderId, locationId, refresh, clear, refetch]);

  return { messages: visible ? state.data?.messages ?? [] : [], conversationId: visible ? state.data?.conversation_id ?? null : null,
    isClosed: visible && Boolean(state.data?.is_closed), loading: enabled && (!visible || state.loading),
    error: visible ? state.error : null, sending: sendingIdentity === identity, retryAt, sendMessage, refetch };
}
