# Procedures Todo

Last updated: 2026-03-24

## Purpose

This file contains only the work that is still left to do.

Use this as the practical next-step list after the completed work already recorded in [`tasks.md`](./tasks.md).

When [`tasks.md`](./tasks.md) and [`issues.md`](./issues/issues.md) disagree, **[`issues.md`](./issues/issues.md) wins** for deciding what is still open or unproven.

---

## What Is Still Open

### 1. Refund / wallet ledger entry type alignment

- [ ] Align wallet ledger writes with allowed `customer_credit_ledger.entry_type` values in SQL — see [`issues.md`](./issues/issues.md) Issue 1.

**Status:** **Blocked** for treating store-credit refunds as **verified**; money path may fail at runtime until fixed.

---

### 2. E2e suite (done — see `tasks.md` Progress Entry 40)

- [x] Run `npm run test:e2e` against the dedicated test database (see `.env.test` in `apps/api/test/`).
- [x] Confirm a reproducible green suite (65 tests; run twice locally).
- [x] Updated `tasks.md` to record verified green e2e and remaining limits ([`issues.md`](./issues/issues.md) Issue 1 for wallet/refund ledger).

**Status:** **Done** for API e2e proof. **Money-path “verified”** still blocked on Issue 1 until ledger writes match SQL.

---

### 3. Platform and operations (not covered by current `issues.md` register)

These are **planned / future** items — not the same as the blocking issue above:

- [ ] Print agent and production store-device workflows (beyond staff browser KDS/POS).
- [ ] Runbooks, monitoring, backup/restore rehearsal, rollout/rollback hardening.

**What not to start yet** (do not prioritize unless business needs force it):

- KDS frontend  
- POS frontend  
- Admin / manager console  
- Devices page  
- Timeclock page  
- Print-agent UI  
- Refund / wallet UI beyond simple customer display  

**Why:** Customer **browse → cart → checkout → track order** is the core product loop. Ops and device surfaces carry more platform complexity and lower immediate product payoff than finishing that loop end-to-end.

**Frontend — test and done criteria**

*Phase 1* is successful when a customer can:

- Open the menu and browse real items  
- Configure an item and add it to cart  
- Get a live server quote  
- Go through checkout  
- Place an order successfully  
- Land on order detail  
- See live status updates  
- See cancel availability correctly during the allowed window  

*Phase 2* is successful when the customer can also:

- Log in with OTP  
- See account orders  
- Use chat on active orders  
- Open support on terminal orders  

**Status:** **Partially verified** at best until core verification (items 1–2) is green.

---

## Priority Roadmap

### Priority 1 — Fix schema-invalid wallet/refund writes

- [ ] Align `refund.service.ts` / `wallets.service.ts` with SQL-allowed ledger entry types ([`issues.md`](./issues/issues.md) Issue 1).
- [ ] Re-run targeted tests or e2e wallet/refund paths after the fix.

**Why first:** Money paths must match the database before calling those flows **verified**.

---

### Priority 2 — Run e2e green and promote

- [x] `npm run test:e2e` against the dedicated test database.
- [x] Confirm reproducible green suite.
- [x] Update `tasks.md` promotion language (`tasks.md` Progress Entry 40).

---

### Priority 3 — Platform follow-ups (when core proof exists)

- [ ] Print agent, device-specific flows (if product still wants them).
- [ ] Runbooks and production hardening.

---

## Simple Rule For Prioritization

1. Fix what blocks trustworthy verification first ([`issues.md`](./issues/issues.md)).
2. Do not count a subsystem as **verified** if the database can reject its writes or tests are not green on deterministic data.
3. Keep [`tasks.md`](./tasks.md) honest: **implemented** ≠ **verified** (see reporting rules at the top of `tasks.md`).
