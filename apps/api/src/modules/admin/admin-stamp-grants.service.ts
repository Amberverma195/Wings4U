import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AdminAuditService } from "../admin-audit/admin-audit.service";
import { STAMPS_PER_REWARD } from "../rewards/rewards.service";
import { StampGrantEmailService } from "../notifications/stamp-grant-email.service";
import { AdminCustomersService } from "./admin-customers.service";
import type { AdminStampGrantInput, AdminStampGrantResult, StampGrantReason } from "./admin-customers.dto";

const reasons: Record<StampGrantReason, string> = {
  WRONG_ORDER: "Wrong order", MISSING_ITEMS: "Missing items", SERVICE_RECOVERY: "Service recovery", OTHER: "Other",
};
const ACTION = "CUSTOMER_STAMPS_GRANTED";
type Actor = { userId: string; role: string };

@Injectable()
export class AdminStampGrantsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AdminAuditService,
    private readonly emails: StampGrantEmailService, private readonly customers: AdminCustomersService) {}

  private authorize(actor: Actor, locationId: string) {
    if (actor.role !== "ADMIN" || !locationId) throw new ForbiddenException("An administrator and restaurant location are required.");
  }

  async grant(customerId: string, locationId: string, actor: Actor, input: AdminStampGrantInput): Promise<AdminStampGrantResult> {
    this.authorize(actor, locationId);
    const note = input.note?.trim() || null;
    if (!Number.isSafeInteger(input.stamps) || input.stamps <= 0 || input.stamps > STAMPS_PER_REWARD ||
      !Object.hasOwn(reasons, input.reason) || (input.reason === "OTHER" && !note) || (note?.length ?? 0) > 1000) {
      throw new UnprocessableEntityException("Enter a positive whole stamp count within the card limit, a valid reason, and an explanation for Other.");
    }
    // A ledger PK is the durable idempotency key; the audit holds the original private request.
    const replay = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.customerWingsStampLedger.findUnique({ where: { id: input.request_id } });
      if (!existing) return null;
      const audit = await tx.adminAuditLog.findFirst({ where: { actionKey: ACTION, entityId: existing.id } });
      const payload = audit?.payloadJson as Record<string, unknown> | undefined;
      if (existing.entryType !== "ADMIN_GRANTED" || existing.customerUserId !== customerId || existing.deltaStamps !== input.stamps ||
        audit?.actorUserId !== actor.userId || audit?.locationId !== locationId || payload?.reason !== input.reason || payload?.note !== note) {
        throw new ConflictException("This request ID was already used for a different stamp grant.");
      }
      return existing;
    };
    let committed: { entry: NonNullable<Awaited<ReturnType<typeof replay>>>; replayed: boolean };
    try {
      committed = await this.prisma.$transaction(async tx => {
        const customer = await tx.user.findFirst({ where: { id: customerId, role: "CUSTOMER", isActive: true, archivedAt: null }, select: { id: true } });
        if (!customer) throw new NotFoundException("Active customer not found.");
        const existing = await replay(tx);
        if (existing) return { entry: existing, replayed: true };
        // Non-empty upsert UPDATE locks the row until commit, shared with automatic accrual.
        await tx.customerWingsRewards.upsert({ where: { customerUserId: customerId },
          create: { customerUserId: customerId }, update: { availableStamps: { increment: 0 } } });
        // Recheck AFTER acquiring the lock so parallel retries of the same grant also work on full cards.
        const afterLock = await replay(tx);
        if (afterLock) return { entry: afterLock, replayed: true };
        const changed = await tx.customerWingsRewards.updateMany({
          where: { customerUserId: customerId, availableStamps: { lte: STAMPS_PER_REWARD - input.stamps } },
          data: { availableStamps: { increment: input.stamps }, lifetimeStamps: { increment: input.stamps } },
        });
        const summary = await tx.customerWingsRewards.findUniqueOrThrow({ where: { customerUserId: customerId } });
        if (!changed.count) throw new ConflictException({ code: "STAMP_CAP_CHANGED",
          message: `Stamp balance is now ${summary.availableStamps}/${STAMPS_PER_REWARD}. You can add at most ${Math.max(0, STAMPS_PER_REWARD - summary.availableStamps)} stamps. Refresh the rewards and try again.` });
        const entry = await tx.customerWingsStampLedger.create({ data: {
          id: input.request_id, customerUserId: customerId, orderId: null, entryType: "ADMIN_GRANTED",
          deltaStamps: input.stamps, balanceAfterStamps: summary.availableStamps, poundsAwarded: null,
          // Internal explanations belong only in the admin audit, never in a customer-visible ledger.
          reasonText: "Gifted by Wings 4 U — courtesy stamps added.",
        } });
        await this.audit.logActionTx(tx, { actorUserId: actor.userId, actorRoleSnapshot: actor.role, locationId,
          actionKey: ACTION, entityType: "CUSTOMER_WINGS_STAMP_GRANT", entityId: entry.id, reasonText: reasons[input.reason],
          payloadJson: { customer_id: customerId, grant_id: entry.id, request_id: input.request_id, stamps: input.stamps,
            previous_balance: summary.availableStamps - input.stamps, new_balance: summary.availableStamps,
            reason: input.reason, note, timestamp: entry.createdAt.toISOString() } });
        await tx.wingsStampGrantEmail.create({ data: { grantId: entry.id } });
        return { entry, replayed: false };
      });
    } catch (error) {
      // A global UUID collision (including a different customer) rolls back before checking the original request.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await this.prisma.$transaction(tx => replay(tx));
      if (!existing) throw error;
      committed = { entry: existing, replayed: true };
    }
    const email = await this.emails.send(committed.entry.id);
    const fresh = await this.customers.getStamps(customerId, locationId);
    const e = committed.entry;
    return { grant_id: e.id, stamps_granted: e.deltaStamps, replayed: committed.replayed, summary: fresh.summary,
      entry: { id: e.id, entry_type: e.entryType, delta_stamps: e.deltaStamps, balance_after_stamps: e.balanceAfterStamps,
        pounds_awarded: null, reason_text: e.reasonText, created_at: e.createdAt.toISOString(), order_id: null,
        order_number: null, order_fulfillment_type: null, order_accessible: false }, email };
  }

  async retryEmail(customerId: string, grantId: string, locationId: string, actor: Actor) {
    this.authorize(actor, locationId);
    const grant = await this.prisma.customerWingsStampLedger.findFirst({ where: { id: grantId, customerUserId: customerId, entryType: "ADMIN_GRANTED" } });
    const audit = grant && await this.prisma.adminAuditLog.findFirst({ where: { actionKey: ACTION, entityId: grantId, locationId } });
    if (!audit) throw new NotFoundException("Stamp grant not found at this restaurant.");
    return this.emails.send(grantId);
  }
}
