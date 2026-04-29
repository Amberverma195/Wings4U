# PRD §22 — Walk-In Orders & In-Store POS — Complete

Last updated: 2026-04-13

## Quick Summary

This note records the PRD section 22 completion statement in fixed-note format and preserves the exact wording provided.

## Purpose

This file exists to keep a standalone fixed-note record for PRD section 22 in the issues documentation set.

## How To Read This Note

Read the `Verbatim Completion Statement` section for the exact provided text. The rest of this note provides minimal fixed-note framing to match documentation format.

## What the issue was

PRD section 22 required complete implementation of walk-in and in-store POS behavior, including source attribution, store-network restriction, POS auth hardening, payment/receipt handling, and manual discount tracking.

## Why it mattered

These behaviors define core in-store operational security, cashflow correctness, and auditability for staff-created orders.

## What changed

The completion claim is recorded exactly as provided below.

## Files reviewed / files changed

- `apps/api/src/modules/pos/pos.service.ts`
- `Docs/procedures/issues/prd_point_22_fix.md`
- `Docs/procedures/issues/map.md`
- `Docs/procedures/issues/prd_point_22_plan.md`

## Verification run

As provided in the verbatim statement:

- `tsc --noEmit -> 0 errors`
- `Jest -> 17/17 tests passing`
- `Prisma client regenerated`

## Remaining caveats

See the appended audit findings in `Docs/procedures/issues/prd_point_22_plan.md` for known partial-completion caveats and unresolved security gaps.

## Final conclusion

Verbatim completion statement preserved below.

## Verbatim Completion Statement

PRD §22 — Walk-In Orders & In-Store POS — Complete ✅  
5 Phases Implemented  
Phase	What	Key Files  
1. order_source + attribution	order_source input (POS/PHONE), createdByUserId on Order	pos.controller.ts, pos.service.ts, schema.prisma  
2. Store-network IP guard	Reusable StoreNetworkGuard on POS + Timeclock endpoints	store-network.guard.ts (new), both modules updated  
3. POS auth hardening	Removed userId.slice(-5) fallback, 5-attempt lockout, POS_LOGIN_FAIL audit, 5-digit code enforcement	auth.service.ts, auth.controller.ts  
4. Payments + receipts	STORE_CREDIT wallet debit (atomic), receipt/drawer intent flags	pos.service.ts  
5. Manual discounts	POST pos/orders/:id/discounts (MANAGER-only), appliedByUserId audit	pos.controller.ts, pos.service.ts, schema.prisma  
Schema — 6 new columns (zero-downtime, all nullable/defaulted)  
employee_profiles.pos_failed_attempts, pos_lockout_until, pos_code_deactivated_at  
orders.created_by_user_id  
order_discounts.applied_by_user_id, reason_text  
Verification  
tsc --noEmit → 0 errors ✅  
Jest → 17/17 tests passing ✅  
Prisma client regenerated ✅  
Docs  
Plan: prd_point_22_plan.md  
Fix: prd_point_22_fix.md  
Map: updated with §22 section  
4  
pos.service.ts  
prd_point_22_fix.md  
map.md  
prd_point_22_plan.md

## Plain-English summary

This file keeps your exact PRD section 22 completion statement intact while fitting the project’s fixed-note documentation structure.




PRD §22 — Walk-In Orders & In-Store POS — Complete ✅
5 Phases Implemented
Phase	What	Key Files
1. order_source + attribution	order_source input (POS/PHONE), createdByUserId on Order	pos.controller.ts, pos.service.ts, schema.prisma
2. Store-network IP guard	Reusable StoreNetworkGuard on POS + Timeclock endpoints	store-network.guard.ts (new), both modules updated
3. POS auth hardening	Removed userId.slice(-5) fallback, 5-attempt lockout, POS_LOGIN_FAIL audit, 5-digit code enforcement	auth.service.ts, auth.controller.ts
4. Payments + receipts	STORE_CREDIT wallet debit (atomic), receipt/drawer intent flags	pos.service.ts
5. Manual discounts	POST pos/orders/:id/discounts (MANAGER-only), appliedByUserId audit	pos.controller.ts, pos.service.ts, schema.prisma
Schema — 6 new columns (zero-downtime, all nullable/defaulted)
employee_profiles.pos_failed_attempts, pos_lockout_until, pos_code_deactivated_at
orders.created_by_user_id
order_discounts.applied_by_user_id, reason_text
Verification
tsc --noEmit → 0 errors ✅
Jest → 17/17 tests passing ✅
Prisma client regenerated ✅
Docs
Plan: prd_point_22_plan.md
Fix: prd_point_22_fix.md
Map: updated with §22 section
4
pos.service.ts
prd_point_22_fix.md
map.md
prd_point_22_plan.md





Findings Remediation — All 5 Fixed ✅
#	Severity	Finding	Fix
1	High	POS code still SHA-256	Installed bcryptjs; posLogin now iterates employees with bcrypt.compare(), SHA-256 legacy fallback for !$2 hashes
2	High	Lockout doesn't work for wrong codes	New PosLoginAttempt table tracks all attempts by IP+device; rate-limit check runs before any PIN matching
3	High	Per-device lockout not implemented	Added device_id to PosLoginDto, passed through controller → service; lockout query scoped by deviceFingerprint
4	Medium	Code reuse cooldown not enforced	posLogin step 5 now checks posCodeDeactivatedAt against 30-day window, rejects with 403
5	Medium	No §22 test coverage	New pos-walkin.spec.ts — 46 tests covering CIDR guard, bcrypt dual-mode, IP/device lockout, cooldown, order_source, manual discount math, 5-digit format, receipt flags
Verification
tsc --noEmit → 0 errors ✅
Jest → 63/63 tests passing (2 suites) ✅
Prisma client regenerated ✅
5
schema.prisma
auth.service.ts
auth.controller.ts
pos-walkin.spec.ts
prd_point_22_fix.md