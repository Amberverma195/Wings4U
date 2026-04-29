# PRD Point 13,14,15 Fix

Last updated: 2026-04-13

## Requested Wording (verbatim)

Confirmed plan
Phase 1 — §15 Chat hardening (API + web audit)

Add ioredis dep; create RateLimiterService (sliding window, 5 msg/min/user/order, fail-open).
Enforce in ChatService.sendMessage.
E2E: side-based unread (staff-A read clears staff-B) + rate-limit 429.
Web: audit unread badge on order-chat.tsx + KDS card; wire if missing.
Phase 2 — §14 Reviews (API + web customer/admin)

ReviewsService + controller: create, list-by-order, admin reply, publish toggle.
Eligibility: order.status ∈ {PICKED_UP, DELIVERED}. Unique per order_item_id.
Web customer: Reviews tab under /orders/[id]. Admin: reviews panel with reply UI.
API contract doc + E2E.
Phase 3 — §13 Add Items After Ordering (API + web customer/admin)

Prisma migration: location_settings.add_items_auto_approve_enabled Boolean @default(false).
OrderChangesService: create / list / approve / reject + auto-approve branch + 3-min window.
Eligibility matrix: online card → PLACED only; cash/POS → PLACED/ACCEPTED/PREPARING within 3 min; store credit → WalletsService.debit(delta) inside tx, reject if insufficient.
Mandatory rejection reason (≥5 chars).
On approve: append order_items (+modifiers/flavours) w/ snapshots in a tx; recompute totals; realtime order.change_request.resolved.
Web customer: "Add Items" button on active order (visible only inside 3-min window). Admin: "Pending Add-Item Requests" queue with approve/reject modal.
API contract doc + E2E.

---
above are the phases to do the plan

below are the phases done

Phase 1 — complete. Summary:
Changed

Added ioredis to @wings4u/api deps.
New rate-limit.service.ts — sliding-window limiter, Redis-backed when REDIS_URL is set, in-process fallback otherwise. Fail-open on Redis errors.
New global rate-limit.module.ts, registered in app.module.ts.
chat.service.ts now enforces 5 msg / 60s per (orderId, senderUserId) → HTTP 429 with code: "RATE_LIMITED" and retry_after_seconds.
app.e2e-spec.ts — added two describe blocks:
Side-based unread: manager read + kitchen read share one chat_side_read_states row; customer read keeps its own.
Rate limit: 6th message in a burst returns 429; other users on the same order unaffected.
Verified

Type-check clean (tsc --noEmit for api).
Web surface audit: customer OrderChat already refetches on chat.message and server auto-advances CUSTOMER cursor on GET. 429 error surfaces through existing body.errors[0].message render path. No code change required on web for Phase 1

Phase 2 — complete.
API (backend)

reviews.service.ts — create / listByOrder / listAllForAdmin / adminReply / setPublish. Rating 1–5 integer validation. Eligibility gate (PICKED_UP/DELIVERED). Ownership check on create. Prisma P2002 → 409 on duplicate.
reviews.controller.ts — routes:
POST /orders/:orderId/order-items/:orderItemId/reviews (CUSTOMER)
GET /orders/:orderId/reviews (CUSTOMER / STAFF / ADMIN)
GET /admin/reviews?cursor&limit&has_reply (ADMIN + STAFF-MANAGER)
POST /admin/reviews/:id/reply (ADMIN + STAFF-MANAGER)
POST /admin/reviews/:id/publish (ADMIN + STAFF-MANAGER)
reviews.module.ts wired (was empty).
app.e2e-spec.ts — new Reviews (PRD §14) block: eligibility matrix (8 non-eligible statuses rejected), happy paths for PICKED_UP + DELIVERED, duplicate 409, rating-out-of-range 422, customer cross-access guard, admin reply round-trip, customer cannot hit admin endpoint (403), publish toggle, admin list with has_reply filter.
Web

New order-reviews.tsx — per-item star picker + optional text + shows admin reply when present. Renders only on eligible orders.
Mounted in order-detail-client.tsx below the chat section.
New admin page admin/reviews/page.tsx + reviews-client.tsx — paginated list, All / Needs reply / Replied filter, inline reply editor, publish/unpublish toggle per review

Postgres test DB isn't running locally, so E2E execution is gated on that. Typecheck for API + web is clean.

Phase 3 complete — PRD §13 Post-order Add Items
Backend

