# KDS and Order Status Lifecycle PRD Alignment Issue

Last updated: 2026-04-11

## Quick Summary

This note records the KDS and order-status lifecycle plan for PRD section 7 alignment.

The important context is that the codebase has already moved beyond parts of the original plan text. Some of the requested work is already implemented in the current repo, while some PRD-alignment and test-coverage questions still remain open.

In plain English:

- the order lifecycle exists
- the KDS backend exists
- the KDS web screen exists
- auto-accept into preparing already exists
- some of the remaining work is now documentation, PRD-confirmation, and test-hardening rather than first-time feature creation

Related map file:

- [`map.md`](./map.md)

---

## Purpose

This note exists to do two things in one place:

1. preserve the exact requested plan wording
2. explain the current technical reality in the repo using the standard issue-note format

This is important because the pasted plan reads partly like a future implementation plan, but the current code already contains several of the proposed changes.

So this note separates:

- the requested plan text
- what the code already does
- what still appears to need follow-up

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What Was Found`
- `What Still Needs To Be Fixed`
- `Status`

If you want the full context, read the note top to bottom and then review the verbatim requested-plan section.

---

## Problem In Plain English

The overall issue is not that KDS or order status handling is missing.

The real issue is that the intended PRD lifecycle and the live implementation need to be reconciled carefully so the team does not document old gaps as if they are still unfixed.

There are three layers to this:

1. the backend lifecycle rules
2. the KDS staff-facing UI behavior
3. the customer-facing order-tracking behavior

The pasted plan assumes some of those parts are still missing. After checking the repo, that is only partly true.

Several lifecycle behaviors already exist in code today, including:

- `PLACED` order creation
- KDS accept flow
- auto-progress into `PREPARING`
- manual `READY`
- pickup completion
- delivery start and completion
- KDS ticket actions in the web UI
- realtime refresh in both KDS and customer order tracking

So the remaining problem is more precise:

- confirm the exact PRD wording for the edge cases
- keep the documentation honest about what is already done
- add or tighten the remaining test coverage and any transition cleanup still needed

---

## Technical Path / Files Involved

The main files involved in this issue are:

- [`schema.prisma`](../../../packages/database/prisma/schema.prisma)
- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)
- [`kds.controller.ts`](../../../apps/api/src/modules/kds/kds.controller.ts)
- [`checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)
- [`realtime.gateway.ts`](../../../apps/api/src/modules/realtime/realtime.gateway.ts)
- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)
- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)
- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`format.ts`](../../../apps/web/src/lib/format.ts)

These files cover:

- enum lifecycle states
- KDS API endpoints and guards
- accept / status / delivery backend logic
- order placement into `PLACED`
- websocket channel subscription model
- KDS UI actions and realtime refresh
- customer order-detail realtime refresh
- test coverage for the lifecycle surface

---

## Why This Mattered

This mattered because order lifecycle rules are product-critical.

If the implementation and the PRD drift apart, the team can easily make one of these mistakes:

- document a missing feature that is already implemented
- rely on a transition rule that is no longer true
- wire the KDS UI around outdated assumptions
- ship the wrong customer-facing status semantics
- miss important lifecycle regressions because the tests do not cover the real flow

This also matters operationally.

Kitchen flow, delivery handoff, no-show handling, cancellation, chat closure, and customer status updates all depend on the status graph being correct.

---

## What Was Found

### 1. The schema already contains the expected core status set

In:

- [`schema.prisma`](../../../packages/database/prisma/schema.prisma)

`OrderStatus` already includes:

- `PLACED`
- `ACCEPTED`
- `PREPARING`
- `READY`
- `OUT_FOR_DELIVERY`
- `PICKED_UP`
- `DELIVERED`
- `NO_SHOW_PICKUP`
- `NO_SHOW_DELIVERY`
- `CANCELLED`

So the enum itself is already aligned with the general pickup/delivery lifecycle described in the plan.

### 2. Checkout already creates orders in `PLACED`

In:

