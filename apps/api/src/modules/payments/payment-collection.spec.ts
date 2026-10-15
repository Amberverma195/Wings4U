import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ROLES_KEY } from "../../common/decorators/roles.decorator";
import { PaymentsController, RecordCollectionDto } from "./payments.controller";
import {
  PaymentsService,
  type PaymentActor,
  type RecordCollectionParams,
} from "./payments.service";

type FakeOrder = {
  id: string;
  locationId: string;
  customerUserId: string | null;
  status: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  finalPayableCents: number;
  paymentStatusSummary: string;
  paymentMethod: string | null;
  netPaidAmountCents: number;
  remainingRefundableCents: number;
  assignedDriverUserId: string | null;
  pricingSnapshotJson: Record<string, unknown>;
};

type FakePayment = Record<string, any> & {
  id: string;
  orderId: string;
  transactionStatus: string;
  createdAt: Date;
};

const STAFF: PaymentActor = { userId: "staff-1", role: "STAFF", employeeRole: "CASHIER" };
const STATION: PaymentActor = {
  userId: null,
  role: "KDS_STATION",
  kdsStationSessionId: "station-session-1",
};

function makeOrder(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: "order-1",
    locationId: "loc-1",
    customerUserId: "customer-1",
    status: "READY",
    fulfillmentType: "PICKUP",
    finalPayableCents: 2500,
    paymentStatusSummary: "UNPAID",
    paymentMethod: null,
    netPaidAmountCents: 0,
    remainingRefundableCents: 0,
    assignedDriverUserId: null,
    pricingSnapshotJson: { collection_preference: "PAY_AT_STORE" },
    ...overrides,
  };
}

/**
 * In-memory Prisma double. `$transaction` runs callbacks one at a time, the
 * same guarantee the order row lock (SELECT ... FOR UPDATE) gives in Postgres.
 */
function createHarness(orders: FakeOrder[]) {
  const state = {
    orders: new Map(orders.map((order) => [order.id, { ...order }])),
    payments: [] as FakePayment[],
    audits: [] as Record<string, any>[],
    lockSql: [] as string[],
  };
  let sequence = 0;

  const matchesPaymentWhere = (payment: FakePayment, where: Record<string, any>) =>
    payment.orderId === where.orderId &&
    (!where.transactionStatus || payment.transactionStatus === where.transactionStatus);

  const client = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.lockSql.push(strings.join("?"));
      const [orderId, locationId] = values as string[];
      const order = state.orders.get(orderId);
      return order && order.locationId === locationId ? [{ id: orderId }] : [];
    }),
    order: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const order = state.orders.get(where.id);
        if (!order) throw new Error("not found");
        return { ...order };
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const order = state.orders.get(where.id);
        if (!order) return null;
        if (where.locationId && order.locationId !== where.locationId) return null;
        if (where.customerUserId && order.customerUserId !== where.customerUserId) {
          return null;
        }
        const paymentWhere = { orderId: order.id, ...(include?.payments?.where ?? {}) };
        return {
          ...order,
          payments: state.payments.filter((payment) =>
            matchesPaymentWhere(payment, paymentWhere),
          ),
          assignedDriver: order.assignedDriverUserId
            ? { employeeProfile: { user: { displayName: "Dana Driver" } } }
            : null,
        };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const order = state.orders.get(where.id)!;
        Object.assign(order, data);
        return { ...order };
      }),
    },
    orderPayment: {
      findMany: jest.fn(async ({ where }: any) =>
        state.payments.filter((payment) => matchesPaymentWhere(payment, where)),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (
          data.providerTransactionId &&
          state.payments.some(
            (payment) =>
              payment.provider === data.provider &&
              payment.providerTransactionId === data.providerTransactionId,
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
    adminAuditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.audits.push(data);
        return data;
      }),
    },
  };

  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...client,
    $transaction: jest.fn((callback: (tx: typeof client) => Promise<unknown>) => {
      const run = queue.then(() => callback(client));
      queue = run.catch(() => undefined);
      return run;
    }),
  };

  const service = new PaymentsService(prisma as any);
  return { service, state, prisma };
}

