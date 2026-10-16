import { SupportService } from "./support.service";
import { primaryIdentityOrder } from "../../common/utils/primary-identity";

const DATE = new Date("2026-10-15T12:00:00Z");
const actor = (id = "customer", role = "CUSTOMER") => ({ id, displayName: id === "customer" ? "John Smith" : "Alex Manager",
  firstName: "John", lastName: "Smith", role, archivedAt: null });
const order = (extra = {}) => ({ id: "order", locationId: "location", customerUserId: "customer", orderNumber: 9007199254740993n,
  status: "COMPLETED", fulfillmentType: "PICKUP", placedAt: DATE, finalPayableCents: 2345,
  customerNameSnapshot: "Order contact", customerPhoneSnapshot: "+15195550100", customerEmailSnapshot: "old@example.com", ...extra });
const message = (internal = false) => ({ id: internal ? "internal" : "public", supportTicketId: "ticket", authorUserId: "admin",
  messageBody: internal ? "Private note" : "Public reply", isInternalNote: internal, createdAt: DATE, author: actor("admin", "ADMIN") });
const event = (type: string, extra = {}) => ({ id: type, ticketId: "ticket", eventType: type, performedByUserId: "admin",
  performedBy: actor("admin", "ADMIN"), createdAt: DATE, payloadJson: {}, ...extra });
const ticket = (extra = {}) => ({ id: "ticket", locationId: "location", customerUserId: "customer", orderId: "order",
  assignedAdminUserId: "admin", assignedAdmin: actor("admin", "ADMIN"), ticketType: "COLD_FOOD", subject: "Cold wings",
  description: "Food arrived cold.\nPlease help.", priority: "NORMAL", status: "OPEN", createdSource: "ADMIN",
  createdAt: DATE, updatedAt: DATE, customer: { ...actor(), identities: [
    { phoneE164: null, emailNormalized: "primary@example.com" }, { phoneE164: "+15195551234", emailNormalized: "secondary@example.com" },
  ] }, order: order(), messages: [message(), message(true)], events: [event("CREATED"),
    event("MESSAGE_ADDED", { payloadJson: { is_internal_note: true }, note: "Private audit note" }), event("ORDER_LINKED")],
  resolutions: [], ...extra });

function mockPrisma() {
  const prisma = {
    supportTicket: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    supportTicketEvent: { create: jest.fn() }, supportTicketMessage: { create: jest.fn() }, supportTicketResolution: { create: jest.fn() },
    order: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() }, $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async arg => typeof arg === "function" ? arg(prisma) : Promise.all(arg));
  prisma.supportTicket.findUnique.mockResolvedValue(ticket());
  prisma.supportTicket.findFirst.mockResolvedValue({ id: "ticket" });
  prisma.supportTicket.findMany.mockResolvedValue([ticket()]);
  prisma.supportTicket.create.mockResolvedValue(ticket());
  prisma.supportTicket.update.mockResolvedValue(ticket({ status: "IN_REVIEW" }));
  prisma.supportTicket.updateMany.mockResolvedValue({ count: 1 });
  prisma.supportTicketMessage.create.mockResolvedValue(message());
  prisma.order.findFirst.mockResolvedValue(order());
  prisma.order.findUnique.mockResolvedValue(order());
  prisma.order.findMany.mockResolvedValue([order()]);
  return prisma;
}

