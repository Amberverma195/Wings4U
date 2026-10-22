import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import type { Request } from "express";
import type { IncomingMessage } from "node:http";
import { Server, Socket } from "socket.io";
import { SessionValidator } from "../../common/session/session-validator.service";
import { isAllowedCorsOrigin } from "../../common/utils/cors-origins";
import { resolveLocationRef } from "../../common/utils/location-ref";
import { extractClientIp, isAllowedStoreIp } from "../../common/utils/store-ip";
import { PrismaService } from "../../database/prisma.service";
import { RATE_LIMITS, type RateLimitPolicy } from "../rate-limit/rate-limit.policies";
import { RateLimiterService, rateLimitKeyPart } from "../rate-limit/rate-limit.service";
import {
  KDS_STATION_COOKIE_NAME,
  KdsAuthService,
} from "../kds/kds-auth.service";
import { KdsPresenceService } from "../kds/kds-presence.service";
import { KdsOperatingHoursService } from "../kds/kds-operating-hours.service";
import {
  POS_STATION_COOKIE_NAME,
  PosAuthService,
} from "../pos/pos-auth.service";

type RealtimeEventName =
  | "order.placed"
  | "order.accepted"
  | "order.status_changed"
  | "order.cancelled"
  | "order.driver_assigned"
  | "order.delivery_started"
  | "order.eta_updated"
  | "order.manual_review_required"
  | "order.payment_updated"
  | "chat.message"
  | "chat.read"
  | "cancellation.requested"
  | "cancellation.decided"
  | "refund.requested"
  | "support.ticket_created"
  | "support.auto_ticket"
  | "driver.availability_changed"
  | "driver.delivery_completed"
  | "admin.busy_mode_changed"
  | "catalog.updated"
  | "kds.schedule_updated"
  | "kds.schedule_draining"
  | "kds.schedule_closed";

const CHANNEL_PATTERN = /^(orders|order|chat|admin|drivers):(.+)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_ORDER_STATUSES = new Set([
  "PICKED_UP",
  "DELIVERED",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
  "CANCELLED",
]);

function kdsControlChannel(locationId: string): string {
  return `kds-control:${locationId}`;
}

const STORE_RANGES_CACHE_MS = 60_000;
const SUBSCRIPTION_LIMITED_ERROR = "Too many subscription requests";

type AllowRequest = (
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
) => void;

interface SocketUser {
  userId: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN" | "KDS_STATION" | "POS_STATION";
  employeeRole?: "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";
  locationId?: string;
  stationLocationId?: string;
  isPosSession: boolean;
  sessionId: string;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (!key) continue;
    const rawValue = rest.join("=").trim();
    try {
      cookies[key.trim()] = decodeURIComponent(rawValue);
    } catch {
      cookies[key.trim()] = rawValue;
    }
  }
  return cookies;
}

function describeError(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, ...(typeof code === "string" ? { code } : {}) };
}

