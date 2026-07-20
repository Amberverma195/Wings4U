import { KdsAuthService } from "./kds-auth.service";

describe("KdsAuthService scheduled close", () => {
  it("revokes every active station session for the location", async () => {
    const prisma = {
      kdsStationSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = new KdsAuthService(prisma as never, {} as never);

    await expect(service.revokeLocationSessions("location-1")).resolves.toBe(2);
    expect(prisma.kdsStationSession.updateMany).toHaveBeenCalledWith({
      where: { locationId: "location-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
