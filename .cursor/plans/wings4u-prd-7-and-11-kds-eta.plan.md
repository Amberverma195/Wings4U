---
name: Wings4U PRD §7 §8 §11 §12
overview: "PRD alignment for Docs/Wings4U_PRD_v3_5_v24_FIXED.docx — §7 Order/KDS, §8 Validation & edge cases, §11 ETA & prep, §12 Cancel/Help/Refund. Includes gap analysis and backlog for leftovers."
todos:
  - id: schema-flags
    content: "Wire existing orders.requires_manual_review + heartbeat + Pending Review banner per §11.1B"
  - id: auto-accept-11-1b
    content: "Server auto-accept with SYSTEM_AUTO_ACCEPT events; gate by KDS heartbeat (no accept + manual review if offline at timeout)"
  - id: kds-eta-window
    content: "§11.1 + §7.5 — 10s new-order ETA adjustment window on KDS; global default slots admin-editable"
  - id: busy-mode-11-2
    content: "§11.2 Busy mode — KDS header + admin toggle, +X min ETA, indicator; log start/end for admin history"
  - id: per-order-eta-11-3
    content: "§11.3 KDS +5/+10/+15/-5 min; order_eta_events; customer updates <3s"
  - id: customer-eta-11-4
    content: "§11.4 Checkout + order detail ETA copy (ranges and ready-by formats)"
  - id: prd-section-7
    content: "§7.1–7.8.8 — My Orders, lifecycle, labels, KDS layout, rejection, no-show, drivers, PIN, overdue grace 10m, tickets"
  - id: prd-section-8
    content: "§8 — Enforce full menu precedence (deleted/archived/is_active), checkout promo + wallet locking, PIN_FAIL audit, student discount ops"
  - id: prd-section-12
    content: "§12 — Help+Contact UI, KDS_CHAT_REQUEST + chat_thread_id, fix cancellation_source on approve, auto refund_request on paid cancels, admin Cancelled Orders + Refund Requests lists"
---

# Wings4U PRD §7 & §11 — plan (sourced from `Docs/Wings4U_PRD_v3_5_v24_FIXED.docx`)

**PRD location:** [Docs/Wings4U_PRD_v3_5_v24_FIXED.docx](Docs/Wings4U_PRD_v3_5_v24_FIXED.docx) (confirmed in repo).

Temporary extraction files (`Docs/_prd_*.txt/xml`) used for analysis can be deleted after review.

---

## §7 — Order Tracking, Status Lifecycle & KDS (exact scope from PRD)

| § | PRD title / focus | Implementation notes |
|---|-------------------|----------------------|
| **7.1** | **My Orders** (logged-in): Active / Past tabs | Web account orders UI + API list filters |
| **7.2** | **Full lifecycle** — pickup & delivery state machines; **permission vs state machine** (who can cancel) | Align API guards with PRD roles: customer 2-min cancel; KDS requests; Admin finalizes; **KITCHEN cannot direct-cancel to terminal** |
| **7.3** | **Customer-facing status labels** | [apps/web/src/lib/format.ts](apps/web/src/lib/format.ts) maps (PLACED → “Order placed”, etc.) |
| **7.4** | **Order summary card** + **Reorder** rules | Revalidate items/modifiers; diff banner; no silent drops |
| **7.5** | **KDS ticket layout & controls** — permission matrix KITCHEN/MANAGER; **ETA display with 10-second adjustment window on new order (see §11)**; print; **Cancel is request flow, not direct button** (aligned with §11 review) | [kds-client.tsx](apps/web/src/app/kds/kds-client.tsx) vs PRD tables (Accept vs Set Preparing — repo may use PREPARING-first accept; reconcile labels) |
| **7.5.1** | **KDS reject / request cancel** at PLACED or ACCEPTED — modal, PENDING request, admin approval | Already partially implemented; align copy (“Request Cancel” vs “Reject”) |
| **7.6** | **No-show modals** pickup & delivery | Confirmation copy + audit |
| **7.7** | **No-show counters & prepayment gate** (threshold 3, `prepayment_required`) | Checkout gating + KDS badges |
| **7.8** | **Driver management & assignment** | KDS assign, travel minutes, start/complete |
| **7.8.1–7.8.7** | Driver admin fields, availability states, assignment UI, customer driver details, **PIN flow**, no-show delivery, reassignment, driver history | PIN generation, expiry, lockout, bypass, regenerate, `PIN_FAIL` audit rows per PRD |
| **7.8.8** | **Overdue delivery** — customer “almost there” copy; **auto support ticket** if `estimated_arrival_at + grace (default 10 min)` passed; dedupe one ticket per order | Match **10 min** grace; background job; Section 25 ticket types |

