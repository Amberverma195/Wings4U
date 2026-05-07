"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { relativeTime, statusLabel } from "@/lib/format";
import { createOrdersSocket, subscribeToChannels } from "@/lib/realtime";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ChatResponse, ChatMessage } from "@/lib/types";

const HELPER_TEXTS = [
  "Where is my order?",
  "I want to cancel my order",
  "I want to change my delivery address",
  "Something is missing from my order",
  "Other issue",
];

export function OrderChat({
  orderId,
  locationId,
  isTerminal,
}: {
  orderId: string;
  /**
   * Location the order was placed at. `ChatController` is mounted under
   * `orders/:orderId/chat` and guarded by `LocationScopeGuard`, so every
   * request must send `X-Location-Id`. Omitting it yields 422
   * "X-Location-Id header must be a valid UUID" on both load and send.
   */
  locationId: string;
  isTerminal: boolean;
}) {
  const session = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isClosed, setIsClosed] = useState(false);
  const [draft, setDraft] = useState("");
  const [selectedHelper, setSelectedHelper] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await withSilentRefresh(
        () => apiFetch(`/api/v1/orders/${orderId}/chat`, { locationId }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { data?: ChatResponse };
      const data = body.data;
      if (!data) {
        return;
      }
      setMessages(data.messages.slice().reverse());
      setIsClosed(data.is_closed);
    } catch {
      /* first load may 404 if no conversation yet */
    }
  }, [orderId, locationId, session]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const socket = createOrdersSocket();
    socket.on("chat.message", () => void fetchMessages());
    const disposeSubscription = subscribeToChannels(socket, [
      `chat:${orderId}`,
    ]);
    socket.connect();
    return () => {
      disposeSubscription();
      socket.disconnect();
    };
  }, [orderId, fetchMessages]);

  // Keep the transcript pinned to the latest message inside the scrollable
  // `.chat-messages` pane only. `scrollIntoView` on a sentinel would also
  // scroll the window when the pane doesn't need its own scrollbar yet.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const messageBody = selectedHelper || draft.trim();
    if (!messageBody) return;
    setSending(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/orders/${orderId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message_body: messageBody }),
            locationId,
          }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.errors?.[0]?.message ?? `Send failed (${res.status})`);
      }
      setDraft("");
      setSelectedHelper(null);
      await fetchMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }, [orderId, locationId, draft, selectedHelper, fetchMessages, session]);

  const canSend = !isTerminal && !isClosed;

  return (
    <div className="chat-container">
      <h3 style={{ margin: "0 0 0.75rem" }}>
        Order Chat
        {isClosed && <span className="surface-muted"> (closed)</span>}
      </h3>

      <div ref={messagesContainerRef} className="chat-messages">
        {messages.length === 0 && (
          <p className="surface-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
            {canSend ? "No messages yet. Start a conversation." : "No chat messages for this order."}
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-bubble chat-${msg.sender_surface === "CUSTOMER" ? "own" : "other"}`}
          >
            <span className="chat-sender">{msg.sender_surface === "CUSTOMER" ? "You" : statusLabel(msg.sender_surface)}</span>
            <p className="chat-body">{msg.message_body}</p>
            <span className="chat-time">{relativeTime(msg.created_at)}</span>
          </div>
        ))}
      </div>

      {canSend && (
        <div style={{ marginTop: "1rem" }}>
          {messages.length === 0 && (
            <div className="chat-helpers" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
              {HELPER_TEXTS.map((text) => (
                <button
                  key={text}
                  type="button"
                  className={`wk-pill ${selectedHelper === text ? "wk-pill-active" : ""} ${selectedHelper && selectedHelper !== text ? "wk-pill-disabled" : ""}`}
                  onClick={() => setSelectedHelper(prev => prev === text ? null : text)}
                  disabled={sending || (!!selectedHelper && selectedHelper !== text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <div className="chat-input-container">
              <input
                className="chat-input"
                style={{ paddingRight: selectedHelper ? "2.5rem" : "0.75rem" }}
                value={selectedHelper || draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (selectedHelper) setSelectedHelper(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Type a message…"
                disabled={sending}
              />
              {selectedHelper && (
                <button
                  type="button"
                  className="chat-input-clear"
                  onClick={() => setSelectedHelper(null)}
                  title="Clear selection"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              className="btn-primary chat-send-btn"
              disabled={sending || (!selectedHelper && !draft.trim())}
              onClick={() => void send()}
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="surface-error" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>{error}</p>}

      {isTerminal && !isClosed && messages.length > 0 && (
        <p className="surface-muted" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
          This order has ended. Chat is read-only.
        </p>
      )}
    </div>
  );
}
