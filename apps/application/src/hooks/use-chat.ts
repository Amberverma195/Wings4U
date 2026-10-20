/**
 * useChat - fetch & send chat messages for an order.
 *
 * Mirrors the web app's chat patterns:
 *   const { data } = await apiJson<ChatResponse>(`/api/v1/orders/${orderId}/chat`);
 *   await apiFetch(`/api/v1/orders/${orderId}/chat`, { method: "POST", body: ... });
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, describeApiFailure } from "../lib/api";
import { useSession, withSilentRefresh } from "../context/session";
import { DEFAULT_LOCATION_ID } from "../lib/env";
import type { ChatResponse, ChatMessage } from "../lib/types";

export type UseChatResult = {
  messages: ChatMessage[];
  conversationId: string | null;
  isClosed: boolean;
  loading: boolean;
  error: string | null;
  sendMessage: (body: string) => Promise<void>;
  refetch: () => void;
};

export function useChat(orderId: string | null): UseChatResult {
  const session = useSession();
  const sessionRefresh = session.refresh;
  const sessionClear = session.clear;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!orderId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await withSilentRefresh(
          () => apiFetch(`/api/v1/orders/${orderId}/chat`, { locationId: DEFAULT_LOCATION_ID }),
          sessionRefresh,
          sessionClear,
        );
        const envelope = await response.json().catch(() => null) as { data?: ChatResponse | null } | null;
        if (!response.ok) throw new Error(describeApiFailure(response.status, envelope, "Unable to load chat."));
        if (!cancelled && envelope?.data) {
          setMessages(envelope.data.messages);
          setConversationId(envelope.data.conversation_id);
          setIsClosed(envelope.data.is_closed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, nonce, sessionRefresh, sessionClear]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!orderId) return;
      try {
        // A 401 is rejected by the auth guard before anything is stored, so
        // the single retry after a silent refresh cannot duplicate a message.
        const response = await withSilentRefresh(
          () => apiFetch(`/api/v1/orders/${orderId}/chat`, {
            method: "POST",
            locationId: DEFAULT_LOCATION_ID,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message_body: body }),
          }),
          sessionRefresh,
          sessionClear,
        );
        if (!response.ok) {
          const envelope = await response.json().catch(() => null);
          throw new Error(describeApiFailure(response.status, envelope, "Message was not sent."));
        }
        // Refetch to get the new message + any system messages
        refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [orderId, refetch, sessionRefresh, sessionClear]
  );

  return {
    messages,
    conversationId,
    isClosed,
    loading,
    error,
    sendMessage,
    refetch,
  };
}