---

## §11 — ETA & Prep Time System

### §11.1 Global default prep slots (admin-editable)

- Pickup default range **30–40 min**, delivery **40–60 min** (examples in PRD — align with `LocationSettings` defaults/seeds).
- **Busy mode:** +X min on top when ON.
- **New order ETA adjustment window: 10 seconds** — grace for kitchen to tweak ETA on arrival (ties to §7.5 KDS).
- Changes apply to **new** orders only.

### §11.1B New order arrival — configurable auto-accept window

PRD requirements:

- **Audible alert** on new order (unmissable).
- **`kds_auto_accept_seconds`** per location (`location_settings`).
- **If KDS offline or heartbeat lapsed:** **do not** auto-accept; order stays **PLACED**; set **`requires_manual_review = true`** on `orders`; **Pending Review** banner on admin + online KDS; cleared only on human accept/reject (not dismiss-only).
- **During countdown:** staff may **Accept at default ETA** or **adjust ETA** then accept.
- **After timeout with no action:** **auto-accept at default ETA**.
- **Audit:** `order_status_events` with **`source = SYSTEM`**, **`action_source = SYSTEM_AUTO_ACCEPT`** (PRD wording).

**Resolved:** At timeout, **auto-accept only when KDS heartbeat is healthy**; if offline / heartbeat lapsed at timeout → **no** auto-accept, keep **PLACED** and set **`requires_manual_review`** (PRD §11.1B). Human accept/reject clears the flag.

### §11.2 Busy mode

- When ON: +X min to ETA for **new** orders; **Busy** in KDS header; customer UI shows updated ETA; existing orders unchanged.
- **Toggle:** KDS header **and** admin panel (PRD acceptance criteria).
- **Admin “busy mode toggles” history (your ask):** extend with **append-only events** — started_at, ended_at, actor_user_id (and optional prep snapshot). PRD acceptance does not name this table but it satisfies operational audit.

### §11.3 Per-order ETA adjustments (KDS)

- Buttons **+5 / +10 / +15 / −5** min on live orders.
- Customer order detail updates **within 3 seconds** (socket or poll).
- Every change logged in **`order_eta_events`** (who, when, old → new). Status unchanged.

### §11.4 ETA display — customer UI

- Checkout: current default ETA slot (busy-adjusted if active).
- Order detail: live ETA as KDS adjusts.
- Formats: e.g. “Ready in approx. 30–40 minutes” or “Ready by 6:45 PM”.

---

## Codebase gaps (unchanged from prior analysis)

- **`requires_manual_review`** — already on [`Order`](packages/database/prisma/schema.prisma) (`requiresManualReview`); **wire** §11.1B logic + UI (§11.1B).
- **KDS heartbeat** — new endpoint + store last-seen per device/session; worker checks before auto-accept.
- **Auto-accept** — server-side job/queue; **SYSTEM_AUTO_ACCEPT** events.
- **Delivery PIN** — wire `delivery_pin_verifications`; `complete-delivery` body; customer display; regenerate + bypass (§7.8.5).
- **§11.3** — KDS buttons vs current ETA API shape ([kds.service.ts](apps/api/src/modules/kds/kds.service.ts) `updateEta` may need discrete deltas vs free minutes).
- **Admin UI** — settings for ETA windows, `kds_auto_accept_seconds`, busy mode, busy history; largely placeholder [admin/page.tsx](apps/web/src/app/admin/page.tsx).

---

## Suggested implementation order

