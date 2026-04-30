import { io, type Socket } from "socket.io-client";
import type { PrintAgentConfig } from "./config";

export function createPrintAgentSocket(
  config: PrintAgentConfig,
  cookieHeader: string,
): Socket {
  return io(config.apiOrigin, {
    path: "/ws",
    transports: ["websocket"],
    autoConnect: false,
    withCredentials: true,
    auth: { surface: "kds" },
    extraHeaders: {
      Cookie: cookieHeader,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });
}

export function subscribeOrdersChannel(
  socket: Socket,
  locationId: string,
): () => void {
  const channel = `orders:${locationId}`;

  const subscribe = () => {
    socket.emit(
      "subscribe",
      { channel },
      (ack?: { subscribed: boolean; channel: string; error?: string }) => {
        if (ack && ack.subscribed === false) {
          // eslint-disable-next-line no-console
          console.warn(
            `[print-agent] subscribe denied for ${channel}: ${
              ack.error ?? "(no reason)"
            }`,
          );
          return;
        }

        // eslint-disable-next-line no-console
        console.log(`[print-agent] subscribed to ${channel}`);
      },
    );
  };

  socket.on("connect", subscribe);
  if (socket.connected) subscribe();

  return () => {
    socket.off("connect", subscribe);
    socket.emit("unsubscribe", { channel });
  };
}
