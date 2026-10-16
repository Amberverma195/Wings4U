import { AdminCustomersService } from "./admin-customers.service";
import { AdminService } from "./admin.service";
import { RewardsController } from "../rewards/rewards.controller";

const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DATE = new Date("2026-10-15T12:34:56.789Z");
const mockPrisma = () => ({
  user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  order: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  supportTicket: { findMany: jest.fn().mockResolvedValue([]) },
  customerWingsRewards: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  customerWingsStampLedger: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
});
const profile = () => ({ id: CUSTOMER, displayName: "Brown", firstName: "Alex", lastName: "Brown", createdAt: DATE,
  _count: { ordersAsCustomer: 42 },
  identities: [{ phoneE164: "+15195551234", emailNormalized: null }, { phoneE164: null, emailNormalized: "brown@example.com" }],
  customerAddresses: [{ id: "address", label: "Home", line1: "123 Main St", city: "London", postalCode: "N6A 1A1", isDefault: true }],
});
const order = (id: string) => ({ id, orderNumber: BigInt("9007199254740993"), placedAt: DATE,
  status: "CANCELLED", fulfillmentType: "PICKUP", finalPayableCents: 2500 });
const entry = (id: string, overrides = {}) => ({ id, entryType: "EARNED", deltaStamps: 2, balanceAfterStamps: 5,
  poundsAwarded: { toString: () => "2.50" }, reasonText: "Earned 2 stamps", createdAt: DATE, orderId: "order-1",
  order: { id: "order-1", orderNumber: BigInt(1042), locationId: LOCATION, customerUserId: CUSTOMER, fulfillmentType: "PICKUP" }, ...overrides });

