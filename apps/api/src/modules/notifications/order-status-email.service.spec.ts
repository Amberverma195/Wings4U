import {
  OrderEmailStatus,
  OrderStatusEmailService,
} from "./order-status-email.service";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

const order = {
  id: "5d29ce89-c565-4e24-b9b5-0912de22003b",
  orderNumber: 1042n,
  customerNameSnapshot: "Jamie & Sam",
  customerEmailSnapshot: "jamie@example.com",
};

describe("OrderStatusEmailService", () => {
  beforeEach(() => {
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
  ] as Array<[OrderEmailStatus, string]>)(
    "sends the %s email directly through Resend",
    async (status, expectedSubject) => {
      const sent = await new OrderStatusEmailService().send(order, status);

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
    },
  );

  it("does nothing when the order has no customer email", async () => {
    const sent = await new OrderStatusEmailService().send(
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
      new OrderStatusEmailService().send(order, "DELIVERED"),
    ).resolves.toBe(false);
  });
});
