import { ensureCustomerAddressExists } from "./customer-addresses.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("ensureCustomerAddressExists", () => {
  it("returns an existing normalized address without replacing it", async () => {
    const existing = {
      id: "22222222-2222-4222-8222-222222222222",
      userId: USER_ID,
      label: "Home",
      line1: "10 King Street",
      city: "London",
      postalCode: "N5W 1A1",
      isDefault: true,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    };
    const client = {
      customerAddress: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    };

    const result = await ensureCustomerAddressExists(
      client as never,
      USER_ID,
      {
        line1: " 10 king street ",
        city: "London",
        postalCode: "n5w 1a1",
      },
    );

    expect(client.customerAddress.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        postalCode: "N5W 1A1",
        line1: { equals: "10 king street", mode: "insensitive" },
      },
    });
    expect(client.customerAddress.create).not.toHaveBeenCalled();
    expect(result.label).toBe("Home");
    expect(result.is_default).toBe(true);
  });

  it("appends a different guest address to the customer address book", async () => {
    const created = {
      id: "33333333-3333-4333-8333-333333333333",
      userId: USER_ID,
      label: null,
      line1: "25 Dundas Street",
      city: "London",
      postalCode: "N5W 2B2",
      isDefault: false,
      createdAt: new Date("2026-07-22T12:00:00.000Z"),
      updatedAt: new Date("2026-07-22T12:00:00.000Z"),
    };
    const client = {
      customerAddress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };

    await ensureCustomerAddressExists(client as never, USER_ID, {
      line1: " 25 Dundas Street ",
      city: " London ",
      postalCode: "n5w  2b2",
    });

    expect(client.customerAddress.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        line1: "25 Dundas Street",
        city: "London",
        postalCode: "N5W 2B2",
        label: null,
        isDefault: false,
      },
    });
  });
});
