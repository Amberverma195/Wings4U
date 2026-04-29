# PRD Section 8 - Validation Rules And Edge Cases: QA Matrix

Source: `Wings4U_PRD_v3_5_v24_FIXED.docx` section 8.
Status reflects the codebase after the Phase 1-4 hardening pass plus the later PRD section 8 / section 12 leftover follow-up.

## Menu item purchasability precedence

Evaluated at checkout, in order:

| # | Rule | Enforced? | Evidence |
|---|------|-----------|----------|
| 1 | `deleted_at` / `archivedAt` -> reject | Yes | [checkout.service.ts](../../apps/api/src/modules/checkout/checkout.service.ts) |
| 2 | `is_active = false` -> reject | Partial | `MenuItem` has no separate `isActive`; behavior is folded into `isAvailable` plus `archivedAt` in the current schema. |
| 3 | `is_available = false` -> reject | Yes | Explicit `menuItem.isAvailable` guard |
| 4 | Outside `menu_item_schedules` window -> reject | Yes | Schedule violation `422` path |
| 5 | Not valid for current `fulfillment_type` -> reject | Yes | `allowedFulfillmentType` guard |
| 6 | All pass -> purchasable | Yes | Happy path |

## Checkout revalidation

| Check | Enforced? | Evidence |
|-------|-----------|----------|
| Item availability via precedence | Yes | See table above |
| Modifier validity | Yes | Modifier option activity and group attachment checks |
| Flavour validity | Yes | Wing builder validation in checkout and cart quote |
| Promo eligibility | Not yet | No promo application path exists in checkout today |
| Scheduling (store hours) | Yes | Schedule violation handling |
| Scheduling (minimum lead time) | Yes | `scheduled_for >= now + prepMinutes`, busy-mode aware |
| Prepayment / delivery restriction gate | Yes | No-show delivery restriction helper |
| Delivery zone (postal code) | Yes | Allowed-postal comparison in checkout |
| Minimum subtotal (delivery) | Yes | Delivery subtotal guard |

## Section 8 rules table

| Rule | Status | Notes |
|------|--------|-------|
| Delivery requires address | Yes | Delivery rejects without address snapshot |
| Schedule within store hours | Yes | Server-side schedule window check |
| Minimum lead time (30 min) | Yes | `defaultPrepTimeMinutes` now defaults to 30 in schema and seed |
| Required modifier missing | Yes | Required-group validation at checkout and reorder |
| Flavour count must match weight | Yes | Wings builder enforcement |
| Plain flavour remains valid | Yes | Plain flavour handling preserved |
| Saucing method required for multi-flavour | Yes | Builder step and validation path |
| Item unavailable card | Yes | UI plus server guard |
| Duplicate order prevention | Yes | `Idempotency-Key` and persisted checkout keys |
| Wallet deduction row-locked and atomic | Yes | `SELECT ... FOR UPDATE` inside checkout transaction |
| Promo usage limit atomicity | Not yet | Promo application path still deferred |
| Mode change mid-session | Yes | Fulfillment switch preserves cart/session flow |
| Guest checkout phone + OTP | Yes | Guest identity lifecycle |
| Prepayment / history gate blocks delivery | Yes | Shared delivery eligibility guard |
| Final status lock | Yes | Terminal status guards |
| Driver assign only for READY delivery | Yes | KDS assign validation |
| Busy driver override required | Yes | KDS modal path |
| Delivery tip only on delivery | Yes | Pickup rejects delivery tip |
| Driver rating only after delivery | Yes | Review guard |
| One driver rating per order | Yes | Unique constraint |
| Coupon stacking blocked | Yes | Promo module behavior |
| Credit cannot make order negative | Yes | Pricing clamp plus wallet row lock and balance pre-check |
| Item sold out badge | Yes | Web |

## Student discount fields

| Field | Present? |
|-------|----------|
| `student_discount_requested` | Yes |
| `student_discount_verified_by` | Yes |
| `student_discount_amount_cents` | Yes |

## Follow-up status

1. Prep defaults are aligned: schema default is 30, seed refresh now writes pickup `30-40` and delivery `40-60`, and catalog/web fallbacks use the same baseline.
2. Promo application in checkout is still deferred. When the feature exists, `promo_redemption` insert and promo usage updates must happen in the same transaction as order creation.
3. E2E scenarios were added in [app.e2e-spec.ts](../../apps/api/test/app.e2e-spec.ts):
   - Archived main menu item reject.
   - Archived salad customization target reject.
   - Delivery postal outside allowed postals reject.
   - `scheduled_for` before minimum lead time reject.
   - Wallet concurrency / single debit under race.
   - Admin-approved paid cancel creates one pending refund request.
   - Customer self-cancel (`POST /orders/:id/cancel`) with a successful capture on the order creates one pending refund request (same net-balance rules as `RefundService.createForCancelledOrder`).
   - Chat closes after both admin-approved and KDS-approved cancel flows.
4. The local e2e harness still needs a reachable Postgres instance from `apps/api/test/.env.test`. [global-setup.ts](../../apps/api/test/global-setup.ts) now reports the exact connection target instead of failing with an opaque aggregate error.
5. A manual UI matrix pass is still useful on `apps/web` so every disabled state matches the matching server rejection path.

## PIN audit visibility

- `order_driver_events` remains the durable source of truth.
- PIN failure and bypass events are also mirrored into `admin_audit_logs` under `delivery_pin.*` action keys so operations can see them in the audit feed.
- Successful PIN verifications are intentionally not duplicated into the admin audit feed.
