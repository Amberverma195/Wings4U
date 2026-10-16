import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { CustomerAddress, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { normalizeCanadianPostalCode } from "../delivery-pricing/delivery-address";
import { customerAddressIdentity, normalizeAddressText } from "./customer-address-identity";

export interface CustomerAddressDto {
  id: string; label: string | null; line1: string; city: string; postal_code: string;
  is_default: boolean; created_at: string; updated_at: string;
}
export interface UpsertCustomerAddressInput {
  label?: string | null; line1: string; city: string; postalCode: string; isDefault?: boolean;
}
export type UpdateCustomerAddressInput = Partial<UpsertCustomerAddressInput>;
type AddressTransaction = Pick<Prisma.TransactionClient, "customerAddress" | "$queryRaw">;

async function lockAddressBook(tx: AddressTransaction, userId: string) {
  // Shared with the database trigger. Held until the surrounding transaction ends.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${userId}::text, 84542))`;
}
function normalizeInput(input: UpsertCustomerAddressInput) {
  const result = { line1: normalizeAddressText(input.line1), city: normalizeAddressText(input.city),
    postalCode: normalizeCanadianPostalCode(input.postalCode) };
  if (!result.line1 || !result.city || !result.postalCode) {
    throw new UnprocessableEntityException("Street address, city and postal code are required.");
  }
  return result;
}
async function findMatching(tx: AddressTransaction, userId: string, input: UpsertCustomerAddressInput, excludeId?: string) {
  // Finds untouched legacy rows whose postal codes were saved without a space.
  const rows = await tx.customerAddress.findMany({ where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }] });
  const key = customerAddressIdentity(input);
  return rows.find(row => row.id !== excludeId && customerAddressIdentity(row) === key);
}
/** Called inside checkout's existing transaction; do not pass a root Prisma client. */
export async function ensureCustomerAddressExists(tx: AddressTransaction, userId: string, input: UpsertCustomerAddressInput): Promise<CustomerAddressDto> {
  const normalized = normalizeInput(input);
  await lockAddressBook(tx, userId);
  const existing = await findMatching(tx, userId, normalized);
  if (existing) return toDto(existing);
  const created = await tx.customerAddress.create({ data: { userId, ...normalized,
    label: sanitizeLabel(input.label), isDefault: false } });
  return toDto(created);
}
function duplicateError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    throw new ConflictException("This address is already saved.");
  }
  throw error;
}
@Injectable()
export class CustomerAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<CustomerAddressDto[]> {
    const rows = await this.prisma.customerAddress.findMany({ where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }] });
    // Keep authoritative records visible until the separately approved legacy cleanup.
    return rows.map(toDto);
  }
  async ensure(userId: string, input: UpsertCustomerAddressInput): Promise<CustomerAddressDto> {
    return this.prisma.$transaction(tx => ensureCustomerAddressExists(tx, userId, input));
  }
  async upsert(userId: string, input: UpsertCustomerAddressInput): Promise<CustomerAddressDto> {
    const normalized = normalizeInput(input);
    try {
      return await this.prisma.$transaction(async tx => {
        await lockAddressBook(tx, userId);
        const existing = await findMatching(tx, userId, normalized);
        const isDefault = input.isDefault === true || existing?.isDefault === true;
        const label = sanitizeLabel(input.label) ?? existing?.label ?? null;
        const saved = existing ? await tx.customerAddress.update({ where: { id: existing.id },
          data: { ...normalized, label, isDefault } }) : await tx.customerAddress.create({
          data: { userId, ...normalized, label, isDefault } });
        if (isDefault) await tx.customerAddress.updateMany({
          where: { userId, isDefault: true, NOT: { id: saved.id } }, data: { isDefault: false } });
        return toDto(saved);
      });
    } catch (error) { return duplicateError(error); }
  }
  async update(userId: string, addressId: string, input: UpdateCustomerAddressInput): Promise<CustomerAddressDto> {
    try {
      return await this.prisma.$transaction(async tx => {
        await lockAddressBook(tx, userId);
        const existing = await this.getOwned(tx, userId, addressId);
        const normalized = normalizeInput({ line1: input.line1 ?? existing.line1, city: input.city ?? existing.city,
          postalCode: input.postalCode ?? existing.postalCode });
        if (await findMatching(tx, userId, normalized, addressId)) {
          throw new ConflictException("This address is already saved.");
        }
        const isDefault = input.isDefault ?? existing.isDefault;
        const saved = await tx.customerAddress.update({ where: { id: addressId }, data: { ...normalized,
          label: input.label !== undefined ? sanitizeLabel(input.label) : undefined, isDefault } });
        if (isDefault) await tx.customerAddress.updateMany({
          where: { userId, isDefault: true, NOT: { id: addressId } }, data: { isDefault: false } });
        return toDto(saved);
      });
    } catch (error) { return duplicateError(error); }
  }
  async remove(userId: string, addressId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockAddressBook(tx, userId);
      await this.getOwned(tx, userId, addressId);
      await tx.customerAddress.delete({ where: { id: addressId } });
    });
  }
  private async getOwned(tx: AddressTransaction, userId: string, addressId: string): Promise<CustomerAddress> {
    const row = await tx.customerAddress.findUnique({ where: { id: addressId } });
    if (!row) throw new NotFoundException("Address not found");
    if (row.userId !== userId) throw new ForbiddenException("Address not found");
    return row;
  }
}
function toDto(row: CustomerAddress): CustomerAddressDto {
  return { id: row.id, label: row.label, line1: row.line1, city: row.city,
    postal_code: normalizeCanadianPostalCode(row.postalCode), is_default: row.isDefault,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() };
}
function sanitizeLabel(value: string | null | undefined): string | null { return value?.trim() || null; }
