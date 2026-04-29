# Wings4U PRD 7 And 11 KDS ETA Fixed

Last updated: 2026-04-12

## Quick Summary

This fix note records the later follow-up work that closed the remaining PRD section 7 / section 11 gaps after the main KDS and ETA implementation had already landed.

In plain English, this follow-up finished four things:

1. `Pending Review` is now visible on the KDS board for flagged PLACED orders
2. ETA delta changes on `PLACED` tickets now expire after the location-level auto-accept window instead of staying open forever
3. overdue delivery ticket creation now has direct regression coverage
4. cash-era no-show policy now blocks delivery for over-threshold customers while still allowing pickup

The backend and web builds both passed after this pass.

The added API e2e coverage was written, but the local e2e runner could not start because Jest global setup failed before the tests executed.

---

## Purpose

This note records:

1. what the remaining merged follow-up plan was
2. what changed in the API and web app
3. why the new behavior is now correct
4. what was verified directly and what was still blocked

Related plan file:

- [`wings4u-prd-7-and-11-kds-eta.plan.md`](../../../.cursor/plans/wings4u-prd-7-and-11-kds-eta.plan.md#L1)

Related map file:

- [`map.md`](./map.md#L1)

---

## What This Follow-Up Was Closing

The main PRD 7 / 11 implementation was already mostly in place.

This follow-up was specifically about the remaining gaps:

- the KDS board still needed to show `requires_manual_review`
- the ETA-delta rule for `PLACED` orders still needed to be limited to the auto-accept window
- the overdue-delivery worker needed explicit regression coverage
- no-show counting and delivery restriction needed to be completed for the current cash-only phase

So this was not a full reimplementation of PRD section 7 and section 11.

It was the final cleanup pass for the remaining operational gaps.

---

## What Changed

## 1. Shared no-show delivery policy

A new shared helper was added in:

- [`apps/api/src/modules/customers/no-show-policy.ts`](../../../apps/api/src/modules/customers/no-show-policy.ts)

This helper centralizes:

- the delivery-block rule
- the threshold comparison
- the stable API error shape
- the future prepayment placeholder note

The rule implemented in this pass is:

- block delivery only when `total_no_shows > prepayment_threshold_no_shows`
- still allow pickup
- do not change `prepayment_required` behavior in this milestone

That matches the merged follow-up plan for the current cash-only phase.

### Why this mattered

Before this, the no-show restriction logic was not consistently enforced across quote, checkout, and the customer-facing menu/order-settings flow.

After this change, the same rule is used everywhere.

---

## 2. Delivery restriction enforced in quote and checkout

The shared policy is now enforced in:

- [`apps/api/src/modules/cart/cart.service.ts`](../../../apps/api/src/modules/cart/cart.service.ts)
- [`apps/api/src/modules/checkout/checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)

### Cart quote

Authenticated `POST /cart/quote` requests now:

- read the customer no-show count
- compare it to the location threshold
- return a stable delivery-block error when the user is over threshold and asks for delivery

Anonymous quote requests still remain public and still work, because the route is intentionally public and there is no authenticated customer to evaluate.

### Checkout

Delivery checkout now uses the same shared assertion before order creation.

So even if a customer somehow bypasses the UI state, delivery checkout will still be blocked server-side.

### Optional auth on the public quote route

No new auth architecture was needed.

The existing auth guard already populates `req.user` on public routes when a valid session cookie exists, so:

- [`apps/api/src/modules/cart/cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)

now forwards `req.user?.userId` into quote calculation.

That completed the "optional auth on quote" requirement without changing the public-route model.

---

## 3. Menu payload now exposes delivery-block state

The menu API now includes customer/location restriction data in:

- [`apps/api/src/modules/catalog/catalog.service.ts`](../../../apps/api/src/modules/catalog/catalog.service.ts)

The `location` payload now carries:

- `prepayment_threshold_no_shows`
- `customer_total_no_shows`
- `delivery_blocked_due_to_no_shows`

### Why this mattered

Without that payload, the web could only discover the restriction after a quote or checkout failure.

After this change, the web can disable delivery early while still keeping the backend as the source of truth.

---

## 4. No-show transitions now increment customer counters

The KDS status-transition flow in:

- [`apps/api/src/modules/kds/kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

now increments `CustomerProfile.totalNoShows` when the order transitions to:

- `NO_SHOW_PICKUP`
- `NO_SHOW_DELIVERY`

This increment is done inside the same transaction as:

- the order status update
- the status-event write

### Why this mattered

The merged follow-up plan explicitly required the no-show counter update to happen atomically with the transition itself.

That is now true.

The code also keeps the current milestone boundary intact:

- no online-payment gateway added
- no forced `prepayment_required` mutation added
- payment-related schema/code remains untouched except for future-policy placeholders

---

## 5. KDS Pending Review is now visible

The KDS client in:

- [`apps/web/src/app/kds/kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

was updated so the board now understands:

- `requires_manual_review`
- `placed_at`
- `kds_auto_accept_seconds`

### Behavior now

When an order is:

- `PLACED`
- `requires_manual_review === true`

the ticket now shows a visible `Pending Review` badge.

The KDS board also now refreshes on realtime:

- `order.manual_review_required`

### Why this mattered

The backend already supported the flag and the realtime event.

The missing part was operational visibility on the board itself.

This pass completed that missing UI state.

---

## 6. PLACED ETA delta window now matches the PRD rule

The ETA delta rule was tightened in:

- [`apps/api/src/modules/kds/kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

`adjustEtaDelta(...)` now:

- loads `LocationSettings.kdsAutoAcceptSeconds`
- checks elapsed time since `placedAt` when the order is still `PLACED`
- returns `422` after the window expires

For non-terminal orders after `PLACED`, ETA delta behavior remains as it was.

### Matching KDS client behavior

The KDS client now mirrors that server rule:

- ETA delta buttons on `PLACED` tickets disable when the window closes
- helper text shows either the remaining seconds or the closed-window message

### Why this mattered

Before this change, the KDS UI could still offer ETA-delta buttons on stale `PLACED` orders even though the intended PRD behavior is a short arrival window only.

Now the server and client agree on the same windowed rule.

---

## 7. Overdue delivery worker regression coverage

The overdue-delivery worker already exposed a callable:

- `tick()`

in:

- [`apps/api/src/modules/kds/overdue-delivery.worker.ts`](../../../apps/api/src/modules/kds/overdue-delivery.worker.ts)

So the main remaining work was test coverage, not worker restructuring.

This pass added overdue-delivery coverage in:

- [`apps/api/test/app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

The new scenario:

- creates a delivery order
- advances it to `OUT_FOR_DELIVERY`
- forces it past the overdue threshold
- calls `OverdueDeliveryWorker.tick()`
- confirms only one `DELIVERY_OVERDUE` ticket is created even after repeated ticks

### Why this mattered

The worker already had dedupe logic.

The missing part was regression protection so later changes do not silently break that path.

---

## 8. Web delivery controls now disable early

The early-delivery-disable behavior was added to:

- [`apps/web/src/Wings4u/components/order-method-modal.tsx`](../../../apps/web/src/Wings4u/components/order-method-modal.tsx)
- [`apps/web/src/Wings4u/components/menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`apps/web/src/Wings4u/components/cart-order-settings.tsx`](../../../apps/web/src/Wings4u/components/cart-order-settings.tsx)
- [`apps/web/src/Wings4u/components/cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`apps/web/src/app/checkout/checkout-client.tsx`](../../../apps/web/src/app/checkout/checkout-client.tsx)

Shared client-side helper:

- [`apps/web/src/lib/delivery-restrictions.ts`](../../../apps/web/src/lib/delivery-restrictions.ts)

Shared type update:

- [`apps/web/src/lib/types.ts`](../../../apps/web/src/lib/types.ts)

Style support:

- [`apps/web/src/Wings4u/components/global-style.tsx`](../../../apps/web/src/Wings4u/components/global-style.tsx)

### What improved

The customer now sees the restriction before forcing delivery deeper into the flow:

- delivery can be disabled in the pre-menu order-method modal
- delivery can be disabled in menu/cart order-settings panels
- the cart and checkout pages can show the same restriction message and stop the next step early

This reduces confusion while still relying on the backend for final enforcement.

---

## Test Coverage Added

The API e2e file now includes follow-up coverage for:

- authenticated delivery quote blocked over threshold
- anonymous delivery quote still allowed
- delivery checkout blocked over threshold
- pickup checkout still allowed
- no-show transition increments `total_no_shows`
- stale `PLACED` ETA delta rejected after the auto-accept window
- overdue delivery worker creates only one overdue support ticket

Those additions live in:

- [`apps/api/test/app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

---

## Verification Run

What I verified directly:

- `npm run build:api` passed
- `npm run build:web` passed

What I attempted but could not complete:

- `npm run test:e2e --workspace @wings4u/api -- --runInBand --testPathPattern app.e2e-spec.ts`

That run failed before executing tests because Jest global setup failed in:

- [`apps/api/test/global-setup.ts`](../../../apps/api/test/global-setup.ts)

So the follow-up implementation is:

- build-verified
- test-file updated
- not runtime-e2e-verified in this pass because the test bootstrap failed before execution

---

## Final Conclusion

This follow-up completed the missing merged-plan work rather than changing the original architecture.

The important outcomes are:

- KDS operators can now see `Pending Review` tickets clearly
- PLACED ETA edits now obey the intended short arrival window
- overdue-delivery ticket creation has direct regression coverage
- no-show history now has a real operational effect in the current cash-only phase by blocking delivery only after the configured threshold is exceeded
- the web now exposes that restriction early instead of waiting for checkout failure

The remaining caveat is only the e2e environment bootstrap failure, not a web/API compile problem.
