# Issues Register

Last updated: 2026-04-08

## Purpose

This file records the current implementation issues found during backend review.

Use this file to track:

- what is broken or incomplete
- why it matters
- what should be fixed next
- whether the issue is still open or already resolved

---

## Review Date - 2026-03-21

### Issue 1. Wallet-backed refund credits use an invalid ledger entry type

- **Date:** 2026-03-21
- **Area:** Refunds / wallets
- **Issue:** Refund issuance sends wallet ledger entry type `REFUND`, but the SQL schema only allows `ISSUE`, `USE`, `REVERSE`, `EXPIRE`, and `ADJUST`.
- **Impact:** Store-credit refund flows can fail when trying to write ledger records.
- **Why is it bad?:** Refunds are a money path. Any mismatch here is higher-risk than a cosmetic bug because it can break financial tracking and customer balances.
- **Proposed fix:** Use one of the allowed ledger types or formally extend the schema and Prisma model to support a dedicated refund entry type.
- **Status:** Open - high
- **Solution:** Align `apps/api/src/modules/refunds/refund.service.ts` and `apps/api/src/modules/wallets/wallets.service.ts` with the allowed `customer_credit_ledger.entry_type` values, then retest wallet-credit refunds.

---

## Review Date - 2026-04-08

### Issue 2. Builder overlays had duplicated progress labels, confusing scroll behavior, and inconsistent shell chrome

- **Date:** 2026-04-08
- **Area:** Web ordering UX / builders
- **Issue:** The wings/combo/customization flows had grown inconsistent. Progress UI looked like a second menu, the footer could feel buried relative to the scroll region, and the main builder/customization overlays did not yet share one clear shell structure.
- **Impact:** Customers could read the builder top area as noisy or duplicated, and the overall modal UX was harder to follow than it needed to be.
- **Why is it bad?:** This is the main order-building surface. Friction here directly hurts customization clarity and add-to-cart confidence.
- **Proposed fix:** Introduce one shared builder shell, keep one main scroll region, pin the footer, replace the duplicated progress strip with compact progress text, and raise overlay stacking above the `/order` sticky bars.
- **Status:** Resolved - verified
- **Solution:** The builder flows now use `BuilderShell` in `apps/web/src/components/builder-shared.tsx`, compact progress replaced the old duplicated-label strip, the footer is pinned outside the scroll region, `.item-customization-overlay` now uses `z-index: 3000`, and the final live grouped-size modal path was migrated onto the same shared shell. Detailed current note: [`issues2.md`](./issues2.md). Historical verification archive: [`fixed issues2.md`](./fixed%20issues2.md).

---

## Current Read Of The Project

**Plain-English summary:**
The backend has substantial real implementation work completed. **One** issue remains in this register: wallet ledger entry types for refunds. The e2e harness now has a dedicated test database with automatic reset + seed (see Progress Entry 39 in `tasks.md`), so automated verification is unblocked once the remaining money-path issue is fixed.

**Technical summary:**
The remaining issue is a runtime schema mismatch — the refund service writes a `REFUND` ledger entry type that the SQL CHECK constraint does not allow.

---

## Suggested Fix Order

1. Fix schema-invalid write values in refunds and wallets.
2. Run e2e against the dedicated test database and confirm a green suite.
3. Keep `tasks.md` / `todo.md` aligned to verified reality (see promotion rules in `tasks.md`); do not claim **verified** until proof is green and issues are closed.