1. Schema: `requires_manual_review` + heartbeat storage; migration/seed defaults (**10 min** overdue grace per §7.8.8).
2. §11.1B: alerts + countdown + auto-accept + manual-review path + SYSTEM audit.
3. §11.1: 10s ETA tweak window on new tickets (KDS).
4. §11.2: busy mode toggle surfaces + history table + admin list.
5. §11.3 / §11.4: KDS delta buttons, logging, customer formatting.
6. §7 remainder: PIN end-to-end, overdue ticket job, reorder rules, permission matrix audit.

---

## Testing

- E2E: heartbeat healthy → timeout auto-accept; heartbeat dead → no accept + flag; manual accept clears flag.
- ETA: order_eta_events rows; customer refresh <3s.
- PIN: match, fail x5 lockout, bypass, regenerate.

---

## PRD §8 — Validation rules & edge cases (gap analysis)

**PRD text (summary):** Menu purchasability follows strict **precedence**: `deleted_at` → `is_active` → `is_available` → `menu_item_schedules` → `fulfillment_type` → else OK. **Checkout** must revalidate (server-side): item availability (same rules), modifiers, flavours/saucing, **promo eligibility**, scheduling/lead time, **prepayment gate**, **delivery zone** (`allowed_postal_codes`), **minimum subtotal**. On failure: **clear errors**, never silent drops. **Idempotency** must wrap wallet promo and payment side effects; wallet needs **row-level locking**; promo `usage_count` atomic with limit check. Additional rules: duplicate prevention via idempotency, student discount checkbox (pickup), cashiers verify later, terminal status lock, driver UI rules, coupon stacking, credit floor at $0, etc.

### Already implemented (evidence in repo)

| PRD theme | Where / notes |
|-----------|----------------|
| Idempotency key required on checkout | [`checkout.controller.ts`](apps/api/src/modules/checkout/checkout.controller.ts) + replay of existing order |
| Item `is_available`, fulfillment type, schedule windows, special instructions | [`checkout.service.ts`](apps/api/src/modules/checkout/checkout.service.ts) (loops + violations) |
| Modifier options loaded with `isActive: true` | Same file |
| Delivery minimum subtotal | Same (`minimumDeliverySubtotalCents`) |
| Delivery eligibility / no-show prepayment policy | `getDeliveryEligibilityForCustomer` + `assertCustomerMayUseDelivery` |
| Student discount requested flag on order | Order create + serialization |
| Reorder revalidation (not blind clone) | [`orders.service.ts`](apps/api/src/modules/orders/orders.service.ts) `reorder()` |
| Customer self-cancel window | `cancelAllowedUntil` = now+2m at create; [`orders.service.ts`](apps/api/src/modules/orders/orders.service.ts) `customerCancel` |

### Gaps / partial (backlog)

1. **Precedence 1–2 (soft-delete / inactive)** — Checkout validates `is_available` but does **not** clearly enforce **`archivedAt` / `deleted_at`** and **`isActive`** on `menu_items` the way §8 orders (items not sold if inactive/archived). **Plan:** In `placeOrder`, reject lines where `menuItem.archivedAt != null` or `menuItem.isActive === false` with structured errors (mirror catalog filtering rules).
2. **Promo eligibility at checkout** — §8 lists promo revalidation at checkout. **Plan:** Trace cart/quote → checkout path; ensure **promo codes** are re-checked at `placeOrder` (valid, not expired, limits, fulfillment). If promos are quote-only today, add **server-side** promo application block in the same transaction as pricing.
3. **Wallet concurrency** — §8 requires **SELECT FOR UPDATE** (or equivalent) on wallet rows when applying credit. **Plan:** Audit [`WalletsService`](apps/api/src/modules/wallets/wallets.service.ts) / checkout pricing transaction; add pessimistic lock if missing.
4. **Promo usage atomicity** — Increment + limit check in **one** transaction with order creation. **Plan:** Verify promo redemption path; add tests for double-submit with same idempotency vs different keys.
5. **Postal / delivery zone** — Confirm `address_snapshot_json` is validated against `location_settings.allowed_postal_codes` at checkout (add explicit check if only client-side today).
6. **Lead time (30 min)** — PRD table says minimum lead time 30 min for schedule picker. **Plan:** Align [`LocationSettings`](packages/database/prisma/schema.prisma) defaults and time-slot builders in web (`defaultPickupMinMinutes` etc.) with PRD examples (30–40 pickup, 40–60 delivery) and enforce **no slot before now+30m** where PRD requires it.
7. **PIN_FAIL admin_audit_logs** — §7.8.5 (cross-cutting with §8 edge cases) requires each failed PIN attempt logged. **Plan:** On mismatch in delivery PIN verification, insert `admin_audit_logs` row `PIN_FAIL` (if not already).
8. **UI-only rules** — Many §8 table rows (modifier auto-scroll, flavour count, saucing step, guest OTP, tip only on delivery) require **checklist pass** on [`apps/web`](apps/web) builders and checkout — track as QA matrix vs §8.

