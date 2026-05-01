"use client";

import { io, type Socket } from "socket.io-client";
import { getRealtimeOrigin } from "./env";

/**
 * Build a not-yet-connected Socket.IO client for the `/ws` gateway.
 *
 * Notes:
 *   - `withCredentials: true` is mandatory. The gateway authenticates on
 *     every handshake by reading the `access_token` cookie. With the web
 *     app on `localhost:3000` and the API on `localhost:3001`, the two
 *     origins are different (different ports), so the browser only
 *     attaches cookies when `withCredentials` is explicitly set. Omitting
 *     this made the polling transport silently unauthenticated, and the
 *     gateway logged "Connection rejected - no cookies".
 *   - Auto-reconnect is left on (the default): Nest dev-mode recompiles
 *     cause the socket to drop every time a file changes, and the whole
 *     point of realtime is that the UI recovers without a reload.
 *   - `autoConnect: false` is preserved so the caller owns the lifecycle;
 *     useEffects typically connect during mount and disconnect during
 *     cleanup (handles React StrictMode double-mount cleanly).
 */
export function createOrdersSocket(
  options: { preferKdsStation?: boolean; preferPosStation?: boolean } = {},
): Socket {
  const origin = getRealtimeOrigin();
  const surface = options.preferKdsStation
    ? "kds"
    : options.preferPosStation
      ? "pos"
      : undefined;

  return io(origin, {
    path: "/ws",
    transports: ["websocket", "polling"],
    autoConnect: false,
    withCredentials: true,
    auth: surface ? { surface } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}

/**
 * Subscribe the socket to one or more realtime channels, and keep the
 * subscription alive across reconnects.
 *
 * Why this helper exists: the earlier pattern of
 *
 *   socket.connect();
 *   socket.emit("subscribe", { channel });
 *
 * worked on the first connect (socket.io buffers emits during handshake
 * and flushes them once connected) but was completely missed on every
 * subsequent reconnect. The server's room membership is in-memory, so a
 * reconnect starts clean and the client never receives the `order.*` or
 * `chat.*` events it thinks it's listening for. This helper binds a
 * `connect` listener that re-emits `subscribe` every time the transport
 * comes back up.
 *
 * The `subscribe` ack is checked so a denied subscription surfaces in the
 * dev console instead of disappearing silently. The returned cleanup
 * function detaches the listener AND sends an explicit `unsubscribe`.
 */
export function subscribeToChannels(
  socket: Socket,
  channels: readonly string[],
  options?: {
    /** Fires when the server rejects a channel subscribe (wrong user, stale session, etc.). */
    onDenied?: (channel: string, error?: string) => void;
  },
): () => void {
  const subscribe = () => {
    for (const channel of channels) {
      socket.emit(
        "subscribe",
        { channel },
        (
          ack?:
            | { subscribed: boolean; channel: string; error?: string }
            | undefined,
        ) => {
          if (ack && ack.subscribed === false) {
            console.warn(
              "[realtime] subscribe denied",
              channel,
              ack.error ?? "(no reason)",
            );
            options?.onDenied?.(channel, ack.error);
          }
        },
      );
    }
  };

  // Subscribe on the first connect (or reconnect). Using `connect` — not
  // firing immediately — guarantees we only send once the transport is
  // ready, avoiding rare races where a buffered emit is dropped by a
  // closing transport.
  socket.on("connect", subscribe);

  // Surface transport-level failures in dev so "why isn't realtime
  // working?" isn't a mystery. These fire for CORS, cookie, and reachable
  // gateway problems.
  const onConnectError = (err: Error) => {
    console.warn("[realtime] connect_error", err.message);
  };
  socket.on("connect_error", onConnectError);

  // If the socket is already connected (e.g. a hot-reloaded caller reuses
  // an existing instance), fire a subscribe now so we don't wait for the
  // next reconnect.
  if (socket.connected) subscribe();

  return () => {
    socket.off("connect", subscribe);
    socket.off("connect_error", onConnectError);
    for (const channel of channels) {
      socket.emit("unsubscribe", { channel });
    }
  };
}