describe("Support context, ownership and existing workflows", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: SupportService;
  beforeEach(() => { prisma = mockPrisma(); service = new SupportService(prisma as never); });

  it("returns admin queue metadata with deterministic identities, safe order numbers and pagination", async () => {
    prisma.supportTicket.findMany.mockResolvedValue([ticket(), ticket({ id: "next" })]);
    const result = await service.listTickets({ locationId: "location", adminContext: true, limit: 1, status: "OPEN" });
    expect(result.tickets[0]).toMatchObject({ subject: "Cold wings", customer: { display_name: "John Smith", primary_email: "primary@example.com",
      primary_phone: "+15195551234", account_available: true }, order: { order_number: "9007199254740993", final_payable_cents: 2345 } });
    expect(result.next_cursor).toBe("ticket");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(prisma.supportTicket.findMany.mock.calls[0][0]).toMatchObject({ where: { locationId: "location", status: "OPEN" },
      select: { customer: { select: { identities: { orderBy: primaryIdentityOrder } } } } });
  });

  it("distinguishes creator, assigned admin, customer and order contact snapshots", async () => {
    const result = await service.getTicket("ticket", "ADMIN", "admin", "location");
    expect(result).toMatchObject({ created_by: { user_id: "admin", display_name: "Alex Manager" },
      assigned_admin: { display_name: "Alex Manager" }, customer: { display_name: "John Smith" },
      order: { customer_name_snapshot: "Order contact", customer_email_snapshot: "old@example.com" },
      messages: [{ author: { display_name: "Alex Manager" } }, { is_internal_note: true }] });
  });

  it("uses the actual CREATED event, with honest fallbacks when its actor or event is missing", async () => {
    prisma.supportTicket.findUnique.mockResolvedValue(ticket({ events: [event("CREATED", { performedByUserId: null, performedBy: null })], createdSource: "SYSTEM_OVERDUE_DELIVERY" }));
    expect((await service.getTicket("ticket", "ADMIN", "admin", "location")).created_by?.display_name).toBe("System");
    prisma.supportTicket.findUnique.mockResolvedValue(ticket({ events: [] }));
    expect((await service.getTicket("ticket", "ADMIN", "admin", "location")).created_by).toBeNull();
  });

  it("preserves the linked-order modal's items, modifiers, flavours, payments and pricing", async () => {
    prisma.order.findFirst.mockResolvedValue(order({ acceptedAt: DATE, readyAt: null, completedAt: DATE, cancelledAt: null,
      paymentStatusSummary: "PAID", itemSubtotalCents: 2000, itemDiscountTotalCents: 100, orderDiscountTotalCents: 50,
      taxCents: 240, deliveryFeeCents: 255, driverTipCents: 0, customerOrderNotes: "Ring bell", addressSnapshotJson: null,
      orderItems: [{ id: "line", productNameSnapshot: "Chicken Wings", categoryNameSnapshot: "Wings", quantity: 1,
        unitPriceCents: 2000, lineTotalCents: 2000, specialInstructions: "Extra crispy",
        modifiers: [{ modifierNameSnapshot: "Ranch", modifierGroupNameSnapshot: "Dip", quantity: 1, priceDeltaCents: 100 }],
        flavours: [{ flavourNameSnapshot: "Honey Garlic", heatLevelSnapshot: "MILD", placement: "ON_SIDE" }] }],
      payments: [{ id: "payment", paymentMethod: "CARD", transactionStatus: "CAPTURED", signedAmountCents: 2345, createdAt: DATE }],
    }));
    const result = await service.getTicketOrderDetails("ticket", "location");
    expect(result).toMatchObject({ order: { order_number: "9007199254740993", discount_total_cents: 150, final_payable_cents: 2345 },
      customer: { name: "Order contact" }, payments: [{ method: "CARD", amount_cents: 2345 }],
      items: [{ product_name: "Chicken Wings", modifiers: [{ name: "Ranch", price_delta_cents: 100 }], flavours: [{ name: "Honey Garlic", placement: "ON_SIDE" }] }] });
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: "order", locationId: "location", customerUserId: "customer" });
    expect(prisma.order.findFirst.mock.calls[0][0]).toHaveProperty("select");
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.getTicketOrderDetails("ticket", "location")).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    { orderId: null, order: null }, { customerUserId: null, customer: null, orderId: null, order: null },
    { customer: { ...actor(), archivedAt: DATE, identities: [] } },
  ])("handles missing relationships and unavailable accounts", async extra => {
    prisma.supportTicket.findUnique.mockResolvedValue(ticket(extra));
    const result = await service.getTicket("ticket", "ADMIN", "admin", "location");
    if (extra.orderId === null) expect(result.order).toBeNull();
    if (extra.customer === null || extra.customer?.archivedAt) expect(result.customer).toMatchObject({ account_available: false, primary_email: null });
  });

  it.each([{ locationId: "other-location" }, { customerUserId: "other-customer" }])("redacts inconsistent linked order context", async extra => {
    prisma.supportTicket.findUnique.mockResolvedValue(ticket({ order: order(extra) }));
    expect((await service.getTicket("ticket", "ADMIN", "admin", "location")).order).toBeNull();
  });

  it("keeps expanded information and private notes/audits out of customer responses", async () => {
    const detail = await service.getTicket("ticket", "CUSTOMER", "customer", "location");
    expect(detail).not.toHaveProperty("customer"); expect(detail).not.toHaveProperty("created_by"); expect(detail).not.toHaveProperty("order");
    expect(detail.messages).toHaveLength(1); expect(detail.messages[0]).not.toHaveProperty("author");
    expect(detail.events).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("Private");
    const list = await service.listTickets({ locationId: "location", customerUserId: "customer" });
    expect(list.tickets[0]).not.toHaveProperty("customer"); expect(list.tickets[0]).not.toHaveProperty("order");
    expect(prisma.supportTicket.findMany.mock.calls[0][0]).toMatchObject({ where: { locationId: "location", customerUserId: "customer" } });
    expect(prisma.supportTicket.findMany.mock.calls[0][0].select).not.toHaveProperty("customer");
  });

  it.each(["other-customer", undefined])("rejects customer ownership violations (%s)", async user => {
    await expect(service.getTicket("ticket", "CUSTOMER", user, "location")).rejects.toMatchObject({ status: 403 });
    await expect(service.addMessage("ticket", "other-customer", "Hello", false, "CUSTOMER", "location")).rejects.toMatchObject({ status: 403 });
  });

  it("blocks cross-location reads, replies, statuses, resolutions, order details and link discovery", async () => {
    for (const operation of [
      () => service.getTicket("ticket", "ADMIN", "admin", "other-location"),
      () => service.addMessage("ticket", "admin", "Hi", false, "ADMIN", "other-location"),
      () => service.updateStatus("ticket", "admin", "IN_REVIEW", "other-location"),
      () => service.resolve("ticket", "admin", "INFO_ONLY", "Done", "other-location"),
      () => service.getTicketOrderDetails("ticket", "other-location"),
      () => service.getEligibleOrders("ticket", "other-location"),
      () => service.linkOrder("ticket", "order", "admin", "other-location"),
    ]) await expect(operation()).rejects.toMatchObject({ status: 403 });
  });

  it("validates pagination anchors within the ticket scope", async () => {
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    await expect(service.listTickets({ locationId: "location", customerUserId: "customer", cursor: "foreign" })).rejects.toMatchObject({ status: 400 });
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });

  it("creates linked tickets with ownership validation and the actual creation actor", async () => {
    const params = { locationId: "location", customerUserId: "customer", orderId: "order", ticketType: "COLD_FOOD",
      subject: "Cold", description: "Help", createdSource: "CUSTOMER_APP" };
    await service.createTicket(params);
    expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ performedByUserId: "customer", eventType: "CREATED" }) });
    await service.createTicket({ ...params, createdSource: "SYSTEM_OVERDUE_DELIVERY" });
    expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ performedByUserId: null }) });
    await service.createTicket({ ...params, createdSource: "ADMIN", createdByUserId: "admin" });
    expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ performedByUserId: "admin" }) });
    prisma.order.findUnique.mockResolvedValue(order({ customerUserId: "unrelated" }));
    await expect(service.createTicket(params)).rejects.toMatchObject({ status: 403 });
  });

  it("preserves customer/admin replies, internal notes and their audit events", async () => {
    await service.addMessage("ticket", "customer", "Customer reply", false, "CUSTOMER", "location");
    await service.addMessage("ticket", "admin", "Admin reply", false, "ADMIN", "location");
    await service.addMessage("ticket", "admin", "Private", true, "ADMIN", "location");
    expect(prisma.supportTicketMessage.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ isInternalNote: true }) });
    expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ eventType: "MESSAGE_ADDED", payloadJson: { is_internal_note: true } }) });
    await expect(service.addMessage("ticket", "customer", "Private", true, "CUSTOMER", "location")).rejects.toMatchObject({ status: 403 });
  });

  it("preserves status and refund/replacement/credit resolution records and audits", async () => {
    await service.updateStatus("ticket", "admin", "IN_REVIEW", "location");
    expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ eventType: "STATUS_CHANGED", fromValue: "OPEN", toValue: "IN_REVIEW" }) });
    for (const type of ["REFUND_ISSUED", "REPLACEMENT_ORDER", "STORE_CREDIT_ISSUED"]) {
      await service.resolve("ticket", "admin", type, "Resolution notes", "location");
      expect(prisma.supportTicketResolution.create).toHaveBeenLastCalledWith({ data: { ticketId: "ticket", resolutionType: type, createdByUserId: "admin", note: "Resolution notes" } });
      expect(prisma.supportTicketEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ eventType: "RESOLVED", toValue: type }) });
    }
  });
});