- [`checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)

order creation still persists `status: "PLACED"`.

So the lifecycle start state already matches the requested story.

### 3. The KDS backend already exists and is staff/admin-gated

In:

- [`kds.controller.ts`](../../../apps/api/src/modules/kds/kds.controller.ts)

the controller already exposes KDS routes for:

- list orders
- accept
- status changes
- cancel-request handling
- driver assignment
- start delivery
- complete delivery
- ETA
- refund requests

These routes are already protected by:

- `LocationScopeGuard`
- `@Roles("STAFF", "ADMIN")`

So this is not an unbuilt backend area.

### 4. Accept already auto-progresses to `PREPARING`

In:

- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

`acceptOrder()` no longer leaves the order persisted in `ACCEPTED`.

It now:

- updates the order status to `PREPARING`
- records a `PLACED -> ACCEPTED` status event
- records an `ACCEPTED -> PREPARING` status event
- emits `order.accepted`
- emits `order.status_changed`

So one of the main plan items is already implemented in code.

### 5. The transition graph has already been partially aligned

The current `ALLOWED_TRANSITIONS` in:

- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

is:

- `ACCEPTED -> PREPARING`
- `PREPARING -> READY`
- `READY -> PICKED_UP`
- `READY -> OUT_FOR_DELIVERY`
- `READY -> NO_SHOW_PICKUP`
- `OUT_FOR_DELIVERY -> DELIVERED`
- `OUT_FOR_DELIVERY -> NO_SHOW_DELIVERY`

This is important because it means the older concern in the pasted plan about suspicious no-show edges is already outdated in the current repo.

The current code already uses:

- `READY -> NO_SHOW_PICKUP`
- `OUT_FOR_DELIVERY -> NO_SHOW_DELIVERY`

which is much closer to the target PRD-style flow.

### 6. Terminal-status handling already closes chat

Also in:

- [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)

terminal statuses include:

- `DELIVERED`
- `PICKED_UP`
- `CANCELLED`
- `NO_SHOW_PICKUP`
- `NO_SHOW_DELIVERY`

and terminal transitions close the customer conversation through `chatService.closeConversation(orderId)`.

So that part of the lifecycle cleanup is also already present.

### 7. The KDS web UI is no longer read-only

In:

- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

the KDS page already supports live actions such as:

- `Accept`
- `Mark Ready`
- `Picked Up`
- `Assign Driver`
- `Start Delivery`
- `Mark Delivered`
- `No-Show`
- `Cancel`
- cancel-request approval or denial

So the plan text describing the KDS web UI as read-only is no longer accurate for the current code.

### 8. The KDS web UI already refreshes in realtime

Also in:

- [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)

the page already creates a socket connection, subscribes to `orders:${DEFAULT_LOCATION_ID}`, and refreshes on order and cancellation events.

This is backed by channel subscription support in:

- [`realtime.gateway.ts`](../../../apps/api/src/modules/realtime/realtime.gateway.ts)

So the live-board behavior already exists at a basic level.

### 9. Customer order tracking already listens to the relevant events

In:

- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)

the customer order-detail screen already refreshes on:

- `order.accepted`
- `order.status_changed`
- `order.cancelled`
- `order.driver_assigned`
- `order.delivery_started`
- `order.eta_updated`

So the customer-facing realtime story is already present.

### 10. Test coverage exists, but it does not yet prove the full lifecycle matrix

In:

- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

there is already KDS-related coverage for:

- KDS access control
- lifecycle-related chat closing on terminal status

But this file does not yet read like a complete end-to-end lifecycle matrix for:

- accept with auto-preparing audit behavior
- pickup no-show path
- delivery no-show path
- full delivery progression from `READY` to `OUT_FOR_DELIVERY` to `DELIVERED`

So test-hardening still looks like a valid remaining task.

---

## Exact Requested Plan Text

The following block preserves the exact wording that was requested for documentation:

```text
KDS and order status lifecycle (PRD §7 alignment)

What already exists (verified in code)





Schema — [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma): OrderStatus includes PLACED, ACCEPTED, PREPARING, READY, OUT_FOR_DELIVERY, PICKED_UP, DELIVERED, NO_SHOW_PICKUP, NO_SHOW_DELIVERY, CANCELLED (matches your pickup/delivery story at a high level).



KDS API — [apps/api/src/modules/kds/kds.service.ts](apps/api/src/modules/kds/kds.service.ts) + [kds.controller.ts](apps/api/src/modules/kds/kds.controller.ts): GET /kds/orders, POST .../accept, POST .../status, driver assign/start/complete delivery, ETA, cancel-request handling, refunds. Guarded by LocationScopeGuard + @Roles("STAFF", "ADMIN").



Accept flow today — acceptOrder() moves only PLACED → ACCEPTED and emits Socket.IO order.accepted. It does not move to PREPARING.



Manual steps — ALLOWED_TRANSITIONS enforces ACCEPTED → PREPARING, PREPARING → READY, READY → PICKED_UP (pickup) or READY → OUT_FOR_DELIVERY (delivery, but see delivery path below). CANCELLED is handled separately (reason required).



Delivery path — Separate methods: assignDriver, startDelivery (READY → OUT_FOR_DELIVERY), completeDelivery (OUT_FOR_DELIVERY → DELIVERED). Driver must be assigned before start.



Realtime → customer — [apps/web/src/app/orders/[orderId]/order-detail-client.tsx](apps/web/src/app/orders/[orderId]/order-detail-client.tsx) subscribes to order:${orderId} and refreshes on order.accepted, order.status_changed, order.cancelled, order.driver_assigned, order.delivery_started, order.eta_updated.



KDS web UI — [apps/web/src/app/kds/kds-client.tsx](apps/web/src/app/kds/kds-client.tsx) is read-only: lists tickets, no Accept / Prep / Ready / Complete actions, no Socket.IO refresh. Uses apiJson + DEFAULT_LOCATION_ID; KDS routes require STAFF/ADMIN session (cookie auth via [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts)).

Gaps vs your described lifecycle (and PRD §7.2)







Requirement (your message)



Current behavior





Customer places order → PLACED



Checkout sets PLACED ([checkout.service.ts](apps/api/src/modules/checkout/checkout.service.ts)).





KDS accepts → ACCEPTED; customer sees update



acceptOrder + order.accepted exists.





Automatically → PREPARING after accept



Not implemented — kitchen must call POST .../status with PREPARING today.





KDS sets → READY



Supported (PREPARING → READY).





Pickup finals: PICKED_UP, NO_SHOW_PICKUP, CANCELLED



READY → PICKED_UP exists. NO_SHOW path is suspicious: ALLOWED_TRANSITIONS has PICKED_UP → NO_SHOW_PICKUP (not READY → NO_SHOW_PICKUP). Confirm against PRD §7.2 — likely should be from READY (customer never collected).





Delivery: same until READY, then OUT_FOR_DELIVERY, DELIVERED, NO_SHOW_DELIVERY, CANCELLED



READY → OUT_FOR_DELIVERY via startDelivery; OUT_FOR_DELIVERY → DELIVERED via completeDelivery. NO_SHOW: current graph has DELIVERED → NO_SHOW_DELIVERY which contradicts typical “no-show” semantics; align with PRD (often OUT_FOR_DELIVERY → NO_SHOW_DELIVERY).





KDS “live” board



Needs realtime or polling + actions; today only manual Refresh.

flowchart LR
  subgraph pickup [Pickup]
    P1[PLACED] --> P2[ACCEPTED]
    P2 --> P3[PREPARING]
    P3 --> P4[READY]
    P4 --> P5[PICKED_UP]
    P4 --> P6[NO_SHOW_PICKUP]
    P4 --> P7[CANCELLED]
  end
  subgraph delivery [Delivery]
    D1[PLACED] --> D2[ACCEPTED]
    D2 --> D3[PREPARING]
    D3 --> D4[READY]
    D4 --> D5[OUT_FOR_DELIVERY]
    D5 --> D6[DELIVERED]
    D5 --> D7[NO_SHOW_DELIVERY]
    D4 --> D8[CANCELLED]
  end

(Diagram reflects target PRD-style flow; adjust NO_SHOW edges after confirming §7.2.)

Recommended implementation plan

1) Backend: auto ACCEPTED → PREPARING on accept (PRD §7.2)





