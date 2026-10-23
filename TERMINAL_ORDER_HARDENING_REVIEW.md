Terminal-order hardening review — October 23, 2026

Fetched `origin/main` before implementation: it matched reviewed commit `c6b127ecb4ea849e1118b0d414a4028f7b8c1255`, with no additional commits to inspect. Work was implemented and verified on `fix/cancellation-driver-hardening` before the requested main push.

Root causes and fixes:

| Priority | Finding | Implementation |
| --- | --- | --- |
| P1 | KDS wrote `DENIED`, while admin wrote `REJECTED` and deletion recognized only the latter. Cancellation status is a string, not a schema enum. | Central resolved-status classification accepts historical `DENIED` and `REJECTED`, plus existing `APPROVED`, `CANCELLED`, `WITHDRAWN`. New rejection decisions consistently write `REJECTED`. Pending and unknown statuses remain protected. No historical records are normalized in the database. |
| P2 | Generic driver release emitted `driver.delivery_completed` for cancellation and wrote `lastDeliveryCompletedAt` for cancellation/no-show. | Cancellation publishes existing `order.cancelled` and driver availability notifications, never a completion notification. Shared unsuccessful/cancelled driver release no longer changes successful-delivery timestamps or counters. Availability remains transactional and considers other active assignments. |
| P2 | A request can remain pending after fulfillment. Approval is correctly forbidden on terminal orders, but the existing rejection path was unclear in the UI and KDS rejection lacked a pending-state guard/audit transaction. | Reuse existing admin approvals queue and explicit reject decision. Terminal requests remain visible; approve-and-cancel is disabled, with instructions to review the original request and leave genuine disputes pending. Admin and KDS rejection now atomically guard `PENDING`, store reviewer/time/notes, and write an audit record. No order transition or refund occurs when rejecting a request on a terminal order. |

The smallest workflow uses the existing `DENY` decision input and endpoints. It does not add an endpoint, status, automatic disposition, or refund workflow. A staff member who considers the dispute unresolved leaves the request pending; payment/refund/support obligations stay independently protected. Rejection means a reviewed request was rejected, not that fulfillment was cancelled. Original request text and references remain intact. Approved active-order cancellation retains its existing refund initiation behavior.

Realtime and timestamp compatibility:

- Existing successful `DELIVERED` and established `NO_PIN_DELIVERY` paths keep PIN controls, completion events, successful-delivery counters, timestamps and release behavior.
- `NO_SHOW_DELIVERY` retains its established `driver.delivery_completed` notification with explicit `no_show: true` for compatibility. This is an unsuccessful operational closure, not a successful handoff. Existing `DELIVERY_NO_SHOW` audit remains; successful counters and driver completion timestamps are not advanced.
- Order-level `deliveryCompletedAt` for `NO_SHOW_DELIVERY` remains the existing operational closure timestamp. Changing its schema/meaning for historical orders would be incompatible; this patch leaves it intact. Driver-level `lastDeliveryCompletedAt` now advances only in successful/established completion paths. Existing historical timestamps are not rewritten.
- Contracts now describe the already-produced optional `no_show` and `without_pin` fields, in source and the tracked declaration. No event names change. Gateway driver-channel routing, KDS order-cancellation/status subscriptions and customer subscriptions remain unchanged; cancellation still emits availability for driver-channel consumers.

Exact files modified or added:

| File | Change |
| --- | --- |
| `apps/api/src/common/orders/cancellation-lifecycle.ts` | Shared resolved aliases and canonical new rejection status. |
| `apps/api/src/common/orders/release-closed-order-driver.ts` | Preserve successful completion timestamp on non-successful release. |
| `apps/api/src/modules/admin/admin.service.ts` | Atomic, guarded, audited rejection independent of fulfillment. |
| `apps/api/src/modules/admin/admin-terminal.spec.ts` | Terminal review, duplicate/concurrent decisions, approval/rejection races, rollback, queue visibility and timestamp assertions. |
| `apps/api/src/modules/auth/account-deletion.service.ts` | Recognize resolved historical aliases without backfills. |
| `apps/api/src/modules/auth/account-deletion.service.spec.ts` | Historical alias eligibility across terminal states; pending/unknown request protection. |
| `apps/api/src/modules/kds/kds.service.ts` | Suppress false cancellation completion event; canonical guarded/audited rejection. |
| `apps/api/src/modules/kds/kds-terminal.spec.ts` | Completion/no-show/cancellation event, timestamp and counter invariants. |
| `apps/web/src/app/admin/approvals/approvals-client.tsx` | Explicit terminal request review instructions; disable invalid approval. |
| `apps/web/tests/cancellation-terminal-review.test.cjs` | Render all terminal states, manual rejection, notes, conflict handling and active-order compatibility. |
| `packages/contracts/src/realtime.ts` | Document existing optional delivery outcome flags. |
| `packages/contracts/src/realtime.d.ts` | Keep tracked declaration aligned. |
| `scripts/verify-terminal-orders.cjs` | Include new website review tests in safe verification. |
| `TERMINAL_ORDER_HARDENING_REVIEW.md` | This report. |

Verification:

`node scripts/verify-terminal-orders.cjs` passed the selected API, website and mobile suites and all three no-emit TypeScript checks. After adding approval/rejection concurrency cases, `node scripts/verify-terminal-orders.cjs api` passed again. `git diff --check` passed. All modified files were reinspected.

| Check | Final result |
| --- | --- |
| API mocked unit tests | 394 passed, 15 suites |
| Website component/unit tests | 54 passed, 6 suites |
| Mobile mocked regression tests | 184 passed, 11 suites |
| API / website / mobile TypeScript | All passed |
| Whitespace/error check | Passed |

Total: 632 tests, 32 suites. Coverage includes both historical rejection aliases, genuinely pending/unknown cancellations, terminal unpaid orders, active orders, pending payments/refunds, holds/support disputes, separate payment reconciliation, PIN requirements, no-show counters, driver availability with other assignments, duplicate and competing terminal transitions, rejection audit rollback, concurrent decisions and terminal review UI. Tests model transactions and guarded writes in memory; they do not validate a live PostgreSQL engine or hosting environment.

Production safety and financial review:

No production database reads or writes were performed. The root `.env` was not loaded. The safe test runner blocks real Prisma construction, environment-file loading and network access, and supplies unusable database URLs. No production-connected e2e tests, Prisma migration/seed/reset/db-push commands, cleanup, backfill or application startup ran. No payment/refund implementation, payment calculation, online-payment flag, hosting setting, customer record or ledger record was changed. Existing deletion cleanup and retention policies remain unchanged. No migration or schema change is required.

Readiness and remaining risks:

- No known outstanding P0, P1 or P2 defect remains in the three reviewed issues. Terminal fulfillment remains independent of collection, and genuine unresolved requests continue blocking deletion until reviewed.
- P3 validation limitation: run isolated PostgreSQL concurrency and staging staff/customer smoke checks before a production release. Verification here is mocked/static; no browser/device or production deployment validation is claimed.
- P3 compatibility consideration: external consumers of the legacy no-show closure event must respect `no_show: true`; this existing event is retained and now documented in contracts. No external consumers were contacted or changed.
- Existing post-commit realtime/notification delivery remains best effort; no durable outbox was added in this scoped patch.

Verdict: the requested fixes pass safe verification and are suitable for the requested main publication. Unconditional production readiness is not claimed without isolated integration/staging validation. The user's final Git Instructions authorize committing and pushing to main; no deployment command or Railway/Vercel configuration change is part of this work. Automatic hosting behavior following a main push is outside this verification.