describe("Explicit admin order linking", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: SupportService;
  beforeEach(() => { prisma = mockPrisma(); prisma.supportTicket.findUnique.mockResolvedValue(ticket({ orderId: null, order: null })); service = new SupportService(prisma as never); });
  it("shows only the same customer's/location's orders", async () => {
    const result = await service.getEligibleOrders("ticket", "location");
    expect(result.orders[0].order_number).toBe("9007199254740993");
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ locationId: "location", customerUserId: "customer" });
  });
  it("links a selected eligible order with an audit event, without changing customer ownership", async () => {
    await service.linkOrder("ticket", "order", "admin", "location");
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: "order", locationId: "location", customerUserId: "customer" });
    expect(prisma.supportTicket.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "ticket", locationId: "location", customerUserId: "customer", orderId: null }, data: { orderId: "order" } });
    expect(prisma.supportTicket.updateMany.mock.calls[0][0].data).not.toHaveProperty("customerUserId");
    expect(prisma.supportTicketEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: "ORDER_LINKED", performedByUserId: "admin" }) });
  });
  it("rejects orders outside the customer/location filter", async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.linkOrder("ticket", "unrelated-order", "admin", "location")).rejects.toMatchObject({ status: 403 });
    expect(prisma.supportTicket.updateMany).not.toHaveBeenCalled();
  });
  it("never relinks existing orders or links tickets without a customer", async () => {
    for (const extra of [{ orderId: "existing" }, { customerUserId: null }]) {
      prisma.supportTicket.findUnique.mockResolvedValue(ticket({ orderId: null, ...extra }));
      await expect(service.linkOrder("ticket", "order", "admin", "location")).rejects.toMatchObject({ status: 409 });
    }
    expect(prisma.supportTicket.updateMany).not.toHaveBeenCalled();
  });
  it("rejects concurrent association changes without recording a false audit event", async () => {
    prisma.supportTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.linkOrder("ticket", "order", "admin", "location")).rejects.toMatchObject({ status: 409 });
    expect(prisma.supportTicketEvent.create).not.toHaveBeenCalled();
  });
});