In [kds.service.ts](apps/api/src/modules/kds/kds.service.ts) acceptOrder():





After validating PLACED, run a single transaction that:





Updates order to ACCEPTED (and acceptedAt) or skip lingering on ACCEPTED if product prefers a single hop — PRD asks for both “accepted” and “preparing”; recommended: two rows in order_status_events (PLACED→ACCEPTED, then ACCEPTED→PREPARING) and final row status PREPARING so the ticket is “in kitchen” immediately.



Emit realtime: keep order.accepted for the first hop; emit order.status_changed for ACCEPTED→PREPARING (customer detail page already listens).



Revisit ALLOWED_TRANSITIONS: if accept lands on PREPARING, remove redundant manual ACCEPTED→PREPARING unless you still want rare manual correction paths.

2) Backend: align NO_SHOW and CANCEL with PRD





Reconcile [ALLOWED_TRANSITIONS](apps/api/src/modules/kds/kds.service.ts) with PRD §7:





Pickup: add READY → NO_SHOW_PICKUP (if PRD says no-show before pickup completion); remove or repurpose PICKED_UP → NO_SHOW_PICKUP unless PRD explicitly defines a post-pickup correction.



Delivery: add OUT_FOR_DELIVERY → NO_SHOW_DELIVERY; remove DELIVERED → NO_SHOW_DELIVERY unless PRD defines a different meaning.



