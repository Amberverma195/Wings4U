# PRD §22 — Walk-In Orders & In-Store POS Implementation Plan

Last updated: 2026-04-13

---

## Scope

PRD §22 covers Walk-In Orders & In-Store POS. This plan identifies the existing baseline, gaps, and implementation phases required to bring the POS surface up to specification.

---

## Baseline Assessment

### Already Present

| Component | File | Status |
|---|---|---|
| POS controller with create/list | `pos.controller.ts` | ✅ Working |
| POS service — full order creation in tx | `pos.service.ts` | ✅ Working |
| POS auth endpoint | `auth.controller.ts` L203 | ✅ Working |
| POS login with SHA-256 PIN check | `auth.service.ts` L362-443 | ⚠️ Weak hash |
| IP allowlist check in posLogin | `auth.service.ts` L400-404 | ⚠️ Only on login |
| `trustedIpRanges` on LocationSettings | `schema.prisma` L282 | ✅ Present |
| OrderSource enum: ONLINE, POS, PHONE, ADMIN | `schema.prisma` L1530-1537 | ✅ Present |
| Timeclock controller + service | `timeclock/` module | ✅ Working |
| Driver availability from clock state | `timeclock.service.ts` L241-255 | ✅ Working |
| AdminAuditLog model | `schema.prisma` L1461-1478 | ✅ Present |
| OrderDiscount model | `schema.prisma` L916-928 | ⚠️ No `applied_by_user_id` |
| OrderPayment with `createdByUserId` | `schema.prisma` L945 | ✅ Present |
| Payment methods: CASH, CARD | `pos.controller.ts` L68 | ⚠️ Missing STORE_CREDIT |

### Gaps Identified

1. **order_source not accepted from client** — POS service hardcodes `"POS"` (L299); no input for PHONE orders
2. **No IP guard on POS create/list or timeclock** — IP check only in auth.service.posLogin
3. **POS PIN uses SHA-256** — Not bcrypt; also has fallback `userId.slice(-5)` matching
4. **No POS lockout/throttle** — No failed attempt tracking or device-bound lockout
5. **No code reuse cooldown** — Schema missing `deactivatedAt` tracking for cooldown
6. **No audit logging for POS_LOGIN_FAIL**
7. **STORE_CREDIT not in POS payment methods**
8. **Receipt/drawer intent flags** not in POS response
9. **OrderDiscount missing `applied_by_user_id`** — Manual discounts can't be attributed
10. **No manual discount endpoint in POS controller**
11. **POS login DTO allows 4-8 chars** — Should enforce exactly 5 digits

---

## Implementation Phases

### Phase 1: order_source + createdByUserId on POS create

- Add `order_source` field to `CreatePosOrderDto` with `@IsIn(["POS", "PHONE"])`
- Pass through to service; replace hardcoded `"POS"` with input value
- Add `createdByUserId` to Order model (schema migration)
- Persist `actorUserId` as `createdByUserId` on POS order creation
- Expose `created_by_user_id` in serializer + list endpoint
- Reject deprecated values (IN_STORE, ADMIN_CREATED) via DTO validation

### Phase 2: Store-network IP guard

- Create reusable `StoreNetworkGuard` in `common/guards/`
- Guard reads `trustedIpRanges` from LocationSettings
- Applies to: POS controller, Timeclock controller
- Returns `403: POS access is restricted to in-store network only`
- Admin/customer APIs remain unrestricted

### Phase 3: POS code security hardening

- Schema: add `posLockoutUntil`, `posFailedAttempts`, `posCodeDeactivatedAt` to EmployeeProfile
- Replace SHA-256 with bcrypt for `employeePinHash`
- Remove `userId.slice(-5)` fallback
- Enforce exactly 5-digit code format in DTO
- Implement lockout: 5 attempts per device per 10 min → 10 min lockout
- Log POS_LOGIN_FAIL to AdminAuditLog
- Reject deactivated employees
- Code reuse cooldown: 30 days after deactivation

### Phase 4: POS payment + receipts

- Add STORE_CREDIT to allowed payment methods
- Implement wallet debit for STORE_CREDIT (atomic with order creation)
- Add receipt/drawer intent flags to POS order response:
  - `receipt_action: "PRINT"` (always)
  - `drawer_action: "OPEN" | "CLOSED"`

### Phase 5: Manual discounts

- Schema: add `appliedByUserId` to OrderDiscount
- Add `POST pos/orders/:id/discounts` endpoint
- Role check: only MANAGER role can apply manual discounts
- Persist: applied_by_user_id, reason, amount, order linkage
- Write AdminAuditLog entry for POS_MANUAL_DISCOUNT

### Phase 6: Web surfaces

- Verify POS login UI
- Ensure POS order screen has separate fulfillment + source controls
- Verify timeclock correctness (already mostly present)

### Phase 7: Tests + docs

- E2E tests for IP guard, POS login, lockout, order_source
- API contract doc updates
- Plan/fix note pair + map update

---

## Status

Status: **Complete** — Phases 1–5 implemented, build clean, tests passing.

---

## Architecture Notes

- IP guard is reusable middleware, not per-service ad hoc checks
- POS orders share lifecycle pipeline with online orders (KDS, status events)
- `createdByUserId` is source of truth for "who placed walk-in/phone order"
- STORE_CREDIT wallet debit is atomic within the same transaction as order creation
