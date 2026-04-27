import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DriverAvailabilityStatus,
  EmployeeRole,
  IdentityProvider,
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";

const EMPLOYEE_ROLES: EmployeeRole[] = [
  "MANAGER",
  "CASHIER",
  "KITCHEN",
  "DRIVER",
];

const DRIVER_AVAILABILITY_STATUSES: DriverAvailabilityStatus[] = [
  "AVAILABLE",
  "ON_DELIVERY",
  "OFF_SHIFT",
  "UNAVAILABLE",
  "INACTIVE",
];

type StaffListMember = {
  userId: string;
  role: EmployeeRole;
  hourlyRateCents: number | null;
  hireDate: Date | null;
  isActiveEmployee: boolean;
  createdAt: Date;
  archivedAt: Date | null;
  user: {
    id: string;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    identities: Array<{
      provider: IdentityProvider;
      phoneE164: string | null;
      emailNormalized: string | null;
      isPrimary: boolean;
    }>;
  };
  driverProfile: {
    availabilityStatus: DriverAvailabilityStatus;
    isOnDelivery: boolean;
    vehicleType: string | null;
    vehicleIdentifier: string | null;
    isActive: boolean;
    archivedAt: Date | null;
  } | null;
};

type CreateStaffMemberInput = {
  full_name: string;
  phone: string;
  email?: string;
  employee_role: EmployeeRole;
  employee_pin?: string;
  hourly_rate_cents?: number;
  hire_date?: string;
  is_active?: boolean;
  availability_status?: DriverAvailabilityStatus;
  vehicle_type?: string;
  vehicle_identifier?: string;
};

type UpdateStaffMemberInput = Omit<CreateStaffMemberInput, "employee_role">;

const STAFF_MEMBER_INCLUDE = {
  user: {
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      isActive: true,
      identities: {
        select: {
          provider: true,
          phoneE164: true,
          emailNormalized: true,
          isPrimary: true,
          id: true,
        },
      },
    },
  },
  driverProfile: {
    select: {
      availabilityStatus: true,
      isOnDelivery: true,
      vehicleType: true,
      vehicleIdentifier: true,
      isActive: true,
      archivedAt: true,
    },
  },
} as const;

function normalizePhone(phone: string): string {
  const digitsOnly = phone.trim().replace(/\D/g, "");

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  throw new BadRequestException("Please enter a valid 10 digit phone number");
}

