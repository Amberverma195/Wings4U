import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import type { DriverAvailabilityStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

function serializeBreak(b: Record<string, unknown>) {
  return {
    id: b.id,
    break_type: b.breakType,
    started_at: b.startedAt,
    ended_at: b.endedAt ?? null,
  };
}

function serializeShift(s: Record<string, unknown>) {
  const breaks = ((s.breaks as Record<string, unknown>[]) ?? []).map(serializeBreak);

  return {
    id: s.id,
    employee_user_id: s.employeeUserId,
    location_id: s.locationId,
    clock_in_at: s.clockInAt,
    clock_out_at: s.clockOutAt ?? null,
    status: s.status,
    total_break_minutes: s.totalBreakMinutes ?? 0,
    net_worked_minutes: s.netWorkedMinutes ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    breaks,
  };
}

@Injectable()
export class TimeclockService {
  constructor(private readonly prisma: PrismaService) {}

  async clockIn(employeeUserId: string, locationId: string) {
    const existing = await this.prisma.employeeShift.findFirst({
      where: {
        employeeUserId,
        status: { in: ["CLOCKED_IN", "ON_BREAK"] },
      },
    });
    if (existing) {
      throw new ConflictException("Employee already has an active shift");
    }

    const shift = await this.prisma.employeeShift.create({
      data: {
        employeeUserId,
        locationId,
        clockInAt: new Date(),
        status: "CLOCKED_IN",
        totalBreakMinutes: 0,
      },
      include: { breaks: true },
    });

    await this.setDriverAvailabilityIfDriver(employeeUserId, "AVAILABLE");

    return serializeShift(shift as unknown as Record<string, unknown>);
  }

  async startBreak(employeeUserId: string) {
    const shift = await this.findActiveShift(employeeUserId);
    if (!shift) {
      throw new NotFoundException("No active shift found");
    }
    if (shift.status === "ON_BREAK") {
      throw new ConflictException("Employee is already on break");
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.employeeBreak.create({
        data: {
          employeeShiftId: shift.id,
          breakType: "UNPAID",
          startedAt: new Date(),
        },
      }),
      this.prisma.employeeShift.update({
        where: { id: shift.id },
        data: { status: "ON_BREAK" },
        include: { breaks: { orderBy: { startedAt: "asc" } } },
      }),
    ]);

    await this.setDriverAvailabilityIfDriver(employeeUserId, "UNAVAILABLE");

    return serializeShift(updated as unknown as Record<string, unknown>);
  }

  async endBreak(employeeUserId: string) {
    const shift = await this.findActiveShift(employeeUserId);
    if (!shift) {
      throw new NotFoundException("No active shift found");
    }
    if (shift.status !== "ON_BREAK") {
      throw new ConflictException("Employee is not currently on break");
    }

    await this.closeOpenBreak(shift.id);
    const totalBreakMinutes = this.calculateBreakMinutes(shift.breaks);

    const updated = await this.prisma.employeeShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOCKED_IN",
        totalBreakMinutes,
      },
      include: { breaks: { orderBy: { startedAt: "asc" } } },
    });

    await this.setDriverAvailabilityIfDriver(employeeUserId, "AVAILABLE");

    return serializeShift(updated as unknown as Record<string, unknown>);
  }

  async clockOut(employeeUserId: string) {
    const shift = await this.findActiveShift(employeeUserId);
    if (!shift) {
      throw new NotFoundException("No active shift found");
    }

    if (shift.status === "ON_BREAK") {
      await this.closeOpenBreak(shift.id);
    }

    const now = new Date();
    const allBreaks = await this.prisma.employeeBreak.findMany({
      where: { employeeShiftId: shift.id },
      orderBy: { startedAt: "asc" },
    });
    const totalBreakMinutes = this.calculateBreakMinutes(allBreaks);
    const totalShiftMs = now.getTime() - shift.clockInAt.getTime();
    const totalShiftMinutes = Math.round(totalShiftMs / 60_000);
    const netWorkedMinutes = Math.max(0, totalShiftMinutes - totalBreakMinutes);

    const updated = await this.prisma.employeeShift.update({
      where: { id: shift.id },
      data: {
        clockOutAt: now,
        status: "CLOCKED_OUT",
        totalBreakMinutes,
        netWorkedMinutes,
      },
      include: { breaks: { orderBy: { startedAt: "asc" } } },
    });

    await this.setDriverAvailabilityIfDriver(employeeUserId, "OFF_SHIFT");

    return serializeShift(updated as unknown as Record<string, unknown>);
  }

  async getActiveShift(employeeUserId: string) {
    const shift = await this.prisma.employeeShift.findFirst({
      where: {
        employeeUserId,
        status: { in: ["CLOCKED_IN", "ON_BREAK"] },
      },
      include: { breaks: { orderBy: { startedAt: "asc" } } },
    });

    if (!shift) {
      return null;
    }

    return serializeShift(shift as unknown as Record<string, unknown>);
  }

  async getShiftHistory(
    employeeUserId: string,
    cursor?: string,
    limit = 20,
  ) {
    const take = Math.min(limit, 100);

    const shifts = await this.prisma.employeeShift.findMany({
      where: { employeeUserId },
      orderBy: { clockInAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { breaks: { orderBy: { startedAt: "asc" } } },
    });

    const hasMore = shifts.length > take;
    const page = hasMore ? shifts.slice(0, take) : shifts;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      shifts: page.map((s) =>
        serializeShift(s as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  private async findActiveShift(employeeUserId: string) {
    return this.prisma.employeeShift.findFirst({
      where: {
        employeeUserId,
        status: { in: ["CLOCKED_IN", "ON_BREAK"] },
      },
      include: { breaks: true },
    });
  }

  private async closeOpenBreak(shiftId: string) {
    const openBreak = await this.prisma.employeeBreak.findFirst({
      where: { employeeShiftId: shiftId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (openBreak) {
      await this.prisma.employeeBreak.update({
        where: { id: openBreak.id },
        data: { endedAt: new Date() },
      });
    }
  }

  private calculateBreakMinutes(
    breaks: { startedAt: Date; endedAt: Date | null }[],
  ): number {
    let totalMs = 0;
    const now = new Date();
    for (const b of breaks) {
      const end = b.endedAt ?? now;
      totalMs += end.getTime() - b.startedAt.getTime();
    }
    return Math.round(totalMs / 60_000);
  }

  /**
   * If the employee has a driver profile and is not currently on a delivery,
   * update their availability status.
   */
  private async setDriverAvailabilityIfDriver(
    employeeUserId: string,
    status: DriverAvailabilityStatus,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: employeeUserId },
    });
    if (!driver) return;
    if (driver.isOnDelivery && status !== "OFF_SHIFT") return;

    await this.prisma.driverProfile.update({
      where: { userId: employeeUserId },
      data: { availabilityStatus: status },
    });
  }
}
