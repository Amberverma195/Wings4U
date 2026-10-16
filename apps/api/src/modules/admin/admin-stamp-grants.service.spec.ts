import { Prisma } from "@prisma/client";
import { AdminStampGrantsService } from "./admin-stamp-grants.service";
import { AdminAuditService } from "../admin-audit/admin-audit.service";
import { RewardsService } from "../rewards/rewards.service";
import type { AdminStampGrantInput } from "./admin-customers.dto";

const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const actor = { userId: "admin-one", role: "ADMIN" };
const input = (stamps = 2, request_id = REQUEST): AdminStampGrantInput => ({ stamps, request_id, reason: "SERVICE_RECOVERY", note: "Wrong item" });

/** Transaction contract fake: row locks are held to commit; rollback restores all writes.
 * This exercises both real reward methods, but is not a replacement for PostgreSQL integration QA. */
function setup(balance = 0) {
  let state: any = { summary: { availableStamps: balance, lifetimeStamps: 12, lifetimeRedemptions: 3 }, entries: [], audits: [], emails: [] };
  let tail = Promise.resolve();
  let fail: string | null = null;
  let activeCustomer = true;
  let transactions = 0;
  const txs: any[] = [];
  const prisma: any = { $transaction: async (fn: (tx: any) => Promise<any>) => {
    let release: (() => void) | undefined;
    let snapshot: any;
    const lock = async () => {
      if (release) return;
      const previous = tail;
      tail = new Promise<void>(done => { release = done; });
      await previous;
      snapshot = structuredClone(state);
    };
    const tx: any = {
      user: { findFirst: jest.fn(async () => activeCustomer ? { id: CUSTOMER } : null) },
      order: { findUnique: async () => ({ id: "completed-order", customerUserId: CUSTOMER, orderItems: [
        { quantity: 1, builderType: "WINGS", builderPayloadJson: { weight_lb: 2 }, menuItem: { slug: "wings-2lb" } },
      ] }) },
      customerWingsRewards: {
        upsert: jest.fn(async ({ update }: any) => {
          if (Object.keys(update).length) await lock();
          return { ...state.summary };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          await lock();
          const value = state.summary.availableStamps;
          if (where.availableStamps?.lte !== undefined && value > where.availableStamps.lte) return { count: 0 };
          if (where.availableStamps?.gte !== undefined && value < where.availableStamps.gte) return { count: 0 };
          for (const [key, mutation] of Object.entries(data) as any) state.summary[key] += mutation.increment ?? -mutation.decrement;
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => {
          await lock();
          for (const [key, mutation] of Object.entries(data) as any) state.summary[key] += mutation.increment ?? -mutation.decrement;
          return { ...state.summary };
        }),
        findUniqueOrThrow: jest.fn(async () => ({ ...state.summary })),
      },
      customerWingsStampLedger: {
        findUnique: jest.fn(async ({ where }: any) => state.entries.find((row: any) => row.id === where.id) ?? null),
        findFirst: jest.fn(async ({ where }: any) => state.entries.find((row: any) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
        create: jest.fn(async ({ data }: any) => {
          if (fail === "ledger") throw new Error("Ledger unavailable");
          if (state.entries.some((row: any) => row.id === data.id)) throw new Prisma.PrismaClientKnownRequestError("Duplicate", { code: "P2002", clientVersion: "7" });
          const entry = { ...data, id: data.id ?? `order-entry-${state.entries.length}`, createdAt: new Date() };
          state.entries.push(entry); return entry;
        }),
      },
      adminAuditLog: {
        findFirst: jest.fn(async ({ where }: any) => state.audits.find((row: any) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
        create: jest.fn(async ({ data }: any) => { if (fail === "audit") throw new Error("Audit unavailable"); state.audits.push(data); return data; }),
      },
      wingsStampGrantEmail: { create: jest.fn(async ({ data }: any) => {
        if (fail === "email") throw new Error("Outbox unavailable"); state.emails.push(data); return data;
      }) },
    };
    txs.push(tx); transactions++;
    try { return await fn(tx); }
    catch (error) { if (snapshot) state = snapshot; throw error; }
    finally { transactions--; release?.(); }
  } };
  prisma.customerWingsStampLedger = { findFirst: async ({ where }: any) => state.entries.find((row: any) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null };
  prisma.adminAuditLog = { findFirst: async ({ where }: any) => state.audits.find((row: any) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null };
  const emails = { send: jest.fn(async () => {
    expect(transactions).toBe(0);
    return { status: "SENT", message: "Accepted", retryable: false };
  }) };
  const customers = { getStamps: jest.fn(async () => ({ summary: {
    available_stamps: state.summary.availableStamps, lifetime_stamps: state.summary.lifetimeStamps,
    lifetime_redemptions: state.summary.lifetimeRedemptions, stamps_per_reward: 8, reward_available: state.summary.availableStamps >= 8,
  } })) };
  const service = new AdminStampGrantsService(prisma, new AdminAuditService(prisma), emails as any, customers as any);
  return { service, prisma, emails, txs, state: () => state, fail: (value: string) => { fail = value; }, disableCustomer: () => { activeCustomer = false; } };
}

describe("Admin manual stamp grants", () => {
  it.each([[0, 2], [6, 8]])("credits %i + 2 atomically to %i", async (before, after) => {
    const s = setup(before);
    const result = await s.service.grant(CUSTOMER, "location", actor, input());
    expect(result.summary).toEqual({ available_stamps: after, lifetime_stamps: 14, lifetime_redemptions: 3, stamps_per_reward: 8, reward_available: after === 8 });
    expect(s.state().entries).toEqual([expect.objectContaining({ id: REQUEST, entryType: "ADMIN_GRANTED", deltaStamps: 2,
      balanceAfterStamps: after, orderId: null, poundsAwarded: null, reasonText: "Gifted by Wings 4 U — courtesy stamps added." })]);
    expect(s.state().audits).toEqual([expect.objectContaining({ actorUserId: actor.userId, actorRoleSnapshot: "ADMIN", locationId: "location",
      entityId: REQUEST, actionKey: "CUSTOMER_STAMPS_GRANTED", payloadJson: expect.objectContaining({
        customer_id: CUSTOMER, grant_id: REQUEST, request_id: REQUEST, stamps: 2, previous_balance: before,
        new_balance: after, reason: "SERVICE_RECOVERY", note: "Wrong item", timestamp: expect.any(String),
      }) })]);
    expect(s.state().emails).toEqual([{ grantId: REQUEST }]);
    expect(s.txs[0].customerWingsRewards.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerUserId: CUSTOMER, availableStamps: { lte: 6 } } }));
    expect(s.emails.send).toHaveBeenCalledTimes(1);
  });
  it.each([[6, 5], [8, 1]])("rejects %i + %i with no writes or email", async (balance, stamps) => {
    const s = setup(balance); const before = structuredClone(s.state());
    await expect(s.service.grant(CUSTOMER, "location", actor, input(stamps))).rejects.toThrow(/at most/);
    expect(s.state()).toEqual(before); expect(s.emails.send).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, undefined, 9])("rejects invalid count %s", async stamps => {
    const s = setup();
    await expect(s.service.grant(CUSTOMER, "location", actor, { ...input(), stamps: stamps as number })).rejects.toThrow();
    expect(s.state().entries).toHaveLength(0);
  });
  it.each([undefined, "", "FAKE"])("rejects invalid reason %s", async reason => {
    const s = setup();
    await expect(s.service.grant(CUSTOMER, "location", actor, { ...input(), reason } as any)).rejects.toThrow();
  });
  it("requires an Other explanation and an active, nonarchived customer", async () => {
    const s = setup();
    await expect(s.service.grant(CUSTOMER, "location", actor, { ...input(), reason: "OTHER", note: " " })).rejects.toThrow();
    s.disableCustomer();
    await expect(s.service.grant(CUSTOMER, "location", actor, input())).rejects.toThrow(/Active customer/);
    expect(s.txs[0].user.findFirst).toHaveBeenCalledWith({ where: { id: CUSTOMER, role: "CUSTOMER", isActive: true, archivedAt: null }, select: { id: true } });
    expect(s.state().entries).toHaveLength(0);
  });
  it.each(["CUSTOMER", "STAFF"])("refuses %s actors in depth", async role => {
    const s = setup(); await expect(s.service.grant(CUSTOMER, "location", { ...actor, role }, input())).rejects.toThrow();
  });
  it.each(["ledger", "audit", "email"])("rolls back the entire grant on %s insert failure", async failure => {
    const s = setup(6); s.fail(failure); const before = structuredClone(s.state());
    await expect(s.service.grant(CUSTOMER, "location", actor, input())).rejects.toThrow();
    expect(s.state()).toEqual(before); expect(s.emails.send).not.toHaveBeenCalled();
  });
  it("two admins serialize on the reward row; only one can fill the remaining capacity", async () => {
    const s = setup(6);
    // Email processing is separately tested; another transaction may still be active for this fixture.
    s.emails.send.mockImplementation(async () => ({ status: "SENT", message: "Accepted", retryable: false }));
    const outcomes = await Promise.allSettled([
      s.service.grant(CUSTOMER, "location", actor, input()),
      s.service.grant(CUSTOMER, "location", { ...actor, userId: "admin-two" }, input(2, SECOND)),
    ]);
    expect(outcomes.map(row => row.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(s.state().summary.availableStamps).toBe(8);
    expect(s.state().entries).toHaveLength(1); expect(s.state().audits).toHaveLength(1);
  });
  it("parallel identical retries and subsequent retries never duplicate stamps, ledger or audit", async () => {
    const s = setup(6);
    s.emails.send.mockImplementation(async () => ({ status: "SENT", message: "Accepted", retryable: false }));
    const results = await Promise.all([s.service.grant(CUSTOMER, "location", actor, input()), s.service.grant(CUSTOMER, "location", actor, input())]);
    expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
    expect((await s.service.grant(CUSTOMER, "location", actor, input())).replayed).toBe(true);
    expect(s.state().summary).toEqual({ availableStamps: 8, lifetimeStamps: 14, lifetimeRedemptions: 3 });
    expect(s.state().entries).toHaveLength(1); expect(s.state().audits).toHaveLength(1); expect(s.state().emails).toHaveLength(1);
  });
  it.each(["customer", "amount", "reason", "note", "actor", "location"])("rejects conflicting UUID reuse: %s", async field => {
    const s = setup(); await s.service.grant(CUSTOMER, "location", actor, input());
    const change = { ...input(), ...(field === "amount" ? { stamps: 1 } : field === "reason" ? { reason: "WRONG_ORDER" as const } : field === "note" ? { note: "Different" } : {}) };
    await expect(s.service.grant(field === "customer" ? "other" : CUSTOMER, field === "location" ? "other" : "location",
      field === "actor" ? { ...actor, userId: "other" } : actor, change)).rejects.toThrow(/already used/);
    expect(s.state().entries).toHaveLength(1);
  });
  it("grant racing completed-order accrual never exceeds eight, with existing lifetime semantics", async () => {
    const s = setup(6); const rewards = new RewardsService(s.prisma);
    s.emails.send.mockImplementation(async () => ({ status: "SENT", message: "Accepted", retryable: false }));
    await Promise.allSettled([s.service.grant(CUSTOMER, "location", actor, input()),
      s.prisma.$transaction((tx: any) => rewards.accrueForOrderInTransaction(tx, "completed-order"))]);
    expect(s.state().summary.availableStamps).toBe(8);
    const earned = s.state().entries.find((entry: any) => entry.entryType === "EARNED");
    expect(earned).toBeDefined(); expect(s.state().summary.lifetimeStamps).toBe(12 + 2 + (earned.deltaStamps === 0 ? 2 : 0));
    for (const tx of s.txs) expect(tx.customerWingsRewards.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { availableStamps: { increment: 0 } } }));
  });
  it("a grant racing redemption observes the post-redemption balance without losing lifetime totals", async () => {
    const s = setup(8); const rewards = new RewardsService(s.prisma);
    s.emails.send.mockImplementation(async () => ({ status: "SENT", message: "Accepted", retryable: false }));
    const results = await Promise.allSettled([
      s.prisma.$transaction((tx: any) => rewards.redeemForOrderInTransaction(tx, CUSTOMER, "redeemed-order")),
      s.service.grant(CUSTOMER, "location", actor, input()),
    ]);
    expect(results.every(row => row.status === "fulfilled")).toBe(true);
    expect(s.state().summary).toEqual({ availableStamps: 2, lifetimeStamps: 14, lifetimeRedemptions: 4 });
  });
  it("email failure keeps stamps, and scoped email retry never changes the balance", async () => {
    const s = setup(); s.emails.send.mockResolvedValue({ status: "FAILED", message: "Rejected", retryable: true });
    expect((await s.service.grant(CUSTOMER, "location", actor, input())).email.status).toBe("FAILED");
    const before = structuredClone(s.state());
    await s.service.retryEmail(CUSTOMER, REQUEST, "location", actor); expect(s.state()).toEqual(before);
    await expect(s.service.retryEmail(CUSTOMER, REQUEST, "wrong-location", actor)).rejects.toThrow(/not found/);
  });
});
