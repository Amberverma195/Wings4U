# KDS and Order Status Lifecycle PRD Alignment Fix

Last updated: 2026-04-11

## Quick Summary

This fix completed the main implementation-side work for the KDS lifecycle and staff kitchen board so the repo now matches the intended PRD-style pickup and delivery flow much more closely.

In plain English, the fix did four main things:

1. corrected the backend status-transition rules for no-show handling
2. made KDS accept move the order directly into `PREPARING` while still preserving the `ACCEPTED` audit trail
3. upgraded the KDS web screen into an actionable live board with modals, driver assignment, and realtime refresh
4. improved customer-facing status wording and driver-name data so the flow reads more naturally to both staff and customers

### Honest short status

The code changes are implemented and both workspace builds passed.

What I did not verify in this documentation pass was a full runtime lifecycle walkthrough or an expanded lifecycle e2e matrix. So this note can say the fix is implemented and build-verified, but not that every lifecycle branch was manually exercised end to end in this pass.

---

## Purpose

This note records:

1. what the original lifecycle-alignment issue was
2. what changed in the backend and frontend
3. what was directly verified
4. what caveats still remain

Related current issue note:

- [`kds-and-order-status-lifecycle-prd-alignment_issue.md`](./kds-and-order-status-lifecycle-prd-alignment_issue.md)

Related map file:

