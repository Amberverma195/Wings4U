import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RefundService } from "./refund.service";
import { PaymentsService } from "../payments/payments.service";
import { WalletsService } from "../wallets/wallets.service";

/**
 * Regression coverage for offline refund issuance (Phase 3.1, Task 3).
 *
 * The refund state transition, wallet credit and payment-ledger row must all
 * commit together, and two concurrent approvals must never both issue the same
 * refund (double-refund). These tests exercise those two guarantees against an
 * in-memory Prisma double whose `$transaction`:
 *   - runs callbacks one at a time (Postgres row-lock serialization), and
 *   - snapshots every table before the callback and restores it if the callback
 *     throws (Postgres transactional rollback).
 */

type FakeRefund = Record<string, any> & { id: string; status: string };
type FakeOrder = Record<string, any> & { id: string };
type FakePayment = Record<string, any> & { transactionStatus: string };

function createHarness(options: { failRefundLedger?: boolean } = {}) {
  const state = {
    refunds: new Map<string, FakeRefund>(),
    orders: new Map<string, FakeOrder>(),
    payments: [] as FakePayment[],
    wallets: new Map<string, Record<string, any>>(),
    creditLedger: [] as Record<string, any>[],
    audits: [] as Record<string, any>[],
  };

  state.orders.set("order-1", {
    id: "order-1",
    locationId: "loc-1",
    orderNumber: 1001,
    customerUserId: "customer-1",
    status: "CANCELLED",
    finalPayableCents: 2500,
    paymentStatusSummary: "PAID",
    paymentMethod: "CASH",
    netPaidAmountCents: 2500,
    remainingRefundableCents: 2500,
  });
  // One successful CAPTURE so there are collected funds to refund.
  state.payments.push({
    id: "capture-1",
    orderId: "order-1",
    locationId: "loc-1",
    transactionType: "CAPTURE",
    transactionStatus: "SUCCESS",
    paymentMethod: "CASH",
    signedAmountCents: 2500,
    provider: null,
    providerTransactionId: null,
    createdAt: new Date(2026, 9, 14, 12, 0, 0),
  });
  state.refunds.set("refund-1", {
    id: "refund-1",
    orderId: "order-1",
    locationId: "loc-1",
    amountCents: 1000,
    status: "PENDING",
    refundMethod: null,
  });

  let sequence = 0;
  const matchesPaymentWhere = (p: FakePayment, where: Record<string, any>) =>
    p.orderId === where.orderId &&
    (!where.transactionStatus || p.transactionStatus === where.transactionStatus);

  const client = {
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const [orderId, locationId] = values as string[];
      const order = state.orders.get(orderId);
      return order && order.locationId === locationId ? [{ id: orderId }] : [];
    }),
    refundRequest: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const refund = state.refunds.get(where.id);
        if (!refund) return null;
        return {
          ...refund,
          ...(include?.order ? { order: { ...state.orders.get(refund.orderId) } } : {}),
        };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const refund = state.refunds.get(where.id);
        if (!refund) throw new Error("not found");
        return { ...refund };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const refund = state.refunds.get(where.id);
        if (!refund) return { count: 0 };
        if (where.status && refund.status !== where.status) return { count: 0 };
        Object.assign(refund, data);
        return { count: 1 };
      }),
    },
    order: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const order = state.orders.get(where.id);
        if (!order) throw new Error("not found");
        return { ...order };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const order = state.orders.get(where.id)!;
        Object.assign(order, data);
        return { ...order };
      }),
    },
    orderPayment: {
      findMany: jest.fn(async ({ where }: any) =>
        state.payments.filter((p) => matchesPaymentWhere(p, where)),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (options.failRefundLedger && data.transactionType === "REFUND") {
          throw new Error("simulated ledger write failure");
        }
        if (
          data.providerTransactionId &&
          state.payments.some(
            (p) =>
              p.provider === data.provider &&
              p.providerTransactionId === data.providerTransactionId,
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        sequence += 1;
        const row: FakePayment = {
          id: `payment-${sequence}`,
          createdAt: new Date(2026, 9, 14, 12, 0, sequence),
          ...data,
        };
        state.payments.push(row);
        return row;
      }),
    },
    customerWallet: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = state.wallets.get(where.customerUserId);
        if (existing) {
          existing.balanceCents += update.balanceCents.increment;
          existing.lifetimeCreditCents += update.lifetimeCreditCents.increment;
          return { ...existing };
        }
        const wallet = { ...create };
        state.wallets.set(where.customerUserId, wallet);
        return { ...wallet };
      }),
    },
    customerCreditLedger: {
      create: jest.fn(async ({ data }: any) => {
        state.creditLedger.push(data);
        return data;
      }),
    },
    adminAuditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.audits.push(data);
        return data;
      }),
    },
  };

  const snapshot = () => ({
    refunds: new Map([...state.refunds].map(([k, v]) => [k, { ...v }])),
    orders: new Map([...state.orders].map(([k, v]) => [k, { ...v }])),
    payments: state.payments.map((p) => ({ ...p })),
    wallets: new Map([...state.wallets].map(([k, v]) => [k, { ...v }])),
    creditLedger: state.creditLedger.map((e) => ({ ...e })),
    audits: state.audits.map((a) => ({ ...a })),
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    state.refunds = snap.refunds;
    state.orders = snap.orders;
    state.payments = snap.payments;
    state.wallets = snap.wallets;
    state.creditLedger = snap.creditLedger;
    state.audits = snap.audits;
  };

  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...client,
    $transaction: jest.fn((callback: (tx: typeof client) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const snap = snapshot();
        try {
          return await callback(client);
        } catch (error) {
          restore(snap);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    }),
  };

  const wallets = new WalletsService(prisma as any);
  const payments = new PaymentsService(prisma as any);
  const service = new RefundService(prisma as any, wallets, payments);
  return { service, state, prisma };
}

