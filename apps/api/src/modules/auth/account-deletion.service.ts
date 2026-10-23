import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { eraseCustomerData } from "./account-deletion.cleanup";
import { ACCOUNT_DELETION_POLICY_VERSION, accountDeletionEnabled, DELETION_AUTHORIZATION_TTL_MS,
  DELETION_BLOCKERS, type DeletionBlockerCode, TERMINAL_ORDER_STATUSES } from "./account-deletion.policy";

type CustomerSession = { userId: string; role: string; sessionId: string };
export type DeletionResult = {
  status: "completed" | "resolution_required";
  request_id: string;
  blockers: Array<{ code: DeletionBlockerCode; message: string }>;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class AccountDeletionService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeGateway) {}

  config() {
    return { enabled: accountDeletionEnabled(), policy_version: ACCOUNT_DELETION_POLICY_VERSION };
  }

  async receipt(input: { request_id: string; authorization: string }) {
    // A completed account no longer has a usable login. The original 256-bit
    // secret permits a minimal completion check for 24h, never another deletion.
    if (!/^[a-f0-9]{64}$/.test(input.authorization)) return { status: "unconfirmed" as const };
    try {
      const row = await this.prisma.accountDeletionRequest.findFirst({ where: {
        id: input.request_id, authorizationHash: digest(input.authorization), status: "COMPLETED",
        completedAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) },
      }, select: { id: true } });
      return row ? { status: "completed" as const, request_id: row.id } : { status: "unconfirmed" as const };
    } catch { throw new ServiceUnavailableException("Deletion completion could not be confirmed. Please try again."); }
  }

  private enabled() {
    if (!accountDeletionEnabled()) throw new ServiceUnavailableException("Account deletion is not available yet. Your account has not been deleted.");
  }

  private customer(session: CustomerSession) {
    // RolesGuard deliberately permits ADMIN overrides. Never allow that here.
    if (!session?.userId || !session.sessionId) throw new UnauthorizedException("Sign in to manage your account.");
    if (session.role !== "CUSTOMER") throw new ForbiddenException("Only customer accounts can use account deletion.");
  }

  private async lockedCustomer(tx: Prisma.TransactionClient, session: CustomerSession, allowCompleted = false) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${session.userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: session.userId },
      include: { employeeProfile: true, adminLocationAssignments: { select: { userId: true } } } });
    if (!user || user.role !== "CUSTOMER") throw new ForbiddenException("Only customer accounts can use account deletion.");
    if (allowCompleted && user.accountDeletedAt) return user;
    if (!user.isActive || user.archivedAt || user.accountDeletedAt) throw new UnauthorizedException("Your session is no longer valid.");
    const authSession = await tx.authSession.findFirst({ where: { id: session.sessionId, userId: user.id,
      revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!authSession) throw new UnauthorizedException("Your session is no longer valid.");
    return user;
  }

  async status(session: CustomerSession) {
    this.customer(session);
    if (!accountDeletionEnabled()) return { ...this.config(), status: "unavailable", blockers: [], available_stamps: 0 };
    return this.prisma.$transaction(async tx => {
      const user = await this.lockedCustomer(tx, session);
      const [blockers, rewards, request] = await Promise.all([
        this.blockers(tx, user), tx.customerWingsRewards.findUnique({ where: { customerUserId: user.id } }),
        tx.accountDeletionRequest.findUnique({ where: { userId: user.id } }),
      ]);
      return { ...this.config(), status: blockers.length ? "resolution_required" : "ready",
        blockers, available_stamps: rewards?.availableStamps ?? 0,
        request_id: request?.id ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => this.failure(error));
  }

  async verify(session: CustomerSession, password: string) {
    this.customer(session); this.enabled();
    return this.prisma.$transaction(async tx => {
      const user = await this.lockedCustomer(tx, session);
      if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new ForbiddenException("Password verification failed. Use Forgot password if you need to set or reset your password.");
      }
      const authorization = randomBytes(32).toString("hex");
      const requestId = randomUUID();
      const expiresAt = new Date(Date.now() + DELETION_AUTHORIZATION_TTL_MS);
      await tx.accountDeletionAuthorization.deleteMany({ where: { userId: user.id } });
      await tx.accountDeletionAuthorization.create({ data: { userId: user.id, sessionId: session.sessionId,
        tokenHash: digest(authorization), requestId, credentialHash: digest(user.passwordHash), expiresAt } });
      return { authorization, request_id: requestId, expires_at: expiresAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => this.failure(error));
  }

  async remove(session: CustomerSession, input: { authorization: string; request_id: string; confirmation: string; forfeit_rewards: boolean }): Promise<DeletionResult> {
    this.customer(session); this.enabled();
    if (input.confirmation !== "DELETE") throw new BadRequestException("Confirm permanent account deletion.");
    if (!/^[a-f0-9]{64}$/.test(input.authorization)) throw new UnauthorizedException("Verify your password again.");
    const authorizationHash = digest(input.authorization);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.prisma.$transaction(async tx => {
          const user = await this.lockedCustomer(tx, session, true);
          const previous = await tx.accountDeletionRequest.findUnique({ where: { userId: user.id } });
          // Only an identical in-flight request already authenticated by the guard
          // may get the completed result. Different proof/request IDs are replays.
          if (user.accountDeletedAt) {
            if (previous?.status === "COMPLETED" && previous.id === input.request_id && previous.authorizationHash === authorizationHash) {
              return { status: "completed" as const, request_id: previous.id, blockers: [] };
            }
            throw new UnauthorizedException("Deletion authorization is no longer valid.");
          }
          const now = new Date();
          const consumed = await tx.accountDeletionAuthorization.updateMany({ where: {
            userId: user.id, sessionId: session.sessionId, tokenHash: authorizationHash, consumedAt: null,
            requestId: input.request_id,
            credentialHash: digest(user.passwordHash ?? ""), expiresAt: { gt: now },
          }, data: { consumedAt: now } });
          if (consumed.count !== 1) throw new UnauthorizedException("Deletion authorization expired or was already used. Verify your password again.");
          const blockers = await this.blockers(tx, user);
          const rewards = await tx.customerWingsRewards.findUnique({ where: { customerUserId: user.id } });
          if ((rewards?.availableStamps ?? 0) > 0 && input.forfeit_rewards !== true) {
            throw new BadRequestException("Confirm that your available rewards will be lost.");
          }
          const status = blockers.length ? "RESOLUTION_REQUIRED" : "COMPLETED";
          const data = { id: input.request_id, authorizationHash, status,
            blockersJson: blockers.map(blocker => blocker.code), completedAt: blockers.length ? null : now };
          await tx.accountDeletionRequest.upsert({ where: { userId: user.id },
            create: { ...data, userId: user.id }, update: { ...data, updatedAt: now } });
          if (blockers.length) return { status: "resolution_required" as const, request_id: input.request_id, blockers };
          await eraseCustomerData(tx, user.id, now);
          return { status: "completed" as const, request_id: input.request_id, blockers: [] };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
        if (result.status === "completed") {
          // DB revocation is already committed; transport cleanup cannot roll it back.
          // Every customer broadcast revalidates the session on every API instance.
          try { this.realtime.disconnectCustomer(session.userId); } catch { /* DB authorization remains revoked. */ }
        }
        return result;
      } catch (error) {
        if (isTransactionConflict(error) && attempt < 2) continue;
        if (error instanceof UnauthorizedException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
        // Never send Prisma errors (parameters may contain sensitive JSON) to logs/clients.
        throw new ServiceUnavailableException("Deletion could not be confirmed. Your request can be retried; verify your password again if it has expired.");
      }
    }
    throw new ServiceUnavailableException("Please try again shortly.");
  }

  private async blockers(tx: Prisma.TransactionClient, user: { id: string; employeeProfile: unknown; adminLocationAssignments: unknown[] }) {
    const id = user.id;
    const customerOrder = { customerUserId: id };
    const openTicket = { OR: [{ customerUserId: id }, { order: customerOrder }] };
    const checks: Array<[DeletionBlockerCode, Promise<number>]> = [
      ["ACCOUNT_HOLD", tx.accountDeletionHold.count({ where: { userId: id, releasedAt: null } })],
      ["ACTIVE_ORDERS", tx.order.count({ where: { ...customerOrder, status: { notIn: [...TERMINAL_ORDER_STATUSES] } } })],
      ["PENDING_PAYMENTS", tx.orderPayment.count({ where: { order: customerOrder, transactionStatus: "PENDING" } })],
      // Terminal summary balances remain available for staff reconciliation;
      // actual pending transactions/refunds and holds are independent blockers.
      ["OUTSTANDING_PAYMENTS", tx.order.count({ where: { ...customerOrder, status: { notIn: [...TERMINAL_ORDER_STATUSES] },
        paymentStatusSummary: { in: ["UNPAID", "PENDING", "PARTIALLY_PAID", "FAILED"] } } })],
      ["PENDING_REFUNDS", tx.refundRequest.count({ where: { OR: [{ requestedByUserId: id }, { order: customerOrder }], status: { in: ["PENDING", "APPROVED"] } } })],
      ["WALLET_BALANCE", tx.customerWallet.count({ where: { customerUserId: id, balanceCents: { not: 0 } } })],
      ["OPEN_SUPPORT", tx.supportTicket.count({ where: { ...openTicket, status: { notIn: ["RESOLVED", "CLOSED"] } } })],
      ["OPEN_CANCELLATION", tx.cancellationRequest.count({ where: { OR: [{ order: customerOrder }, { requestedByUserId: id }], status: { notIn: ["APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"] } } })],
      ["OPEN_CATERING", tx.cateringInquiry.count({ where: { customerUserId: id, status: { notIn: ["CLOSED", "CANCELLED", "COMPLETED"] } } })],
      ["REWARD_NOTIFICATION", tx.wingsStampGrantEmail.count({ where: { grant: { customerUserId: id }, leaseUntil: { gt: new Date() } } })],
    ];
    const counts = await Promise.all(checks.map(async ([code, query]) => ({ code, count: await query })));
    const staffHistory = await Promise.all([
      tx.registerSession.count({ where: { OR: [{ openedByUserId: id }, { closedByUserId: id }] } }),
      tx.cashDrawerEvent.count({ where: { OR: [{ actorUserId: id }, { approvedByUserId: id }] } }),
      tx.inventoryAdjustment.count({ where: { actorUserId: id } }),
      tx.restockList.count({ where: { createdByUserId: id } }),
      tx.driverPayout.count({ where: { OR: [{ createdByUserId: id }, { paidByUserId: id }] } }),
      tx.busyModeEvent.count({ where: { OR: [{ startedByUserId: id }, { endedByUserId: id }] } }),
      tx.promoCode.count({ where: { createdByUserId: id } }),
    ]);
    if (user.employeeProfile || user.adminLocationAssignments.length || staffHistory.some(count => count > 0)) {
      counts.push({ code: "STAFF_HISTORY", count: 1 });
    }
    return counts.filter(value => value.count > 0).map(({ code }) => ({ code, message: DELETION_BLOCKERS[code] }));
  }

  private failure(error: unknown): never {
    if (error instanceof UnauthorizedException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
    throw new ServiceUnavailableException("Account deletion is temporarily unavailable. Please try again.");
  }
}

function isTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}