- [`map.md`](./map.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What Changed`
- `Verification Run`
- `Final Conclusion`

If you want the full technical path, read the note from `What the issue was` through `Remaining caveats`.

---

## What The Issue Was

The issue was not that the repo had no KDS or no order-status system.

The real problem was that the lifecycle needed to be tightened so the backend transitions, the KDS staff UI, and the customer-facing status experience all lined up more cleanly with the intended PRD section 7 flow.

Before this fix set, the core concerns were:

- no-show transitions needed to be aligned to the correct source states
- KDS accept behavior needed to move the order into kitchen-preparing flow automatically
- staff needed a real kitchen-board UI instead of relying on a weaker or less complete interaction path
- driver assignment needed usable names for the dropdown
- customer-facing order status copy needed to be more human-readable than raw enum casing

So the fix was about lifecycle coherence, not just one endpoint or one button.

---

## Why It Mattered

This mattered because KDS and order status are operational features, not cosmetic ones.

If the lifecycle is wrong, the effects cascade into:

- wrong staff actions being allowed at the wrong time
- confusing no-show and cancellation behavior
- weaker audit history
- customer order tracking that feels robotic or misleading
- a KDS board that does not actually support kitchen and delivery workflow properly

This also mattered for traceability.

The system already had status enums, events, sockets, and KDS routes. The missing step was making the behavior across those parts consistent and useful in practice.

---

## What Changed

## Backend KDS lifecycle changes

The main lifecycle logic was tightened in:

- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

### Transition graph alignment

`ALLOWED_TRANSITIONS` now follows the PRD-style no-show flow more closely:

- `READY -> NO_SHOW_PICKUP`
- `OUT_FOR_DELIVERY -> NO_SHOW_DELIVERY`

This removes the older invalid model where those no-show states were tied to later or incorrect source states.

The service also keeps fulfillment-specific validation so:

- `NO_SHOW_PICKUP` only works on pickup orders
- `NO_SHOW_DELIVERY` only works on delivery orders

That prevents cross-fulfillment misuse of the no-show endpoints.

### Accept now auto-progresses into kitchen work

`acceptOrder()` now performs the accept-to-preparing flow in one transaction.

The order itself is persisted as:

- `PREPARING`

but two audit rows are still written so the lifecycle history remains complete:

- `PLACED -> ACCEPTED`
- `ACCEPTED -> PREPARING`

This is important because it preserves both of these product needs at once:

- the kitchen ticket enters active preparation immediately
- the audit trail still shows that the order was accepted first

The service also emits two realtime events:

- `order.accepted`
- `order.status_changed`

That gives the customer detail page and staff surfaces enough signal to reflect both hops.

### Terminal-state closure behavior remains intact

Terminal statuses still close the order conversation through `chatService.closeConversation(orderId)`.

That means the lifecycle fix did not regress one of the important side effects already tied to completion, cancellation, and no-show resolution.

## Driver dropdown data improvement

The available-driver API was improved in:

- [`drivers.service.ts`](../../../apps/api/src/modules/drivers/drivers.service.ts)

The service now joins through:

- `employeeProfile`
- `user`

to return:

- `full_name`

for each available driver.

This matters because the KDS web driver-assignment modal now has human-readable staff-facing names instead of only technical identifiers.

## Customer-facing status wording

Customer-friendly status copy was improved in:

- [`format.ts`](../../../apps/web/src/lib/format.ts)

Instead of only title-casing enum names, the shared formatter now maps lifecycle states to clearer phrases such as:

- `Order placed`
- `Order accepted`
- `Preparing your order`
- `Out for delivery`
- `Order cancelled`

The file also now includes:

- `readyLabel()`

so pickup flows can show:

- `Ready for pickup`

instead of a generic `Ready` label where that wording matters.

## KDS web app rewrite

The staff-facing KDS surface was substantially upgraded in:

- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

### Board layout

The page now uses a four-column board:

- `New`
- `Preparing`
- `Ready`
- `Out for Delivery`

Each column has its own color and order count badge, which makes active ticket volume easier to scan at a glance.

### Staff actions by status

The KDS board now exposes action buttons directly on tickets.

For `PLACED`:

- `Accept`
- `Request Cancel`

For `PREPARING`:

- `Mark Ready`

For `READY` pickup tickets:

- `Picked Up`
- `No-Show`
- `Request Cancel`

For `READY` delivery tickets:

- `Assign Driver`
- `Start Delivery`
- `Request Cancel`

For `OUT_FOR_DELIVERY`:

- `Mark Delivered`
- `No-Show`

That means the KDS page is now a real working board rather than only a passive status list.

### Modal flows

The KDS client now includes dedicated modal flows for the more sensitive actions.

The cancel modal:

- requires a reason
- enforces a minimum reason length of 5 characters

The no-show modal:

- uses separate pickup and delivery confirmation wording

The driver-assignment modal:

- fetches available drivers from the API
- displays human-readable driver names
- submits assignment directly to the KDS flow

### Pending cancellation-request handling

Tickets with a pending cancellation request now show:

- a visible badge
- inline request details
- `Approve Cancel`
- `Deny`

That improves the manager/staff review flow without forcing a separate page transition.

### Realtime board refresh

The KDS client now subscribes to:

- `orders:${DEFAULT_LOCATION_ID}`

through the Socket.IO orders channel and refreshes on events including:

- `order.placed`
- `order.accepted`
- `order.status_changed`
- `order.cancelled`
- `order.driver_assigned`
- `order.delivery_started`
- `order.eta_updated`
- cancellation request events

So the board now behaves like a live operational surface instead of a manual-refresh-only list.

### Staff access gate

The page now checks the session and shows a clear access restriction message when the user is:

- not authenticated
- or not `STAFF` / `ADMIN`

That keeps the KDS UI aligned with the server-side role protection already enforced by the API.

---

## Files Reviewed / Files Changed

Primary API files reviewed or changed:

- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)
- [`drivers.service.ts`](../../../apps/api/src/modules/drivers/drivers.service.ts)

Primary web files reviewed or changed:

- [`format.ts`](../../../apps/web/src/lib/format.ts)
- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

Related behavior files reviewed:

- [`kds.controller.ts`](../../../apps/api/src/modules/kds/kds.controller.ts)
- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)

---

## Verification Run

### Directly verified

- Code inspection of the backend lifecycle logic in [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)
- Code inspection of the available-driver response shape in [`drivers.service.ts`](../../../apps/api/src/modules/drivers/drivers.service.ts)
- Code inspection of customer-facing status labels in [`format.ts`](../../../apps/web/src/lib/format.ts)
- Code inspection of the KDS board actions, modals, access gating, and realtime subscriptions in [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)
- Build verification of the API workspace
- Build verification of the web workspace

### Commands run

- `npm run build --workspace @wings4u/api`
- `npm run build --workspace @wings4u/web`

### What passed

- API build passed
- Web build passed

### What was not verified in this pass

- a full browser walkthrough of every KDS lifecycle action
- a dedicated API e2e run covering the complete lifecycle matrix
- PRD section 7 source wording from the original document itself

### Honest verification summary

This fix is code-verified and build-verified.

It is not yet documented here as fully runtime-proven across every lifecycle branch.

---

## Remaining Caveats

There are still a few honest caveats to keep on record.

### 1. Lifecycle e2e coverage still needs explicit confirmation

The code now reflects the intended lifecycle much better, but this note does not claim that a full end-to-end test matrix was executed in this pass.

That means acceptance, pickup no-show, delivery no-show, driver assignment, and delivery completion should still be covered explicitly if the team wants formal regression proof.

### 2. `ACCEPTED` is still more of an event/audit hop than a lingering persisted UI state

The order now persists as `PREPARING` immediately after accept.

That appears intentional and product-sensible, but it should still be checked against the exact PRD wording if the product team expects customers to visibly sit on an `Accepted` status before preparation begins.

### 3. The KDS client imports `withSilentRefresh`, but this note does not claim it is wired into KDS actions

The page clearly gates by session and role.

This note does not claim a fully reviewed staff-session silent-refresh strategy inside the KDS action flow.

---

## Final Conclusion

The KDS lifecycle fix brought the backend transitions, KDS UI, driver assignment data, and customer-facing labels into a much more coherent PRD-style flow.

The most important practical changes are:

- no-show transitions now come from the correct operational states
- accepting an order moves it straight into active preparation while keeping a full audit trail
- staff can now manage the kitchen flow from a real live board
- customers and staff both see cleaner lifecycle wording

This means the lifecycle story is no longer just documented as a plan. It is implemented in the main code paths and build-verified.

---

## Plain-English Summary

The KDS fix made the kitchen workflow act like a real order board instead of a partial status viewer.

Orders now move through the right states, staff can take the right actions at the right time, drivers show up with real names, and the status wording is clearer for customers. The code is in place and both app builds passed, but a full end-to-end lifecycle test run is still the remaining proof step.

---

## Final Follow-Up Fix That Closed The Remaining Alignment Gaps

After the main KDS lifecycle fix landed, one smaller follow-up batch was still left.

That follow-up is now implemented as well.

The remaining gaps were:

- the customer order-detail page still showed generic `Ready` wording instead of `Ready for pickup`
- the KDS client imported `withSilentRefresh` but did not actually use it
- the API e2e suite still did not prove accept audit hops, pickup no-show, or delivery progression

### What changed in this follow-up fix

#### 1. Customer-facing READY wording was fully wired

In:

- [`format.ts`](../../../apps/web/src/lib/format.ts)

a new helper was added:

- `orderStatusCustomerLabel(status, fulfillmentType)`

This wraps the existing `readyLabel()` logic so pickup-specific `READY` wording can be applied consistently from one place.

That helper is now used in:

- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)

for both:

- the main header status badge
- the status timeline

So pickup customers now see:

- `Ready for pickup`

instead of a generic `Ready` label in the order detail experience.

#### 2. KDS staff flows now actually use silent refresh

In:

- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

the KDS client now uses session-aware wrappers around API calls.

The follow-up introduced:

- a `kdsJson()` helper
- a session-aware `kdsAction()` helper

Both now run through:

- `withSilentRefresh()`

using the current session’s:

- `refresh`
- `clear`

That behavior now covers:

- KDS order-list loading
- KDS ticket actions
- available-driver loading inside the driver modal

So the KDS board can now recover from expired staff sessions instead of only failing on `401`.

#### 3. Lifecycle e2e coverage was expanded

In:

- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

the follow-up added a reusable helper:

- `createCheckoutOrder()`

and a new lifecycle test block covering:

- accept on a `PLACED` pickup order, including proof that the order persists as `PREPARING` and writes both audit events
- pickup `READY -> NO_SHOW_PICKUP`, including proof that chat is closed afterward
- delivery progression through:
  - driver assignment
  - `OUT_FOR_DELIVERY`
  - `DELIVERED`
  - driver availability reset

This closes the most important regression-proof gap identified after the earlier KDS fix note.

### Files changed in this follow-up

Primary web files:

- [`format.ts`](../../../apps/web/src/lib/format.ts)
- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

Primary API test file:

- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

### Verification for this follow-up

#### Directly verified

- Code inspection of the new customer-status label helper and order-detail wiring
- Code inspection of the KDS silent-refresh wiring
- Code inspection of the new lifecycle e2e cases
- Build verification of the API workspace
- Build verification of the web workspace

#### Commands run

- `npx tsc --noEmit` in `apps/web`
- `npm run build --workspace @wings4u/web`
- `npm run build --workspace @wings4u/api`
- `npm run test:e2e --workspace @wings4u/api`

#### What passed

- API build passed
- Web build passed

#### What did not fully pass in this environment

`npx tsc --noEmit` in `apps/web` did not complete cleanly because the local `tsconfig.json` includes generated `.next` / `.next-wings4u` type paths that were missing in this environment at the time of the run.

`npm run test:e2e --workspace @wings4u/api` still did not complete because Jest global setup could not complete the local test-database bootstrap in this environment.

#### Honest follow-up summary

This follow-up fix is implemented and build-verified.

The remaining missing proof is still environment-level:

- a clean standalone web `tsc --noEmit` run under the current Next type-generation setup
- a fully working API e2e database environment so the new lifecycle tests can execute end to end

### Final takeaway for this follow-up

The earlier KDS fix covered the large lifecycle and board behavior changes.

This final follow-up closed the smaller but important remaining gaps:

- pickup-ready wording now reaches the customer UI
- KDS now actually uses silent refresh instead of only importing it
- the lifecycle test suite now contains the missing high-value scenarios, even though the environment here still blocked the full e2e run