Ensure TERMINAL_STATUSES + chatService.closeConversation still run on the correct terminal transitions.



Add/adjust e2e tests in [apps/api/test/app.e2e-spec.ts](apps/api/test/app.e2e-spec.ts) for accept+auto-preparing and each terminal path.

3) KDS web app: functional “kitchen board”





Auth UX: Gate /kds to staff (e.g. redirect or message if not STAFF/ADMIN / KITCHEN as your session model allows). Reuse existing session helpers if present ([order-detail-client](apps/web/src/app/orders/[orderId]/order-detail-client.tsx) pattern with withSilentRefresh where needed).



Actions per ticket (call existing endpoints):





PLACED: Accept → triggers new accept flow (→ PREPARING).



PREPARING: Mark ready (PREPARING → READY).



Pickup READY: Picked up / No-show / Cancel (with reason modal for cancel).



Delivery READY: Assign driver (dropdown from GET /drivers/available if exposed to web) + Out for delivery (startDelivery), then driver or staff Delivered (completeDelivery), plus No-show / Cancel per aligned transitions.



Realtime: createOrdersSocket() + subscribe to location:{locationId} or per-order channels as [realtime.gateway.ts](apps/api/src/modules/realtime/realtime.gateway.ts) supports — or short-interval polling as MVP. On event, refresh list.



Layout: Columns or filters by status (PLACED | PREPARING | READY | OUT_FOR_DELIVERY) + terminal archive toggle optional.

4) Customer order tracking





After backend emits events for auto-preparing, verify [order-detail-client.tsx](apps/web/src/app/orders/[orderId]/order-detail-client.tsx) shows Accepted vs Preparing labels correctly — update [statusLabel](apps/web/src/lib/format.ts) / badge copy if PRD uses different customer-facing wording.



Optionally subscribe to order.status_changed only if duplicate refresh from order.accepted + order.status_changed is noisy (minor).

5) Documentation





Export a short internal lifecycle table (pickup vs delivery) into [Docs/session-code-changes.md](Docs/session-code-changes.md) or a dedicated doc — only if you want (per your preference to avoid unsolicited markdown).

Risk / open point