describe("Read-only Admin customer data", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: AdminCustomersService;
  beforeEach(() => {
    prisma = mockPrisma(); prisma.user.findFirst.mockResolvedValue(profile());
    service = new AdminCustomersService(prisma as never);
  });

  it("returns explicit contact/address DTOs using customer-only predicates and primary identity ordering", async () => {
    const result = await service.getCustomer(CUSTOMER, LOCATION);
    expect(result.primary_phone).toBe("+15195551234");
    expect(result.primary_email).toBe("brown@example.com");
    expect(result.default_address).toEqual({ id: "address", label: "Home", line1: "123 Main St", city: "London", postal_code: "N6A 1A1", is_default: true });
    expect(result.created_at).toBe(DATE.toISOString());
    expect(result.total_order_count).toBe(42);
    const query = prisma.user.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: CUSTOMER, role: "CUSTOMER", archivedAt: null });
    expect(query.select.identities.orderBy.slice(0, 2)).toEqual([{ isPrimary: "desc" }, { isVerified: "desc" }]);
    expect(query.select.identities.select).toEqual({ emailNormalized: true, phoneE164: true });
    expect(query.select.passwordHash).toBeUndefined();
    expect(query.select.customerAddresses.orderBy[0]).toEqual({ isDefault: "desc" });
    expect(query.select._count).toEqual({ select: { ordersAsCustomer: { where: { locationId: LOCATION } } } });
    expect(Object.keys(result).sort()).toEqual(['id','display_name','first_name','last_name','primary_phone','primary_email','created_at','total_order_count','saved_addresses','default_address'].sort());
  });

  it("returns zero orders for customers with no orders at this restaurant", async () => {
    prisma.user.findFirst.mockResolvedValue({ ...profile(), _count: { ordersAsCustomer: 0 } });
    expect((await service.getCustomer(CUSTOMER, LOCATION)).total_order_count).toBe(0);
  });

  it("handles email-only customers with no saved/default address", async () => {
    prisma.user.findFirst.mockResolvedValue({ ...profile(), identities: [{ emailNormalized: "only@example.com", phoneE164: null }], customerAddresses: [] });
    expect(await service.getCustomer(CUSTOMER, LOCATION)).toEqual(expect.objectContaining({
      primary_phone: null, primary_email: "only@example.com", saved_addresses: [], default_address: null,
    }));
  });
  it.each(["getCustomer", "getOrders", "getStamps"] as const)("%s rejects noncustomer/missing accounts and absent location scope", async method => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service[method](CUSTOMER, LOCATION)).rejects.toMatchObject({ status: 404 });
    await expect(service[method](CUSTOMER, "")).rejects.toMatchObject({ status: 403 });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.customerWingsStampLedger.findMany).not.toHaveBeenCalled();
  });
  it("queries orders by account/location including historical statuses, with safe BigInt serialization", async () => {
    prisma.order.findMany.mockResolvedValue([order("one"), order("two"), order("three")]);
    const result = await service.getOrders(CUSTOMER, LOCATION, undefined, 2);
    expect(prisma.order.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { customerUserId: CUSTOMER, locationId: LOCATION }, orderBy: [{ placedAt: "desc" }, { id: "desc" }], take: 3,
    }));
    expect(result.orders).toHaveLength(2);
    expect(result.next_cursor).toBe("two");
    expect(result.orders[0].order_number).toBe("9007199254740993");
    expect(result.orders[0].status).toBe("CANCELLED");
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("loads scoped subsequent pages with stable date/id ordering", async () => {
    prisma.order.findFirst.mockResolvedValue({ id: "cursor", placedAt: DATE });
    prisma.order.findMany.mockResolvedValue([order("older")]);
    const result = await service.getOrders(CUSTOMER, LOCATION, "cursor", 2);
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ customerUserId: CUSTOMER, locationId: LOCATION, id: "cursor" });
    expect(prisma.order.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { customerUserId: CUSTOMER, locationId: LOCATION }, cursor: { id: "cursor" }, skip: 1,
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    }));
    expect(result.next_cursor).toBeNull();
  });
  it("rejects foreign-customer/location order cursors before querying the page", async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.getOrders(CUSTOMER, LOCATION, "foreign-cursor")).rejects.toMatchObject({ status: 400 });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
  it("returns zero rewards without upserting or writing a ledger entry", async () => {
    const result = await service.getStamps(CUSTOMER, LOCATION);
    expect(result.summary).toEqual({ available_stamps: 0, lifetime_stamps: 0, lifetime_redemptions: 0, stamps_per_reward: 8, reward_available: false });
    expect(result.entries).toEqual([]);
    expect(prisma.customerWingsRewards.upsert).not.toHaveBeenCalled();
    expect(prisma.customerWingsStampLedger.create).not.toHaveBeenCalled();
  });
  it("preserves ADMIN_GRANTED in admin and customer ledgers without a fake order or private notes", async () => {
    const grant = entry("grant", { customerUserId: CUSTOMER, entryType: "ADMIN_GRANTED", orderId: null, order: null,
      poundsAwarded: null, reasonText: "Gifted by Wings 4 U — courtesy stamps added." });
    prisma.customerWingsStampLedger.findMany.mockResolvedValue([grant]);
    expect((await service.getStamps(CUSTOMER, LOCATION)).entries[0]).toEqual(expect.objectContaining({
      entry_type: "ADMIN_GRANTED", delta_stamps: 2, pounds_awarded: null, order_id: null, order_number: null,
      reason_text: "Gifted by Wings 4 U — courtesy stamps added.",
    }));
    const rewards = new RewardsController({ getLedger: async () => ({ entries: [grant], next_cursor: null }) } as any);
    const mine = await rewards.getMyLedger({ userId: CUSTOMER, role: "CUSTOMER" } as any);
    expect(mine.entries[0]).toEqual(expect.objectContaining({ entry_type: "ADMIN_GRANTED", delta_stamps: 2, order_id: null, pounds_awarded: null }));
  });
  it("keeps lifetime totals and historical redemptions when available stamps are zero", async () => {
    prisma.customerWingsRewards.findUnique.mockResolvedValue({ availableStamps: 0, lifetimeStamps: 40, lifetimeRedemptions: 5 });
    prisma.customerWingsStampLedger.findMany.mockResolvedValue([entry("redeem", { entryType: "REDEEMED", deltaStamps: -8, poundsAwarded: null, balanceAfterStamps: 0 })]);
    const result = await service.getStamps(CUSTOMER, LOCATION);
    expect(result.summary.lifetime_redemptions).toBe(5);
    expect(result.summary.lifetime_stamps).toBe(40);
    expect(result.entries[0]).toEqual(expect.objectContaining({ entry_type: "REDEEMED", delta_stamps: -8, created_at: DATE.toISOString(), order_number: "1042" }));
    expect(prisma.customerWingsRewards.findUnique.mock.calls[0][0].where).toEqual({ customerUserId: CUSTOMER });
  });
  it("uses the reward threshold and converts Decimal/BigInt values to JSON primitives", async () => {
    prisma.customerWingsRewards.findUnique.mockResolvedValue({ availableStamps: 8, lifetimeStamps: 16, lifetimeRedemptions: 1 });
    prisma.customerWingsStampLedger.findMany.mockResolvedValue([entry("earned")]);
    const result = await service.getStamps(CUSTOMER, LOCATION);
    expect(result.summary.reward_available).toBe(true);
    expect(result.entries[0].pounds_awarded).toBe(2.5);
    expect(result.entries[0].order_number).toBe("1042");
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("redacts other restaurants' order metadata while keeping the stamp event and balance", async () => {
    prisma.customerWingsStampLedger.findMany.mockResolvedValue([entry("foreign", {
      order: { id: "foreign-order", orderNumber: BigInt(9999), locationId: "other-location", customerUserId: CUSTOMER, fulfillmentType: "DELIVERY" },
      reasonText: "Private order #9999 details", poundsAwarded: 3,
    })]);
    const result = await service.getStamps(CUSTOMER, LOCATION);
    expect(result.entries[0]).toEqual(expect.objectContaining({ delta_stamps: 2, balance_after_stamps: 5,
      order_id: null, order_number: null, order_fulfillment_type: null, order_accessible: false, pounds_awarded: null }));
    expect(JSON.stringify(result)).not.toContain("9999");
    expect(JSON.stringify(result)).not.toContain("foreign-order");
  });
  it("paginates stamp history independently and rejects a cursor owned by another customer", async () => {
    prisma.customerWingsStampLedger.findFirst.mockResolvedValue({ id: "cursor", createdAt: DATE });
    prisma.customerWingsStampLedger.findMany.mockResolvedValue([entry("one"), entry("two"), entry("three")]);
    const result = await service.getStamps(CUSTOMER, LOCATION, "cursor", 2);
    expect(result.next_cursor).toBe("two");
    expect(prisma.customerWingsStampLedger.findFirst.mock.calls[0][0].where).toEqual({ id: "cursor", customerUserId: CUSTOMER });
    expect(prisma.customerWingsStampLedger.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { customerUserId: CUSTOMER }, cursor: { id: "cursor" }, skip: 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
    prisma.customerWingsStampLedger.findFirst.mockResolvedValue(null);
    await expect(service.getStamps(CUSTOMER, LOCATION, "other-customer")).rejects.toMatchObject({ status: 400 });
  });
});

describe("Global customer search", () => {
  it.each(["Brown", "brown@example.com", "(519) 555-1234"])("matches %s using customer-only name/identity predicates", async query => {
    const prisma = mockPrisma();
    const service = new AdminService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await service.globalSearch(LOCATION, query);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.role).toBe("CUSTOMER");
    expect(where.archivedAt).toBeNull();
    expect(where.OR.slice(0, 3)).toEqual([
      { displayName: { contains: query, mode: "insensitive" } }, { firstName: { contains: query, mode: "insensitive" } },
      { lastName: { contains: query, mode: "insensitive" } },
    ]);
    const identities = where.OR[3].identities.some.OR;
    expect(identities).toContainEqual({ emailNormalized: { contains: query, mode: "insensitive" } });
    if (query.startsWith("(")) expect(identities).toContainEqual({ phoneE164: { contains: "5195551234" } });
    expect(prisma.order.findMany.mock.calls[0][0].where.locationId).toBe(LOCATION);
  });
});