Migration 20260412220000_add_items_auto_approve/migration.sql + schema field LocationSettings.addItemsAutoApproveEnabled
order-changes.service.ts — 3-min window, payment-method matrix (online-card→PLACED only; cash/POS→PLACED/ACCEPTED/PREPARING; store-credit wallet debit inline on approve), auto-approve branch, mandatory ≥5-char rejection reason, atomic $transaction that appends order_items + modifiers + recomputes totals
order-changes.controller.ts — 5 routes with role guards (CUSTOMER for create/list; ADMIN+MANAGER for admin queue/approve/reject)
Wired into order-changes.module.ts; realtime events order.change_requested|approved|rejected added to realtime.gateway.ts:17
E2E — 9 tests added to app.e2e-spec.ts covering happy path, window expiry, payment matrix branches, approval+totals recompute, rejection reason validation, auto-approve, store-credit wallet debit, customer 403 on admin endpoint.

Web

Customer: order-add-items.tsx with live countdown timer, mounted on order-detail-client.tsx
Admin: order-changes-client.tsx pending queue with per-card approve/reject
Docs — new §5c in Wings4U_API_Contract_v1_0.md + realtime channel additions in §12

## Quick Summary

This fix note records the completed PRD section 13, section 14, and section 15 implementation pass.

In plain English, this work delivered:

1. chat hardening with side-based unread verification and message rate limiting
2. item-level reviews plus admin reply and publish controls
3. post-order add-item requests with approval workflow, timing rules, and payment handling

This file preserves your completion wording above and then restates the shipped work in the repo’s fixed-note structure below.

---

## Purpose

This note explains:

1. what changed for PRD section 13, section 14, and section 15
2. which backend, web, and docs surfaces were added or completed
3. why those changes matter for product correctness
4. what verification was reported for this pass

Related plan note:

