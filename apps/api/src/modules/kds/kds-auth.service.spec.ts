import * as bcrypt from "bcryptjs";
import { KdsAuthService } from "./kds-auth.service";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

describe("KdsAuthService persistent station session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses a fixed eight-day expiry instead of the operating schedule", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-20T14:00:00.000Z"));
    try {
      jest.mocked(bcrypt.compare).mockResolvedValue(true as never);
      jest.mocked(bcrypt.hash).mockResolvedValue("token-hash" as never);
      const prisma = {
        locationSettings: {
          findUnique: jest.fn().mockResolvedValue({
            kdsPasswordHash: "password-hash",
            trustedIpRanges: [],
          }),
        },
        posLoginAttempt: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
        },
        kdsStationSession: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const operatingHours = {
        getClientState: jest.fn().mockResolvedValue({ is_open: false }),
      };
      const service = new KdsAuthService(
        prisma as never,
        operatingHours as never,
      );

      const result = await service.login(
        LOCATION_ID,
        "12345678",
        "127.0.0.1",
      );

      expect(result.expiresAt).toEqual(
        new Date("2026-07-28T14:00:00.000Z"),
      );
      expect(prisma.kdsStationSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          locationId: LOCATION_ID,
          expiresAt: new Date("2026-07-28T14:00:00.000Z"),
        }),
      });
      expect(operatingHours.getClientState).toHaveBeenCalledWith(LOCATION_ID);
    } finally {
      jest.useRealTimers();
    }
  });

  it("revokes only the explicitly logged-out station session", async () => {
    const prisma = {
      kdsStationSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new KdsAuthService(prisma as never, {} as never);

    await service.logout("session-1");

    expect(prisma.kdsStationSession.updateMany).toHaveBeenCalledWith({
      where: { sessionKey: "session-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