PRD §7.2 exact wording for NO_SHOW and whether ACCEPTED remains a persisted status or is only an event — the .docx was not machine-read here. Before locking transition rules, skim §7 in the PRD and confirm NO_SHOW source states and whether auto-preparing should still expose “Accepted” to the customer for a short time.
```

---

## What Still Needs To Be Fixed

Based on the current repo state, the remaining work now looks narrower than the original plan text suggests.

### 1. Confirm PRD section 7 wording against the live implementation

The biggest remaining documentation/product question is not whether a lifecycle exists.

It is whether the exact PRD wording still wants:

- `ACCEPTED` to exist as a visible customer-facing status
- or `ACCEPTED` to function mainly as an event while the order itself persists as `PREPARING`

The code currently follows the second model.

That may be correct, but it should be confirmed against PRD section 7.

### 2. Expand end-to-end lifecycle coverage

The repo still needs stronger e2e proof for:

- accept producing the two-hop audit trail
- pickup no-show
- delivery no-show
- driver-assignment and delivery progression
- terminal-state side effects

### 3. Decide whether the customer-facing labels need copy adjustment

If the PRD expects different customer wording than the raw enum labels, then:

- [`format.ts`](../../../apps/web/src/lib/format.ts)

may need follow-up copy mapping instead of only title-casing the enum name.

### 4. Verify whether `/kds` should use silent refresh for staff actions

The KDS client imports `withSilentRefresh`, but the file currently reads more like a direct session-gated page than a clearly wrapped refresh-on-401 flow.

That does not prove a bug.

It does mean this part should be checked explicitly if staff-session resilience is important in the KDS browser flow.

---

## Files Changed

For product code:

- no product code was changed in this documentation pass

For documentation:

- this issue note was added
- [`map.md`](./map.md) was updated

---

## Verification

### What was directly verified in code

- `OrderStatus` enum in [`schema.prisma`](../../../packages/database/prisma/schema.prisma)
- KDS controller endpoints and role protection in [`kds.controller.ts`](../../../apps/api/src/modules/kds/kds.controller.ts)
- accept / transition / delivery logic in [`kds.service.ts`](../../../apps/api/src/modules/kds/kds.service.ts)
- order placement state in [`checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)
- websocket subscription and order-channel emission in [`realtime.gateway.ts`](../../../apps/api/src/modules/realtime/realtime.gateway.ts)
- KDS actions and realtime subscriptions in [`kds-client.tsx`](../../../apps/web/src/app/kds/kds-client.tsx)
- customer order-detail event listeners in [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- existing e2e coverage in [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

### What was not verified in this pass

- PRD section 7 wording from the source document itself
- a full runtime walkthrough of every KDS transition in the browser
- a full e2e lifecycle matrix proving every transition path

### Honest verification summary

The main implementation claims in this note were checked against the current code.

The remaining open points are mostly PRD-confirmation and coverage-completeness questions, not blind guesses about whether the underlying lifecycle exists.

---

## Status

**Issue status:** partially open  
**Documentation status:** added  
**Plan text preserved verbatim:** yes  
**Code inspected against plan:** yes  
**Important correction found:** yes  
**Best current description:** the original plan is now only partly a future plan because several of its proposed changes are already implemented

---

## Plain-English Takeaway

This is no longer a case of "build the KDS lifecycle from scratch."

A lot of that work is already in the repo.

The real remaining job is to confirm the PRD semantics, tighten test coverage, and document the lifecycle in a way that matches the code as it exists today.

---

## Final Plain-English Summary

The requested KDS/order-lifecycle plan has now been documented in two layers:

- the exact original wording is preserved in this file
- the current code reality is explained around it

After checking the repo, the biggest correction is that several major items from the pasted plan are already done, especially:

- auto-accept into `PREPARING`
- corrected no-show transitions
- KDS ticket actions
- KDS realtime refresh
- customer realtime order updates

So this issue should now be treated as a PRD-alignment and verification note, not as a blank implementation plan.

---

## Final Follow-Up Issue That Arrived After The Initial Fix Note

After the first KDS lifecycle fix note was written, a smaller follow-up issue still remained.

This was no longer a broad "KDS is missing" problem.

It was a narrower alignment gap between:

- the helper functions already present in the repo
- the actual customer-facing order-detail UI
- the staff KDS session behavior
- and the e2e coverage that was supposed to prove the lifecycle flow

### What the new issue actually was

Three concrete gaps were still left:

1. pickup customers could still see generic `Ready` wording instead of `Ready for pickup`
2. the KDS client imported `withSilentRefresh` but did not actually use it for staff actions or ticket loading
3. the API e2e suite still did not prove the key lifecycle paths that had just been documented as important

So the new issue was not a missing status enum or missing KDS route.

The new issue was that a few important implementation details had not yet been carried all the way through to:

- the customer order detail page
- the KDS staff workflow
- and the regression-test layer

### Why this follow-up still mattered

This follow-up still had real product impact.

For customers:

- the pickup-ready state still read too generically
- the timeline and status badge did not fully reflect the pickup-specific wording the helper was meant to provide

For staff:

- a long-running KDS session could still hit `401` and fail without the silent-refresh recovery path that the codebase already used elsewhere

For engineering quality:

- the most important lifecycle guarantees were still under-tested
- the code could look correct in review while still lacking proof for accept audit events, no-show handling, and delivery progression

### Files most relevant to this follow-up

The main files tied to this smaller follow-up were:

- [`format.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/lib/format.ts)
- [`order-detail-client.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`kds-client.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/kds/kds-client.tsx)
- [`session.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/lib/session.tsx)
- [`api.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/lib/api.ts)
- [`app.e2e-spec.ts`](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts)

### What this follow-up issue covered

The remaining follow-up scope was:

- wire pickup `READY` through the customer order-detail badge and timeline using the existing helper path
- choose and implement the KDS session strategy for expired staff sessions
- expand the lifecycle e2e matrix to cover:
  - accept plus both audit hops
  - pickup no-show
  - delivery progression through driver assignment, out-for-delivery, and delivered

### What was intentionally out of scope for this follow-up

The follow-up did not try to machine-verify the PRD source text itself.

That wording question remained a product confirmation task, not a code task.

The optional `ACCEPTED` orphan-ticket case was also lower priority than the three concrete gaps above.

### Plain-English takeaway

The first KDS lifecycle fix got the big structure into place.

This follow-up issue existed because the last 10 percent still mattered:

- one customer-facing wording gap
- one staff-session resilience gap
- and one missing test-proof gap