- [`prd_point_13,14,15_PLAN.md`](./prd_point_13,14,15_PLAN.md#L1)

Related map file:

- [`map.md`](./map.md#L1)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What Changed`
- `Verification`
- `Final Conclusion`

If you want the detailed implementation record, read the phase sections in order.

---

## What The Issue Was

The schema and baseline contracts already implied three product areas:

- post-order item changes
- line-item reviews with admin replies
- side-based chat unread tracking

But the runtime surface was incomplete:

- section 15 needed hardening and proof
- section 14 had schema but no real API/UI
- section 13 had model groundwork but almost no actual workflow

So this was not a cleanup-only task.

It was a full implementation pass across API, web, docs, and tests.

---

## Why It Mattered

These sections sit after checkout, where operations and customer trust matter most.

Without them:

- chat could be spammed or unread state could drift between staff users
- customers could not review actual order lines
- admins could not reply in a structured product flow
- post-order add-item requests could not move through a real approval and pricing path

This work closes gaps in support workflow, review workflow, and live-order modification workflow.

---

## What Changed

## Phase 1: Section 15 chat hardening

### Backend

The API gained a dedicated rate limiter for chat traffic.

Reported changes:

- `ioredis` added to `@wings4u/api`
- new `rate-limit.service.ts`
- new `rate-limit.module.ts`
- module registered in `app.module.ts`
- `chat.service.ts` now enforces `5 messages / 60 seconds` per `(orderId, senderUserId)`

Behavior summary:

- Redis-backed when `REDIS_URL` is configured
- in-process fallback when Redis is not configured
- fail-open on Redis errors
- returns HTTP `429` with `code: "RATE_LIMITED"` and `retry_after_seconds`

### Tests

`app.e2e-spec.ts` gained coverage for:

- side-based unread behavior where one staff read clears unread for other staff users
- rate limiting where the 6th burst message is rejected but other users on the same order remain unaffected

### Web audit

The reported web audit found no required code change for phase 1:

- customer `OrderChat` already refetches on `chat.message`
- server-side GET already advances the customer cursor
- existing error rendering already surfaces the `429` body message

### Why phase 1 mattered

This phase hardens the canonical section 15 model instead of replacing it.

It gives:

- real abuse protection
- proof that unread is side-based for staff
- confidence that existing web error handling and refetch behavior already fit the API contract

---

## Phase 2: Section 14 reviews and admin replies

### API

The reviews backend was implemented end to end.

Reported changes:

- `reviews.service.ts`
  - `create`
  - `listByOrder`
  - `listAllForAdmin`
  - `adminReply`
  - `setPublish`
- integer rating validation `1–5`
- eligibility gate: only `PICKED_UP` and `DELIVERED`
- ownership check on create
- Prisma `P2002` mapped to `409` on duplicate review

### Routes

`reviews.controller.ts` now exposes:

- `POST /orders/:orderId/order-items/:orderItemId/reviews` for customers
- `GET /orders/:orderId/reviews` for customer, staff, and admin read paths
- `GET /admin/reviews?cursor&limit&has_reply` for admin and manager
- `POST /admin/reviews/:id/reply` for admin and manager
- `POST /admin/reviews/:id/publish` for admin and manager

`reviews.module.ts` was wired up from its previous empty state.

### Tests

`app.e2e-spec.ts` now covers:

- negative eligibility matrix across non-eligible statuses
- happy paths for `PICKED_UP` and `DELIVERED`
- duplicate review `409`
- rating out-of-range `422`
- customer cross-access guard
- admin reply round-trip
- customer forbidden from admin endpoints
- publish toggle
- admin list filtering by reply state

### Web

Customer-facing work:

- new `order-reviews.tsx`
- per-item stars plus optional text
- admin reply shown when present
- rendered only on eligible orders
- mounted in `order-detail-client.tsx` below chat

Admin-facing work:

- new `admin/reviews/page.tsx`
- new `reviews-client.tsx`
- paginated list
- `All / Needs reply / Replied` filter
- inline reply editor
- publish / unpublish toggle

### Publish-Toggle Authorization (Finding 4)

PRD §14.3 says reviews are **internal by default** and only become publicly visible when a privileged operator toggles `is_approved_public = true`. The implementation locks that toggle behind staff roles so customers and anonymous viewers cannot publish their own reviews:

| Endpoint | Who can call it |
|---|---|
| `POST /admin/reviews/:id/publish` | `ADMIN`, or `STAFF` with `employeeRole = MANAGER` |

Enforcement points:

- Controller: [`reviews.controller.ts`](../../../apps/api/src/modules/reviews/reviews.controller.ts) — the `setPublish` handler is decorated with `@Roles("ADMIN", { userRoles: ["STAFF"], employeeRoles: ["MANAGER"] })`, so Kitchen and Cashier staff are rejected with `403` even though they are authenticated staff.
- Service: [`reviews.service.ts`](../../../apps/api/src/modules/reviews/reviews.service.ts) — `setPublish` performs the DB update only; it does not re-check the caller, trusting the controller guard.
- Customer UI does **not** expose any control that calls this endpoint; only the admin reviews page at [`apps/web/src/app/admin/reviews/reviews-client.tsx`](../../../apps/web/src/app/admin/reviews/reviews-client.tsx) renders the toggle.

This is a deliberate product decision:

- authors cannot self-publish their own reviews
- a published review can later be un-published by the same role set
- the audit record is the `is_approved_public` flag itself plus standard `updatedAt`; no separate `published_by_user_id` column exists today (tracked as a future enhancement if we need reviewer attribution on the public feed).

### Why phase 2 mattered

This phase turns the review schema into a real product flow.

Customers can now review actual order lines instead of relying on a schema that existed only on paper, and admins/managers can respond through the app rather than external tooling.

---

## Phase 3: Section 13 add items after ordering

### Schema and migration

Reported changes:

- migration `20260412220000_add_items_auto_approve/migration.sql`
- new `LocationSettings.addItemsAutoApproveEnabled`

This provides the configuration hook for auto-approval behavior.

### Backend workflow

`order-changes.service.ts` now implements:

- create
- list
- approve
- reject
- auto-approve branch
- 3-minute window handling
- payment-method eligibility matrix
- mandatory rejection reason length `>= 5`
- atomic transaction for appending items and recomputing totals

Reported payment rules:

- online card -> `PLACED` only
- cash / POS -> `PLACED`, `ACCEPTED`, or `PREPARING` within 3 minutes
- store credit -> wallet debit during approve transaction, rejected if insufficient

On approval:

- new `order_items` are appended with snapshots
- modifiers are appended
- totals are recomputed in the same transaction

### Controller and realtime

`order-changes.controller.ts` now exposes five guarded routes with:

- `CUSTOMER` for create and list
- `ADMIN` plus `MANAGER` for queue, approve, and reject flows

`order-changes.module.ts` was wired up.

Realtime additions were reported in `realtime.gateway.ts`:

- `order.change_requested`
- `order.change_request.approved`
- `order.change_request.rejected`

### Tests

`app.e2e-spec.ts` now includes nine tests covering:

- happy path create and approve
- window expiry
- payment matrix branches
- totals recompute on approval
- rejection reason validation
- auto-approve
- store-credit wallet debit
- customer forbidden from admin endpoint

### Web

Customer-facing work:

- `order-add-items.tsx`
- live countdown timer
- mounted in `order-detail-client.tsx`

Admin-facing work:

- `order-changes-client.tsx`
- pending request queue
- approve / reject controls per card

### Docs

The API contract docs were extended:

- new section `5c` in `Wings4U_API_Contract_v1_0.md`
- realtime additions documented in section `12`

### Why phase 3 mattered

This is the biggest workflow in the set.

It turns the stored `order_change_requests` model into a functioning product path with:

- customer submission
- staff/admin resolution
- timing and payment rules
- atomic order mutation

That is the difference between “the schema hints at this feature” and “the feature actually exists.”

---

## Files / Areas Changed

Based on your completion summary, the main touched areas were:

- API dependencies and app module wiring
- chat rate-limiting files and `chat.service.ts`
- review service/controller/module files
- order-change service/controller/module files
- `order-detail-client.tsx`
- `order-reviews.tsx`
- admin reviews page/client
- customer add-items UI
- admin add-item-request queue UI
- `app.e2e-spec.ts`
- Prisma migration and schema for add-item auto-approve
- API contract docs and realtime documentation

This was a broad but coherent cross-stack implementation pass.

---

## Verification

Reported verification for this pass:

- API typecheck clean
- web typecheck clean
- phase 1 API `tsc --noEmit` clean
- web audit for section 15 found no required code changes

Reported environment gate:

- Postgres test DB is not running locally, so runtime E2E execution is still blocked in that environment

That means the honest verification statement is:

- implementation completed
- typecheck verified
- E2E scenarios written
- full runtime E2E execution still gated on test database availability

---

## Remaining Caveat

The only explicit caveat reported in your completion summary is the test-database gate for local E2E execution.

That does not reduce the implementation scope that landed.

It only limits runtime proof on the current machine until the Postgres test DB is available.

---

## Final Conclusion

This fix closes the PRD section 13, section 14, and section 15 implementation backlog in three layers:

- section 15 now has real chat rate limiting and stronger unread verification
- section 14 now has a real review and admin-reply product flow
- section 13 now has a working post-order add-items request workflow with approval, payment handling, and web/admin surfaces

That moves these sections from partial schema intent to actual product behavior.

---

## Plain-English Summary

The important result is that all three planned phases now exist as real features.

Customers get:

- safer chat behavior
- real line-item reviews
- the ability to request add-items after ordering when allowed

Staff and admins get:

- review reply tools
- add-item approval workflows
- clearer realtime signals

And the docs now reflect the API and realtime contract changes that shipped with those flows.

---

## Phase 4: Audit Findings Remediation (Gap Fixes)

After the initial implementation (Phases 1-3), a gap audit was conducted comparing `prd_point_13,14,15_PLAN.md` against actual source code. Nine findings were identified. This section documents their resolution.

### Validation Hardening (Findings 2, 7 & 9)

**Finding 2 — Server-side validation mirrors checkout checks:**

`OrderChangesService.approveChangeRequest` now performs three checkout-grade validation checks before appending lines:

1. **Builder guard** — rejects any `menuItem.builderType !== null` with `ADD_ITEMS_BUILDER_NOT_SUPPORTED` (also closes Finding 7).
2. **Fulfillment compatibility** — rejects DELIVERY/PICKUP-only items on a mismatched order with `ADD_ITEMS_FULFILLMENT_MISMATCH`.
3. **Schedule window** — timezone-aware check against `order.scheduledFor ?? order.placedAt`; emits `SCHEDULE_VIOLATION` (or `LUNCH_SPECIAL_SCHEDULE_CONFLICT` when every offender is lunch-only) with the same response shape checkout uses.

Shared helpers (`getLocationLocalDate`, `isLunchSpecialMenuItem`, `buildScheduleViolationBody`) mirror `checkout.service.ts`.

Files changed:
- [`order-changes.service.ts`](../../../apps/api/src/modules/order-changes/order-changes.service.ts) — lines 17-71 (helpers), lines 296-358 (validation block)
- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts) — three new §13 tests covering each rejection path

**Finding 7 — Builder support guard:** Resolved as part of Finding 2. The server rejects builder-type items instead of supporting them, matching the product decision that add-items only handles simple line items.

**Finding 9 — Strict input parsing:**

`parseRequestedItems()` now throws `BadRequestException` with index-specific error messages on:
- Non-object entries
- Missing or invalid `menu_item_id`
- `quantity < 1` or non-numeric quantity

Files changed:
- [`order-changes.service.ts`](../../../apps/api/src/modules/order-changes/order-changes.service.ts) — lines 705-738

### UX & Visibility (Findings 3 & 5)

**Finding 3 — Unread chat badge on orders list:**

- Backend: `ChatService.getUnreadCountsForOrders(orderIds, role)` — batches conversations + side read-states, then per-order counts messages since `lastReadAt` with side filters.
- Backend: `OrdersService.listOrders` now joins in `unread_chat_count` per order summary.
- Frontend type: `OrderSummary.unread_chat_count?: number`.
- Frontend UI: Red badge next to the order number with 99+ clamp and accessible `aria-label`.
- E2E: Asserts the field is present and grows after a manager posts an unread message.

Files changed:
- [`chat.service.ts`](../../../apps/api/src/modules/chat/chat.service.ts) — lines 201-247
- [`orders.service.ts`](../../../apps/api/src/modules/orders/orders.service.ts) — lines 205-213
- [`types.ts`](../../../apps/web/src/lib/types.ts) — `OrderSummary` type
- [`orders-list-client.tsx`](../../../apps/web/src/app/account/orders/orders-list-client.tsx) — lines 88-114

**Finding 5 — KDS pending change-request indicator:**

- Backend: `serializeKdsOrder` now includes `pending_change_request_count` from a `{ where: { status: "PENDING" } }` query on `orderChangeRequests`.
- Backend: `getKdsOrders` Prisma query includes `orderChangeRequests` in the relation join.
- Frontend: `KdsOrder` type extended with `pending_change_request_count: number`.
- Frontend: `KdsOrderCard` renders a purple **📋 Add-Items Pending** badge when count > 0.
- Frontend: KDS socket subscribes to `order.change_requested`, `order.change_approved`, `order.change_rejected` events for real-time refresh.

Files changed:
- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts) — lines 97-98, 129, 180-184
- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx) — lines 70, 669, 721-735, 1084-1087

