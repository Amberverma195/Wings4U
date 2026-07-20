import { ForbiddenException } from "@nestjs/common";
import { KdsOperatingHoursService } from "./kds-operating-hours.service";

function time(value: string): Date {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

function row(dayOfWeek: number, from: string, to: string, isClosed = false) {
  return {
    dayOfWeek,
    timeFrom: time(from),
    timeTo: time(to),
    isClosed,
    serviceType: "KDS",
  };
}

function createService(hours: ReturnType<typeof row>[]) {
  const prisma = {
    location: {
      findUnique: jest.fn().mockResolvedValue({
        timezoneName: "America/Toronto",
        hours,
      }),
    },
    order: { count: jest.fn().mockResolvedValue(0) },
  };
  return new KdsOperatingHoursService(prisma as never);
}

describe("KdsOperatingHoursService session expiry", () => {
  const weeklyHours = [
    row(1, "09:00", "17:00"),
    row(2, "09:00", "17:00"),
  ];

  it("expires an open Monday session at Tuesday's next opening", async () => {
    const service = createService(weeklyHours);

    await expect(
      service.getDailySessionExpiry(
        "location-1",
        new Date("2026-07-20T14:00:00.000Z"),
      ),
    ).resolves.toEqual(new Date("2026-07-21T13:00:00.000Z"));
  });

  it("uses the opening after the upcoming shift for a pre-open unlock", async () => {
    const service = createService(weeklyHours);

    await expect(
      service.getDailySessionExpiry(
        "location-1",
        new Date("2026-07-20T12:00:00.000Z"),
      ),
    ).resolves.toEqual(new Date("2026-07-21T13:00:00.000Z"));
  });

  it("caps sparse pre-open sessions at the eight-day safety limit", async () => {
    const service = createService([row(1, "09:00", "17:00")]);

    await expect(
      service.getDailySessionExpiry(
        "location-1",
        new Date("2026-07-20T22:00:00.000Z"),
      ),
    ).resolves.toEqual(new Date("2026-07-28T22:00:00.000Z"));
  });

  it("rejects unlock expiry when every KDS day is closed", async () => {
    const service = createService([row(1, "09:00", "17:00", true)]);

    await expect(
      service.getDailySessionExpiry(
        "location-1",
        new Date("2026-07-20T14:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
