import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const VALID_AVAILABILITY_STATUSES = new Set([
  "AVAILABLE",
  "ON_DELIVERY",
  "OFF_SHIFT",
  "UNAVAILABLE",
  "INACTIVE",
]);

function serializeDriver(d: Record<string, unknown>) {
  return {
    user_id: d.userId,
    location_id: d.locationId,
    phone_number_mirror: d.phoneNumberMirror,
    vehicle_type: d.vehicleType,
    vehicle_identifier: d.vehicleIdentifier,
    availability_status: d.availabilityStatus,
    is_active: d.isActive,
    is_on_delivery: d.isOnDelivery,
    total_deliveries_completed: d.totalDeliveriesCompleted,
    average_rating_numeric: d.averageRatingNumeric,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async getAvailableDrivers(locationId: string) {
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        locationId,
        archivedAt: null,
        availabilityStatus: { in: ["AVAILABLE", "ON_DELIVERY"] },
        isActive: true,
        employeeProfile: {
          is: {
            archivedAt: null,
            isActiveEmployee: true,
          },
        },
      },
      include: {
        employeeProfile: {
          include: { user: { select: { displayName: true } } },
        },
      },
      orderBy: [{ isOnDelivery: "asc" }, { lastAssignedAt: "asc" }],
    });

    return {
      drivers: drivers.map((d) => ({
        ...serializeDriver(d as unknown as Record<string, unknown>),
        full_name: d.employeeProfile?.user?.displayName ?? "Unknown",
      })),
    };
  }

  async updateAvailability(
    driverUserId: string,
    status: string,
    locationId: string,
  ) {
    if (!VALID_AVAILABILITY_STATUSES.has(status)) {
      throw new UnprocessableEntityException({
        message: `Invalid availability status "${status}"`,
        field: "status",
      });
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) {
      throw new NotFoundException("Driver profile not found");
    }
    if (driver.locationId !== locationId) {
      throw new ForbiddenException("Driver does not belong to this location");
    }

    const updated = await this.prisma.driverProfile.update({
      where: { userId: driverUserId },
      data: {
        availabilityStatus: status as never,
        isOnDelivery: status === "ON_DELIVERY",
      },
    });

    this.realtime.emitDriverEvent(driver.locationId, "driver.availability_changed", {
      driver_user_id: driverUserId,
      location_id: driver.locationId,
      availability_status: status,
    });

    return serializeDriver(updated as unknown as Record<string, unknown>);
  }
}