### Accountability & Docs (Findings 4, 6 & 8)

**Finding 4 — Publish-toggle authorization documented:**

Added a subsection to Phase 2 (above) that captures:
- `POST /admin/reviews/:id/publish` is gated to `ADMIN` + `STAFF` with `employeeRole=MANAGER`. Kitchen/Cashier staff get 403.
- Enforcement anchor is the controller `@Roles(...)` decorator; the service trusts the guard.
- Customer UI does not expose the toggle.
- No separate `published_by_user_id` audit column today (tracked as future enhancement).

**Finding 6 — Audit trail for change requests:**

Both `approveChangeRequest()` and `rejectChangeRequest()` now create `orderStatusEvent` rows:
- Approve: `eventType: "CHANGE_REQUEST_APPROVED"`, `reasonText` includes request ID and delta cents.
- Reject: `eventType: "CHANGE_REQUEST_REJECTED"`, `reasonText` includes request ID and rejection reason.
- `fromStatus` and `toStatus` are set to the order's current status (the status itself doesn't change on approve/reject).

Files changed:
- [`order-changes.service.ts`](../../../apps/api/src/modules/order-changes/order-changes.service.ts) — lines 575-586 (approve), lines 641-652 (reject)

**Finding 8 — API Spec mirror synced:**

`Wings4U_API_Contract_v1_0.md` updated with:
- **Section 5b** — Reviews: POST create, GET list, GET admin feed with has_reply filter
- **Section 5c** — Post-Order Changes: POST change-requests, POST approve with side effects documented
- **Section 12** — Realtime channel table updated to include `order.change_requested`, `order.change_approved`, `order.change_rejected` on `orders:{location_id}`, `order:{order_id}`, and `admin:{location_id}` channels

Files changed:
- [`Wings4U_API_Contract_v1_0.md`](../../../Docs/API_Spec/Wings4U_API_Contract_v1_0.md) — lines 601-680 (5b/5c), lines 1199-1203 (section 12 channels)

### Status of All Findings

| ID | Finding | Status |
|---|---|---|
| 1 | Payment delta matrix (Card) | **Deferred** — Online payments not live. Tracked in [`future_fixes.md`](./future_fixes.md). |
| 2 | Add-Items Server Validation | ✅ Complete |
| 3 | Unread Chat Badge (Order List) | ✅ Complete |
| 4 | Review Publish Authorization | ✅ Documented |
| 5 | KDS Pending Change Indicators | ✅ Complete |
| 6 | Order Status Event Audit | ✅ Complete |
| 7 | Add-Items Builder Support | ✅ Resolved (rejected as unsupported) |
| 8 | API Spec Mirror Sync | ✅ Complete |
| 9 | Add-Items Malformed Input Check | ✅ Complete |
