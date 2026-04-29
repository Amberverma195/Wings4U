# Doc Sync Pass After Current Code Review

## Summary

Most of the **active markdown product docs** are now in decent shape. The codebase does **not** look like it needs a broad PRD rewrite right now.

What still needs updating is mostly:
- stale operational/procedure summaries
- a few API contract mismatches
- one duplicate-contract housekeeping issue

The biggest remaining **code/runtime** issue is still the wallet/refund ledger mismatch in [refund.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/refunds/refund.service.ts) and [wallets.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/wallets/wallets.service.ts). That is already tracked correctly in [issues.md](/d:/Projects/Websites/Wings4U/Code/Docs/procedures/issues/issues.md), so no new PRD rewrite is needed just for that yet.

## Required Doc Changes

### 1. Rewrite or archive [Docs/audits/README.md](/d:/Projects/Websites/Wings4U/Code/Docs/audits/README.md)
This is the most stale file I found.

It still says:
- CSRF skips device token at [Docs/audits/README.md#L80](/d:/Projects/Websites/Wings4U/Code/Docs/audits/README.md#L80)
- auth/cart/checkout/orders are stubs at [Docs/audits/README.md#L84](/d:/Projects/Websites/Wings4U/Code/Docs/audits/README.md#L84)
- most domain routes are still stubs at [Docs/audits/README.md#L130](/d:/Projects/Websites/Wings4U/Code/Docs/audits/README.md#L130)

Current code no longer matches that:
- [csrf.middleware.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/common/middleware/csrf.middleware.ts)
- [auth.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/auth/auth.controller.ts)
- [checkout.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/checkout/checkout.service.ts)
- [orders.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/orders/orders.service.ts)

Best fix:
- either mark `Docs/audits/README.md` as a clearly dated historical snapshot
- or rewrite it as a current audit summary

### 2. Fix the API contract event name drift
Both contract copies still say rejected cancellation uses `cancellation.rejected` at:
- [Docs/API_Spec/Wings4U_API_Contract_v1_0.md#L922](/d:/Projects/Websites/Wings4U/Code/Docs/API_Spec/Wings4U_API_Contract_v1_0.md#L922)
- [Docs/Wings4U_API_Contract_v1_0.md#L922](/d:/Projects/Websites/Wings4U/Code/Docs/Wings4U_API_Contract_v1_0.md#L922)

But current gateway/services use `cancellation.decided`:
- [realtime.gateway.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/realtime/realtime.gateway.ts)
- [admin.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/admin/admin.service.ts)
- [kds.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/kds/kds.service.ts)

Update the contract so rejected/approved decisions are both described as `cancellation.decided` with a decision payload.

### 3. Document the live endpoints that exist in code but are missing or under-documented in the contract
I found these live routes in code:

- [refund.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/refunds/refund.controller.ts)
  `POST /orders/:orderId/refund-request`
- [payments.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/payments/payments.controller.ts)
  `POST /orders/:orderId/payments`
  `GET /orders/:orderId/payments`
- [drivers.controller.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/drivers/drivers.controller.ts)
  `POST /drivers/:id/availability`

These should either:
- be added to the contract docs
- or be explicitly marked internal/non-contract routes if you do not want frontend/devs depending on them yet

### 4. Fix the support/admin realtime claims if you are not implementing them yet
The contract still lists:
- `support.ticket_created`
- `support.auto_ticket`

in admin-channel realtime tables at:
- [Docs/API_Spec/Wings4U_API_Contract_v1_0.md#L1126](/d:/Projects/Websites/Wings4U/Code/Docs/API_Spec/Wings4U_API_Contract_v1_0.md#L1126)
- [Docs/Wings4U_API_Contract_v1_0.md#L1126](/d:/Projects/Websites/Wings4U/Code/Docs/Wings4U_API_Contract_v1_0.md#L1126)

But the support module does not emit those events:
- [support.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/support/support.service.ts)

So pick one:
- remove those events from the contract for now
- or track them as planned/future, not current behavior

### 5. Clean up minor procedure-doc drift
Two smaller cleanup items:

- [Docs/API_Spec/README.md#L6](/d:/Projects/Websites/Wings4U/Code/Docs/API_Spec/README.md#L6) says the older contract file is only a redirect note, but [Docs/Wings4U_API_Contract_v1_0.md](/d:/Projects/Websites/Wings4U/Code/Docs/Wings4U_API_Contract_v1_0.md) is still a full duplicate contract.
- [Docs/procedures/tasks.md#L389](/d:/Projects/Websites/Wings4U/Code/Docs/procedures/tasks.md#L389) still uses `AUTHORIZED` in the payments summary, but the real order payment summary enum uses `PENDING`, `PAID`, `PARTIALLY_PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`, etc. See [payments.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/payments/payments.service.ts).

## What Probably Does Not Need a PRD Rewrite

Based on the markdown docs and code:
- chat docs look aligned
- support docs look largely aligned
- timeclock docs look aligned
- device auth deferral is already reflected in the main API contract

So I would **not** rewrite the PRD just because of the current codebase.

For the `.docx` PRD/system-design files:
- I could not reliably do a full semantic diff through the shell
- if those `.docx` files are still treated as canonical by your team, manually mirror the same changes listed above:
  - device auth is deferred in MVP
  - `cancellation.decided` replaces `cancellation.rejected`
  - only document support/admin realtime events that actually exist today
  - include any public endpoints you intend frontend/devs to rely on

## Assumptions

- The markdown files under `Docs/` are your practical working source of truth right now.
- Historical files are allowed to stay historical, but only if they are clearly marked as such.
- You want docs to describe **current implemented behavior**, not future-intended behavior, unless a section is explicitly labeled planned/deferred.
