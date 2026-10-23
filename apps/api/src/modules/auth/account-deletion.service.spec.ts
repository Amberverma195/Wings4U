// Import barriers: these tests cannot instantiate a production database or transport.
jest.mock("../../database/prisma.service", () => ({ PrismaService: class { constructor() { throw new Error("Real database forbidden in deletion tests"); } } }));
jest.mock("../realtime/realtime.gateway", () => ({ RealtimeGateway: class {} }));
jest.mock("../../common/utils/jwt-secret", () => ({ getJwtSecret: () => "deletion-unit-test-secret" }));
jest.mock("./otp-sender", () => ({ createOtpSender: () => ({}) }));

import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AccountDeletionService } from "./account-deletion.service";
import { ACCOUNT_DELETION_POLICY_VERSION, minimizeAuditPayload, minimizePayment, minimizePricing } from "./account-deletion.policy";
import { SessionValidator } from "../../common/session/session-validator.service";
import { signJwt } from "../../common/utils/jwt";
import { AuthService } from "./auth.service";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = { userId: id, role: "CUSTOMER", sessionId: "33333333-3333-4333-8333-333333333333" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("atomic customer account deletion with only mocked dependencies", () => {
  let service: AccountDeletionService, db: any, state: any, realtime: any, passwordHash: string;
  let queue: Promise<unknown>;
  const verify = () => service.verify(session, "Fictional123!");
  const remove = (proof: any, extra = {}) => service.remove(session, { authorization: proof.authorization,
    request_id: proof.request_id, confirmation: "DELETE", forfeit_rewards: true, ...extra });
  beforeAll(async () => { passwordHash = await bcrypt.hash("Fictional123!", 4); });
  beforeEach(() => {
    process.env.ACCOUNT_DELETION_ENABLED = "true";
    process.env.ACCOUNT_DELETION_POLICY_VERSION = ACCOUNT_DELETION_POLICY_VERSION;
    queue = Promise.resolve();
    state = { user: { id, role: "CUSTOMER", isActive: true, archivedAt: null, accountDeletedAt: null,
      displayName: "Fictional Customer", passwordHash, employeeProfile: null, adminLocationAssignments: [] },
      sessions: [{ id: session.sessionId, userId: id }, { id: "second-device", userId: id }],
      grants: [], request: null, addresses: [{ id: "address", userId: id }, { id: "unrelated-address", userId: other }],
      identities: [{ userId: id }, { userId: other }] };
    const delegate = () => ({ count: jest.fn(async () => 0), findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null), deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async () => ({ count: 0 })), update: jest.fn(async ({ data }: any) => data),
      // A careless financial cascade/delete fails immediately in these tests.
      delete: jest.fn(async () => { throw new Error("Unapproved financial deletion"); }) });
    db = { $queryRaw: jest.fn(async () => [{ id }]) };
    for (const name of ["user", "authSession", "authOtpCode", "userIdentity", "customerProfile", "customerAddress", "savedCart",
      "checkoutIdempotencyKey", "order", "orderPayment", "refundRequest", "customerWallet", "customerCreditLedger",
      "customerWingsRewards", "customerWingsStampLedger", "wingsStampGrantEmail", "promoRedemption", "itemReview",
      "driverDeliveryReview", "cateringInquiry", "chatReadState", "chatSideReadState", "deliveryPinVerification", "orderMessage",
      "supportTicket", "supportTicketMessage", "supportTicketEvent", "supportTicketResolution", "orderItem", "orderDiscount",
      "orderStatusEvent", "orderEtaEvent", "orderDriverEvent", "cancellationRequest", "adminAuditLog", "accountDeletionAuthorization",
      "accountDeletionRequest", "accountDeletionHold", "registerSession", "cashDrawerEvent", "inventoryAdjustment", "restockList", "driverPayout", "busyModeEvent", "promoCode"]) db[name] = delegate();
    db.user.findUnique.mockImplementation(async () => state.user);
    db.user.update.mockImplementation(async ({ data }: any) => Object.assign(state.user, data));
    db.authSession.findFirst = jest.fn(async ({ where }: any) => state.sessions.find((row: any) => row.id === where.id && row.userId === where.userId) ?? null);
    db.authSession.deleteMany.mockImplementation(async () => { state.sessions = []; return { count: 2 }; });
    db.userIdentity.deleteMany.mockImplementation(async ({ where }: any) => { state.identities = state.identities.filter((row: any) => row.userId !== where.userId); });
    db.customerAddress.deleteMany.mockImplementation(async ({ where }: any) => { state.addresses = state.addresses.filter((row: any) => row.userId !== where.userId); });
    db.accountDeletionAuthorization.deleteMany.mockImplementation(async ({ where }: any) => { state.grants = state.grants.filter((row: any) => row.userId !== where.userId); });
    db.accountDeletionAuthorization.create = jest.fn(async ({ data }: any) => { const row = { ...data, consumedAt: null }; state.grants.push(row); return row; });
    db.accountDeletionAuthorization.updateMany.mockImplementation(async ({ where, data }: any) => {
      const row = state.grants.find((g: any) => g.userId === where.userId && g.sessionId === where.sessionId &&
        g.tokenHash === where.tokenHash && g.requestId === where.requestId && g.credentialHash === where.credentialHash &&
        g.consumedAt === null && g.expiresAt > where.expiresAt.gt);
      if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 };
    });
    db.accountDeletionRequest.findUnique.mockImplementation(async () => state.request);
    db.accountDeletionRequest.findFirst = jest.fn(async ({ where }: any) => {
      const row = state.request;
      return row?.id === where.id && row.authorizationHash === where.authorizationHash && row.status === "COMPLETED" &&
        row.completedAt > where.completedAt.gt ? { id: row.id } : null;
    });
    db.accountDeletionRequest.upsert = jest.fn(async ({ create, update }: any) => {
      state.request = state.request ? { ...state.request, ...update } : create; return state.request;
    });
    db.$transaction = jest.fn((callback: any) => {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try { return await callback(db); } catch (error) { state = snapshot; throw error; }
      });
      queue = run.catch(() => {}); return run;
    });
    realtime = { disconnectCustomer: jest.fn(), disconnectSession: jest.fn() };
    service = new AccountDeletionService(db, realtime);
  });
  afterEach(() => { delete process.env.ACCOUNT_DELETION_ENABLED; delete process.env.ACCOUNT_DELETION_POLICY_VERSION; });

  it("is disabled without both explicit activation settings, before touching the database", async () => {
    delete process.env.ACCOUNT_DELETION_POLICY_VERSION;
    expect(service.config().enabled).toBe(false);
    await expect(verify()).rejects.toThrow("not available");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("stays disabled while online card payments are enabled, because the policy covers in-store collection only", async () => {
    process.env.ONLINE_PAYMENTS_ENABLED = "true";
    try {
      expect(service.config().enabled).toBe(false);
      await expect(verify()).rejects.toThrow("not available");
      expect(db.$transaction).not.toHaveBeenCalled();
    } finally { delete process.env.ONLINE_PAYMENTS_ENABLED; }
  });
  it.each(["ADMIN", "STAFF", "DRIVER"])("rejects %s even if a caller bypassed the shared ADMIN role override", async role => {
    await expect(service.verify({ ...session, role }, "Fictional123!")).rejects.toThrow("Only customer");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rechecks the database role and actual active session, not JWT/client identity", async () => {
    state.user.role = "ADMIN"; await expect(verify()).rejects.toThrow("Only customer");
    state.user.role = "CUSTOMER"; state.sessions = [];
    await expect(verify()).rejects.toThrow("session is no longer valid");
  });
  it("rejects wrong passwords without creating authorizations", async () => {
    await expect(service.verify(session, "wrong-password")).rejects.toThrow("Password verification failed");
    expect(state.grants).toHaveLength(0);
  });
  it("stores only a short-lived, account/session/credential/request-bound authorization digest", async () => {
    const proof = await verify(); const grant = state.grants[0];
    expect(proof.authorization).toMatch(/^[a-f0-9]{64}$/);
    expect(grant.tokenHash).toBe(hash(proof.authorization));
    expect(grant).toMatchObject({ userId: id, sessionId: session.sessionId, requestId: proof.request_id, credentialHash: hash(passwordHash) });
    expect(Date.parse(proof.expires_at) - Date.now()).toBeGreaterThan(295000);
    expect(JSON.stringify(grant)).not.toContain(proof.authorization);
    await verify(); expect(state.grants).toHaveLength(1);
  });
  it.each(["expired", "consumed", "different-session", "different-user", "changed-password", "different-request"])("rejects %s authorizations", async kind => {
    const proof = await verify();
    if (kind === "expired") state.grants[0].expiresAt = new Date(0);
    if (kind === "consumed") state.grants[0].consumedAt = new Date();
    if (kind === "different-session") state.grants[0].sessionId = "other-device";
    if (kind === "different-user") state.grants[0].userId = other;
    if (kind === "changed-password") state.user.passwordHash = "new-password-hash";
    if (kind === "different-request") proof.request_id = other;
    await expect(remove(proof)).rejects.toThrow("expired or was already used");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("atomically removes credentials, addresses, all sessions and tombstones the customer without deleting another account", async () => {
    const proof = await verify(); const result = await remove(proof);
    expect(result.status).toBe("completed"); expect(state.sessions).toHaveLength(0);
    expect(state.user).toMatchObject({ isActive: false, displayName: "Deleted customer", passwordHash: null });
    expect(state.user.accountDeletedAt).toBeInstanceOf(Date);
    expect(state.identities).toEqual([{ userId: other }]);
    expect(state.addresses).toEqual([{ id: "unrelated-address", userId: other }]);
    expect(state.grants).toHaveLength(0); expect(realtime.disconnectCustomer).toHaveBeenCalledWith(id);
    expect(db.$transaction.mock.calls.at(-1)[1].isolationLevel).toBe("Serializable");
    expect(db.order.deleteMany).not.toHaveBeenCalled(); expect(db.orderPayment.deleteMany).not.toHaveBeenCalled();
    expect(db.refundRequest.deleteMany).not.toHaveBeenCalled(); expect(db.customerCreditLedger.deleteMany).not.toHaveBeenCalled();
  });
  it("clears order snapshots, free text, arbitrary JSON and copied support/audit data while retaining financial references", async () => {
    db.order.findMany.mockResolvedValue([{ id: "order", pricingSnapshotJson: { tax_cents: 130, customer_email: "private@example.invalid" } }]);
    db.supportTicket.findMany.mockResolvedValue([{ id: "ticket" }]);
    db.orderPayment.findMany.mockResolvedValue([{ id: "payment", processorPayloadJson: { id: "pi_Test123", latest_charge: { id: "ch_Test", billing: "private" }, metadata: { email: "private@example.invalid" } } }]);
    await remove(await verify());
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: "order" }, data: expect.objectContaining({
      customerNameSnapshot: "Deleted customer", customerPhoneSnapshot: "", deliveryPhoneSnapshot: null,
      customerEmailSnapshot: null, addressSnapshotJson: Prisma.DbNull, pricingSnapshotJson: { tax_cents: 130 },
    }) });
    expect(db.orderPayment.update).toHaveBeenCalledWith({ where: { id: "payment" }, data: {
      processorPayloadJson: { id: "pi_Test123", latest_charge: "ch_Test" }, failureReason: null } });
    expect(db.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { specialInstructions: null, builderPayloadJson: Prisma.DbNull } }));
    expect(db.supportTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["ticket"] } } }));
    expect(db.orderMessage.deleteMany).not.toHaveBeenCalled(); // Preserve referenced message IDs / FK constraints.
  });
  it("keeps financial audit evidence while removing free text from related audit logs", async () => {
    db.adminAuditLog.findMany.mockResolvedValue([{ id: "audit", payloadJson: { order_id: other, amount_cents: 1000,
      decision: "APPROVE", refund_method: "CASH", admin_notes: "Called Jane at 555-0100", customer_email: "private@example.invalid" } }]);
    await remove(await verify());
    expect(db.adminAuditLog.update).toHaveBeenCalledWith({ where: { id: "audit" }, data: { reasonText: null,
      payloadJson: { order_id: other, amount_cents: 1000, decision: "APPROVE", refund_method: "CASH" } } });
    expect(db.adminAuditLog.deleteMany).not.toHaveBeenCalled();
  });
  it.each([
    ["order", "ACTIVE_ORDERS"], ["orderPayment", "PENDING_PAYMENTS"], ["refundRequest", "PENDING_REFUNDS"],
    ["customerWallet", "WALLET_BALANCE"], ["supportTicket", "OPEN_SUPPORT"], ["cateringInquiry", "OPEN_CATERING"],
    ["cancellationRequest", "OPEN_CANCELLATION"], ["wingsStampGrantEmail", "REWARD_NOTIFICATION"], ["registerSession", "STAFF_HISTORY"],
    ["accountDeletionHold", "ACCOUNT_HOLD"],
  ])("requires resolution for %s; never cancels, settles or deletes obligations", async (model, code) => {
    db[model].count.mockResolvedValue(1);
    const proof = await verify(); const result = await remove(proof);
    expect(result.status).toBe("resolution_required"); expect(result.blockers.map(b => b.code)).toContain(code);
    expect(state.user.isActive).toBe(true); expect(state.sessions).toHaveLength(2); expect(state.grants[0].consumedAt).toBeInstanceOf(Date);
    expect(db.order.update).not.toHaveBeenCalled(); expect(realtime.disconnectCustomer).not.toHaveBeenCalled();
    await expect(remove(proof)).rejects.toThrow("expired or was already used");
  });
  function storedOrder(status: string, paymentStatusSummary: string) {
    const row = { id: "historical-order", customerUserId: id, status, paymentStatusSummary, pricingSnapshotJson: {} };
    db.order.findMany.mockResolvedValue([row]);
    db.order.count.mockImplementation(async ({ where }: any) => {
      const statusMatches = (!where.status?.notIn || !where.status.notIn.includes(row.status)) &&
        (!where.status?.not || where.status.not !== row.status);
      const paymentMatches = !where.paymentStatusSummary?.in || where.paymentStatusSummary.in.includes(row.paymentStatusSummary);
      return statusMatches && paymentMatches ? 1 : 0;
    });
    return row;
  }
  it.each(["PICKED_UP", "DELIVERED", "NO_SHOW_PICKUP", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY", "CANCELLED"]
    .flatMap(status => ["UNPAID", "PAID", "PENDING", "PARTIALLY_PAID", "FAILED"].map(payment => [status, payment])))
  ("allows an existing %s / %s order without backfills or payment changes", async (status, payment) => {
    const historical = storedOrder(status, payment);
    expect(await service.status(session)).toMatchObject({ status: "ready", blockers: [] });
    expect((await remove(await verify())).status).toBe("completed");
    expect(historical).toMatchObject({ status, paymentStatusSummary: payment });
    for (const call of db.order.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("status");
      expect(call[0].data).not.toHaveProperty("paymentStatusSummary");
    }
    expect(db.orderPayment.update).not.toHaveBeenCalled();
    expect(db.orderPayment.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["PICKED_UP", "DELIVERED", "NO_SHOW_PICKUP", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY", "CANCELLED"]
    .flatMap(status => ["DENIED", "REJECTED"].map(decision => [status, decision])))
  ("allows historical unpaid %s with a %s cancellation, without a backfill", async (status, decision) => {
    storedOrder(status, "UNPAID");
    db.cancellationRequest.count.mockImplementation(async ({ where }: any) => where.status.notIn.includes(decision) ? 0 : 1);
    expect(await service.status(session)).toMatchObject({ status: "ready", blockers: [] });
    expect((await remove(await verify())).status).toBe("completed");
    expect(db.cancellationRequest.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "UNKNOWN_FUTURE_STATUS"])("protects %s cancellations until genuinely resolved", async decision => {
    storedOrder("PICKED_UP", "UNPAID");
    let current = decision;
    db.cancellationRequest.count.mockImplementation(async ({ where }: any) => where.status.notIn.includes(current) ? 0 : 1);
    expect(await service.status(session)).toMatchObject({ status: "resolution_required", blockers: [{ code: "OPEN_CANCELLATION" }] });
    current = "REJECTED";
    expect(await service.status(session)).toMatchObject({ status: "ready", blockers: [] });
  });
  it.each(["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"])
  ("preserves active-order and outstanding-balance blockers for %s", async status => {
    storedOrder(status, "UNPAID");
    const result = await remove(await verify());
    expect(result.blockers.map(b => b.code)).toEqual(expect.arrayContaining(["ACTIVE_ORDERS", "OUTSTANDING_PAYMENTS"]));
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it.each([
    ["orderPayment", "PENDING_PAYMENTS"], ["refundRequest", "PENDING_REFUNDS"],
    ["accountDeletionHold", "ACCOUNT_HOLD"], ["supportTicket", "OPEN_SUPPORT"],
    ["cancellationRequest", "OPEN_CANCELLATION"],
  ])("a terminal unpaid order still respects %s", async (model, code) => {
    storedOrder("PICKED_UP", "UNPAID");
    db[model].count.mockResolvedValue(1);
    const result = await remove(await verify());
    expect(result.blockers.map(b => b.code)).toEqual([code]);
    expect(db.user.update).not.toHaveBeenCalled();
    if (model === "orderPayment") expect(db.orderPayment.count).toHaveBeenCalledWith({ where: {
      order: { customerUserId: id }, transactionStatus: "PENDING",
    } });
    if (model === "refundRequest") expect(db.refundRequest.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["PENDING", "APPROVED"] } }),
    }));
  });
  it("requires explicit loss-of-rewards consent and never spends rewards as a deletion side effect", async () => {
    db.customerWingsRewards.findUnique.mockResolvedValue({ availableStamps: 8 }); const proof = await verify();
    await expect(remove(proof, { forfeit_rewards: false })).rejects.toThrow("available rewards will be lost");
    expect(state.grants[0].consumedAt).toBeNull();
    expect((await remove(proof)).status).toBe("completed");
    expect(db.customerWingsStampLedger.updateMany).toHaveBeenCalledWith({ where: { customerUserId: id }, data: { reasonText: "Personal information removed" } });
  });
  it("serializes duplicate/concurrent requests and rejects unrelated replay IDs", async () => {
    const proof = await verify(); const results = await Promise.all([remove(proof), remove(proof)]);
    expect(results.map(r => r.status)).toEqual(["completed", "completed"]);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    await expect(remove(proof, { request_id: other })).rejects.toThrow("no longer valid");
  });
  it("rolls back partial erasure and proof consumption on failure; the same deliberate request can retry", async () => {
    const proof = await verify(); db.orderMessage.updateMany.mockRejectedValueOnce(new Error("simulated FK failure with sensitive parameters"));
    await expect(remove(proof)).rejects.toThrow("could not be confirmed");
    expect(state.sessions).toHaveLength(2); expect(state.identities).toHaveLength(2); expect(state.addresses).toHaveLength(2);
    expect(state.grants[0].consumedAt).toBeNull(); expect(state.request).toBeNull();
    expect(realtime.disconnectCustomer).not.toHaveBeenCalled();
    expect((await remove(proof)).status).toBe("completed");
  });
  it("retries serializable conflicts at most three times without consuming a failed transaction's proof", async () => {
    const proof = await verify(); db.orderMessage.updateMany.mockRejectedValueOnce({ code: "P2034" });
    expect((await remove(proof)).status).toBe("completed");
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
  it("old access and refresh tokens cannot authenticate after completion", async () => {
    const token = signJwt({ sub: id, role: "CUSTOMER", sessionId: session.sessionId }, "deletion-unit-test-secret", 900);
    const validator = new SessionValidator(db);
    db.authSession.findFirst.mockImplementation(async () => state.sessions.length ? { ...state.sessions[0], user: state.user } : null);
    expect((await validator.resolve(token))?.userId).toBe(id);
    await remove(await verify());
    expect(await validator.resolve(token)).toBeNull();
    const auth = new AuthService(db, realtime);
    await expect(auth.refresh("old-refresh-secret")).rejects.toThrow("Invalid or expired refresh token");
  });
  it("financial JSON minimization drops unknown values including expanded provider contacts", () => {
    expect(minimizePayment({ amount: 1000, id: "pi_ok", payment_method: { id: "pm_ok", billing_details: { email: "private" } },
      status: "customer name", note: "private", metadata: { email: "private" }, currency: "CAD" })).toEqual({ amount: 1000, id: "pi_ok", payment_method: "pm_ok", currency: "CAD" });
    expect(minimizePricing({ tax_cents: 100, collection_preference: "CASH_ON_DELIVERY", customer: { phone: "private" } })).toEqual({ tax_cents: 100, collection_preference: "CASH_ON_DELIVERY" });
  });
  it("audit minimization keeps amounts, IDs, enum codes, order numbers and times, and drops contact or free text", () => {
    expect(minimizeAuditPayload({
      amount_cents: 1250, driver_tip_cents: 300, refund_method: "ORIGINAL_PAYMENT", order_id: other, order_number: "1042",
      issued_at: "2026-10-20T12:00:00.000Z", approved: true, previous: null,
      customer_name: "Jane", customerPhone: "555-0100", ip_address: "203.0.113.9", reasonText: "Jane was upset",
      free_form: "Jane Doe, 1 Main St", lines: [{ amount_cents: 50, note: "private" }, "Jane"],
    })).toEqual({
      amount_cents: 1250, driver_tip_cents: 300, refund_method: "ORIGINAL_PAYMENT", order_id: other, order_number: "1042",
      issued_at: "2026-10-20T12:00:00.000Z", approved: true, previous: null, lines: [{ amount_cents: 50 }],
    });
  });
  it("confirms a lost success response only with the matching high-entropy proof, within 24h, without restoring access", async () => {
    const proof = await verify(); await remove(proof);
    expect(await service.receipt(proof)).toEqual({ status: "completed", request_id: proof.request_id });
    expect(await service.receipt({ ...proof, authorization: "b".repeat(64) })).toEqual({ status: "unconfirmed" });
    expect(await service.receipt({ ...proof, request_id: other })).toEqual({ status: "unconfirmed" });
    state.request.completedAt = new Date(0);
    expect(await service.receipt(proof)).toEqual({ status: "unconfirmed" });
    expect(state.sessions).toHaveLength(0); expect(state.user.isActive).toBe(false);
  });
});
