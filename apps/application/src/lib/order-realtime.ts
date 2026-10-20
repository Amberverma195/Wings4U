/**
 * Live updates for one order's detail screen.
 *
 * The screen is only "live" once the gateway has acknowledged both the
 * `order:{id}` and `chat:{id}` rooms. Every (re)subscription is followed by
 * an authoritative refetch, so events emitted while the socket was down are
 * recovered from the API rather than assumed.
 *
 * Recovery has two layers:
 *   - Transport: when the network drops, socket.io reconnects by itself with
 *     capped, jittered backoff and no attempt limit. A network outage only
 *     produces `connect_error`, so it never consumes the bounded budgets below
 *     and the order recovers whenever connectivity returns.
 *   - Authentication/subscription: a server-side disconnect (rejected or ended
 *     session), a missing acknowledgement or a transient denial is retried at
 *     most MAX_RECOVERY_ATTEMPTS times, refreshing the session before each
 *     reconnect. Connections that open but drop before going live (for
 *     example the gateway closing the transport while it cannot validate the
 *     handshake) are capped at MAX_CONNECTS_WITHOUT_LIVE, because that is the
 *     server refusing this client rather than an outage. Exhausting either
 *     budget stops all reconnection until `resume()`.
 */
import type { Socket } from "socket.io-client";

export type OrderRealtimeStatus = "connecting" | "live" | "unavailable";

export type OrderRealtimeHandle = {
  /**
   * Re-sync after returning to the foreground or when the customer taps
   * Retry. Refetches a live order, restarts after recovery was exhausted or
   * the socket could not be created, and leaves in-progress recovery alone.
   */
  resume: () => void;
  stop: () => void;
};

export type OrderRealtimeOptions = {
  orderId: string;
  createSocket: () => Socket;
  /** Re-validates the session, rotating an expired access token when possible. */
  refreshSession: () => Promise<unknown>;
  onStatus: (status: OrderRealtimeStatus) => void;
  onOrderChanged: () => void;
  onChatChanged: () => void;
  ackTimeoutMs?: number;
};

type SubscribeAck = { subscribed: boolean; channel: string; error?: string };
type Listener = (...args: any[]) => void;

export const ORDER_REFRESH_EVENTS = [
  "order.placed",
  "order.accepted",
  "order.status_changed",
  "order.cancelled",
  "order.driver_assigned",
  "order.delivery_started",
  "order.eta_updated",
  "order.payment_updated",
  "order.manual_review_required",
] as const;
export const CHAT_REFRESH_EVENTS = ["chat.message", "chat.read"] as const;

export const SUBSCRIBE_ACK_TIMEOUT_MS = 8_000;
export const MAX_RECOVERY_ATTEMPTS = 5;
export const MAX_CONNECTS_WITHOUT_LIVE = 5;
export const RECOVERY_BASE_DELAY_MS = 1_000;
const RECOVERY_MAX_DELAY_MS = 30_000;
const CONNECT_ERRORS_BEFORE_UNAVAILABLE = 3;
/** KDS accept emits `order.accepted` and `order.status_changed` back to back. */
export const REFRESH_COALESCE_MS = 150;

const PERMANENT_DENIALS = [
  /^Insufficient permissions/,
  /^Order not found$/,
  /^Invalid order id$/,
  /^Invalid channel format$/,
  /^Unknown channel prefix$/,
];

