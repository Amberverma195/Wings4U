import { BadRequestException } from "@nestjs/common";
import { KdsOperatingHoursService } from "./kds-operating-hours.service";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function time(value: string): Date {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

function storedRow(
  dayOfWeek: number,
  from: string,
  to: string,
  serviceType = "STORE",
) {
  return {
    dayOfWeek,
    timeFrom: time(from),
    timeTo: time(to),
    isClosed: false,
    serviceType,
  };
}

function inputRow(dayOfWeek: number, from = "09:00", to = "18:00") {
  return {
    day_of_week: dayOfWeek,
    time_from: from,
    time_to: to,
    is_closed: false,
  };
}

function createService() {
  const storeHours = Array.from({ length: 7 }, (_, day) =>
    storedRow(day, "10:00", "17:00"),
  );
  const savedKdsHours = Array.from({ length: 7 }, (_, day) =>
    storedRow(day, "09:00", "18:00", "KDS"),
  );
  const tx = {
    locationHours: {
      deleteMany: jest.fn().mockResolvedValue({ count: 7 }),
      createMany: jest.fn().mockResolvedValue({ count: 7 }),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    location: {
      findUnique: jest.fn().mockImplementation((args) =>
        args?.select?.id
          ? Promise.resolve({ id: LOCATION_ID })
          : Promise.resolve({
              timezoneName: "America/Toronto",
              hours: savedKdsHours,
            }),
      ),
    },
    locationHours: { findMany: jest.fn().mockResolvedValue(storeHours) },
    order: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  return {
    service: new KdsOperatingHoursService(prisma as never),
    tx,
  };
}

describe("KdsOperatingHoursService schedule editing", () => {
  it("saves validated KDS hours and writes an audit record", async () => {
    const { service, tx } = createService();
    const input = Array.from({ length: 7 }, (_, day) => inputRow(day));

    const result = await service.updateHours(LOCATION_ID, input);

    expect(tx.locationHours.deleteMany).toHaveBeenCalledWith({
      where: { locationId: LOCATION_ID, serviceType: "KDS" },
    });
    expect(tx.locationHours.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          locationId: LOCATION_ID,
          serviceType: "KDS",
          dayOfWeek: 0,
          timeFrom: time("09:00"),
          timeTo: time("18:00"),
        }),
      ]),
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        actorRoleSnapshot: "KDS_STATION",
        actionKey: "kds.operating_hours.update",
      }),
    });
    expect(result).toMatchObject({
      timezone: "America/Toronto",
      is_open: expect.any(Boolean),
      has_active_tickets: false,
    });
  });

  it("rejects KDS hours that do not cover customer store hours", async () => {
    const { service, tx } = createService();
    const input = Array.from({ length: 7 }, (_, day) =>
      inputRow(day, "11:00", "16:00"),
    );

    await expect(service.updateHours(LOCATION_ID, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.locationHours.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate weekdays", async () => {
    const { service } = createService();
    const input = Array.from({ length: 7 }, () => inputRow(1));

    await expect(service.updateHours(LOCATION_ID, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