---

## PRD §11 — ETA & prep time (cross-check)

The **§11 — ETA & Prep Time System** section earlier in this document is the implementation source of truth. **Additional confirmation from PRD:** acceptance criteria require **admin-editable** pickup/delivery windows, **busy mode** from KDS + admin, **order_eta_events** for every adjustment, customer ETA **&lt;3s**. Backlog items in **Codebase gaps** still apply unless the **Appended Completion Note** below already merged a given line (e.g. PLACED ETA window, overdue worker tests — verify in repo before skipping).

---

## PRD §12 — Cancel / Help / Contact & refund requests (gap analysis)

**PRD text (summary):** **12.1** — Cancel button **2 minutes**; `cancel_allowed_until`; then **Help** replaces Cancel. Self-cancel → `CANCELLED`, `CUSTOMER_SELF`, fixed reason text. **12.2** — Help shows specific copy + **Contact us** (phone call / click-to-call). **12.3** — Chat-initiated cancel: KDS **Live Order Settings** → Request Cancel, reasons list, `cancellation_request` with **`KDS_CHAT_REQUEST`** on admin approval, **`chat_thread_id`** linked. **12.4** — Admin/manager direct cancel. **12.5** — Admin **Cancelled Orders** table with full columns. **12.6** — Paid cancel → **auto create/update `refund_request`** for remaining balance per `order_payments` derivation; admin refund UI; store credit vs original (disabled).

### Already implemented

| PRD | Evidence |
|-----|----------|
| 12.1 Window + `cancel_allowed_until` | [`checkout.service.ts`](apps/api/src/modules/checkout/checkout.service.ts) sets 2m; [`orders.service.ts`](apps/api/src/modules/orders/orders.service.ts) enforces window |
| 12.1 Customer cancel API | `POST /orders/:id/cancel` |
| Post-window messaging | [`order-detail-client.tsx`](apps/web/src/app/orders/[orderId]/order-detail-client.tsx) tells user to use order chat |
| KDS cancellation **request** (non-chat source) | [`kds.service.ts`](apps/api/src/modules/kds/kds.service.ts) `requestCancellation` → `KDS_CANCEL_REQUEST`, pending |
| Admin approve/deny cancellation | [`admin.controller.ts`](apps/api/src/modules/admin/admin.controller.ts) `POST /admin/cancellation-requests/:id/decide` |
| Admin direct cancel | `POST /admin/orders/:id/cancel` |
| Refund approve/issue (service layer) | [`refund.service.ts`](apps/api/src/modules/refunds/refund.service.ts) + [`admin.service.ts`](apps/api/src/modules/admin/admin.service.ts) `decideRefund` |
| KDS refund **request** | [`kds.service.ts`](apps/api/src/modules/kds/kds.service.ts) `requestRefund` |

### Gaps / mismatches (detailed backlog)

