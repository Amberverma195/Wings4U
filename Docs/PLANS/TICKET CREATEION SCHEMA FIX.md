# Expand Support Ticket Schema and Align the Support Module

## Summary

You chose a **real schema expansion** for support tickets, not just a service rename. The clean way to do that is:

- expand the SQL support vocabulary to match the richer support workflow you want
- add only **lean** admin-helpful schema additions now
- update Prisma, controller DTOs, service writes, and API docs together
- keep status vocabulary stable for now

Recommended default:
- expand `created_source` and `event_type`
- add a real `priority` field on tickets
- add `payload_json` on support events for future audit detail
- **do not** add full helpdesk fields like tags/SLA/assignment history yet

## Key Changes

### 1. Expand the support schema in SQL first

Update the canonical SQL in [0001_wings4u_baseline_v1_4.sql](/d:/Projects/Websites/Wings4U/Code/db/sql/0001_wings4u_baseline_v1_4.sql) (single baseline file; expansion is documented in the file header). For databases already deployed from an older baseline, apply equivalent `ALTER TABLE` statements manually or via your migration tool—do not re-run the full baseline on production.

Schema changes:
- `support_tickets.created_source`
  - change allowed values to: `CUSTOMER_APP`, `STAFF_PANEL`, `ADMIN_PANEL`, `AUTO_OVERDUE`
- `support_ticket_events.event_type`
  - change allowed values to: `CREATED`, `MESSAGE_ADDED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `RESOLUTION_SET`, `RESOLVED`, `REOPENED`, `NOTE_ADDED`, `ASSIGNED`
- `support_tickets.priority`
  - add `priority text NOT NULL DEFAULT 'NORMAL'`
  - allow: `LOW`, `NORMAL`, `HIGH`, `URGENT`
- `support_ticket_events.payload_json`
  - add `jsonb NOT NULL DEFAULT '{}'::jsonb`

Do **not** add more schema yet for:
- tags
- SLA timestamps
- assignment history
- triage buckets

Those are a separate phase if you still want a full helpdesk model later.

### 2. Keep these existing schema fields and actually use them

Do **not** invent new columns for data you already have. Start using the existing support schema properly:

- `support_tickets.order_id`
- `support_tickets.assigned_admin_user_id`
- `support_tickets.resolution_type`
- `support_ticket_messages.is_internal_note`
- `support_ticket_events.performed_by_user_id`
- `support_ticket_resolutions.*`

These already help admins if the API actually exposes them.

### 3. Update Prisma after the SQL change

Update [schema.prisma](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/schema.prisma) so it reflects:
- expanded `createdSource`
- expanded `eventType`
- new `priority`
- new `payloadJson`

Then:
- run Prisma pull/generate
- keep Prisma aligned to the new SQL, not the old service assumptions

## Service and API Changes

### 4. Fix the support controller/request shapes

Update [support.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/support/support.controller.ts) so the public contract matches the new support model:

- Create ticket request:
  - `order_id?`
  - `ticket_type`
  - `subject`
  - `description`
  - `created_source`
  - `priority?`
- Add message request:
  - `message_body`
  - `is_internal_note?`
- Resolve endpoint:
  - align to `POST /support/tickets/:id/resolutions`
  - not `:id/resolve`
- Status update:
  - keep using `OPEN`, `IN_REVIEW`, `WAITING_ON_CUSTOMER`, `RESOLVED`, `CLOSED`

Important default:
- do **not** add `IN_PROGRESS`
- keep the existing ticket status vocabulary stable for now

### 5. Fix the support service to write only schema-valid values

Update [support.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/support/support.service.ts):

- `createTicket()`
  - write `createdSource = CUSTOMER_APP` for customer-created tickets
  - persist `orderId` when supplied
  - persist `priority` with default `NORMAL`
  - create `support_ticket_events` row with `eventType = CREATED`
  - put any extra context into `payload_json`, not overloaded `note`
- `addMessage()`
  - write `messageBody`
  - write `isInternalNote`
  - create event `MESSAGE_ADDED`
  - put note metadata into `payload_json`
- `updateStatus()`
  - use `STATUS_CHANGED`
  - keep `from_value` / `to_value`
- `resolve()`
  - update `support_tickets.resolution_type`
  - create `support_ticket_resolutions` row
  - create `support_ticket_events` row with `RESOLVED`
  - use `payload_json` if you want resolution metadata beyond `to_value`

### 6. Improve admin-facing reads without more schema

For ticket detail/list responses, expose:
- `order_id`
- `created_source`
- `priority`
- `assigned_admin_user_id`
- `resolved_by_user_id`
- `resolution_type`
- `is_internal_note` on messages

Important behavior:
- internal notes should be visible to `STAFF` / `ADMIN`
- internal notes should **not** be returned to customers

## Migration and Verification

### 7. Apply the change in the right order

Implementation order:
1. Create SQL patch file for live DBs.
2. Fold the same change into the baseline SQL.
3. Apply patch to the real database.
4. Refresh Prisma schema and client.
5. Update controller/service code.
6. Update API docs.
7. Re-run support flows and drift check.

### 8. Tests and scenarios

Cover these cases in [app.e2e-spec.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts):

- customer creates a ticket with:
  - `order_id`
  - `ticket_type`
  - `created_source = CUSTOMER_APP`
  - `priority = NORMAL`
- staff/admin creates or manages a ticket with:
  - `created_source = STAFF_PANEL` or `ADMIN_PANEL`
- adding a public message creates `MESSAGE_ADDED`
- adding an internal note stores `is_internal_note = true`
- customer cannot see internal notes
- status update writes `STATUS_CHANGED`
- resolution writes:
  - `support_tickets.resolution_type`
  - `support_ticket_resolutions` row
  - `support_ticket_events.event_type = RESOLVED`
- drift check stays clean after SQL + Prisma changes

## Assumptions

- You want a richer support schema, not a contract-first minimal fix.
- Lean expansion only:
  - expand support source/event vocabulary
  - add `priority`
  - add `payload_json`
- Keep current ticket status vocabulary:
  - `OPEN`, `IN_REVIEW`, `WAITING_ON_CUSTOMER`, `RESOLVED`, `CLOSED`
- Do not add full helpdesk features yet.
- Existing DBs will be migrated through a new SQL patch file, not by editing only the baseline.
