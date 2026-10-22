jest.mock("../../database/prisma.service", () => ({ PrismaService: class {} }));
import { SupportService } from "./support.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";

function harness() {
  const rows: any[] = [], events: any[] = [], messages = [{ id: "history", messageBody: "Original concern" }];
  const match = (row: any, where: any) => Object.entries(where).every(([key, value]: any) =>
    value && typeof value === "object" ? value.not !== undefined ? row[key] !== value.not : value.in.includes(row[key]) : row[key] === value);
  let chain = Promise.resolve();
  const db: any = {
    supportTicket: {
      findUnique: jest.fn(async ({ where }: any) => { const row = rows.find(row => row.id === where.id); return row ? { ...row } : null; }),
      findFirst: jest.fn(async ({ where }: any) => rows.find(row => match(row, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => rows.filter(row => match(row, where)).map(row => ({ ...row, messages: [] }))),
      create: jest.fn(async ({ data }: any) => { const row = { ...data, id: 'ticket-' + rows.length, createdAt: new Date(), messages, events, resolutions: [] }; rows.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = rows.find(row => match(row, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    supportTicketEvent: { create: jest.fn(async ({ data }: any) => { events.push(data); return data; }) },
    order: { findFirst: jest.fn(async () => ({ id: "order", locationId: "location", customerUserId: "customer", orderNumber: 1n })), findUnique: jest.fn(async () => ({ id: "order", locationId: "location", customerUserId: "customer" })) },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: any) => {
      const previous = chain; let release!: () => void; chain = new Promise<void>(r => { release = r; });
      await previous; try { return await fn(db); } finally { release(); }
    }),
  };
  const limiter = new RateLimiterService({ withClient: async () => null } as never);
  return { rows, events, messages, db, service: new SupportService(db, limiter) };
}
const customer = { locationId: "location", customerUserId: "customer", orderId: "order", ticketType: "COLD_FOOD", subject: "Cold food", description: "Please help", createdSource: "CUSTOMER_APP" };
const alert = { ...customer, ticketType: "DELIVERY_OVERDUE", createdSource: "SYSTEM_OVERDUE_DELIVERY" };

describe("Customer allowance and internal alerts", () => {
  it.each([true, false])("keeps separate allowances when alert comes first: %s", async alertFirst => {
    const { service, rows } = harness();
    await service.createTicket(alertFirst ? alert : customer);
    await service.createTicket(alertFirst ? customer : alert);
    expect(rows).toHaveLength(2);
    await expect(service.createTicket(customer)).rejects.toMatchObject({ status: 409 });
    await expect(service.createTicket(alert)).rejects.toMatchObject({ status: 409 });
  });
  it("deduplicates concurrent alerts and concurrent customer creations", async () => {
    const { service, rows } = harness();
    await Promise.allSettled(Array.from({ length: 4 }, () => service.createTicket(alert)));
    await Promise.allSettled(Array.from({ length: 4 }, () => service.createTicket(customer)));
    expect(rows).toHaveLength(2);
  });
  it("admin linking ignores the internal alert while retaining the customer-ticket allowance", async () => {
    const { service, rows } = harness();
    await service.createTicket(alert);
    await service.createTicket({ ...customer, orderId: undefined });
    const id = rows[1].id;
    // Prisma stores absent order associations as null.
    await expect(service.linkOrder(id, "order", "admin", "location")).resolves.toHaveProperty("order");
    await expect(service.createTicket(customer)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps alerts in staff queues and denies customer access, messaging and listing", async () => {
    const { service, rows } = harness();
    await service.createTicket(alert);
    expect((await service.listTickets({ locationId: "location" })).tickets).toHaveLength(1);
    expect((await service.listTickets({ locationId: "location", customerUserId: "customer" })).tickets).toHaveLength(0);
    await expect(service.getTicket(rows[0].id, "CUSTOMER", "customer", "location")).rejects.toMatchObject({ status: 403 });
    await expect(service.addMessage(rows[0].id, "customer", "reply", false, "CUSTOMER", "location")).rejects.toMatchObject({ status: 403 });
  });
});

describe("Customer reopening", () => {
  it.each(["RESOLVED", "CLOSED"])("reopens %s once under concurrent/repeated requests, retaining history and active visibility", async status => {
    const { service, rows, events, messages } = harness();
    await service.createTicket(customer); rows[0].status = status;
    const history = [...messages];
    await Promise.all(Array.from({ length: 3 }, () => service.reopenTicket(rows[0].id, "customer", "location")));
    expect(events.filter(event => event.note === "Reopened by customer")).toEqual([expect.objectContaining({ fromValue: status, toValue: "OPEN" })]);
    expect(rows).toHaveLength(1); expect(messages).toEqual(history);
    expect((await service.listTickets({ locationId: "location", status: "OPEN" })).tickets).toHaveLength(1);
    await expect(service.createTicket(customer)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects other owners, other locations, missing location and internal alerts", async () => {
    const { service, rows, events } = harness();
    await service.createTicket(customer); rows[0].status = "CLOSED";
    for (const [user, location] of [["attacker", "location"], ["customer", "other"], ["customer", ""]]) {
      await expect(service.reopenTicket(rows[0].id, user, location)).rejects.toMatchObject({ status: 403 });
    }
    await service.createTicket(alert);
    await expect(service.reopenTicket(rows[1].id, "customer", "location")).rejects.toMatchObject({ status: 403 });
    expect(events.filter(event => event.note === "Reopened by customer")).toHaveLength(0);
  });
  it("limits repeated attempts without creating messages or extra events", async () => {
    const { service, rows, events } = harness(); await service.createTicket(customer); rows[0].status = "CLOSED";
    for (let i = 0; i < 10; i++) await service.reopenTicket(rows[0].id, "customer", "location");
    await expect(service.reopenTicket(rows[0].id, "customer", "location")).rejects.toMatchObject({ status: 429 });
    expect(events.filter(event => event.note === "Reopened by customer")).toHaveLength(1);
  });
});
