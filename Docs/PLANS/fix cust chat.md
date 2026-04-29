# Fix Chat While Treating Manager/Admin the Same Only in UI

## Summary

Current repo truth:
- `ADMIN` and `MANAGER` are **not** the same backend role today.
- `ADMIN` is `users.role = ADMIN`
- `MANAGER` is `users.role = STAFF` plus `employee_profiles.role = MANAGER`

Chosen direction:
- keep backend roles distinct
- treat both as the same **UI/staff-side** concept
- fix chat so it matches the schema and contract without rewriting the whole auth model

That means:
- unread stays side-based: `CUSTOMER` vs `STAFF`
- message authors stay canonical in DB: `CUSTOMER`, `KDS`, `MANAGER`, `ADMIN`
- UI can render both `MANAGER` and `ADMIN` as the same visible label if you want

## Key Changes

### 1. Keep the role model as-is outside chat

Do **not** merge manager and admin across the app.

Keep:
- `ADMIN` as a top-level user role
- `MANAGER` as an employee role under `STAFF`

Reason:
- guards, schema, and contract already depend on this split
- app-wide merge would force broad auth, schema, and docs changes far beyond chat

### 2. Fix chat sender identity

Change chat so the client no longer sends `sender_side = CUSTOMER | STORE`.

Instead, the server should derive `sender_surface` from the authenticated actor:

- `CUSTOMER` user -> `CUSTOMER`
- `STAFF` with employee role `KITCHEN` -> `KDS`
- `STAFF` with employee role `MANAGER` -> `MANAGER`
- `ADMIN` user -> `ADMIN`

Chosen rule for other staff roles:
- `CASHIER` and `DRIVER` should **not** post order chat messages for now
- they can be blocked from sending, rather than inventing a fake sender surface not supported by schema

### 3. Fix unread tracking to use the canonical table

The current code writes only `chat_read_states`.

Change the design so:
- canonical unread source = `chat_side_read_states`
- optional helper/audit = `chat_read_states`

Rules:
- when a customer reads, advance `reader_side = CUSTOMER`
- when any staff or admin reads, advance `reader_side = STAFF`
- staff unread clears for all staff views when one staff member reads

If you still want per-user audit, also update `chat_read_states`, but it must not be treated as the unread source of truth.

### 4. Align the chat API shape to the contract

`GET /orders/:id/chat`
- return `sender_surface`, not `sender_side`
- include message `visibility`
- on read access, advance side-based unread cursor based on caller role

`POST /orders/:id/chat`
- request body should be message-focused, not actor-focused
- server determines the sender identity
- customer can send only `visibility = BOTH`
- staff/admin can send `BOTH` or `STAFF_ONLY`

`POST /orders/:id/chat/read`
- client should not send `CUSTOMER | STORE`
- server should infer side from the authenticated caller:
  - customer -> `CUSTOMER`
  - staff/admin -> `STAFF`

## Test Plan

Add or update tests for:

- customer sends message -> stored as `sender_surface = CUSTOMER`
- kitchen user sends message -> stored as `sender_surface = KDS`
- manager sends message -> stored as `sender_surface = MANAGER`
- admin sends message -> stored as `sender_surface = ADMIN`
- cashier/driver send attempt -> rejected
- customer cannot send `STAFF_ONLY`
- staff/admin can send `STAFF_ONLY`
- customer read updates `chat_side_read_states(CUSTOMER)`
- staff/admin read updates `chat_side_read_states(STAFF)`
- staff read by one staff user clears staff unread for the shared staff side
- optional `chat_read_states` may still be updated, but unread logic must not depend on it

## Assumptions

- “Manager and admin are the same thing” means **same in UI/staff experience**, not a full backend role merge
- kitchen chat messages should be represented as `KDS`
- cashier and driver are not order-chat senders for now
- the frontend may display both `MANAGER` and `ADMIN` as a common label like `Staff`, while the DB keeps the real sender surface for audit