function splitName(fullName: string) {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3) {
    throw new BadRequestException("Full name must be at least 3 characters");
  }

  const parts = trimmed.split(" ");
  return {
    displayName: trimmed,
    firstName: parts[0] ?? trimmed,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function serializeStaffMember(member: StaffListMember) {
  const primaryPhone =
    member.user.identities.find(
      (identity) => identity.provider === "PHONE_OTP" && identity.isPrimary,
    )?.phoneE164 ??
    member.user.identities.find((identity) => identity.phoneE164)?.phoneE164 ??
    null;

  const email =
    member.user.identities.find((identity) => identity.provider === "EMAIL")
      ?.emailNormalized ?? null;

  return {
    user_id: member.userId,
    display_name: member.user.displayName,
    first_name: member.user.firstName,
    last_name: member.user.lastName,
    employee_role: member.role,
    is_active:
      member.user.isActive &&
      member.isActiveEmployee &&
      member.archivedAt === null,
    phone: primaryPhone,
    email,
    hire_date: member.hireDate,
    hourly_rate_cents: member.hourlyRateCents,
    created_at: member.createdAt,
    driver_profile: member.driverProfile
      ? {
          availability_status: member.driverProfile.availabilityStatus,
          is_on_delivery: member.driverProfile.isOnDelivery,
          vehicle_type: member.driverProfile.vehicleType,
          vehicle_identifier: member.driverProfile.vehicleIdentifier,
          is_active:
            member.driverProfile.isActive &&
            member.driverProfile.archivedAt === null,
        }
      : null,
  };
}

@Injectable()
export class AdminStaffService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMemberOrThrow(locationId: string, userId: string) {
    const member = await this.prisma.employeeProfile.findFirst({
      where: {
        userId,
        locationId,
        archivedAt: null,
      },
      include: STAFF_MEMBER_INCLUDE,
    });

    if (!member) {
      throw new NotFoundException("Staff member not found");
    }

    return member;
  }

  async listMembers(locationId: string) {
    const members = await this.prisma.employeeProfile.findMany({
      where: {
        locationId,
        archivedAt: null,
        role: { in: EMPLOYEE_ROLES },
      },
      include: STAFF_MEMBER_INCLUDE,
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    });

    const items = members.map((member) =>
      serializeStaffMember(member as StaffListMember),
    );

    return {
      summary: {
        total_team: items.length,
        active_team: items.filter((item) => item.is_active).length,
        managers: items.filter((item) => item.employee_role === "MANAGER")
          .length,
        cashiers: items.filter((item) => item.employee_role === "CASHIER")
          .length,
        kitchen: items.filter((item) => item.employee_role === "KITCHEN")
          .length,
        drivers: items.filter((item) => item.employee_role === "DRIVER")
          .length,
        drivers_available: items.filter(
          (item) =>
            item.employee_role === "DRIVER" &&
            item.driver_profile?.availability_status === "AVAILABLE" &&
            item.driver_profile.is_active,
        ).length,
        drivers_on_delivery: items.filter(
          (item) =>
            item.employee_role === "DRIVER" &&
            item.driver_profile?.is_on_delivery,
        ).length,
      },
      items,
    };
  }

  async createMember(
    locationId: string,
    actorUserId: string,
    input: CreateStaffMemberInput,
  ) {
    const { displayName, firstName, lastName } = splitName(input.full_name);
    const phoneE164 = normalizePhone(input.phone);
    const normalizedEmail = input.email?.trim()
      ? input.email.trim().toLowerCase()
      : null;
    const isActive = input.is_active ?? true;

    if (input.employee_pin && !/^\d{5}$/.test(input.employee_pin)) {
      throw new BadRequestException("Employee PIN must be exactly 5 digits");
    }

    if (
      input.hourly_rate_cents != null &&
      (!Number.isInteger(input.hourly_rate_cents) ||
        input.hourly_rate_cents < 0)
    ) {
      throw new BadRequestException("Hourly rate must be a positive whole number");
    }

    if (!EMPLOYEE_ROLES.includes(input.employee_role)) {
      throw new BadRequestException("Unsupported employee role");
    }

    if (
      input.employee_role === "DRIVER" &&
      input.availability_status &&
      !DRIVER_AVAILABILITY_STATUSES.includes(input.availability_status)
    ) {
      throw new BadRequestException("Unsupported driver availability status");
    }

    const [existingPhone, existingEmail] = await Promise.all([
      this.prisma.userIdentity.findUnique({ where: { phoneE164 } }),
      normalizedEmail
        ? this.prisma.userIdentity.findFirst({
            where: { provider: "EMAIL", emailNormalized: normalizedEmail },
          })
        : Promise.resolve(null),
    ]);

    if (existingPhone) {
      throw new ConflictException("That phone number is already in use");
    }

    if (existingEmail) {
      throw new ConflictException("That email address is already in use");
    }

    const hireDate = input.hire_date
      ? new Date(`${input.hire_date}T00:00:00.000Z`)
      : null;

    if (hireDate && Number.isNaN(hireDate.getTime())) {
      throw new BadRequestException("Hire date is invalid");
    }

    const pinHash = input.employee_pin
      ? await bcrypt.hash(input.employee_pin, 10)
      : null;

    const driverStatus: DriverAvailabilityStatus =
      input.employee_role === "DRIVER"
        ? isActive
          ? (input.availability_status ?? "AVAILABLE")
          : "INACTIVE"
        : "INACTIVE";

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: "STAFF",
          displayName,
          firstName,
          lastName,
          isActive,
        },
      });

      await tx.userIdentity.create({
        data: {
          userId: user.id,
          provider: "PHONE_OTP",
          phoneE164,
          isPrimary: true,
        },
      });

      if (normalizedEmail) {
        await tx.userIdentity.create({
          data: {
            userId: user.id,
            provider: "EMAIL",
            providerSubject: normalizedEmail,
            emailNormalized: normalizedEmail,
            isPrimary: false,
          },
        });
      }

      await tx.employeeProfile.create({
        data: {
          userId: user.id,
          locationId,
          role: input.employee_role,
          employeePinHash: pinHash,
          hourlyRateCents: input.hourly_rate_cents ?? null,
          hireDate,
          isActiveEmployee: isActive,
        },
      });

      if (input.employee_role === "DRIVER") {
        await tx.driverProfile.create({
          data: {
            userId: user.id,
            locationId,
            phoneNumberMirror: phoneE164,
            emailMirror: normalizedEmail,
            vehicleType: input.vehicle_type?.trim() || null,
            vehicleIdentifier: input.vehicle_identifier?.trim() || null,
            availabilityStatus: driverStatus,
            isActive,
            isOnDelivery: driverStatus === "ON_DELIVERY",
          },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "ADMIN",
          actionKey: "staff_member.create",
          entityType: "EmployeeProfile",
          entityId: user.id,
          payloadJson: {
            employee_role: input.employee_role,
            phone_e164: phoneE164,
            email: normalizedEmail,
            driver_availability_status:
              input.employee_role === "DRIVER" ? driverStatus : null,
          },
        },
      });

      return tx.employeeProfile.findUniqueOrThrow({
        where: { userId: user.id },
        include: STAFF_MEMBER_INCLUDE,
      });
    });

    return {
      item: serializeStaffMember(created as StaffListMember),
    };
  }

  async updateMember(
    locationId: string,
    actorUserId: string,
    userId: string,
    input: UpdateStaffMemberInput,
  ) {
    const existing = await this.getMemberOrThrow(locationId, userId);
    const { displayName, firstName, lastName } = splitName(input.full_name);
    const phoneE164 = normalizePhone(input.phone);
    const normalizedEmail = input.email?.trim()
      ? input.email.trim().toLowerCase()
      : null;
    const isActive = input.is_active ?? true;

    if (input.employee_pin && !/^\d{5}$/.test(input.employee_pin)) {
      throw new BadRequestException("Employee PIN must be exactly 5 digits");
    }

    if (
      input.hourly_rate_cents != null &&
      (!Number.isInteger(input.hourly_rate_cents) ||
        input.hourly_rate_cents < 0)
    ) {
      throw new BadRequestException("Hourly rate must be a positive whole number");
    }

    if (
      existing.role === "DRIVER" &&
      input.availability_status &&
      !DRIVER_AVAILABILITY_STATUSES.includes(input.availability_status)
    ) {
      throw new BadRequestException("Unsupported driver availability status");
    }

    const [existingPhone, existingEmail] = await Promise.all([
      this.prisma.userIdentity.findUnique({ where: { phoneE164 } }),
      normalizedEmail
        ? this.prisma.userIdentity.findFirst({
            where: { provider: "EMAIL", emailNormalized: normalizedEmail },
          })
        : Promise.resolve(null),
    ]);

    if (existingPhone && existingPhone.userId !== userId) {
      throw new ConflictException("That phone number is already in use");
    }

    if (existingEmail && existingEmail.userId !== userId) {
      throw new ConflictException("That email address is already in use");
    }

    const hireDate = input.hire_date
      ? new Date(`${input.hire_date}T00:00:00.000Z`)
      : null;

    if (hireDate && Number.isNaN(hireDate.getTime())) {
      throw new BadRequestException("Hire date is invalid");
    }

    const pinHash = input.employee_pin
      ? await bcrypt.hash(input.employee_pin, 10)
      : null;

    const phoneIdentity = existing.user.identities.find(
      (identity) => identity.provider === "PHONE_OTP" && identity.isPrimary,
    );
    const emailIdentity = existing.user.identities.find(
      (identity) => identity.provider === "EMAIL",
    );

    const nextDriverStatus: DriverAvailabilityStatus =
      existing.role === "DRIVER"
        ? isActive
          ? (input.availability_status ??
            existing.driverProfile?.availabilityStatus ??
            "AVAILABLE")
          : "INACTIVE"
        : "INACTIVE";

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          displayName,
          firstName,
          lastName,
          isActive,
        },
      });

      if (phoneIdentity) {
        await tx.userIdentity.update({
          where: { id: phoneIdentity.id },
          data: {
            phoneE164,
            isPrimary: true,
          },
        });
      } else {
        await tx.userIdentity.create({
          data: {
            userId,
            provider: "PHONE_OTP",
            phoneE164,
            isPrimary: true,
          },
        });
      }

      if (normalizedEmail) {
        if (emailIdentity) {
          await tx.userIdentity.update({
            where: { id: emailIdentity.id },
            data: {
              providerSubject: normalizedEmail,
              emailNormalized: normalizedEmail,
            },
          });
        } else {
          await tx.userIdentity.create({
            data: {
              userId,
              provider: "EMAIL",
              providerSubject: normalizedEmail,
              emailNormalized: normalizedEmail,
              isPrimary: false,
            },
          });
        }
      } else if (emailIdentity) {
        await tx.userIdentity.delete({
          where: { id: emailIdentity.id },
        });
      }

      await tx.employeeProfile.update({
        where: { userId },
        data: {
          hourlyRateCents: input.hourly_rate_cents ?? null,
          hireDate,
          isActiveEmployee: isActive,
          ...(pinHash ? { employeePinHash: pinHash } : {}),
        },
      });

      if (existing.role === "DRIVER") {
        await tx.driverProfile.update({
          where: { userId },
          data: {
            phoneNumberMirror: phoneE164,
            emailMirror: normalizedEmail,
            vehicleType: input.vehicle_type?.trim() || null,
            vehicleIdentifier: input.vehicle_identifier?.trim() || null,
            availabilityStatus: nextDriverStatus,
            isActive,
            isOnDelivery: nextDriverStatus === "ON_DELIVERY",
          },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "ADMIN",
          actionKey: "staff_member.update",
          entityType: "EmployeeProfile",
          entityId: userId,
          payloadJson: {
            employee_role: existing.role,
            phone_e164: phoneE164,
            email: normalizedEmail,
            driver_availability_status:
              existing.role === "DRIVER" ? nextDriverStatus : null,
          },
        },
      });

      return tx.employeeProfile.findUniqueOrThrow({
        where: { userId },
        include: STAFF_MEMBER_INCLUDE,
      });
    });

    return {
      item: serializeStaffMember(updated as StaffListMember),
    };
  }

  async deleteDriver(
    locationId: string,
    actorUserId: string,
    userId: string,
  ) {
    const existing = await this.getMemberOrThrow(locationId, userId);

    if (existing.role !== "DRIVER") {
      throw new BadRequestException("Only driver records can be deleted here");
    }

    const activeAssignments = await this.prisma.order.count({
      where: {
        locationId,
        assignedDriverUserId: userId,
        status: {
          in: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"],
        },
      },
    });

    if (activeAssignments > 0) {
      throw new ConflictException(
        "Driver cannot be deleted while assigned to an active order",
      );
    }

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { userId },
        data: {
          isActive: false,
          isOnDelivery: false,
          availabilityStatus: "INACTIVE",
          archivedAt: now,
        },
      }),
      this.prisma.employeeProfile.update({
        where: { userId },
        data: {
          isActiveEmployee: false,
          archivedAt: now,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          archivedAt: now,
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "ADMIN",
          actionKey: "staff_member.delete_driver",
          entityType: "DriverProfile",
          entityId: userId,
          payloadJson: {
            deleted_driver_user_id: userId,
            driver_name: existing.user.displayName,
          },
        },
      }),
    ]);

    return {
      ok: true,
      user_id: userId,
      archived_at: now,
    };
  }
}
