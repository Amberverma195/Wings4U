# PRD Point 8,12 Fix

Last updated: 2026-04-12

## Quick Summary

This fix note records the completed PRD section 8 / section 12 follow-up work across cancellation correctness, customer Help UX, checkout hardening, and PIN audit visibility.

In plain English, this work finished four things:

1. cancellation requests now preserve chat-linked context and map the right cancellation source onto the order
2. customer self-cancel and approved cancel paths now create refund requests consistently when money is owed back
3. order detail now shows a proper Help flow with click-to-call support instead of only a dead-end message after the cancel window
4. checkout is now stricter about archived items, delivery postal zones, lead time, and wallet concurrency

The user-reported implementation status for all four phases was complete, and API/web typechecks were reported clean.

---

## Purpose

This note explains:

1. what the remaining PRD section 8 / section 12 issue was
2. what changed in the schema, API, web UI, and audit behavior
3. why those changes now align the repo more closely to the PRD
4. what verification was reported for this pass

Related plan note:

- [`prd_point_8,12_plan.md`](./prd_point_8,12_plan.md#L1)

Related map file:

- [`map.md`](./map.md#L1)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What changed`
- `Verification run`
- `Final conclusion`

If you want the detailed version, read each phase section in order.

---

## What The Issue Was

The repo was already partly aligned with PRD section 8 and section 12.

The unfinished part was the correctness layer around:

- cancellation source tracking
- chat-linked cancel requests
- refund-request creation on cancellations
- Help / Contact behavior after the self-cancel window
- archived-item, postal-zone, lead-time, and wallet-safety checks at checkout
- operator-facing PIN failure visibility

So this was not a “build from zero” task.

It was a hardening and completion pass on flows that already existed but still had PRD gaps.

---

## Why It Mattered

These gaps sat on the most sensitive parts of the order lifecycle:

- cancellation and refund handling
- customer support / help entry points
- checkout correctness
- money safety under concurrent wallet use
- operational audit visibility

If these paths are loose, the system may still work most of the time, but it stops matching the PRD where correctness matters most:

- analytics can misread why an order was cancelled
- refunds can be missed or duplicated
- customers can be told to “chat” without an actual Help / Contact fallback
- archived or invalid delivery requests can slip too far into checkout
- wallet credit can be overspent under race conditions

---

## What Changed

## Phase 1: Section 12 data model and cancellation correctness

### Schema and cancellation request model

The cancellation request model was extended so chat-linked cancellation requests can be represented directly.

Changes reported:

- `schema.prisma` now includes `chatThreadId` on `CancellationRequest`
- `CancellationRequest` now has an FK to `order_conversations`
- a migration was added:
  - `20260412120000_cancellation_request_chat_thread/migration.sql`

### Refund creation on cancelled orders

`RefundService.createForCancelledOrder` was added as the shared cancellation refund helper.

Reported behavior:

- idempotent creation
- calculates net captured payment from signed `order_payments`
- subtracts open or already-issued refund claims

This is the right shape for section 12.6 because it avoids blindly creating duplicate refund requests.

### Customer self-cancel

`OrdersService.customerCancel` was updated so:

- the cancellation reason is forced to the PRD-fixed string:
  - `Customer cancelled within window`
- the auto-refund hook runs from that path

That closes two section 12.1 / 12.6 gaps at once:

- reason-string correctness
- refund-request creation

### Admin approve/deny and direct cancel

`AdminService.decideCancellation` now maps the final `order.cancellation_source` from the underlying request source rather than flattening the result to `ADMIN`.

Reported mapping:

- `KDS_CHAT_REQUEST`
- `KDS_CANCEL_REQUEST`
- `ADMIN`

The same pass also added auto-refund behavior to:

- `AdminService.decideCancellation`
- `AdminService.cancelOrder`

That means approved request-driven cancels and direct admin cancels now both feed the same refund logic.

### KDS approve path and chat-linked cancel requests

`KdsService.handleCancelRequest` now:

- maps the cancellation source from `cancelRequest.requestSource`
- triggers the auto-refund hook on approve

That fixes the earlier problem where the KDS-approved path could lose the original request source.

The KDS flow also gained a dedicated chat-linked request path:

- `KdsService.requestChatCancellation`
- controller route:
  - `POST /kds/orders/:id/request-chat-cancellation`

Reported behavior:

- requires `conversation_id`
- creates the cancellation request as `KDS_CHAT_REQUEST`
- stores `chatThreadId`

### Module wiring

To support those shared refund hooks, the following modules were reported updated:

- `OrdersModule`
- `KdsModule`

Both now import `RefundModule`.

### Why phase 1 mattered

This phase fixed the highest-risk section 12 correctness problems:

- where the cancel came from
- whether chat-driven cancel requests are represented explicitly
- whether paid cancels reliably generate refund requests

Without this phase, the UI can look correct while the stored lifecycle and money follow-up stay wrong.

---

## Phase 2: Section 12 customer Help / Contact UX

### API order detail payload

`orders.service.ts` was reported updated so `getOrderDetail` now includes the location on the read path and serializes:

- `location_phone`
- `location_name`

That gives the web enough data to support section 12.2 without inventing a second lookup.

### Web order detail UI

Reported changes:

- `types.ts` now includes `location_phone` and `location_name` on `OrderDetail`
- `order-detail-client.tsx` now replaces the plain “self-cancel window closed” message with a Help button
- that Help button opens a modal with PRD-style Help copy
- the modal includes a `tel:` click-to-call link when the location has a phone number
- if no location phone is available, the UI falls back to a chat-directed note
- chat remains available directly below as before

### Why phase 2 mattered

This closes the customer-facing gap after the self-cancel window expires.

Before this, the user could be told that self-cancel was closed without getting the fuller Help / Contact path the PRD expects.

After this change, the user has:

- a clearer help explanation
- a direct call action when possible
- chat still available as a fallback

---

## Phase 3: Section 8 checkout hardening

This phase tightened checkout behavior in `checkout.service.ts`.

### Archived item rejection

Reported behavior:

- `menuItem.archivedAt` is now checked before `isAvailable`
- checkout returns an explicit `422` when an archived item is submitted

That is a better PRD match than relying only on `isAvailable`, because it makes archive state part of explicit purchasability precedence.

### Delivery postal-zone validation

Reported behavior:

- when `settings.allowed_postal_codes` is non-empty
- delivery postal code is normalized by stripping spaces and uppercasing
- checkout rejects addresses outside the allowed set
- the error points to `address_snapshot_json.postal_code`

This closes the delivery-zone gap called out in the planning note.

### Minimum lead-time enforcement

Reported behavior:

- when `scheduled_for` is supplied
- checkout requires `scheduled_for >= now + prep_time`
- prep time is busy-mode aware
- invalid requests return `422` on `scheduled_for`

This is important because lead time must be enforced server-side, not only by the web slot builder.

### Wallet row lock and atomic debit

Reported behavior inside the existing checkout transaction:

- a raw SQL `SELECT balance_cents ... FOR UPDATE` locks the wallet row
- balance is checked before debit
- insufficient funds return `422`
- after `order.create`, wallet is decremented
- a `CREDIT_USED` ledger row is written with `orderId`
- rollback on downstream failure restores the whole transaction

### Why that matters

This is the main concurrency-safety improvement in section 8.

Without a row lock or equivalent atomic pattern, two concurrent checkouts can both read the same pre-debit balance and overspend the wallet.

With the lock held through commit, that double-spend window is closed.

### Promo atomicity

The reported status for promo handling was:

- no promo-application code path exists in checkout today
- therefore there was nothing active to atomize in this phase
- this was documented as a no-op rather than being overstated as “fixed”

That is the correct honest status for this phase.

---

## Phase 4: Section 8 audit and QA follow-up

### PIN failure audit mirror

`delivery-pin.service.ts` was reported updated so the following PIN-related failure events now also write to `admin_audit_logs`:

- `PIN_FAIL`
- `PIN_FAIL_LOCK`
- `PIN_FAIL_LOCKED`
- `PIN_FAIL_EXPIRED`
- `PIN_BYPASS`

Reported action key pattern:

- `delivery_pin.*`

The note also makes the intended audit split clear:

- driver events remain the durable source of truth
- admin audit mirror improves ops visibility
- successful verification events are intentionally kept out of the admin feed

That is a sensible interpretation of the section 8 / section 7.8.5 audit requirement.

### QA matrix

A dedicated QA document was reported added at:

- `Docs/audits/prd-section-8-qa-matrix.md`

Reported contents:

- conformance table for each section 8 rule
- current code mapping
- highlighted remaining gaps
- explicit e2e plan

The user-reported remaining gaps inside that QA matrix were:

- promo atomicity
- seeded `defaultPrepTimeMinutes = 30`

That is useful because it keeps the note honest about what this pass did not try to overclaim.

---

## Files Reviewed / Files Changed

Based on the completed phase summary, the main touched areas were:

- `schema.prisma`
- `migrations/20260412120000_cancellation_request_chat_thread/migration.sql`
- `refund.service.ts`
- `orders.service.ts`
- `admin.service.ts`
- `kds.service.ts`
- `kds.controller.ts`
- `OrdersModule`
- `KdsModule`
- `types.ts`
- `order-detail-client.tsx`
- `checkout.service.ts`
- `delivery-pin.service.ts`
- `Docs/audits/prd-section-8-qa-matrix.md`

This was a broad but coherent pass: data model, lifecycle correctness, customer UX, checkout validation, and audit visibility all moved together.

---

## Verification Run

The reported verification state for this pass was:

- API typechecks clean after phase 1
- both API and web typechecks clean after phase 2
- API typechecks clean after phase 3
- API typechecks clean after phase 4

The phase summary did not report a full runtime e2e or concurrency test run here.

So the honest verification statement is:

- typecheck-verified
- implementation-complete per the reported phase checklist
- not described here as fully runtime-e2e-verified

---

## Remaining Caveats

The remaining caveats reported alongside this fix were:

- no live promo-application path exists in checkout today, so promo atomicity remains documented as a no-op rather than an implemented transactional path
- the QA matrix still highlights `defaultPrepTimeMinutes = 30` as a gap to review
- this note is based on the reported completed work summary and typecheck status, not on a separate fresh runtime verification pass in this documentation step

Those caveats do not negate the fix.

They define the honest edges of what this pass covered.

---

## Final Conclusion

This fix closes the major open PRD section 8 / section 12 gaps that were most important for correctness:

- cancellation requests now carry the right source and chat linkage
- refund requests are created consistently across the main cancellation paths
- the customer now gets a proper Help / Contact experience once self-cancel is no longer allowed
- checkout now rejects archived items, enforces postal and lead-time rules, and protects wallet balance under concurrency
- PIN failure events are now more visible to operations through admin audit mirroring

That moves the repo much closer to a PRD-aligned “safe and operationally trustworthy” state rather than just a “mostly working” state.

---

## Plain-English Summary

The important result is that the risky edges are now tighter.

Customers get:

- clearer Help behavior
- better cancel/refund follow-through

Operators get:

- better cancellation-source tracking
- better PIN failure visibility

Checkout gets:

- stricter validation
- safer wallet handling

And the documentation trail is now clearer about what was truly finished in the PRD section 8 / section 12 pass.

---

## Appended Leftover Fix

Last updated: 2026-04-12

This appendix records the later PRD section 8 / section 12 leftovers that were completed after the initial Phase 1-4 fix note.

### What was still missing

The remaining work was no longer broad feature work.

It was a cleanup pass on the final gaps:

- missing E2E coverage from the section 8 QA matrix
- cancel paths that still reached `CANCELLED` without closing order chat
- the archived-salad customization edge case in checkout
- duplicate auto-refund risk under concurrency
- prep-minute defaults that still reflected the older `20 / 15-20 / 30-30` baseline
- the opaque Jest global-setup failure when the E2E database was unavailable

### What changed in code

#### 1. Chat lifecycle is now closed on the remaining cancel paths

The missing `ChatService.closeConversation(orderId)` calls were added to:

- [`admin.service.ts`](../../../apps/api/src/modules/admin/admin.service.ts)
  - `decideCancellation(...)` approve path
  - `cancelOrder(...)`
- [`admin.module.ts`](../../../apps/api/src/modules/admin/admin.module.ts)
  - imports `ChatModule` so `AdminService` can inject `ChatService`
- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)
  - `handleCancelRequest(...)` approve path

This closes the lifecycle gap where customer/self-cancel and some terminal KDS paths already closed chat, but admin-approved or KDS-approved cancel requests could still leave the conversation open.

#### 2. Archived salad customization targets are now rejected explicitly

[`checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts) now mirrors the main menu-item archived check when a wing order carries `salad_customization.salad_menu_item_id`.

If the referenced salad item exists but `archivedAt` is set, checkout now returns an explicit validation error instead of treating that salad path as still purchasable.

The same explicit archived check was also added to [`cart.service.ts`](../../../apps/api/src/modules/cart/cart.service.ts) for both main items and salad customization targets so quote and checkout stay aligned.

#### 3. Auto-refund creation is now serialized per order

[`refund.service.ts`](../../../apps/api/src/modules/refunds/refund.service.ts) now runs `createForCancelledOrder(...)` inside a transaction that locks the `orders` row with `SELECT ... FOR UPDATE`.

That change keeps the helper idempotent under concurrent cancel/refund races:

- one caller computes remaining refundable balance first
- later callers see any already-open refund rows before deciding whether another row is needed

This was the smallest safe fix without adding a new uniqueness constraint or widening the refund schema in this pass.

#### 4. Prep-minute defaults were aligned to the PRD baseline

The defaults that were still on the older timing baseline were updated in:

- [`schema.prisma`](../../../packages/database/prisma/schema.prisma)
  - `defaultPrepTimeMinutes` default is now `30`
- [`seed.ts`](../../../packages/database/prisma/seed.ts)
  - full seed now writes pickup `30-40` and delivery `40-60`
  - existing-location refresh path now also updates those values
- [`catalog.service.ts`](../../../apps/api/src/modules/catalog/catalog.service.ts)
  - API fallback timing now matches the same baseline
- [`order-scheduling.ts`](../../../apps/web/src/lib/order-scheduling.ts)
  - web fallback scheduling config now matches the same pickup/delivery windows
- [`20260412201000_prd_prep_defaults_30/migration.sql`](../../../packages/database/prisma/migrations/20260412201000_prd_prep_defaults_30/migration.sql)
  - updates the schema default and refreshes rows still on the old seed values

This closes the mismatch where the PRD expected a 30-minute prep baseline but seed/fallback values still reflected the older settings.

#### 5. The missing QA-matrix E2E scenarios were written

[`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts) now includes coverage for:

- archived main menu item reject
- archived salad customization target reject
- postal-zone reject
- lead-time reject
- wallet concurrency / single debit under race
- KDS-approved cancel closes chat and preserves `KDS_CANCEL_REQUEST`
- admin-approved chat cancel closes chat, preserves `KDS_CHAT_REQUEST`, and creates one pending refund request

This is the practical closure of the earlier QA-matrix TODO list.

#### 6. The E2E bootstrap failure is now explicit instead of opaque

[`global-setup.ts`](../../../apps/api/test/global-setup.ts) now catches the database connection failure up front and throws a clearer error naming the exact Postgres target.

Before this, Jest surfaced an opaque `AggregateError`.

Now the failure clearly states that the suite needs a reachable Postgres instance from `apps/api/test/.env.test`, which is the real gate in environments where the DB is not running.

#### 7. The QA matrix note was updated

[`prd-section-8-qa-matrix.md`](../../../Docs/audits/prd-section-8-qa-matrix.md) was refreshed so the document now reflects:

- the landed E2E scenarios
- the aligned prep defaults
- the remaining deferred promo/admin-list work
- the explicit E2E database requirement

### Verification for the leftover pass

What was verified in this pass:

- `npm run build:api`
- `npm run build:web`

What was attempted but blocked by environment:

- `npm run test:e2e --workspace @wings4u/api -- --runInBand --testPathPattern app.e2e-spec.ts`

Current gate:

- Jest global setup cannot connect to Postgres at `localhost:5432/wings4u_test` from `apps/api/test/.env.test` in this environment.
- The failure message is now explicit in `global-setup.ts`.

### Remaining deferred work after this leftover pass

The items still intentionally deferred are the same ones called out in the leftover plan:

- promo application inside checkout, once the feature exists
- admin cancelled-orders / refund-request list endpoints and tables

### Final plain-English summary for the leftover pass

The important result of this appended pass is that the section 8 / section 12 work no longer has loose correctness edges around:

- chat staying open after cancel approval
- archived salads slipping through customization
- duplicate auto-refund rows under concurrency
- outdated prep defaults
- missing QA-matrix regression coverage

The only thing not proven end-to-end here is runtime execution of the Jest suite, because the local test database is unavailable in this environment. The code, migration, documentation, and clearer harness failure are all in place.