1. **§12.2 Help + Contact** — PRD: dedicated **Help** button after 2 minutes with modal copy and **Contact us** → **phone**. Current: static paragraph + order chat; **no** structured Help modal or **click-to-call** to store phone from location settings. **Plan:** Add Help button (non-terminal, after window), modal with PRD strings, `tel:` link using location phone from API/menu payload.
2. **§12.3 `KDS_CHAT_REQUEST` + `chat_thread_id`** — Schema [`CancellationRequest`](packages/database/prisma/schema.prisma) has **no** `chat_thread_id`. KDS only creates **`KDS_CANCEL_REQUEST`**. **Plan:** Migration: add nullable `chat_thread_id` (FK to chat conversation). New endpoint or variant: create cancellation from chat context with **`request_source: KDS_CHAT_REQUEST`**. On admin approve, set order `cancellation_source` to **`KDS_CHAT_REQUEST`** (not `ADMIN`).
3. **§12.3 / §12.4 `cancellation_source` on approved KDS requests** — [`decideCancellation`](apps/api/src/modules/admin/admin.service.ts) sets order `cancellationSource: "ADMIN"` on approve. PRD: approved KDS requests should set **`KDS_CANCEL_REQUEST`** or **`KDS_CHAT_REQUEST`** per originating `request.requestSource`. **Plan:** Map `requestSource` → order `cancellation_source`; keep **`cancelled_by_user_id`** = admin who approved (PRD “Approved by” column).
4. **§12.1 Exact reason string** — PRD: `cancellation_reason = "Customer cancelled within window"`. **Plan:** Set default reason on server for `CUSTOMER_SELF` path (ignore or override client).
5. **§12.6 Auto `refund_request` on cancel** — [`customerCancel`](apps/api/src/modules/orders/orders.service.ts) and admin/KDS-approved cancel paths **do not** call `RefundService` to auto-open refund when derived net paid &gt; 0. **Plan:** Centralize “on CANCELLED + paid balance” hook: compute balance from **`order_payments`** per PRD; create **PENDING** `refund_request` (idempotent if already exists).
6. **§12.5 / §12.6 Admin UI lists** — No **`GET /admin/cancelled-orders`** or **`GET /admin/refund-requests`** in [`admin.controller.ts`](apps/api/src/modules/admin/admin.controller.ts); admin web is a [placeholder](apps/web/src/app/admin/page.tsx). **Plan:** Paginated list endpoints + admin UI tables (columns per PRD), links to chat thread where applicable.
7. **§12.3 KDS UX** — PRD “Live Order Settings” menu with reason enum including **Customer requested cancellation via chat**. **Plan:** Extend KDS card actions + modals to match copy; wire chat-linked cancel when thread exists.
8. **Refund UI rule** — Show both refund methods; original payment disabled + tooltip (verify admin refund panel when built).

---

## Appended Completion Note - merged remaining-work follow-up

This section records the later merged follow-up plan that closed the remaining PRD section 7 / section 11 gaps after the main implementation pass. The follow-up scope was:

- Pending Review on KDS: make `requires_manual_review` visible on the live KDS board and refresh the board when `order.manual_review_required` arrives.
- PLACED-only ETA delta window: allow ETA delta changes on `PLACED` orders only inside the location-level `kds_auto_accept_seconds` window; keep PREPARING+ ETA delta behavior unchanged.
- Overdue delivery regression protection: cover the overdue-delivery worker path with an e2e that can trigger the worker without waiting on the interval loop and confirm deduped support-ticket creation.
- Cash-only no-show restriction: do not add online payment or change `prepayment_required` behavior in this milestone; instead, increment `customer_profiles.total_no_shows` on `NO_SHOW_*`, and block delivery when `total_no_shows > prepayment_threshold_no_shows`, while still allowing pickup.

### What was completed in that follow-up pass

#### 1. Pending Review visibility on KDS

- `serializeKdsOrder` was already returning `requires_manual_review`; the remaining work was finished on the web.
- [apps/web/src/app/kds/kds-client.tsx](apps/web/src/app/kds/kds-client.tsx) now:
  - includes `requires_manual_review`, `placed_at`, and `kds_auto_accept_seconds` in the client `KdsOrder` type
  - shows a Pending Review badge on `PLACED` tickets when `requires_manual_review` is true
  - refreshes on realtime `order.manual_review_required`

#### 2. PLACED ETA window enforcement