function isTerminalOrderEvent(
  event: RealtimeEventName,
  payload: Record<string, unknown>,
): boolean {
  if (event === "order.cancelled") return true;
  return (
    event === "order.status_changed" &&
    typeof payload.to_status === "string" &&
    TERMINAL_ORDER_STATUSES.has(payload.to_status)
  );
}

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private storeRanges: { ranges: unknown[]; loadedAt: number } | null = null;
  private storeRangesLoading: Promise<unknown[]> | null = null;
  private slotHeartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly sessionSockets = new Map<string, Set<string>>();
  private readonly kdsSocketsByLocation = new Map<string, Set<string>>();
  private readonly kdsClosingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly drainingLocations = new Set<string>();
  private readonly drainChecksInFlight = new Set<string>();
  private readonly drainRecheckRequested = new Set<string>();
  private readonly closingLocations = new Map<string, Promise<void>>();
  // Nest dispatches messages without awaiting handleConnection, so the first
  // subscribe can arrive while the handshake credentials are still validating.
  private readonly handshakeAuthentications = new WeakMap<Socket, Promise<boolean>>();

  constructor(
    private readonly sessionValidator: SessionValidator,
    private readonly prisma: PrismaService,
    private readonly kdsAuthService: KdsAuthService,
    private readonly kdsPresence: KdsPresenceService,
    private readonly posAuthService: PosAuthService,
    private readonly operatingHours: KdsOperatingHoursService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @WebSocketServer()
  server!: Server;

  /* ------------------------------------------------------------------ */
  /*  Abuse protection                                                   */
  /* ------------------------------------------------------------------ */

  afterInit(server: Server): void {
    // Engine.IO runs allowRequest on the handshake HTTP request, before a
    // Socket.IO session exists or any credential is validated. A rejection
    // is a transport error, so clients keep their reconnect backoff.
    const engine = (server as Server & { engine?: { opts?: { allowRequest?: AllowRequest } } }).engine;
    if (engine?.opts) {
      const previous = engine.opts.allowRequest;
      engine.opts.allowRequest = (req, callback) => {
        this.allowHandshake(req).then(
          (allowed) => {
            if (!allowed) return callback("Too many connection attempts", false);
            if (previous) return previous(req, callback);
            callback(null, true);
          },
          () => callback(null, true),
        );
      };
    }

    const leaseMs = RATE_LIMITS.realtimeCustomerConnections.windowMs;
    this.slotHeartbeat = setInterval(() => void this.refreshCustomerSlots(), Math.max(1_000, leaseMs / 4));
    this.slotHeartbeat.unref?.();
  }

  private requestClientIp(req: IncomingMessage): string {
    return extractClientIp({
      headers: req.headers as Request["headers"],
      socket: req.socket as Request["socket"],
    });
  }

  /** Loads every location's trusted ranges so in-store stations get the larger budgets. */
  private async isStoreNetworkIp(ip: string): Promise<boolean> {
    if (!ip) return false;
    if (!this.storeRanges || Date.now() - this.storeRanges.loadedAt > STORE_RANGES_CACHE_MS) {
      this.storeRangesLoading ??= (async () => {
        try {
          const rows = await this.prisma.locationSettings.findMany({ select: { trustedIpRanges: true } });
          return rows.map((row) => row.trustedIpRanges as unknown);
        } catch {
          return this.storeRanges?.ranges ?? [];
        }
      })().finally(() => { this.storeRangesLoading = null; });
      const ranges = await this.storeRangesLoading;
      this.storeRanges = { ranges, loadedAt: Date.now() };
    }
    return this.storeRanges.ranges.some((ranges) => isAllowedStoreIp(ip, ranges));
  }

  private async ipBudget(ip: string): Promise<{
    key: string;
    handshake: RateLimitPolicy;
    authFailure: RateLimitPolicy;
  }> {
    const store = await this.isStoreNetworkIp(ip);
    return {
      key: rateLimitKeyPart(`ip:${ip || "unknown"}`),
      handshake: store ? RATE_LIMITS.realtimeHandshakeStoreIp : RATE_LIMITS.realtimeHandshakeIp,
      authFailure: store ? RATE_LIMITS.realtimeAuthFailureStoreIp : RATE_LIMITS.realtimeAuthFailureIp,
    };
  }

  private async allowHandshake(req: IncomingMessage): Promise<boolean> {
    const budget = await this.ipBudget(this.requestClientIp(req));
    const failures = await this.rateLimiter.peek(
      `rl:ws:auth-failure:${budget.key}`,
      budget.authFailure.limit,
      budget.authFailure.windowMs,
    );
    if (!failures.allowed) return false;
    const attempt = await this.rateLimiter.check(
      `rl:ws:handshake:${budget.key}`,
      budget.handshake.limit,
      budget.handshake.windowMs,
    );
    return attempt.allowed;
  }

  private async recordAuthFailure(socket: Socket): Promise<void> {
    const budget = await this.ipBudget(this.extractSocketClientIp(socket));
    await this.rateLimiter.check(
      `rl:ws:auth-failure:${budget.key}`,
      budget.authFailure.limit,
      budget.authFailure.windowMs,
    );
  }

  private customerSlotKey(userId: string): string {
    return `rl:ws:connections:${rateLimitKeyPart(`user:${userId}`)}`;
  }

  private async refreshCustomerSlots(): Promise<void> {
    const leases: Array<{ key: string; member: string }> = [];
    for (const socket of this.server?.sockets?.sockets?.values() ?? []) {
      const key = socket.data.connectionSlotKey;
      if (typeof key === "string") leases.push({ key, member: socket.id });
    }
    await this.rateLimiter
      .refreshSlots(leases, RATE_LIMITS.realtimeCustomerConnections.windowMs)
      .catch(() => undefined);
  }

  /** True when the socket has exhausted its subscribe/unsubscribe budget. */
  private async subscriptionLimited(socket: Socket): Promise<boolean> {
    const user = socket.data.user as SocketUser | undefined;
    if (!user) return false;
    const isCustomer = user.role === "CUSTOMER";
    const policy = isCustomer ? RATE_LIMITS.realtimeSubscribeCustomer : RATE_LIMITS.realtimeSubscribeStaff;
    const identity = isCustomer ? `user:${user.userId}` : `session:${user.sessionId}`;
    const result = await this.rateLimiter.check(
      `rl:ws:subscribe:${rateLimitKeyPart(identity)}`,
      policy.limit,
      policy.windowMs,
    );
    return !result.allowed;
  }

  /* ------------------------------------------------------------------ */
  /*  Connection lifecycle                                               */
  /* ------------------------------------------------------------------ */

  async handleConnection(socket: Socket): Promise<void> {
    const authentication = this.authenticateHandshake(socket).catch(
      (error: unknown) => {
        this.logger.error(
          JSON.stringify({
            event: "realtime.handshake_validation_failed",
            socket_id: socket.id,
            error: describeError(error),
          }),
        );
        // Closing only the transport keeps the client's automatic reconnect
        // backoff; a server-side disconnect would require a manual reconnect.
        socket.conn.close();
        return false;
      },
    );
    this.handshakeAuthentications.set(socket, authentication);
    await authentication;
  }

  private async authenticateHandshake(socket: Socket): Promise<boolean> {
    const cookieHeader = socket.handshake.headers.cookie;
    const accessToken = this.readHandshakeAccessToken(socket);
    if (!cookieHeader && !accessToken) {
      this.logger.warn(`Connection rejected - no auth credentials (${socket.id})`);
      socket.emit("error", { message: "Authentication required" });
      socket.disconnect(true);
      void this.recordAuthFailure(socket).catch(() => undefined);
      return false;
    }

    const cookies = cookieHeader ? parseCookies(cookieHeader) : {};
    const preferredStationSurface = this.readPreferredStationSurface(socket);
    const resolved = await this.resolveSocketUserFromCookies(
      cookies,
      preferredStationSurface,
      accessToken,
    );
    if (!socket.connected) {
      return false;
    }
    if (!resolved) {
      this.logger.warn(`Connection rejected - no valid auth session (${socket.id})`);
      socket.emit("error", { message: "Invalid or expired session" });
      socket.disconnect(true);
      void this.recordAuthFailure(socket).catch(() => undefined);
      return false;
    }

    if (resolved.user.role === "CUSTOMER") {
      const policy = RATE_LIMITS.realtimeCustomerConnections;
      const slotKey = this.customerSlotKey(resolved.user.userId);
      const acquired = await this.rateLimiter.acquireSlot(slotKey, socket.id, policy.limit, policy.windowMs);
      if (!socket.connected) {
        if (acquired) await this.rateLimiter.releaseSlot(slotKey, socket.id);
        return false;
      }
      if (!acquired) {
        this.logger.warn(`Connection rejected - customer connection limit (${socket.id})`);
        socket.emit("error", { message: "Too many active connections", code: "WS_CONNECTION_LIMIT" });
        // Transport close keeps automatic reconnect with backoff, so the
        // client recovers once a stale or closed connection frees its slot.
        socket.conn.close();
        return false;
      }
      socket.data.connectionSlotKey = slotKey;
    }

    socket.data.accessToken = resolved.accessToken;
    socket.data.kdsSessionCookie = resolved.kdsSessionCookie;
    socket.data.posSessionCookie = resolved.posSessionCookie;
    socket.data.preferredStationSurface = preferredStationSurface;
    socket.data.user = resolved.user;
    this.trackSessionSocket(resolved.user.sessionId, socket.id);
    if (
      resolved.user.role === "KDS_STATION" &&
      resolved.user.stationLocationId
    ) {
      await socket.join(kdsControlChannel(resolved.user.stationLocationId));
    }
    this.logger.log(
      `Client connected: ${socket.id} (user=${resolved.user.userId}, role=${resolved.user.role})`,
    );
    return true;
  }

  handleDisconnect(socket: Socket): void {
    const user = socket.data.user as SocketUser | undefined;
    const slotKey = socket.data.connectionSlotKey;
    if (typeof slotKey === "string") {
      socket.data.connectionSlotKey = undefined;
      void this.rateLimiter.releaseSlot(slotKey, socket.id).catch(() => undefined);
    }
    this.kdsPresence.markDisconnected(socket.id);
    this.untrackKdsSocket(socket.id);
    if (user) {
      this.untrackSessionSocket(user.sessionId, socket.id);
    }
    this.logger.log(
      `Client disconnected: ${socket.id}` +
        (user ? ` (user=${user.userId})` : ""),
    );
  }

  onApplicationShutdown(): void {
    if (this.slotHeartbeat) clearInterval(this.slotHeartbeat);
    this.slotHeartbeat = null;
    for (const timer of this.kdsClosingTimers.values()) {
      clearTimeout(timer);
    }
    this.kdsClosingTimers.clear();
    this.kdsSocketsByLocation.clear();
    this.drainingLocations.clear();
    this.drainChecksInFlight.clear();
    this.drainRecheckRequested.clear();
    this.closingLocations.clear();
  }

  disconnectSession(sessionId: string, message = "Session ended"): void {
    const socketIds = this.sessionSockets.get(sessionId);
    if (!socketIds || !this.server) {
      return;
    }

    for (const socketId of [...socketIds]) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) {
        continue;
      }
      socket.emit("error", { message });
      socket.disconnect(true);
    }

    this.sessionSockets.delete(sessionId);
  }

  disconnectCustomer(userId: string): void {
    for (const socket of this.server?.sockets?.sockets?.values() ?? []) {
      if (socket.data.user?.role === "CUSTOMER" && socket.data.user.userId === userId) {
        socket.emit("error", { message: "Account deleted" });
        socket.disconnect(true);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Channel subscriptions                                              */
  /* ------------------------------------------------------------------ */

  @SubscribeMessage("subscribe")
  async handleSubscribe(
    @MessageBody() data: { channel: string },
    @ConnectedSocket() socket: Socket,
  ): Promise<{ subscribed: boolean; channel: string; error?: string }> {
    const channel = typeof data?.channel === "string" ? data.channel : "";
    try {
      return await this.subscribeSocket(channel, socket);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "realtime.subscribe_failed",
          socket_id: socket.id,
          channel_prefix: CHANNEL_PATTERN.exec(channel)?.[1] ?? null,
          error: describeError(error),
        }),
      );
      return {
        subscribed: false,
        channel,
        error: "Subscription temporarily unavailable",
      };
    }
  }

  private async subscribeSocket(
    channel: string,
    socket: Socket,
  ): Promise<{ subscribed: boolean; channel: string; error?: string }> {
    const handshakeAccepted =
      (await this.handshakeAuthentications.get(socket)) ?? true;
    if (!handshakeAccepted) {
      return { subscribed: false, channel, error: "Not authenticated" };
    }

    // Before session revalidation and channel lookups, which hit the database.
    if (await this.subscriptionLimited(socket)) {
      return { subscribed: false, channel, error: SUBSCRIPTION_LIMITED_ERROR };
    }

    const user = await this.revalidateSocketUser(socket);
    if (!user) {
      return { subscribed: false, channel, error: "Not authenticated" };
    }

    const match = CHANNEL_PATTERN.exec(channel);
    if (!match) {
      return { subscribed: false, channel, error: "Invalid channel format" };
    }

    const [, prefix, requestedSubject] = match;
    const normalized = await this.normalizeSubscriptionChannel(
      prefix,
      requestedSubject,
    );
    if (!normalized) {
      return { subscribed: false, channel, error: "Invalid location id" };
    }

    const authError = await this.authorizeChannel(
      prefix,
      normalized.subject,
      user,
      socket,
    );
    if (authError) {
      this.logger.warn(
        `Subscription denied: ${socket.id} -> ${channel} (${authError})`,
      );
      return { subscribed: false, channel, error: authError };
    }

    let kdsOperatingState: Awaited<
      ReturnType<KdsOperatingHoursService["mayOperate"]>
    > | null = null;
    if (prefix === "orders" && user.role === "KDS_STATION") {
      kdsOperatingState = await this.operatingHours.mayOperate(
        normalized.subject,
      );
      if (!kdsOperatingState.allowed) {
        return {
          subscribed: false,
          channel,
          error: "KDS is outside scheduled operating hours",
        };
      }
    }

    socket.join(normalized.channel);
    if (
      prefix === "orders" &&
      user.role === "KDS_STATION" &&
      user.stationLocationId === normalized.subject
    ) {
      this.kdsPresence.markSubscribed(normalized.subject, socket.id);
      this.trackKdsSocket(normalized.subject, socket.id);
      if (kdsOperatingState?.draining) {
        this.drainingLocations.add(normalized.subject);
      } else if (kdsOperatingState?.closesAt) {
        this.scheduleKdsClosing(normalized.subject, kdsOperatingState.closesAt);
      }
    }
    this.logger.debug(`${socket.id} subscribed to ${normalized.channel}`);
    return { subscribed: true, channel: normalized.channel };
  }

  @SubscribeMessage("unsubscribe")
  async handleUnsubscribe(
    @MessageBody() data: { channel: string },
    @ConnectedSocket() socket: Socket,
  ): Promise<{ unsubscribed: boolean; channel: string; error?: string }> {
    const channel = typeof data?.channel === "string" ? data.channel : "";
    if (await this.subscriptionLimited(socket)) {
      return { unsubscribed: false, channel, error: SUBSCRIPTION_LIMITED_ERROR };
    }
    const match = CHANNEL_PATTERN.exec(channel);
    const normalized = match
      ? await this.normalizeSubscriptionChannel(match[1], match[2])
      : null;
    const joinedChannel = normalized?.channel ?? channel;
    socket.leave(joinedChannel);
    const user = socket.data.user as SocketUser | undefined;
    if (
      match?.[1] === "orders" &&
      normalized &&
      user?.role === "KDS_STATION" &&
      user.stationLocationId === normalized.subject
    ) {
      this.kdsPresence.markUnsubscribed(normalized.subject, socket.id);
      this.untrackKdsSocket(socket.id, normalized.subject);
    }
    this.logger.debug(`${socket.id} unsubscribed from ${joinedChannel}`);
    return { unsubscribed: true, channel: joinedChannel };
  }

  /* ------------------------------------------------------------------ */
  /*  Event emission (called by other services)                          */
  /* ------------------------------------------------------------------ */

  emitToChannel(
    channel: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const envelope = {
      event_type: event,
      payload,
      timestamp: new Date().toISOString(),
    };
    // A socket on another API instance may still be connected after deletion.
    // Revalidate customers before EVERY outbound broadcast, not only subscribe.
    const customers = [...(this.server.sockets?.sockets?.values() ?? [])].filter(socket =>
      socket.data.user?.role === "CUSTOMER" && socket.rooms.has(channel));
    const target = this.server.to(channel);
    if (customers.length) target.except(customers.map(socket => socket.id)).emit(event, envelope);
    else target.emit(event, envelope);
    for (const socket of customers) {
      void this.revalidateSocketUser(socket).then(user => {
        if (user?.role === "CUSTOMER" && socket.connected && socket.rooms.has(channel)) socket.emit(event, envelope);
      }).catch(() => { socket.disconnect(true); });
    }
  }

  emitOrderEvent(
    locationId: string,
    orderId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    this.emitToChannel(`orders:${locationId}`, event, payload);
    this.emitToChannel(`order:${orderId}`, event, payload);
    if (
      this.drainingLocations.has(locationId) &&
      isTerminalOrderEvent(event, payload)
    ) {
      void this.finishDrainIfEmpty(locationId);
    }
  }

  emitChatEvent(
    orderId: string,
    event: "chat.message" | "chat.read",
    payload: Record<string, unknown>,
  ): void {
    this.emitToChannel(`chat:${orderId}`, event, payload);
  }

  emitAdminEvent(
    locationId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    this.emitToChannel(`admin:${locationId}`, event, payload);
  }

  emitDriverEvent(
    locationId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    this.emitToChannel(`drivers:${locationId}`, event, payload);
  }

  emitCatalogUpdated(locationId: string): void {
    this.emitToChannel(`orders:${locationId}`, "catalog.updated", {
      location_id: locationId,
    });
  }

  emitKdsScheduleUpdated(locationId: string): void {
    this.emitToKdsControl(locationId, "kds.schedule_updated", {
      location_id: locationId,
    });
    if (
      this.kdsSocketsByLocation.has(locationId) ||
      this.kdsClosingTimers.has(locationId) ||
      this.drainingLocations.has(locationId)
    ) {
      void this.rescheduleKdsLocation(locationId);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Authorization helpers                                              */
  /* ------------------------------------------------------------------ */

  private trackSessionSocket(sessionId: string, socketId: string): void {
    const sockets = this.sessionSockets.get(sessionId);
    if (sockets) {
      sockets.add(socketId);
      return;
    }
    this.sessionSockets.set(sessionId, new Set([socketId]));
  }

  private trackKdsSocket(locationId: string, socketId: string): void {
    const sockets = this.kdsSocketsByLocation.get(locationId);
    if (sockets) {
      sockets.add(socketId);
      return;
    }
    this.kdsSocketsByLocation.set(locationId, new Set([socketId]));
  }

  private untrackKdsSocket(socketId: string, knownLocationId?: string): void {
    for (const [locationId, sockets] of this.kdsSocketsByLocation) {
      if (knownLocationId && knownLocationId !== locationId) continue;
      sockets.delete(socketId);
      if (sockets.size > 0) continue;
      this.kdsSocketsByLocation.delete(locationId);
    }
  }

  private scheduleKdsClosing(locationId: string, closesAt: Date): void {
    const existing = this.kdsClosingTimers.get(locationId);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, closesAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.kdsClosingTimers.delete(locationId);
      void this.handleKdsClosing(locationId);
    }, delay);
    this.kdsClosingTimers.set(locationId, timer);
  }

  private async handleKdsClosing(locationId: string): Promise<void> {
    if (await this.operatingHours.hasActiveTickets(locationId)) {
      this.drainingLocations.add(locationId);
      this.logKdsTransition("DRAINING", locationId);
      this.emitToKdsControl(locationId, "kds.schedule_draining", {
        location_id: locationId,
      });
      return;
    }
    await this.closeKdsLocation(locationId);
  }

  private async finishDrainIfEmpty(locationId: string): Promise<void> {
    if (this.drainChecksInFlight.has(locationId)) {
      this.drainRecheckRequested.add(locationId);
      return;
    }
    this.drainChecksInFlight.add(locationId);
    try {
      do {
        this.drainRecheckRequested.delete(locationId);
        if (!(await this.operatingHours.hasActiveTickets(locationId))) {
          await this.closeKdsLocation(locationId);
          return;
        }
      } while (this.drainRecheckRequested.has(locationId));
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "kds.drain_check_failed",
          location_id: locationId,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      this.drainChecksInFlight.delete(locationId);
      const shouldRecheck =
        this.drainRecheckRequested.delete(locationId) &&
        this.drainingLocations.has(locationId);
      if (shouldRecheck) {
        void this.finishDrainIfEmpty(locationId);
      }
    }
  }

  private emitToKdsControl(
    locationId: string,
    event:
      | "kds.schedule_updated"
      | "kds.schedule_draining"
      | "kds.schedule_closed",
    payload: Record<string, unknown>,
  ): void {
    this.server?.to(kdsControlChannel(locationId)).emit(event, payload);
  }

  private closeKdsLocation(locationId: string): Promise<void> {
    const existing = this.closingLocations.get(locationId);
    if (existing) return existing;

    const closing = this.performKdsClose(locationId).finally(() => {
      this.closingLocations.delete(locationId);
    });
    this.closingLocations.set(locationId, closing);
    return closing;
  }

  private async performKdsClose(locationId: string): Promise<void> {
    this.drainingLocations.delete(locationId);
    this.drainRecheckRequested.delete(locationId);
    const timer = this.kdsClosingTimers.get(locationId);
    if (timer) clearTimeout(timer);
    this.kdsClosingTimers.delete(locationId);
    const socketIds = [
      ...(this.kdsSocketsByLocation.get(locationId) ?? new Set<string>()),
    ];
    if (this.server) {
      for (const socketId of socketIds) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (!socket) continue;
        await socket.leave(`orders:${locationId}`);
        this.kdsPresence.markUnsubscribed(locationId, socketId);
        this.untrackKdsSocket(socketId, locationId);
      }
    }
    this.kdsSocketsByLocation.delete(locationId);
    this.emitToKdsControl(locationId, "kds.schedule_closed", {
      location_id: locationId,
    });
    this.logKdsTransition("SCHEDULED_CLOSED", locationId, {
      preserved_sessions: true,
    });
  }

  private async rescheduleKdsLocation(locationId: string): Promise<void> {
    const operating = await this.operatingHours.mayOperate(locationId);
    if (!operating.allowed) {
      await this.closeKdsLocation(locationId);
      return;
    }
    if (operating.draining) {
      this.drainingLocations.add(locationId);
      return;
    }
    this.drainingLocations.delete(locationId);
    if (operating.closesAt) {
      this.scheduleKdsClosing(locationId, operating.closesAt);
    }
  }

  private logKdsTransition(
    state: "DRAINING" | "SCHEDULED_CLOSED",
    locationId: string,
    details: Record<string, unknown> = {},
  ): void {
    this.logger.log(
      JSON.stringify({
        event: "kds.schedule_transition",
        location_id: locationId,
        state,
        ...details,
      }),
    );
  }

  private untrackSessionSocket(sessionId: string, socketId: string): void {
    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.sessionSockets.delete(sessionId);
    }
  }

  private readPreferredStationSurface(socket: Socket): "kds" | "pos" | null {
    return socket.handshake.auth?.surface === "kds" ||
      socket.handshake.auth?.surface === "pos"
      ? socket.handshake.auth.surface
      : null;
  }

  private readHandshakeAccessToken(socket: Socket): string | undefined {
    const token = socket.handshake.auth?.token;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  private async resolveSocketUserFromCookies(
    cookies: Record<string, string>,
    preferredStationSurface: "kds" | "pos" | null = null,
    explicitAccessToken?: string,
  ): Promise<{
    user: SocketUser;
    accessToken?: string;
    kdsSessionCookie?: string;
    posSessionCookie?: string;
  } | null> {
    if (preferredStationSurface === "kds") {
      const kdsUser = await this.resolveKdsStationSocketUser(cookies);
      if (kdsUser) return kdsUser;
    }
    if (preferredStationSurface === "pos") {
      const posUser = await this.resolvePosStationSocketUser(cookies);
      if (posUser) return posUser;
    }

    const accessToken = explicitAccessToken ?? cookies["access_token"];
    if (accessToken) {
      const session = await this.sessionValidator.resolve(accessToken);
      if (session) {
        return {
          accessToken,
          user: {
            userId: session.userId,
            role: session.role,
            employeeRole: session.employeeRole,
            locationId: session.locationId,
            stationLocationId: session.stationLocationId,
            isPosSession: session.isPosSession,
            sessionId: session.sessionId,
          },
        };
      }
    }

    return (
      (await this.resolveKdsStationSocketUser(cookies)) ??
      this.resolvePosStationSocketUser(cookies)
    );
  }

  private async resolveKdsStationSocketUser(cookies: Record<string, string>): Promise<{
    user: SocketUser;
    kdsSessionCookie: string;
  } | null> {
    const kdsSessionCookie = cookies[KDS_STATION_COOKIE_NAME];
    if (kdsSessionCookie) {
      const session = await this.kdsAuthService.validateSession(kdsSessionCookie);
      if (session) {
        return {
          kdsSessionCookie,
          user: {
            userId: `kds-station:${session.sessionKey}`,
            role: "KDS_STATION",
            locationId: session.locationId,
            stationLocationId: session.locationId,
            isPosSession: false,
            sessionId: `kds:${session.sessionKey}`,
          },
        };
      }
    }

    return null;
  }

  private async resolvePosStationSocketUser(cookies: Record<string, string>): Promise<{
    user: SocketUser;
    posSessionCookie: string;
  } | null> {
    const posSessionCookie = cookies[POS_STATION_COOKIE_NAME];
    if (posSessionCookie) {
      const session = await this.posAuthService.validateSession(posSessionCookie);
      if (session) {
        return {
          posSessionCookie,
          user: {
            userId: `pos-station:${session.sessionKey}`,
            role: "POS_STATION",
            locationId: session.locationId,
            stationLocationId: session.locationId,
            isPosSession: true,
            sessionId: `pos:${session.sessionKey}`,
          },
        };
      }
    }

    return null;
  }

  private async revalidateSocketUser(socket: Socket): Promise<SocketUser | null> {
    const cookies: Record<string, string> = {};
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      Object.assign(cookies, parseCookies(cookieHeader));
    }

    if (typeof socket.data.accessToken === "string") {
      cookies["access_token"] = socket.data.accessToken as string;
    }
    if (typeof socket.data.kdsSessionCookie === "string") {
      cookies[KDS_STATION_COOKIE_NAME] = socket.data.kdsSessionCookie as string;
    }
    if (typeof socket.data.posSessionCookie === "string") {
      cookies[POS_STATION_COOKIE_NAME] = socket.data.posSessionCookie as string;
    }

    const preferredStationSurface =
      socket.data.preferredStationSurface === "kds" ||
      socket.data.preferredStationSurface === "pos"
        ? socket.data.preferredStationSurface
        : null;
    const resolved = await this.resolveSocketUserFromCookies(
      cookies,
      preferredStationSurface,
    );
    if (!resolved) {
      socket.emit("error", { message: "Invalid or expired session" });
      socket.disconnect(true);
      return null;
    }

    const existing = socket.data.user as SocketUser | undefined;
    const user = resolved.user;

    socket.data.accessToken = resolved.accessToken;
    socket.data.kdsSessionCookie = resolved.kdsSessionCookie;
    socket.data.posSessionCookie = resolved.posSessionCookie;
    socket.data.user = user;
    if (!existing || existing.sessionId !== user.sessionId) {
      if (existing) {
        if (existing.role === "KDS_STATION") {
          this.kdsPresence.markDisconnected(socket.id);
        }
        this.untrackSessionSocket(existing.sessionId, socket.id);
      }
      this.trackSessionSocket(user.sessionId, socket.id);
    }

    return user;
  }

  private async authorizeChannel(
    prefix: string,
    subject: string,
    user: SocketUser,
    socket: Socket,
  ): Promise<string | null> {
    switch (prefix) {
      case "order":
      case "chat":
        return this.authorizeOrderChannel(subject, user);

      case "orders":
        return this.authorizeStationLocationChannel(subject, user, socket);

      case "drivers":
        return this.authorizeKdsLocationChannel(subject, user, socket);

      case "admin":
        if (!UUID_RE.test(subject)) {
          return "Invalid location id";
        }
        if (user.role !== "ADMIN") {
          return "Insufficient permissions - ADMIN required";
        }
        return null;

      default:
        return "Unknown channel prefix";
    }
  }

  private async normalizeSubscriptionChannel(
    prefix: string,
    subject: string,
  ): Promise<{ channel: string; subject: string } | null> {
    if (prefix !== "orders") {
      return { channel: `${prefix}:${subject}`, subject };
    }

    const locationId = await resolveLocationRef(this.prisma, subject);
    if (!locationId) {
      return null;
    }

    return {
      channel: `${prefix}:${locationId}`,
      subject: locationId,
    };
  }

  private async authorizeOrderChannel(
    orderId: string,
    user: SocketUser,
  ): Promise<string | null> {
    if (!UUID_RE.test(orderId)) {
      return "Invalid order id";
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerUserId: true, locationId: true, assignedDriverUserId: true },
    });
    if (!order) {
      return "Order not found";
    }

    if (user.role === "ADMIN") {
      return null;
    }

    if (user.role === "KDS_STATION" || user.role === "POS_STATION") {
      return user.stationLocationId === order.locationId
        ? null
        : "Insufficient permissions - wrong station location";
    }

    if (user.role === "CUSTOMER") {
      return order.customerUserId === user.userId
        ? null
        : "Insufficient permissions - order owner required";
    }

    if (!user.locationId || user.locationId !== order.locationId) {
      return "Insufficient permissions - wrong location";
    }

    if (user.employeeRole === "DRIVER" && order.assignedDriverUserId !== user.userId) {
      return "Insufficient permissions - assigned driver required";
    }

    return null;
  }

  private async authorizeKdsLocationChannel(
    locationId: string,
    user: SocketUser,
    socket: Socket,
  ): Promise<string | null> {
    if (!UUID_RE.test(locationId)) {
      return "Invalid location id";
    }

    if (user.role === "KDS_STATION") {
      if (user.stationLocationId !== locationId) {
        return "Insufficient permissions - wrong KDS station location";
      }
    }

    const networkError = await this.authorizeStoreNetwork(locationId, socket);
    if (networkError) return networkError;

    if (user.role === "KDS_STATION") return null;

    if (user.role === "ADMIN") {
      return null;
    }

    if (user.role !== "STAFF") {
      return "Insufficient permissions - STAFF or ADMIN required";
    }

    if (!user.locationId || user.locationId !== locationId) {
      return "Insufficient permissions - wrong location";
    }

    if (user.isPosSession || user.stationLocationId !== locationId) {
      return "KDS access requires KDS station access";
    }

    return null;
  }

  private async authorizeStationLocationChannel(
    locationId: string,
    user: SocketUser,
    socket: Socket,
  ): Promise<string | null> {
    if (!UUID_RE.test(locationId)) {
      return "Invalid location id";
    }

    if (user.role === "KDS_STATION" || user.role === "POS_STATION") {
      if (user.stationLocationId !== locationId) {
        return "Insufficient permissions - wrong station location";
      }
    }

    const networkError = await this.authorizeStoreNetwork(locationId, socket);
    if (networkError) return networkError;

    if (user.role === "KDS_STATION" || user.role === "POS_STATION") return null;

    if (user.role === "ADMIN") {
      return null;
    }

    if (user.role !== "STAFF") {
      return "Insufficient permissions - STAFF or ADMIN required";
    }

    if (!user.locationId || user.locationId !== locationId) {
      return "Insufficient permissions - wrong location";
    }

    if (user.stationLocationId !== locationId) {
      return "Station access is required for this orders channel";
    }

    return null;
  }

  private async authorizeStoreNetwork(
    locationId: string,
    socket: Socket,
  ): Promise<string | null> {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { trustedIpRanges: true },
    });
    const clientIp = this.extractSocketClientIp(socket);
    const allowed = isAllowedStoreIp(clientIp, settings?.trustedIpRanges);
    if (!allowed) {
      this.logger.warn(
        JSON.stringify({
          event: "realtime.store_network_denied",
          location_id: locationId,
          socket_peer_ip: socket.handshake.address || null,
          forwarded_for: this.ipHeaderForDiagnostics(
            socket.handshake.headers["x-forwarded-for"],
          ),
          real_ip: this.ipHeaderForDiagnostics(
            socket.handshake.headers["x-real-ip"],
          ),
          extracted_client_ip: clientIp || null,
          trusted_proxy_ranges_configured:
            (process.env.TRUSTED_PROXY_IP_RANGES ?? "").trim().length > 0,
        }),
      );
    }
    return allowed
      ? null
      : "Store access is restricted to in-store network only";
  }

  private ipHeaderForDiagnostics(
    value: string | string[] | undefined,
  ): string | null {
    const header = Array.isArray(value) ? value.join(", ") : value;
    return typeof header === "string" && header.length > 0
      ? header.slice(0, 512)
      : null;
  }

  private extractSocketClientIp(socket: Socket): string {
    const requestLike: Pick<Request, "headers" | "ip"> = {
      headers: socket.handshake.headers as Request["headers"],
      ip: socket.handshake.address,
    };
    return extractClientIp(requestLike);
  }
}
