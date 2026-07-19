import {
  KDS_RECONNECT_GRACE_MS,
  KdsPresenceService,
} from "./kds-presence.service";

describe("KdsPresenceService", () => {
  it("tracks connected KDS sockets by location", () => {
    const service = new KdsPresenceService();
    service.markSubscribed("loc-1", "socket-1", 1_000);

    expect(service.isHealthy("loc-1", 5_000)).toBe(true);
    expect(service.isHealthy("loc-2", 5_000)).toBe(false);
  });

  it("keeps a short reconnect grace after disconnect", () => {
    const service = new KdsPresenceService();
    service.markSubscribed("loc-1", "socket-1", 1_000);
    service.markDisconnected("socket-1", 2_000);

    expect(service.isHealthy("loc-1", 2_000 + KDS_RECONNECT_GRACE_MS)).toBe(true);
    expect(service.isHealthy("loc-1", 2_001 + KDS_RECONNECT_GRACE_MS)).toBe(false);
  });

  it("keeps a location online while another KDS socket remains", () => {
    const service = new KdsPresenceService();
    service.markSubscribed("loc-1", "socket-1", 1_000);
    service.markSubscribed("loc-1", "socket-2", 1_000);
    service.markDisconnected("socket-1", 2_000);

    expect(service.isHealthy("loc-1", 2_000 + KDS_RECONNECT_GRACE_MS + 1)).toBe(true);
  });

  it("moves a socket without leaking presence to its previous location", () => {
    const service = new KdsPresenceService();
    service.markSubscribed("loc-1", "socket-1", 1_000);
    service.markSubscribed("loc-2", "socket-1", 2_000);

    expect(service.isHealthy("loc-2", 30_000)).toBe(true);
    expect(service.isHealthy("loc-1", 2_001 + KDS_RECONNECT_GRACE_MS)).toBe(false);
  });
});
