# Resolve Customer Cancellation Flow Without Breaking the Schema

## Summary

Do **not** change the database to allow `request_source = CUSTOMER` for this issue.

For the behavior you chose, the correct fix is:

- `POST /orders/:id/cancel` becomes a **direct self-cancel** endpoint for the first 2 minutes only
- after the 2-minute window, the customer must go to **order chat/help**
- any reviewed cancellation request created from that later flow should continue using the existing DB values such as `KDS_CHAT_REQUEST`
- `orders.cancellation_source` should use the already-valid value `CUSTOMER_SELF` for direct customer self-cancel

That means this is mainly a **service/controller/checkout/test** fix, not a SQL/Prisma schema change.

## Key Changes

### 1. Fix the customer cancel endpoint to match the chosen behavior

Update [orders.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/orders/orders.service.ts) and [orders.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/orders/orders.controller.ts):

- Keep `POST /orders/:id/cancel` as the customer endpoint.
- Change it from “create `cancellation_requests` row” to “directly cancel the order” when `now() <= cancel_allowed_until`.
- Validate:
  - order exists
  - customer owns the order
  - order is not already terminal
  - current time is still inside the self-cancel window
- On success:
  - update `orders.status = CANCELLED`
  - set `orders.cancelled_at`
  - set `orders.cancelled_by_user_id = customer user id`
  - set `orders.cancellation_source = CUSTOMER_SELF`
  - set `orders.cancellation_reason` from the body if provided
  - create an `order_status_events` row for the cancellation
- On expired window:
  - do **not** create `cancellation_requests`
  - return a conflict-style error telling the client to use help/chat

Public API change:
- make `reason` optional on `POST /orders/:id/cancel`, since you want no required reason inside the first 2 minutes

### 2. Start writing `cancel_allowed_until` at checkout and return it in order payloads

Update [checkout.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/checkout/checkout.service.ts) and the order serializers in [orders.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/orders/orders.service.ts):

- At order creation, set `cancel_allowed_until = placed_at + 2 minutes`
- Include `cancel_allowed_until` in:
  - checkout response order payload
  - order list payload
  - order detail payload

This is required so the frontend can:
- show the cancel button during the 2-minute window
- hide it afterward
- replace it with help/chat

### 3. Keep the database and Prisma schema as-is for this issue

Do **not** change:
- [0001_wings4u_baseline_v1_4.sql](/d:/Projects/Websites/Wings4U/Code/db/sql/0001_wings4u_baseline_v1_4.sql)
- [schema.prisma](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/schema.prisma)

Reason:
- `orders.cancellation_source` already allows `CUSTOMER_SELF`
- `cancellation_requests.request_source` is still correct for reviewed KDS/chat-driven requests
- adding `CUSTOMER` there would lock in the wrong backend model for your chosen flow

### 4. Implement the post-window reviewed flow through chat/help, not `/orders/:id/cancel`

For the behavior after 2 minutes:

- the customer UI should open **order chat/help**
- the customer provides the reason there
- KDS or manager sees that request in the operational flow
- if staff escalates it into a formal cancellation request, that row should use `request_source = KDS_CHAT_REQUEST`

This means:
- no customer-created `cancellation_requests` row directly from `/orders/:id/cancel`
- the reviewed cancellation path stays a separate operational flow

If you want the docs to match exactly, update [Wings4U_API_Contract_v1_0.md](/d:/Projects/Websites/Wings4U/Code/Docs/API_Spec/Wings4U_API_Contract_v1_0.md) to clarify:
- direct self-cancel exists only inside the 2-minute window
- after that, customer must use help/chat
- reviewed requests coming from that path are represented as chat/KDS-originated cancellation requests

## Test Plan

Update [app.e2e-spec.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts) to cover:

- customer cancels inside the 2-minute window:
  - response succeeds
  - order becomes `CANCELLED`
  - `cancellation_source = CUSTOMER_SELF`
  - no `cancellation_requests` row is created
  - `order_status_events` includes the cancellation event
- customer cancels after the window:
  - endpoint returns conflict/error
  - order stays unchanged
  - no `cancellation_requests` row is created by this endpoint
- order payloads include `cancel_allowed_until`
- order owner can see the field and UI can derive cancel-vs-help behavior from it

## Assumptions

- Chosen behavior: direct self-cancel for 2 minutes, then help/chat flow afterward
- Default implementation for the post-window path: **order chat/help**, not support tickets
- `reason` is optional for self-cancel and should not block the first-window cancel flow
- This plan fixes the current issue without expanding the schema
- Separate cancellation cleanup still remains elsewhere in the backend for other invalid values like KDS-side cancellation literals, but that is not required to resolve this specific customer `requestSource = CUSTOMER` bug
