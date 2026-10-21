jest.mock("../../database/prisma.service", () => ({ PrismaService: class {} }));

import {
  OrderEmailStatus,
  OrderStatusEmailService,
} from "./order-status-email.service";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
let recipientDeleted = false;
const prisma = {
  $queryRaw: jest.fn(async () => [{ account_deleted_at: recipientDeleted ? new Date() : null }]),
  $transaction: jest.fn(async () => { throw new Error("email delivery must not hold a transaction"); }),
} as any;
const notificationService = () => new OrderStatusEmailService(prisma);

const order = {
  id: "5d29ce89-c565-4e24-b9b5-0912de22003b",
  orderNumber: 1042n,
  customerNameSnapshot: "Jamie & Sam",
  customerEmailSnapshot: "jamie@example.com",
  cancellationReason: "Kitchen closed <early>",
  cancellationSource: "KDS_CANCEL_REQUEST",
};

describe("OrderStatusEmailService", () => {
  beforeEach(() => {
    recipientDeleted = false;
    prisma.$queryRaw.mockClear();
    prisma.$transaction.mockClear();
    process.env = {
      ...ORIGINAL_ENV,
      RESEND_API_KEY: "re_test",
      RESEND_FROM: "orders@wings4u.test",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "email-id" }),
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it.each([
    ["ACCEPTED", "Order #1042 accepted | Wings 4 U"],
    ["PICKED_UP", "Order #1042 picked up | Wings 4 U"],
    ["DELIVERED", "Order #1042 delivered | Wings 4 U"],
    ["CANCELLED", "Order #1042 cancelled | Wings 4 U"],
  ] as Array<[OrderEmailStatus, string]>)(
    "sends the %s email directly through Resend",
    async (status, expectedSubject) => {
      const sent = await notificationService().send(order, status);

      expect(sent).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer re_test",
        "Idempotency-Key": `order-status/${status.toLowerCase()}/${order.id}`,
      });

      const payload = JSON.parse(init.body);
      expect(payload.from).toBe("orders@wings4u.test");
      expect(payload.to).toEqual(["jamie@example.com"]);
      expect(payload.subject).toBe(expectedSubject);
      expect(payload.text).toContain("Jamie & Sam");
      expect(payload.html).toContain("Jamie &amp; Sam");
      if (status === "CANCELLED") {
        expect(payload.text).toContain("Reason: Kitchen closed <early>");
        expect(payload.html).toContain("Reason:");
        expect(payload.html).toContain("Kitchen closed &lt;early&gt;");
      }
    },
  );

  it("does nothing when the order has no customer email", async () => {
    const sent = await notificationService().send(
      { ...order, customerEmailSnapshot: null },
      "ACCEPTED",
    );

    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the order flow successful when Resend rejects the email", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Invalid sender",
    });

    await expect(
      notificationService().send(order, "DELIVERED"),
    ).resolves.toBe(false);
  });

  it("does not submit email without an API key", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await notificationService().send(order, "ACCEPTED")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("preserves the default sender and request timeout", async () => {
    delete process.env.RESEND_FROM;
    await notificationService().send(order, "ACCEPTED");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).from).toBe("Wings 4 U <no-reply@wings4ulondon.ca>");
    expect(init.method).toBe("POST"); expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns false on a provider timeout without retrying or changing the key", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("timeout"));
    expect(await notificationService().send(order, "PICKED_UP")).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers["Idempotency-Key"])
      .toBe(`order-status/picked_up/${order.id}`);
  });

  it("does not send an in-memory order/contact snapshot after customer deletion commits", async () => {
    recipientDeleted = true;
    expect(await notificationService().send(order, "DELIVERED")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("checks the recipient without a lock or transaction, so no pooled connection waits on the provider", async () => {
    let releaseProvider!: () => void;
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => {
      releaseProvider = () => resolve({ ok: true, json: async () => ({ id: "email" }) });
    }));
    const sending = notificationService().send(order, "DELIVERED");
    await new Promise(resolve => setImmediate(resolve));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(String(prisma.$queryRaw.mock.calls[0][0].join(" "))).not.toMatch(/FOR (KEY SHARE|SHARE|UPDATE)/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    releaseProvider();
    await expect(sending).resolves.toBe(true);
  });

  it("does not send when the recipient check fails", async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error("pool exhausted"));
    expect(await notificationService().send(order, "DELIVERED")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