function coalesced(run: () => void, isStopped: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger: () => {
      if (timer || isStopped()) return;
      timer = setTimeout(() => {
        timer = null;
        if (!isStopped()) run();
      }, REFRESH_COALESCE_MS);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function startOrderRealtime(options: OrderRealtimeOptions): OrderRealtimeHandle {
  const ackTimeoutMs = options.ackTimeoutMs ?? SUBSCRIBE_ACK_TIMEOUT_MS;
  const channels = [`order:${options.orderId}`, `chat:${options.orderId}`];
  let socket: Socket | null = null;
  let stopped = false;
  let status: OrderRealtimeStatus | null = null;
  let subscriptionAttempt = 0;
  let recoveryAttempts = 0;
  let connectErrors = 0;
  let connectsWithoutLive = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners: Array<[string, Listener]> = [];
  const isStopped = () => stopped;
  const orderRefresh = coalesced(options.onOrderChanged, isStopped);
  const chatRefresh = coalesced(options.onChatChanged, isStopped);

  const setStatus = (next: OrderRealtimeStatus) => {
    if (stopped || status === next) return;
    status = next;
    options.onStatus(next);
  };

  const clearRecovery = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const resetBudgets = () => {
    recoveryAttempts = 0;
    connectErrors = 0;
    connectsWithoutLive = 0;
    clearRecovery();
  };

  const scheduleRecovery = (recover: () => void) => {
    clearRecovery();
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      setStatus("unavailable");
      return;
    }
    const delay = Math.min(
      RECOVERY_MAX_DELAY_MS,
      RECOVERY_BASE_DELAY_MS * 2 ** recoveryAttempts,
    );
    recoveryAttempts += 1;
    setStatus("connecting");
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (!stopped) recover();
    }, delay);
  };

  const reconnectWithFreshCredentials = (s: Socket) => {
    Promise.resolve()
      .then(() => options.refreshSession())
      .catch(() => undefined)
      .then(() => {
        if (!stopped && !s.connected) s.connect();
      });
  };

  const handleSubscriptionFailure = (
    s: Socket,
    failure: { timedOut: boolean; denial?: string },
  ) => {
    if (failure.denial && PERMANENT_DENIALS.some((pattern) => pattern.test(failure.denial!))) {
      clearRecovery();
      setStatus("unavailable");
      return;
    }
    if (failure.denial === "Not authenticated") {
      // The gateway also disconnects the socket; the disconnect handler recovers.
      return;
    }
    if (failure.timedOut) {
      // A missing acknowledgement can mean a half-open connection.
      s.disconnect();
      scheduleRecovery(() => reconnectWithFreshCredentials(s));
      return;
    }
    scheduleRecovery(() => {
      if (s.connected) subscribe(s);
      else s.connect();
    });
  };

  const subscribe = (s: Socket) => {
    const attempt = ++subscriptionAttempt;
    const confirmed = new Set<string>();
    setStatus("connecting");
    for (const channel of channels) {
      s.timeout(ackTimeoutMs).emit(
        "subscribe",
        { channel },
        (error: Error | null, ack?: SubscribeAck) => {
          if (stopped || attempt !== subscriptionAttempt) return;
          if (error || ack?.subscribed !== true) {
            subscriptionAttempt += 1;
            handleSubscriptionFailure(s, { timedOut: Boolean(error), denial: ack?.error });
            return;
          }
          confirmed.add(channel);
          if (confirmed.size < channels.length) return;
          resetBudgets();
          setStatus("live");
          options.onOrderChanged();
          options.onChatChanged();
        },
      );
    }
  };

  const open = () => {
    let s: Socket;
    try {
      s = options.createSocket();
    } catch {
      setStatus("unavailable");
      return;
    }
    socket = s;
    const listen = (event: string, handler: Listener) => {
      s.on(event, handler);
      listeners.push([event, handler]);
    };

    listen("connect", () => {
      connectErrors = 0;
      connectsWithoutLive += 1;
      clearRecovery();
      subscribe(s);
    });
    listen("disconnect", (reason: string) => {
      subscriptionAttempt += 1;
      if (stopped) return;
      setStatus("connecting");
      if (reason === "io server disconnect") {
        // The gateway rejected or ended this session and socket.io will not
        // reconnect by itself; refresh credentials before trying again.
        scheduleRecovery(() => reconnectWithFreshCredentials(s));
        return;
      }
      if (reason !== "io client disconnect" && connectsWithoutLive >= MAX_CONNECTS_WITHOUT_LIVE) {
        // Disconnecting from this handler stops socket.io's pending reconnect.
        clearRecovery();
        s.disconnect();
        setStatus("unavailable");
      }
    });
    listen("connect_error", () => {
      connectErrors += 1;
      if (connectErrors >= CONNECT_ERRORS_BEFORE_UNAVAILABLE) setStatus("unavailable");
    });
    for (const event of ORDER_REFRESH_EVENTS) listen(event, orderRefresh.trigger);
    for (const event of CHAT_REFRESH_EVENTS) listen(event, chatRefresh.trigger);

    setStatus("connecting");
    s.connect();
  };

  open();

  return {
    resume: () => {
      if (stopped) return;
      if (!socket) {
        resetBudgets();
        open();
        return;
      }
      if (status === "live" && socket.connected) {
        options.onOrderChanged();
        options.onChatChanged();
        return;
      }
      if (status !== "unavailable") return;
      resetBudgets();
      setStatus("connecting");
      if (socket.connected) subscribe(socket);
      else reconnectWithFreshCredentials(socket);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearRecovery();
      orderRefresh.cancel();
      chatRefresh.cancel();
      if (!socket) return;
      for (const [event, handler] of listeners) socket.off(event, handler);
      listeners.length = 0;
      socket.disconnect();
    },
  };
}
