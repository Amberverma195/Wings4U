# Wire Existing Realtime Into Business Flows

## Summary

You do **not** need a new WebSocket server, and you do **not** need a new ack protocol to fix this issue.

The realtime stack is already split correctly:
- [realtime.gateway.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/realtime/realtime.gateway.ts) handles socket auth, channel subscribe/unsubscribe, and actual `emit...()` calls.
- The missing part is that the business services are changing the database but **not calling the gateway after success**.

The fix is: keep HTTP as the write path, keep WebSocket as the push path, and emit typed events **after successful DB mutations**.

## Key Changes

### 1. Keep the current architecture
Do not build anything new at the transport layer.

Keep this model:
1. Client makes normal HTTP request.
2. Service writes to DB.
3. If the write succeeds, service calls the gateway emit helper.
4. Connected clients already subscribed to the right channel receive the update.

Do **not** emit before the DB change succeeds.  
Do **not** add a new socket-only mutation flow for this fix.

### 2. Inject the gateway into the services that own state changes
The services that actually change business state should receive the existing realtime gateway and call it after success.

Use this mapping:

- **Checkout**
  - `placeOrder()` -> emit `order.placed`
  - target via `emitOrderEvent(locationId, orderId, ...)`

- **KDS**
  - `acceptOrder()` -> emit `order.accepted`
  - `updateOrderStatus()` -> emit:
    - `order.status_changed` for normal transitions
    - `order.cancelled` when new status is `CANCELLED`
  - `assignDriver()` -> emit:
    - `order.driver_assigned`
    - `driver.availability_changed` because driver status becomes `ON_DELIVERY`
  - `startDelivery()` -> emit `order.delivery_started`
  - `completeDelivery()` -> emit:
    - `order.status_changed` for `OUT_FOR_DELIVERY -> DELIVERED`
    - `driver.delivery_completed`
    - `driver.availability_changed` because driver becomes available again
  - `updateEta()` -> emit `order.eta_updated`
  - `requestRefund()` -> emit `refund.requested`

- **Chat**
  - `sendMessage()` -> emit `chat.message`
  - `markRead()` and any auto-read path -> emit `chat.read`, but **only if the read cursor actually moved**

- **Admin**
  - `decideCancellation()` -> emit:
    - `cancellation.decided`
    - and `order.cancelled` if decision is approval
  - `cancelOrder()` -> emit `order.cancelled`
  - `decideRefund()` -> emit `refund.requested` only if your product treats “admin approved/issued” as an admin-channel update worth pushing; otherwise keep refund-request emission only at request creation

- **Drivers**
  - `updateAvailability()` -> emit `driver.availability_changed`

### 3. Standardize event semantics before wiring
Use the event names already supported by the gateway and channel table.

Important decision:
- Use `cancellation.decided`
- Do **not** invent `cancellation.rejected` as a separate gateway event in this pass

That means:
- approval payload includes `decision = APPROVED`
- rejection payload includes `decision = REJECTED`

Also keep channel usage exactly as the gateway already expects:
- `orders:{locationId}` for store-side order stream
- `order:{orderId}` for customer order updates
- `chat:{orderId}` for order chat
- `admin:{locationId}` for admin workflow alerts
- `drivers:{locationId}` for driver picker/live driver state

### 4. Emit after success, outside the transaction boundary
Implementation rule:
- do the Prisma mutation first
- wait for the transaction to return
- then emit using the returned row data

Reason:
- if the transaction fails, no client should receive a false realtime update
- the payload should reflect the committed state

For read updates:
- only emit `chat.read` when the latest read cursor changed
- do not emit noisy duplicate read events on every fetch if nothing advanced

## Event Payload Rules

Keep payloads small and aligned to the API contract.

Minimum payload shape by event family:
- `order.placed`: `order_id`, `order_number`, `status`, `fulfillment_type`, `estimated_ready_at`
- `order.accepted` / `order.status_changed` / `order.cancelled`: `order_id`, `from_status`, `to_status`, `changed_by_user_id`
- `order.driver_assigned`: `order_id`, `driver_user_id`
- `order.delivery_started`: `order_id`, `driver_user_id`
- `order.eta_updated`: `order_id`, `estimated_travel_minutes`, `estimated_arrival_at`
- `chat.message`: `order_id`, `message_id`, `sender_surface`, `visibility`
- `chat.read`: `order_id`, `side`, `last_read_message_id`
- `cancellation.requested`: `order_id`, `request_id`, `request_source`
- `cancellation.decided`: `order_id`, `request_id`, `decision`
- `refund.requested`: `order_id`, `refund_request_id`, `amount_cents`
- `driver.availability_changed`: `driver_user_id`, `location_id`, `availability_status`
- `driver.delivery_completed`: `driver_user_id`, `order_id`, `location_id`

Let the gateway continue wrapping these with:
- `event_type`
- `payload`
- `timestamp`

## Test Plan

Add focused tests at the service level first.

Verify:
- checkout success emits `order.placed`
- KDS accept emits `order.accepted`
- KDS status update emits `order.status_changed`
- KDS cancel emits `order.cancelled`
- driver assignment emits both `order.driver_assigned` and `driver.availability_changed`
- start delivery emits `order.delivery_started`
- complete delivery emits `order.status_changed`, `driver.delivery_completed`, and `driver.availability_changed`
- chat send emits `chat.message`
- chat read emits `chat.read` only when cursor changes
- cancellation decision emits `cancellation.decided`
- refund request emits `refund.requested`
- manual driver availability update emits `driver.availability_changed`

Also verify negative cases:
- if DB mutation throws, no emit happens
- if chat read cursor stays the same, no duplicate `chat.read` emit happens

## Assumptions

- No new event bus or outbox is being introduced in this pass.
- Existing gateway/channel model is the correct foundation and should be reused.
- `cancellation.decided` is the canonical decision event; older `cancellation.rejected` wording should be treated as stale contract language and cleaned up later.
- HTTP remains the mutation path; WebSocket remains the push-notification path.