- [apps/api/src/modules/kds/kds.service.ts](apps/api/src/modules/kds/kds.service.ts) now loads `LocationSettings.kdsAutoAcceptSeconds` inside `adjustEtaDelta`.
- If the order is still `PLACED` and the elapsed time since `placedAt` is greater than that window, the API now returns `422` instead of allowing the ETA edit.
- For non-terminal orders after `PLACED`, the existing PRD section 11.3 ETA delta behavior remains unchanged.
- The KDS client now mirrors that server rule:
  - ETA delta buttons on `PLACED` tickets disable after the window closes
  - helper text shows either the remaining seconds or that the window has closed

#### 3. Overdue delivery worker e2e coverage

- The worker already exposed `tick()`, so no structural worker rewrite was needed.
- [apps/api/test/app.e2e-spec.ts](apps/api/test/app.e2e-spec.ts) now includes an overdue-delivery scenario that:
  - creates a delivery order
  - advances it to `OUT_FOR_DELIVERY`
  - forces `estimated_arrival_at` into the overdue window
  - calls `OverdueDeliveryWorker.tick()`
  - asserts only one `DELIVERY_OVERDUE` support ticket exists for that order even after repeated ticks

#### 4. No-show counter + cash-only delivery restriction

- A shared helper was added in [apps/api/src/modules/customers/no-show-policy.ts](apps/api/src/modules/customers/no-show-policy.ts) so quote, checkout, and menu serialization all use the same rule.
- `NO_SHOW_PICKUP` / `NO_SHOW_DELIVERY` transitions in [apps/api/src/modules/kds/kds.service.ts](apps/api/src/modules/kds/kds.service.ts) now increment `CustomerProfile.totalNoShows` inside the same transaction as the status change and audit event.
- Delivery restriction rule implemented:
  - block delivery only when `total_no_shows > prepayment_threshold_no_shows`
  - pickup remains allowed
  - no new online-payment path was added
  - existing `prepayment_required` / payment code was intentionally preserved, with only a future-policy placeholder comment/helper added
- Enforcement points added:
  - [apps/api/src/modules/cart/cart.service.ts](apps/api/src/modules/cart/cart.service.ts) for authenticated `POST /cart/quote`
  - [apps/api/src/modules/checkout/checkout.service.ts](apps/api/src/modules/checkout/checkout.service.ts) for delivery checkout
- Optional auth already worked on public routes through the auth guard, so [apps/api/src/modules/cart/cart.controller.ts](apps/api/src/modules/cart/cart.controller.ts) now forwards `req.user?.userId` into quote calculation without changing the public-route architecture.

#### 5. Web-side early disable / explanation

- The menu payload in [apps/api/src/modules/catalog/catalog.service.ts](apps/api/src/modules/catalog/catalog.service.ts) now includes:
  - `prepayment_threshold_no_shows`
  - `customer_total_no_shows`
  - `delivery_blocked_due_to_no_shows`
- The web now disables delivery early and shows matching explanatory copy in:
  - [apps/web/src/Wings4u/components/order-method-modal.tsx](apps/web/src/Wings4u/components/order-method-modal.tsx)
  - [apps/web/src/Wings4u/components/menu-page.tsx](apps/web/src/Wings4u/components/menu-page.tsx)
  - [apps/web/src/Wings4u/components/cart-order-settings.tsx](apps/web/src/Wings4u/components/cart-order-settings.tsx)
  - [apps/web/src/Wings4u/components/cart-page.tsx](apps/web/src/Wings4u/components/cart-page.tsx)
  - [apps/web/src/app/checkout/checkout-client.tsx](apps/web/src/app/checkout/checkout-client.tsx)

### Verification outcome for the follow-up pass

- `npm run build:api` passed.
- `npm run build:web` passed.
- The intended e2e additions were written in [apps/api/test/app.e2e-spec.ts](apps/api/test/app.e2e-spec.ts), but the local e2e run could not start because Jest global setup failed before test execution in [apps/api/test/global-setup.ts](apps/api/test/global-setup.ts). That remains an environment/test-bootstrap issue rather than an application compile failure.
