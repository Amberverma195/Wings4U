import { Injectable } from "@nestjs/common";

export const KDS_RECONNECT_GRACE_MS = 20_000;

@Injectable()
export class KdsPresenceService {
  private readonly socketsByLocation = new Map<string, Set<string>>();
  private readonly locationBySocket = new Map<string, string>();
  private readonly lastSeenAtByLocation = new Map<string, number>();

  markSubscribed(locationId: string, socketId: string, now = Date.now()): void {
    const previousLocationId = this.locationBySocket.get(socketId);
    if (previousLocationId && previousLocationId !== locationId) {
      this.removeSocket(previousLocationId, socketId, now);
    }

    const sockets = this.socketsByLocation.get(locationId) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByLocation.set(locationId, sockets);
    this.locationBySocket.set(socketId, locationId);
    this.lastSeenAtByLocation.set(locationId, now);
  }

  markDisconnected(socketId: string, now = Date.now()): void {
    const locationId = this.locationBySocket.get(socketId);
    if (!locationId) return;
    this.removeSocket(locationId, socketId, now);
  }

  markUnsubscribed(locationId: string, socketId: string, now = Date.now()): void {
    if (this.locationBySocket.get(socketId) !== locationId) return;
    this.removeSocket(locationId, socketId, now, false);
  }

  isHealthy(locationId: string, now = Date.now()): boolean {
    if ((this.socketsByLocation.get(locationId)?.size ?? 0) > 0) {
      return true;
    }

    const lastSeenAt = this.lastSeenAtByLocation.get(locationId);
    return lastSeenAt != null && now - lastSeenAt <= KDS_RECONNECT_GRACE_MS;
  }

  private removeSocket(
    locationId: string,
    socketId: string,
    now: number,
    preserveReconnectGrace = true,
  ): void {
    const sockets = this.socketsByLocation.get(locationId);
    sockets?.delete(socketId);
    if (sockets?.size === 0) {
      this.socketsByLocation.delete(locationId);
    }
    this.locationBySocket.delete(socketId);
    if (preserveReconnectGrace) {
      this.lastSeenAtByLocation.set(locationId, now);
    } else if (!this.socketsByLocation.has(locationId)) {
      this.lastSeenAtByLocation.delete(locationId);
    }
  }
}