function collection(
  overrides: Partial<RecordCollectionParams> = {},
): RecordCollectionParams {
  return {
    orderId: "order-1",
    locationId: "loc-1",
    method: "CASH",
    outcome: "SUCCESS",
    amountCents: 2500,
    collectedBy: "STORE",
    idempotencyKey: "confirm-0001",
    actor: STAFF,
    ...overrides,
  };
}

const successRows = (harness: ReturnType<typeof createHarness>) =>
  harness.state.payments.filter((payment) => payment.transactionStatus === "SUCCESS");

describe("Payment collection: pickup and delivery", () => {
  it("1. pickup paid with cash at the counter marks the order paid", async () => {
    const harness = createHarness([makeOrder()]);

    await harness.service.recordCollection(collection());

    const order = harness.state.orders.get("order-1")!;
    expect(order.paymentStatusSummary).toBe("PAID");
    expect(order.paymentMethod).toBe("CASH");
    expect(order.netPaidAmountCents).toBe(2500);
    expect(harness.state.payments[0]).toEqual(
      expect.objectContaining({
        transactionType: "CAPTURE",
        transactionStatus: "SUCCESS",
        paymentMethod: "CASH",
        createdByUserId: "staff-1",
        initiatedByUserId: "staff-1",
        provider: null,
      }),
    );
    expect(harness.state.audits[0]).toEqual(
      expect.objectContaining({
        actionKey: "payment.collection_recorded",
        actorUserId: "staff-1",
        actorRoleSnapshot: "STAFF",
        entityId: "order-1",
      }),
    );
  });

  it("2. pickup paid by terminal stores the approval reference, not card data", async () => {
    const harness = createHarness([makeOrder()]);

    await harness.service.recordCollection(
      collection({ method: "CARD", terminalReference: " APPR-552190 ", actor: STATION }),
    );

    const payment = harness.state.payments[0];
    expect(payment.provider).toBe("CARD_TERMINAL");
    expect(payment.providerTransactionId).toBe("APPR-552190");
    expect(JSON.stringify(payment)).not.toMatch(/\d{13,19}/);
    expect(harness.state.orders.get("order-1")!.paymentMethod).toBe("CARD");
    expect(harness.state.audits[0]).toEqual(
      expect.objectContaining({
        actorUserId: null,
        actorRoleSnapshot: "KDS_STATION",
        payloadJson: expect.objectContaining({
          kds_station_session_id: "station-session-1",
        }),
      }),
    );
  });

  it("3. delivery cash collected by the driver is attributed to the driver", async () => {
    const harness = createHarness([
      makeOrder({
        fulfillmentType: "DELIVERY",
        status: "DELIVERED",
        assignedDriverUserId: "driver-1",
        pricingSnapshotJson: { collection_preference: "CASH_ON_DELIVERY" },
      }),
    ]);

    await harness.service.recordCollection(collection({ collectedBy: "DRIVER" }));

    expect(harness.state.payments[0]).toEqual(
      expect.objectContaining({
        initiatedByUserId: "driver-1",
        createdByUserId: "staff-1",
      }),
    );
    expect(harness.state.orders.get("order-1")!.paymentStatusSummary).toBe("PAID");
    expect(harness.state.audits[0].payloadJson).toEqual(
      expect.objectContaining({
        collected_by: "DRIVER",
        driver_user_id: "driver-1",
        method_matches_preference: true,
      }),
    );
  });

  it("4. delivery card-on-delivery terminal success reported by the driver", async () => {
    const harness = createHarness([
      makeOrder({
        fulfillmentType: "DELIVERY",
        status: "OUT_FOR_DELIVERY",
        assignedDriverUserId: "driver-1",
        pricingSnapshotJson: { collection_preference: "CARD_ON_DELIVERY" },
      }),
    ]);

    await harness.service.recordCollection(
      collection({ method: "CARD", collectedBy: "DRIVER", terminalReference: "RRN000123456" }),
    );

    expect(harness.state.orders.get("order-1")!.paymentStatusSummary).toBe("PAID");
    expect(harness.state.payments[0].providerTransactionId).toBe("RRN000123456");
  });

  it("drivers may only record collections on deliveries assigned to them", async () => {
    const harness = createHarness([
      makeOrder({ fulfillmentType: "DELIVERY", assignedDriverUserId: "driver-1" }),
    ]);

    await expect(
      harness.service.recordCollection(
        collection({
          collectedBy: "DRIVER",
          actor: { userId: "driver-2", role: "STAFF", employeeRole: "DRIVER" },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.state.payments).toHaveLength(0);
  });
});

describe("Payment collection: failures and exceptions", () => {
  it("5. a declined terminal attempt is kept as FAILED and leaves the order unpaid", async () => {
    const harness = createHarness([makeOrder()]);

    await harness.service.recordCollection(collection({ method: "CARD", outcome: "DECLINED" }));
    await harness.service.recordCollection(
      collection({ method: "CARD", outcome: "CANCELLED", idempotencyKey: "confirm-0002" }),
    );

    expect(harness.state.payments.map((payment) => payment.transactionStatus)).toEqual([
      "FAILED",
      "CANCELLED",
    ]);
    expect(harness.state.payments[0].failureReason).toBe("Terminal declined");
    expect(harness.prisma.order.update).not.toHaveBeenCalled();
    expect(harness.state.orders.get("order-1")!.paymentStatusSummary).toBe("UNPAID");
    expect(harness.state.audits.map((audit) => audit.actionKey)).toEqual([
      "payment.collection_failed",
      "payment.collection_failed",
    ]);

    const view = await harness.service.getStaffPaymentView("order-1", "loc-1");
    expect(view.outstanding_cents).toBe(2500);
    expect(view.has_unpaid_balance).toBe(true);
  });

  it("rejects a pending terminal outcome at the API boundary", async () => {
    const dto = plainToInstance(RecordCollectionDto, {
      method: "CARD",
      outcome: "PENDING",
      amount_cents: 2500,
      collected_by: "STORE",
      idempotency_key: "confirm-0001",
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain("outcome");
  });

  it("requires a terminal reference, or an explained exception, for card success", async () => {
    const harness = createHarness([makeOrder()]);

    await expect(
      harness.service.recordCollection(collection({ method: "CARD" })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      harness.service.recordCollection(
        collection({ method: "CARD", referenceUnavailable: true }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await harness.service.recordCollection(
      collection({
        method: "CARD",
        referenceUnavailable: true,
        note: "Terminal receipt printer jammed",
      }),
    );
    expect(harness.state.orders.get("order-1")!.paymentStatusSummary).toBe("PAID");
  });

  it("refuses anything shaped like a card number in the reference or note", async () => {
    const harness = createHarness([makeOrder()]);

    await expect(
      harness.service.recordCollection(
        collection({ method: "CARD", terminalReference: "4242424242424242" }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      harness.service.recordCollection(
        collection({ outcome: "NOT_COLLECTED", note: "card 4242 4242 4242 4242 failed" }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(harness.state.payments).toHaveLength(0);
  });

  it("records a refused or uncollected delivery with a required reason", async () => {
    const harness = createHarness([
      makeOrder({ fulfillmentType: "DELIVERY", assignedDriverUserId: "driver-1" }),
    ]);

    await expect(
      harness.service.recordCollection(
        collection({ outcome: "NOT_COLLECTED", collectedBy: "DRIVER" }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await harness.service.recordCollection(
      collection({
        outcome: "NOT_COLLECTED",
        collectedBy: "DRIVER",
        note: "Customer refused the order at the door",
      }),
    );
    expect(harness.state.payments[0]).toEqual(
      expect.objectContaining({
        transactionStatus: "FAILED",
        failureReason: "Customer refused the order at the door",
      }),
    );
    expect(harness.state.orders.get("order-1")!.paymentStatusSummary).toBe("UNPAID");
  });

  it("6. keeps the original preference when the actual method differs", async () => {
    const harness = createHarness([
      makeOrder({
        fulfillmentType: "DELIVERY",
        assignedDriverUserId: "driver-1",
        pricingSnapshotJson: { collection_preference: "CASH_ON_DELIVERY" },
      }),
    ]);

    await harness.service.recordCollection(
      collection({ method: "CARD", terminalReference: "APPR-7781", collectedBy: "DRIVER" }),
    );

    expect(harness.state.orders.get("order-1")!.pricingSnapshotJson).toEqual({
      collection_preference: "CASH_ON_DELIVERY",
    });
    expect(harness.state.audits[0].payloadJson).toEqual(
      expect.objectContaining({
        method: "CARD",
        collection_preference: "CASH_ON_DELIVERY",
        method_matches_preference: false,
      }),
    );
    const view = await harness.service.getStaffPaymentView("order-1", "loc-1");
    expect(view.collection_preference_label).toBe("Cash on Delivery");
    expect(view.payment_method).toBe("CARD");
  });
});

describe("Payment collection: duplicates and concurrency", () => {
  it("7. a retried confirmation with the same key is not recorded twice", async () => {
    const harness = createHarness([makeOrder()]);

    const first = await harness.service.recordCollection(collection());
    const second = await harness.service.recordCollection(collection());

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(harness.state.payments).toHaveLength(1);
    expect(harness.state.audits).toHaveLength(1);
  });

  it("rejects a reused key carrying different details", async () => {
    const harness = createHarness([makeOrder()]);
    await harness.service.recordCollection(collection({ amountCents: 1000 }));

    await expect(
      harness.service.recordCollection(collection({ amountCents: 1500 })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects the same terminal reference on a second order", async () => {
    const harness = createHarness([makeOrder(), makeOrder({ id: "order-2" })]);
    await harness.service.recordCollection(
      collection({ method: "CARD", terminalReference: "APPR-1" }),
    );

    await expect(
      harness.service.recordCollection(
        collection({
          orderId: "order-2",
          method: "CARD",
          terminalReference: "APPR-1",
          idempotencyKey: "confirm-0002",
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("8. simultaneous confirmations record one payment and reject the other", async () => {
    const harness = createHarness([makeOrder()]);

    const results = await Promise.allSettled([
      harness.service.recordCollection(collection({ idempotencyKey: "tablet-a-0001" })),
      harness.service.recordCollection(
        collection({ method: "CARD", terminalReference: "APPR-9", idempotencyKey: "tablet-b-0001" }),
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(successRows(harness)).toHaveLength(1);
    expect(harness.state.orders.get("order-1")!.netPaidAmountCents).toBe(2500);
    expect(harness.state.lockSql).toHaveLength(2);
    harness.state.lockSql.forEach((sql) => expect(sql).toMatch(/FOR UPDATE/));
  });
});

describe("Payment collection: balances", () => {
  it("9. partial payments accumulate and cannot exceed the outstanding balance", async () => {
    const harness = createHarness([makeOrder()]);

    await harness.service.recordCollection(collection({ amountCents: 1000 }));
    let order = harness.state.orders.get("order-1")!;
    expect(order.paymentStatusSummary).toBe("PARTIALLY_PAID");

    await expect(
      harness.service.recordCollection(
        collection({ amountCents: 2000, idempotencyKey: "confirm-0002" }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await harness.service.recordCollection(
      collection({
        amountCents: 1500,
        method: "CARD",
        terminalReference: "APPR-42",
        idempotencyKey: "confirm-0003",
      }),
    );

    order = harness.state.orders.get("order-1")!;
    expect(order.paymentStatusSummary).toBe("PAID");
    expect(order.paymentMethod).toBe("SPLIT");
    expect(order.netPaidAmountCents).toBe(2500);

    await expect(
      harness.service.recordCollection(
        collection({ amountCents: 1, idempotencyKey: "confirm-0004" }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("13. final balance and status stay correct through a refund", async () => {
    const harness = createHarness([makeOrder({ status: "PICKED_UP" })]);
    await harness.service.recordCollection(collection());

    await expect(
      harness.service.createPayment({
        orderId: "order-1",
        locationId: "loc-1",
        transactionType: "REFUND",
        paymentMethod: "CASH",
        signedAmountCents: -3000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await harness.service.createPayment({
      orderId: "order-1",
      locationId: "loc-1",
      transactionType: "REFUND",
      paymentMethod: "CASH",
      signedAmountCents: 500,
      createdByUserId: "admin-1",
    });

    const view = await harness.service.getStaffPaymentView("order-1", "loc-1");
    expect(view.payment_status_summary).toBe("PARTIALLY_REFUNDED");
    expect(view.amount_collected_cents).toBe(2000);
    expect(view.outstanding_cents).toBe(0);
    expect(harness.state.payments[1].signedAmountCents).toBe(-500);
  });

  it("caps manual captures at the outstanding balance", async () => {
    const harness = createHarness([makeOrder()]);

    await expect(
      harness.service.createPayment({
        orderId: "order-1",
        locationId: "loc-1",
        transactionType: "CAPTURE",
        paymentMethod: "CASH",
        signedAmountCents: 2600,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("12. legacy orders without a stored preference still collect and label safely", async () => {
    const harness = createHarness([makeOrder({ pricingSnapshotJson: {} })]);

    const before = await harness.service.getStaffPaymentView("order-1", "loc-1");
    expect(before.collection_preference).toBeNull();
    expect(before.collection_preference_label).toBe("Not recorded");

    await harness.service.recordCollection(collection());
    expect(harness.state.audits[0].payloadJson).toEqual(
      expect.objectContaining({
        collection_preference: null,
        method_matches_preference: null,
      }),
    );
  });

  it("cancelled orders cannot take a collection", async () => {
    const harness = createHarness([makeOrder({ status: "CANCELLED" })]);
    await expect(
      harness.service.recordCollection(collection()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe("Payment collection: authorization", () => {
  it("10. staff cannot record or read payments for another location's order", async () => {
    const harness = createHarness([makeOrder({ locationId: "loc-2" })]);

    await expect(
      harness.service.recordCollection(collection({ locationId: "loc-1" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      harness.service.createPayment({
        orderId: "order-1",
        locationId: "loc-1",
        transactionType: "CAPTURE",
        paymentMethod: "CASH",
        signedAmountCents: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      harness.service.getPaymentsForViewer("order-1", {
        userId: "staff-1",
        role: "STAFF",
        locationId: "loc-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.state.payments).toHaveLength(0);
  });

  it("customers can read only their own order, without staff-only details", async () => {
    const harness = createHarness([makeOrder()]);
    await harness.service.recordCollection(collection({ method: "CARD", outcome: "DECLINED" }));
    await harness.service.recordCollection(
      collection({ method: "CARD", terminalReference: "APPR-55", idempotencyKey: "confirm-0002" }),
    );

    await expect(
      harness.service.getPaymentsForViewer("order-1", {
        userId: "customer-2",
        role: "CUSTOMER",
        locationId: "loc-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const own = await harness.service.getPaymentsForViewer("order-1", {
      userId: "customer-1",
      role: "CUSTOMER",
      locationId: "loc-1",
    });
    expect(own.payments).toHaveLength(1);
    const serialized = JSON.stringify(own);
    expect(serialized).not.toContain("APPR-55");
    expect(serialized).not.toContain("staff-1");
    expect(serialized).not.toContain("Terminal declined");
    expect(own).toEqual(
      expect.objectContaining({
        collection_preference_label: "Pay at Store",
        payment_status_summary: "PAID",
        outstanding_cents: 0,
      }),
    );
  });

  it("limits the collect endpoint to cashier, manager, driver staff and admins", () => {
    const spec = Reflect.getMetadata(ROLES_KEY, PaymentsController.prototype.collect);
    expect(spec.userRoles.sort()).toEqual(["ADMIN", "STAFF"]);
    expect(spec.employeeRoles.sort()).toEqual(["CASHIER", "DRIVER", "MANAGER"]);

    const manual = Reflect.getMetadata(ROLES_KEY, PaymentsController.prototype.create);
    expect(manual.userRoles).toEqual(["ADMIN"]);
  });

  it("refuses direct refunds through the manual ledger endpoint", async () => {
    const service = { createPayment: jest.fn() };
    const controller = new PaymentsController(service as any);

    await expect(
      controller.create(
        "order-1",
        { locationId: "loc-1" } as any,
        { userId: "admin-1", role: "ADMIN" } as any,
        { transaction_type: "REFUND", payment_method: "CASH", signed_amount_cents: 100 } as any,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(service.createPayment).not.toHaveBeenCalled();
  });
});
