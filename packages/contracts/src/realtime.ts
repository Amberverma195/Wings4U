export type RealtimeChannel =
  | `orders:${string}`
  | `order:${string}`
  | `chat:${string}`
  | `admin:${string}`
  | `drivers:${string}`;

export type RealtimeEventName =
  | "order.placed"
  | "order.accepted"
  | "order.status_changed"
  | "order.cancelled"
  | "order.driver_assigned"
  | "order.delivery_started"
  | "order.eta_updated"
  | "order.manual_review_required"
  | "chat.message"
  | "chat.read"
  | "cancellation.requested"
  | "cancellation.decided"
  | "refund.requested"
  | "support.ticket_created"
  | "support.auto_ticket"
  | "driver.availability_changed"
  | "driver.delivery_completed"
  | "admin.busy_mode_changed";

export type RealtimeEventEnvelope<
  TName extends RealtimeEventName,
  TPayload extends Record<string, unknown>
> = {
  event_type: TName;
  payload: TPayload;
  timestamp: string;
};

export type OrderPlacedPayload = {
  order_id: string;
  order_number: number;
  fulfillment_type: "PICKUP" | "DELIVERY";
  status: "PLACED";
  customer_name: string;
  item_count: number;
  estimated_ready_at: string;
};

export type OrderAcceptedPayload = {
  order_id: string;
  status: "ACCEPTED";
};

export type OrderStatusChangedPayload = {
  order_id: string;
  from_status: string;
  to_status: string;
  changed_by_user_id: string;
};

export type OrderCancelledPayload = {
  order_id: string;
  status: "CANCELLED";
};

export type OrderDriverAssignedPayload = {
  order_id: string;
  driver_user_id: string;
};

export type OrderDeliveryStartedPayload = {
  order_id: string;
  status: "OUT_FOR_DELIVERY";
};

export type OrderEtaUpdatedPayload = {
  order_id: string;
  estimated_ready_at?: string;
  estimated_arrival_at?: string;
};

export type ChatMessagePayload = {
  order_id: string;
  message_id: string;
  sender_surface: "CUSTOMER" | "KDS" | "MANAGER" | "ADMIN";
  message_body: string;
  visibility: "BOTH" | "STAFF_ONLY";
};

export type ChatReadPayload = {
  order_id: string;
  reader_side: "CUSTOMER" | "STAFF";
};

export type CancellationRequestedPayload = {
  order_id: string;
  request_id: string;
  request_source: string;
  reason_text: string;
  /** Present when a staff user initiated the request; null for KDS station (PIN) sessions. */
  requested_by_user_id: string | null;
};

export type CancellationDecidedPayload = {
  order_id: string;
  request_id: string;
  decision: "APPROVED" | "REJECTED";
};

export type RefundRequestedPayload = {
  order_id: string;
  refund_request_id: string;
  amount_cents: number;
  refund_method: "STORE_CREDIT" | "ORIGINAL_PAYMENT" | "CASH";
};

export type SupportTicketCreatedPayload = {
  ticket_id: string;
  order_id?: string;
  ticket_type: string;
  status: "OPEN" | "IN_REVIEW" | "WAITING_ON_CUSTOMER" | "RESOLVED" | "CLOSED";
};

export type SupportAutoTicketPayload = {
  ticket_id: string;
  order_id: string;
  ticket_type: string;
};

export type DriverAvailabilityChangedPayload = {
  driver_user_id: string;
  availability_status: string;
  is_on_delivery: boolean;
};

export type DriverDeliveryCompletedPayload = {
  driver_user_id: string;
  order_id: string;
};

export type OrderPlacedEvent = RealtimeEventEnvelope<"order.placed", OrderPlacedPayload>;
export type OrderAcceptedEvent = RealtimeEventEnvelope<"order.accepted", OrderAcceptedPayload>;
export type OrderStatusChangedEvent = RealtimeEventEnvelope<
  "order.status_changed",
  OrderStatusChangedPayload
>;
export type OrderCancelledEvent = RealtimeEventEnvelope<
  "order.cancelled",
  OrderCancelledPayload
>;
export type OrderDriverAssignedEvent = RealtimeEventEnvelope<
  "order.driver_assigned",
  OrderDriverAssignedPayload
>;
export type OrderDeliveryStartedEvent = RealtimeEventEnvelope<
  "order.delivery_started",
  OrderDeliveryStartedPayload
>;
export type OrderEtaUpdatedEvent = RealtimeEventEnvelope<
  "order.eta_updated",
  OrderEtaUpdatedPayload
>;
export type ChatMessageEvent = RealtimeEventEnvelope<"chat.message", ChatMessagePayload>;
export type ChatReadEvent = RealtimeEventEnvelope<"chat.read", ChatReadPayload>;
export type CancellationRequestedEvent = RealtimeEventEnvelope<
  "cancellation.requested",
  CancellationRequestedPayload
>;
export type CancellationDecidedEvent = RealtimeEventEnvelope<
  "cancellation.decided",
  CancellationDecidedPayload
>;
export type RefundRequestedEvent = RealtimeEventEnvelope<
  "refund.requested",
  RefundRequestedPayload
>;
export type SupportTicketCreatedEvent = RealtimeEventEnvelope<
  "support.ticket_created",
  SupportTicketCreatedPayload
>;
export type SupportAutoTicketEvent = RealtimeEventEnvelope<
  "support.auto_ticket",
  SupportAutoTicketPayload
>;
export type DriverAvailabilityChangedEvent = RealtimeEventEnvelope<
  "driver.availability_changed",
  DriverAvailabilityChangedPayload
>;
export type DriverDeliveryCompletedEvent = RealtimeEventEnvelope<
  "driver.delivery_completed",
  DriverDeliveryCompletedPayload
>;

export type RealtimeEvent =
  | OrderPlacedEvent
  | OrderAcceptedEvent
  | OrderStatusChangedEvent
  | OrderCancelledEvent
  | OrderDriverAssignedEvent
  | OrderDeliveryStartedEvent
  | OrderEtaUpdatedEvent
  | ChatMessageEvent
  | ChatReadEvent
  | CancellationRequestedEvent
  | CancellationDecidedEvent
  | RefundRequestedEvent
  | SupportTicketCreatedEvent
  | SupportAutoTicketEvent
  | DriverAvailabilityChangedEvent
  | DriverDeliveryCompletedEvent;
