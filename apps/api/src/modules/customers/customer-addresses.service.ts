import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CustomerAddress } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface CustomerAddressDto {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  postal_code: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertCustomerAddressInput {
  label?: string | null;
  line1: string;
  city: string;
  postalCode: string;
  isDefault?: boolean;
}

export type UpdateCustomerAddressInput = Partial<UpsertCustomerAddressInput>;

/**
 * Persisted customer delivery addresses. Rows belong to a user so they follow
 * the user across devices. We keep dedupe at the app layer (normalized
 * line1 + postal) instead of a DB unique index so users can later attach
 * labels ("Home", "Work") to what would otherwise be the same address.
 */
@Injectable()
export class CustomerAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<CustomerAddressDto[]> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return rows.map(toDto);
  }

  /**
   * Create-or-reuse: if the user already has an address at the same
   * normalized line1 + postal code, update that row's fields and return it
   * (so the picker never shows duplicates). Otherwise insert a new row.
   */
  async upsert(
    userId: string,
    input: UpsertCustomerAddressInput,
  ): Promise<CustomerAddressDto> {
    const line1 = input.line1.trim();
    const city = input.city.trim();
    const postalCode = normalizePostalCode(input.postalCode);
    const label = sanitizeLabel(input.label);
    const isDefault = input.isDefault ?? false;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.customerAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const existing = await tx.customerAddress.findFirst({
        where: {
          userId,
          postalCode,
          line1: { equals: line1, mode: "insensitive" },
        },
      });

      if (existing) {
        const updated = await tx.customerAddress.update({
          where: { id: existing.id },
          data: {
            line1,
            city,
            postalCode,
            label: label ?? existing.label,
            isDefault: isDefault || existing.isDefault,
          },
        });
        return toDto(updated);
      }

      const created = await tx.customerAddress.create({
        data: { userId, line1, city, postalCode, label, isDefault },
      });
      return toDto(created);
    });
  }

  async update(
    userId: string,
    addressId: string,
    input: UpdateCustomerAddressInput,
  ): Promise<CustomerAddressDto> {
    const existing = await this.getOwned(userId, addressId);
    const nextIsDefault = input.isDefault ?? existing.isDefault;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true && !existing.isDefault) {
        await tx.customerAddress.updateMany({
          where: { userId, isDefault: true, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          line1: input.line1 !== undefined ? input.line1.trim() : undefined,
          city: input.city !== undefined ? input.city.trim() : undefined,
          postalCode:
            input.postalCode !== undefined
              ? normalizePostalCode(input.postalCode)
              : undefined,
          label:
            input.label !== undefined ? sanitizeLabel(input.label) : undefined,
          isDefault: nextIsDefault,
        },
      });
    });

    return toDto(updated);
  }

  async remove(userId: string, addressId: string): Promise<void> {
    await this.getOwned(userId, addressId);
    await this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  private async getOwned(
    userId: string,
    addressId: string,
  ): Promise<CustomerAddress> {
    const row = await this.prisma.customerAddress.findUnique({
      where: { id: addressId },
    });
    if (!row) throw new NotFoundException("Address not found");
    if (row.userId !== userId) {
      // Don't leak existence of other users' rows.
      throw new ForbiddenException("Address not found");
    }
    return row;
  }
}

function toDto(row: CustomerAddress): CustomerAddressDto {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    city: row.city,
    postal_code: row.postalCode,
    is_default: row.isDefault,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function normalizePostalCode(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function sanitizeLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
