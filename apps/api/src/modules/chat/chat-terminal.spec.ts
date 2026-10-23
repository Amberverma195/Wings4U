import { TERMINAL_ORDER_STATUSES } from "../../common/orders/order-lifecycle";
import { ChatService } from "./chat.service";

it.each(TERMINAL_ORDER_STATUSES)("rejects messages on unpaid historical %s even if its conversation was never closed", async status => {
  const db = { order: { findUnique: jest.fn(async () => ({ id: "order", status, paymentStatusSummary: "UNPAID" })) },
    orderConversation: { upsert: jest.fn() }, orderMessage: { create: jest.fn() } };
  const service = new ChatService(db as any, {} as any, {} as any);
  await expect(service.sendMessage("order", "customer", "CUSTOMER", "hello")).rejects.toThrow("terminal status");
  expect(db.orderMessage.create).not.toHaveBeenCalled();
  expect(db.orderConversation.upsert).not.toHaveBeenCalled();
});
it("closes a conversation idempotently without changing messages or financial records", async () => {
  const conversation = { id: "chat", closedAt: null as Date | null };
  const db = { orderConversation: {
    findUnique: jest.fn(async () => conversation),
    update: jest.fn(async ({ data }: any) => Object.assign(conversation, data)),
  } };
  const service = new ChatService(db as any, {} as any, {} as any);
  await service.closeConversation("order");
  await service.closeConversation("order");
  expect(conversation.closedAt).toBeInstanceOf(Date);
  expect(db.orderConversation.update).toHaveBeenCalledTimes(1);
});
it("does not create a conversation when an order closes without chat history", async () => {
  const db = { orderConversation: { findUnique: jest.fn(async () => null), update: jest.fn() } };
  await new ChatService(db as any, {} as any, {} as any).closeConversation("order");
  expect(db.orderConversation.update).not.toHaveBeenCalled();
});
