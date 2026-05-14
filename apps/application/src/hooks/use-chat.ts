/**
 * useChat - fetch & send chat messages for an order.
 *
 * Mirrors the web app's chat patterns:
 *   const { data } = await apiJson<ChatResponse>(`/api/v1/orders/${orderId}/chat`);
 *   await apiFetch(`/api/v1/orders/${orderId}/chat`, { method: "POST", body: ... });
 */
import { useCallback, useEffect, useState } from "react";
import { apiJson, apiFetch } from "../lib/api";
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
        const envelope = await apiJson<ChatResponse>(
          `/api/v1/orders/${orderId}/chat`
        );
        if (!cancelled && envelope.data) {
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
  }, [orderId, nonce]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!orderId) return;
      try {
        await apiFetch(`/api/v1/orders/${orderId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_body: body }),
        });
        // Refetch to get the new message + any system messages
        refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [orderId, refetch]
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
