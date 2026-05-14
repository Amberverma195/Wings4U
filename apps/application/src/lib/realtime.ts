/**
 * Realtime (Socket.IO) - ported from `apps/web/src/lib/realtime.ts`.
 *
 * Key differences:
 *   - Uses Bearer token auth instead of `withCredentials: true` (cookies).
 *   - Token is fetched from secure store and passed in `auth.token`.
 */
import { io, type Socket } from "socket.io-client";
import { getRealtimeOrigin } from "./env";
import { getAccessToken } from "./token-store";

/**
 * Build a not-yet-connected Socket.IO client for the `/ws` gateway.
 *
 * On mobile we cannot rely on cookies, so we pass the access token in the
 * handshake `auth` payload. The server should read `socket.handshake.auth.token`
 * or fall back to cookies for backward compat.
 */
export async function createOrdersSocket(): Promise<Socket> {
  const origin = getRealtimeOrigin();
  const token = await getAccessToken();

  return io(origin, {
    path: "/ws",
    transports: ["websocket", "polling"],
    autoConnect: false,
    auth: token ? { token } : undefined,
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
 * Direct port from the web version - identical logic.
 */
export function subscribeToChannels(
  socket: Socket,
  channels: readonly string[],
  options?: {
    onDenied?: (channel: string, error?: string) => void;
  }
): () => void {
  const subscribe = () => {
    for (const channel of channels) {
      socket.emit(
        "subscribe",
        { channel },
        (
          ack?:
            | { subscribed: boolean; channel: string; error?: string }
            | undefined
        ) => {
          if (ack && ack.subscribed === false) {
            console.warn(
              "[realtime] subscribe denied",
              channel,
              ack.error ?? "(no reason)"
            );
            options?.onDenied?.(channel, ack.error);
          }
        }
      );
    }
  };

  socket.on("connect", subscribe);

  const onConnectError = (err: Error) => {
    console.warn("[realtime] connect_error", err.message);
  };
  socket.on("connect_error", onConnectError);

  if (socket.connected) subscribe();

  return () => {
    socket.off("connect", subscribe);
    socket.off("connect_error", onConnectError);
    for (const channel of channels) {
      socket.emit("unsubscribe", { channel });
    }
  };
}
