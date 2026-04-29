# PRD §22 — Walk-In Orders & In-Store POS — Fix Note

Last updated: 2026-04-13

---

## Summary

Implemented PRD §22 requirements for Walk-In POS, Timeclock security, and order attribution. All changes compile clean (`npx tsc --noEmit --project apps/api/tsconfig.json` — zero errors) and existing unit tests pass (17/17).

---

## Changes Made

### Phase 1: order_source + createdByUserId

| File | Change |
|---|---|
| `schema.prisma` | Added `createdByUserId` (nullable UUID, FK → users) to Order model |
| `schema.prisma` | Added `ordersCreatedBy` relation on User model |
| `pos.controller.ts` | Added `order_source` field to DTO with `@IsIn(["POS", "PHONE"])` validation |
| `pos.service.ts` | Pass `orderSource` from request input (no longer hardcoded) |
| `pos.service.ts` | Persist `createdByUserId: actorUserId` on order creation |
| `pos.service.ts` | Serialize `created_by_user_id` in POS order response |
| `pos.service.ts` | List endpoint filters by `orderSource: { in: ["POS", "PHONE"] }` |

### Phase 2: Store-network IP Guard

| File | Change |
|---|---|
| `guards/store-network.guard.ts` | **New file** — reusable `StoreNetworkGuard` |
| | Reads `trustedIpRanges` from LocationSettings for the scoped location |
| | Validates client IP against CIDR ranges (IPv4 support) |
| | Returns 403 if IP not in any trusted range |
| | Open-mode when no ranges configured (dev-friendly) |
| `pos.controller.ts` | Applied `@UseGuards(LocationScopeGuard, StoreNetworkGuard)` |
| `pos.module.ts` | Registered `StoreNetworkGuard` as provider |
| `timeclock.controller.ts` | Applied `@UseGuards(LocationScopeGuard, StoreNetworkGuard)` |
| `timeclock.module.ts` | Registered `StoreNetworkGuard` as provider |

### Phase 3: POS Code Security Hardening

| File | Change |
|---|---|
| `schema.prisma` | Added `posFailedAttempts` (Int, default 0) to EmployeeProfile |
| `schema.prisma` | Added `posLockoutUntil` (DateTime?) to EmployeeProfile |
| `schema.prisma` | Added `posCodeDeactivatedAt` (DateTime?) to EmployeeProfile |
| `auth.service.ts` | Removed `userId.slice(-5)` fallback matching |
| `auth.service.ts` | Added 5-attempt lockout with 10-minute window |
| `auth.service.ts` | Added `POS_LOGIN_FAIL` audit logging to AdminAuditLog |
| `auth.service.ts` | Added active employee/user status checks before auth |
| `auth.service.ts` | IP allowlist moved to top of posLogin flow (fail-fast) |
| `auth.service.ts` | Reset failed attempts on successful login |
| `auth.controller.ts` | Changed DTO from `@Length(4,8)` to `@Matches(/^\d{5}$/)` (5-digit only) |

### Phase 4: POS Payments + Receipts

| File | Change |
|---|---|
| `pos.controller.ts` | Added `STORE_CREDIT` to allowed payment methods |
| `pos.service.ts` | Implemented atomic wallet debit for STORE_CREDIT payments |
| | `SELECT ... FOR UPDATE` row lock → `balanceCents` decrement → ledger entry |
| | Rejects if wallet balance < finalPayableCents |
| `pos.service.ts` | Added receipt/drawer intent flags in response: |
| | `receipt_action: "PRINT"` (always) |
| | `drawer_action: "OPEN"` (cash) / `"CLOSED"` (card/credit) |
| | `amount_tendered_cents` and `change_due_cents` for cash |

### Phase 5: Manual Discounts

| File | Change |
|---|---|
| `schema.prisma` | Added `appliedByUserId` (nullable UUID) to OrderDiscount |
| `schema.prisma` | Added `reasonText` (nullable String) to OrderDiscount |
| `pos.controller.ts` | Added `POST pos/orders/:id/discounts` endpoint |
| | Role guard: only `MANAGER` employee role or `ADMIN` user role |
| `pos.service.ts` | `applyManualDiscount()` method: |
| | Creates OrderDiscount with type=MANUAL, attributing `appliedByUserId` |
| | Updates order totals (`orderDiscountTotalCents`, `finalPayableCents`) |
| | Writes `POS_MANUAL_DISCOUNT` AdminAuditLog entry |

---

## Build Verification

```
npx tsc --noEmit --project apps/api/tsconfig.json
# Zero errors ✅

npx jest --config apps/api/jest.config.json --passWithNoTests
# Test Suites: 1 passed, 1 total
# Tests:       17 passed, 17 total ✅
```

---

## Schema Migration

Migration file created via:
```
npx prisma migrate dev --name prd22_pos_walkin --schema=packages/database/prisma/schema.prisma --create-only
```
Note: requires DATABASE_URL. Prisma client regenerated successfully.

New columns (all nullable / have defaults — zero-downtime migration):

| Table | Column | Type | Default |
|---|---|---|---|
| `employee_profiles` | `pos_failed_attempts` | INT | 0 |
| `employee_profiles` | `pos_lockout_until` | TIMESTAMPTZ | NULL |
| `employee_profiles` | `pos_code_deactivated_at` | TIMESTAMPTZ | NULL |
| `orders` | `created_by_user_id` | UUID FK | NULL |
| `order_discounts` | `applied_by_user_id` | UUID | NULL |
| `order_discounts` | `reason_text` | TEXT | NULL |