describe("Refund issuance atomicity and concurrency", () => {
  it("rolls the ISSUED transition back when the ledger write fails", async () => {
    const harness = createHarness({ failRefundLedger: true });

    await expect(
      harness.service.approveAndIssue({
        refundRequestId: "refund-1",
        approvedByUserId: "admin-1",
        refundMethod: "CASH",
      }),
    ).rejects.toThrow("simulated ledger write failure");

    // The refund request must not be left ISSUED without its ledger row.
    expect(harness.state.refunds.get("refund-1")!.status).toBe("PENDING");
    expect(
      harness.state.payments.filter((p) => p.transactionType === "REFUND"),
    ).toHaveLength(0);
  });

  it("writes exactly one ledger row on a successful cash refund", async () => {
    const harness = createHarness();

    await harness.service.approveAndIssue({
      refundRequestId: "refund-1",
      approvedByUserId: "admin-1",
      refundMethod: "CASH",
    });

    expect(harness.state.refunds.get("refund-1")!.status).toBe("ISSUED");
    const refundRows = harness.state.payments.filter(
      (p) => p.transactionType === "REFUND",
    );
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0].signedAmountCents).toBe(-1000);
  });

  it("rejects a second concurrent approval instead of double-refunding", async () => {
    const harness = createHarness();

    const results = await Promise.allSettled([
      harness.service.approveAndIssue({
        refundRequestId: "refund-1",
        approvedByUserId: "admin-1",
        refundMethod: "CASH",
      }),
      harness.service.approveAndIssue({
        refundRequestId: "refund-1",
        approvedByUserId: "admin-2",
        refundMethod: "CASH",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);

    // Only one REFUND ledger row despite two approval attempts.
    expect(
      harness.state.payments.filter((p) => p.transactionType === "REFUND"),
    ).toHaveLength(1);
  });

  it("credits the wallet exactly once for a store-credit refund", async () => {
    const harness = createHarness();

    const results = await Promise.allSettled([
      harness.service.approveAndIssue({
        refundRequestId: "refund-1",
        approvedByUserId: "admin-1",
        refundMethod: "STORE_CREDIT",
      }),
      harness.service.approveAndIssue({
        refundRequestId: "refund-1",
        approvedByUserId: "admin-2",
        refundMethod: "STORE_CREDIT",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(harness.state.creditLedger).toHaveLength(1);
    expect(harness.state.wallets.get("customer-1")!.balanceCents).toBe(1000);
  });
});
