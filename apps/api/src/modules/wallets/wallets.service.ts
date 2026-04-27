import {
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

interface CreditDebitParams {
  userId: string;
  amountCents: number;
  reason: string;
  entryType: string;
  orderId?: string;
  refundRequestId?: string;
  createdByUserId?: string;
}

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string) {
    const wallet = await this.prisma.customerWallet.upsert({
      where: { customerUserId: userId },
      update: {},
      create: {
        customerUserId: userId,
        balanceCents: 0,
        lifetimeCreditCents: 0,
      },
    });

    return wallet;
  }

  async credit(params: CreditDebitParams) {
    if (params.amountCents <= 0) {
      throw new BadRequestException("Credit amount must be positive");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.customerWallet.upsert({
        where: { customerUserId: params.userId },
        update: {
          balanceCents: { increment: params.amountCents },
          lifetimeCreditCents: { increment: params.amountCents },
        },
        create: {
          customerUserId: params.userId,
          balanceCents: params.amountCents,
          lifetimeCreditCents: params.amountCents,
        },
      });

      await tx.customerCreditLedger.create({
        data: {
          customerUserId: params.userId,
          amountCents: params.amountCents,
          balanceAfterCents: wallet.balanceCents,
          entryType: params.entryType,
          reasonText: params.reason,
          orderId: params.orderId,
          refundRequestId: params.refundRequestId,
          createdByUserId: params.createdByUserId,
        },
      });

      return wallet;
    });
  }

  async debit(params: CreditDebitParams) {
    if (params.amountCents <= 0) {
      throw new BadRequestException("Debit amount must be positive");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.customerWallet.findUnique({
        where: { customerUserId: params.userId },
      });

      if (!wallet || wallet.balanceCents < params.amountCents) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const updated = await tx.customerWallet.update({
        where: { customerUserId: params.userId },
        data: {
          balanceCents: { decrement: params.amountCents },
        },
      });

      await tx.customerCreditLedger.create({
        data: {
          customerUserId: params.userId,
          amountCents: -params.amountCents,
          balanceAfterCents: updated.balanceCents,
          entryType: params.entryType,
          reasonText: params.reason,
          orderId: params.orderId,
          refundRequestId: params.refundRequestId,
          createdByUserId: params.createdByUserId,
        },
      });

      return updated;
    });
  }

  async getLedger(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 100);

    const entries = await this.prisma.customerCreditLedger.findMany({
      where: { customerUserId: userId },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > take;
    const page = hasMore ? entries.slice(0, take) : entries;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { entries: page, next_cursor: nextCursor };
  }
}