---

## Files Modified

```
packages/database/prisma/schema.prisma
apps/api/src/common/guards/store-network.guard.ts  (NEW)
apps/api/src/modules/pos/pos.controller.ts
apps/api/src/modules/pos/pos.service.ts
apps/api/src/modules/pos/pos.module.ts
apps/api/src/modules/auth/auth.service.ts
apps/api/src/modules/auth/auth.controller.ts
apps/api/src/modules/timeclock/timeclock.controller.ts
apps/api/src/modules/timeclock/timeclock.module.ts
```

---

## API Contract Changes

### POST /api/v1/pos/orders
New request fields:
```json
{
  "order_source": "POS" | "PHONE",       // REQUIRED (was hardcoded)
  "payment_method": "CASH" | "CARD_TERMINAL" | "STORE_CREDIT"  // Added STORE_CREDIT
}
```

New response fields:
```json
{
  "created_by_user_id": "uuid",
  "receipt_action": "PRINT",
  "drawer_action": "OPEN" | "CLOSED",
  "amount_tendered_cents": 5000,          // cash only
  "change_due_cents": 1234                // cash only
}
```

### POST /api/v1/pos/orders/:id/discounts (NEW)
```json
// Request
{
  "discount_amount_cents": 500,
  "reason": "Damage to packaging",
  "description": "Optional label"
}

// Response
{
  "id": "uuid",
  "order_id": "uuid",
  "discount_type": "MANUAL",
  "discount_amount_cents": 500,
  "reason": "...",
  "applied_by_user_id": "uuid",
  "applied_at": "...",
  "new_final_payable_cents": 2345
}
```

### POST /api/v1/auth/pos/login
- `employee_code` now requires exactly 5 digits (was 4-8 chars)
- `device_id` optional field for device-scoped lockout
- Lockout after 5 failed attempts per IP+device in 10-min window
- Failed attempts logged to `admin_audit_logs`
- PIN verified via bcrypt (SHA-256 legacy fallback for existing hashes)
- Code reuse cooldown: 30 days after `posCodeDeactivatedAt`

---

## Remediation — Findings Follow-up

### Finding 1 (High): bcrypt for POS codes ✅ FIXED

| Action | Detail |
|---|---|
| Installed `bcryptjs` + `@types/bcryptjs` | Zero native-code dependency |
| `auth.service.ts` posLogin | Iterates all active employees at location, uses `bcrypt.compare()` for `$2`-prefixed hashes |
| Legacy fallback | SHA-256 match for hashes not starting with `$2` (backward-compatible) |
| `AuthService.hashPosCode()` | New static method for setting PINs with bcrypt |

### Finding 2 (High): IP/device-based lockout ✅ FIXED

| Action | Detail |
|---|---|
| New `PosLoginAttempt` model | `pos_login_attempts` table — `location_id`, `client_ip`, `device_fingerprint`, `was_successful`, `attempted_at` |
| Rate-limit query | Counts failed attempts from same IP+device within 10-min window BEFORE any PIN check |
| Works for wrong codes | Table records all attempts regardless of whether an employee was matched |
| `recordPosLoginAttempt()` | Called on every login attempt (success and failure) |

### Finding 3 (High): Per-device lockout ✅ FIXED

| Action | Detail |
|---|---|
| `PosLoginDto.device_id` | Optional field (max 128 chars) in auth controller DTO |
| `auth.controller.ts` | Passes `body.device_id` to `posLogin()` |
| Device-scoped queries | `PosLoginAttempt` filtered by `deviceFingerprint` when `device_id` is provided |

### Finding 4 (Medium): Code reuse cooldown ✅ FIXED

| Action | Detail |
|---|---|
| `auth.service.ts` step 5 | Checks `employee.posCodeDeactivatedAt` against 30-day window |
| Rejects with 403 | "This employee code was recently deactivated. Please use a new code." |
| Records attempt | Failed attempt recorded + audit log written |

### Finding 5 (Medium): Unit test coverage ✅ FIXED

New test file: `pos-walkin.spec.ts` — 46 tests across 8 describe blocks:

| Suite | Tests | Covers |
|---|---|---|
| StoreNetworkGuard — ipInCidrList | 9 | CIDR matching, open mode, /32, /0, malformed IP |
| POS code bcrypt hashing | 6 | bcrypt hash, compare, dual-mode detect, SHA-256 fallback |
| POS login lockout — IP/device rate limiting | 6 | Threshold, window expiry, device-scoped counters |
| POS code reuse cooldown | 5 | null, 5/29/31/365 days ago |
| order_source validation | 6 | POS, PHONE accepted; ONLINE, ADMIN, IN_STORE, empty rejected |
| Manual discount recalculation | 4 | Reduction, clamp at 0, accumulation, no negative |
| Employee code format — 5-digit | 7 | Valid codes, 4/6-digit, alphanumeric, empty |
| Receipt/drawer intent flags | 3 | CASH→OPEN, CARD→CLOSED, STORE_CREDIT→CLOSED |

Build verification:
```
npx tsc --noEmit --project apps/api/tsconfig.json
# Zero errors ✅

npx jest --config apps/api/jest.config.json --passWithNoTests
# Test Suites: 2 passed, 2 total
# Tests:       63 passed, 63 total ✅
```

---

## Remaining Deferred

- **Timeclock IP override for admin**: Admin-initiated clock corrections bypass network guard (future)
