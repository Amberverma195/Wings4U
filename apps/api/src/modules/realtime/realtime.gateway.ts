import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { Server, Socket } from "socket.io";
import { SessionValidator } from "../../common/session/session-validator.service";
import { extractClientIp, isAllowedStoreIp } from "../../common/utils/store-ip";
import { PrismaService } from "../../database/prisma.service";
import {
  KDS_STATION_COOKIE_NAME,
  KdsAuthService,
} from "../kds/kds-auth.service";

type RealtimeEventName =
  | "order.placed"
  | "order.accepted"
  | "order.status_changed"
  | "order.cancelled"
  | "order.driver_assigned"
  | "order.delivery_started"
  | "order.eta_updated"
  | "order.manual_review_required"
  | "order.change_requested"
  | "order.change_approved"
  | "order.change_rejected"
  | "chat.message"
  | "chat.read"
  | "cancellation.requested"
  | "cancellation.decided"
  | "refund.requested"
  | "support.ticket_created"
  | "support.auto_ticket"
  | "driver.availability_changed"
  | "driver.delivery_completed"
  | "admin.busy_mode_changed";

const CHANNEL_PATTERN = /^(orders|order|chat|admin|drivers):(.+)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SocketUser {
  userId: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN" | "KDS_STATION";
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

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly sessionSockets = new Map<string, Set<string>>();

  constructor(
    private readonly sessionValidator: SessionValidator,
    private readonly prisma: PrismaService,
    private readonly kdsAuthService: KdsAuthService,
  ) {}

  @WebSocketServer()
  server!: Server;

  /* ------------------------------------------------------------------ */
  /*  Connection lifecycle                                               */
  /* ------------------------------------------------------------------ */

  async handleConnection(socket: Socket): Promise<void> {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      this.logger.warn(`Connection rejected - no cookies (${socket.id})`);
      socket.emit("error", { message: "Authentication required" });
      socket.disconnect(true);
      return;
    }

    const cookies = parseCookies(cookieHeader);
    const preferKdsStation = socket.handshake.auth?.surface === "kds";
    const resolved = await this.resolveSocketUserFromCookies(cookies, preferKdsStation);
    if (!resolved) {
      this.logger.warn(`Connection rejected - no valid session cookie (${socket.id})`);
      socket.emit("error", { message: "Invalid or expired session" });
      socket.disconnect(true);
      return;
    }

    socket.data.accessToken = resolved.accessToken;
    socket.data.kdsSessionCookie = resolved.kdsSessionCookie;
    socket.data.preferKdsStation = preferKdsStation;
    socket.data.user = resolved.user;
    this.trackSessionSocket(resolved.user.sessionId, socket.id);
    this.logger.log(
      `Client connected: ${socket.id} (user=${resolved.user.userId}, role=${resolved.user.role})`,
    );
  }

  handleDisconnect(socket: Socket): void {
    const user = socket.data.user as SocketUser | undefined;
    if (user) {
      this.untrackSessionSocket(user.sessionId, socket.id);
    }
    this.logger.log(
      `Client disconnected: ${socket.id}` +
        (user ? ` (user=${user.userId})` : ""),
    );
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

  /* ------------------------------------------------------------------ */
  /*  Channel subscriptions                                              */
  /* ------------------------------------------------------------------ */

  @SubscribeMessage("subscribe")
  async handleSubscribe(
    @MessageBody() data: { channel: string },
    @ConnectedSocket() socket: Socket,
  ): Promise<{ subscribed: boolean; channel: string; error?: string }> {
    const channel = typeof data?.channel === "string" ? data.channel : "";
    const user = await this.revalidateSocketUser(socket);
    if (!user) {
      return { subscribed: false, channel, error: "Not authenticated" };
    }

    const match = CHANNEL_PATTERN.exec(channel);
    if (!match) {
      return { subscribed: false, channel, error: "Invalid channel format" };
    }

    const [, prefix, subject] = match;
    const authError = await this.authorizeChannel(prefix, subject, user, socket);
    if (authError) {
      this.logger.warn(
        `Subscription denied: ${socket.id} -> ${channel} (${authError})`,
      );
      return { subscribed: false, channel, error: authError };
    }

    socket.join(channel);
    this.logger.debug(`${socket.id} subscribed to ${channel}`);
    return { subscribed: true, channel };
  }

  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(
    @MessageBody() data: { channel: string },
    @ConnectedSocket() socket: Socket,
  ): { unsubscribed: boolean; channel: string } {
    socket.leave(data.channel);
    this.logger.debug(`${socket.id} unsubscribed from ${data.channel}`);
    return { unsubscribed: true, channel: data.channel };
  }

  /* ------------------------------------------------------------------ */
  /*  Event emission (called by other services)                          */
  /* ------------------------------------------------------------------ */

  emitToChannel(
    channel: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(channel).emit(event, {
      event_type: event,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  emitOrderEvent(
    locationId: string,
    orderId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    this.emitToChannel(`orders:${locationId}`, event, payload);
    this.emitToChannel(`order:${orderId}`, event, payload);
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

  private untrackSessionSocket(sessionId: string, socketId: string): void {
    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.sessionSockets.delete(sessionId);
    }
  }

  private async resolveSocketUserFromCookies(
    cookies: Record<string, string>,
    preferKdsStation = false,
  ): Promise<{
    user: SocketUser;
    accessToken?: string;
    kdsSessionCookie?: string;
  } | null> {
    if (preferKdsStation) {
      const kdsUser = await this.resolveKdsStationSocketUser(cookies);
      if (kdsUser) return kdsUser;
    }

    const accessToken = cookies["access_token"];
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

    return this.resolveKdsStationSocketUser(cookies);
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

    const preferKdsStation = socket.data.preferKdsStation === true;
    const resolved = await this.resolveSocketUserFromCookies(
      cookies,
      preferKdsStation,
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
    socket.data.user = user;
    if (!existing || existing.sessionId !== user.sessionId) {
      if (existing) {
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

  private async authorizeOrderChannel(
    orderId: string,
    user: SocketUser,
  ): Promise<string | null> {
    if (!UUID_RE.test(orderId)) {
      return "Invalid order id";
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerUserId: true, locationId: true },
    });
    if (!order) {
      return "Order not found";
    }

    if (user.role === "ADMIN") {
      return null;
    }

    if (user.role === "KDS_STATION") {
      return user.stationLocationId === order.locationId
        ? null
        : "Insufficient permissions - wrong KDS station location";
    }

    if (user.role === "CUSTOMER") {
      return order.customerUserId === user.userId
        ? null
        : "Insufficient permissions - order owner required";
    }

    if (!user.locationId || user.locationId !== order.locationId) {
      return "Insufficient permissions - wrong location";
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

    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { trustedIpRanges: true },
    });
    const clientIp = this.extractSocketClientIp(socket);
    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      return "Store access is restricted to in-store network only";
    }

    if (user.role === "ADMIN") {
      return null;
    }

    if (user.role === "KDS_STATION") {
      return user.stationLocationId === locationId
        ? null
        : "Insufficient permissions - wrong KDS station location";
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

  private extractSocketClientIp(socket: Socket): string {
    const requestLike: Pick<Request, "headers" | "ip"> = {
      headers: socket.handshake.headers as Request["headers"],
      ip: socket.handshake.address,
    };
    return extractClientIp(requestLike);
  }
}
