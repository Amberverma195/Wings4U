/**
 * Realtime (Socket.IO) - mobile counterpart of `apps/web/src/lib/realtime.ts`.
 *
 * Key differences:
 *   - Authenticates with the access token in the handshake `auth.token`
 *     instead of `withCredentials: true` cookies.
 *   - The token is read on every connect and reconnect, so a token rotated by
 *     the session refresh flow replaces an expired one.
 */
import { io, type Socket } from "socket.io-client";
import { getRealtimeOrigin } from "./env";
import { getAccessToken, subscribeSessionGeneration } from "./token-store";

const customerSockets = new Set<Socket>();
export function disconnectCustomerSockets() {
  for (const socket of customerSockets) socket.disconnect();
  customerSockets.clear();
}
subscribeSessionGeneration(disconnectCustomerSockets);

/**
 * Build a not-yet-connected Socket.IO client for the `/ws` gateway.
 *
 * WebSocket only, deliberately: socket.io-client never falls back to polling
 * unless `tryAllTransports` is set, so listing "polling" alone changes
 * nothing. Where WebSockets are blocked the order screen reports live updates
 * unavailable and keeps refreshing over HTTP (see CONFIGURATION.md).
 *
 * `reconnection` handles network outages without an attempt limit; the order
 * realtime controller bounds authentication and subscription recovery.
 */
export function createOrdersSocket(): Socket {
  const socket = io(getRealtimeOrigin(), {
    path: "/ws",
    transports: ["websocket"],
    autoConnect: false,
    forceNew: true,
    auth: (callback) => {
      getAccessToken().then(
        (token) => callback(token ? { token } : {}),
        () => callback({}),
      );
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  customerSockets.add(socket);
  socket.on('disconnect', reason => { if (reason === 'io client disconnect') customerSockets.delete(socket); });
  return socket;
}
