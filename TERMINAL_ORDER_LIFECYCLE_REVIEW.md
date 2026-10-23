Implemented on local branch `fix/terminal-order-lifecycle`. Terminal fulfillment and payment reconciliation remain independent. No merge, push, deployment, production data access, or production environment changes were performed.

1. Root cause and audit findings

`AccountDeletionService.blockers()` excluded only `CANCELLED` from its outstanding-payment-summary query. Every other terminal order could incorrectly block deletion with `UNPAID`, `PENDING`, `PARTIALLY_PAID`, or `FAILED`, despite the separate active-order check already knowing all six terminal states.

The audit also found obsolete `COMPLETED` / `NO_SHOW` / `REFUNDED` names in customer cancellation; unguarded KDS/admin writes that could overwrite a competing terminal transition; generic internal `DELIVERED` transitions bypassing the dedicated PIN flow; an unguarded legacy ETA method; website tracking that remained subscribed after completion; and KDS ETA controls missing `NO_PIN_DELIVERY`.

Existing website/mobile status labels correctly distinguish missed pickup, unsuccessful delivery, and completion without PIN. Mobile already stops active tracking, hides processing actions, and keeps terminal orders in history. Both deletion clients already fetch fresh backend eligibility when opened/reopened; the website uses `no-store`, and the backend status route sends `Cache-Control: no-store`. These behaviors are covered by regression tests.

Audited dependencies include KDS/controller/PIN flows, order reads/cancellation/reorder, chat, realtime terminal broadcasts, admin cancellations, driver assignment/release, payment policy/collection views/services, refund and rewards behavior, deletion cleanup/controller/policy, customer history/tracking, shared contracts, and the Prisma schema. Payment ledger logic, sales/report calculations, cash drawers, online-payment flags, deletion activation settings, and retention cleanup were left unchanged.

2. Exact files changed or added

| File | Purpose |
| --- | --- |
| `apps/api/src/common/orders/order-lifecycle.ts` | Central backend terminal statuses and guarded-write conflict response. |
| `apps/api/src/common/orders/release-closed-order-driver.ts` | Reuse driver release for no-show/cancellation without altering payment or completed-delivery totals. |
| `apps/api/src/modules/admin/admin.service.ts` | Guard direct/request cancellation, atomically decide approvals, release assigned drivers. |
| `apps/api/src/modules/auth/account-deletion.policy.ts` | Reuse central terminal definition. |
| `apps/api/src/modules/auth/account-deletion.service.ts` | Exempt every terminal status from summary-only outstanding-payment blocking. |
| `apps/api/src/modules/chat/chat.service.ts` | Reuse central terminal boundary. |
| `apps/api/src/modules/kds/kds.service.ts` | Guard lifecycle writes, enforce PIN route, exclude terminal active-queue results, protect ETA and release drivers. |
| `apps/api/src/modules/orders/orders.service.ts` | Correct terminal cancellation guard and prevent cancellation races. |
| `apps/api/src/modules/orders/reorder-preview.ts` | Reuse central terminal definition. |
| `apps/api/src/modules/realtime/realtime.gateway.ts` | Reuse central terminal broadcast definition. |
| `apps/web/src/app/kds/kds-client.tsx` | Reuse existing client terminal helper; hide terminal ETA controls; use detail endpoint for history inspection. |
| `apps/web/src/app/orders/[orderId]/order-detail-client.tsx` | Reuse terminal helper, disconnect final tracking, dismiss stale processing dialogs, guard cancellation submission. |
| `apps/api/src/modules/admin/admin-terminal.spec.ts` | Admin/KDS cancellation terminal protection, rollback, driver release, refund initiation preservation. |
| `apps/api/src/modules/auth/account-deletion.service.spec.ts` | Terminal/payment matrix, active orders and independent financial/support blockers. |
| `apps/api/src/modules/chat/chat-terminal.spec.ts` | Terminal send rejection and idempotent conversation closure. |
| `apps/api/src/modules/kds/kds-terminal.spec.ts` | Completion matrix, active/history reads, PIN checks, duplicate/concurrent requests, no-show/driver/payment invariants. |
| `apps/api/src/modules/orders/orders-terminal.spec.ts` | Historical self-cancellation and losing cancellation races. |
| `apps/api/src/modules/payments/payment-collection.spec.ts` | Authorized separate collection after terminal fulfillment. |
| `apps/web/tests/account-deletion.test.cjs` | Eligibility refresh after reopening. |
| `apps/web/tests/order-terminal-tracking.test.cjs` | Render all final states, stop tracking, dismiss cancellation, retain history actions. |
| `apps/web/tests/terminal-orders.test.cjs` | Accurate final wording and website/mobile classification parity. |
| `apps/application/tests/account-deletion.test.cjs` | Eligibility refresh after reopening. |
| `apps/application/tests/order-detail-realtime.test.cjs` | All terminal realtime states stop tracking and remove cancellation. |
| `scripts/terminal-orders-test-setup.cjs` | Forbid real Prisma construction, environment-file loading, socket connections/listeners, datagrams and real fetch. |
| `scripts/verify-terminal-orders.cjs` | Reproducible mock-only tests and TypeScript checks with unusable database URLs. |
| `TERMINAL_ORDER_LIFECYCLE_REVIEW.md` | This report. |

3. KDS terminal paths verified

| Terminal status | Verified behavior |
| --- | --- |
| `PICKED_UP` | Unpaid/paid completion; conversation closes; final event; no payment write; repeat requests rejected. |
| `DELIVERED` | Unpaid/paid completion through verified/supplied PIN; external-provider bypass retained; driver release and audit/status events preserved. |
| `NO_SHOW_PICKUP` | Final unsuccessful-pickup state; one no-show increment; no payment or refund action; competing pickup completions rejected. |
| `NO_SHOW_DELIVERY` | Final unsuccessful-delivery state; one no-show increment; driver event/release preserved; other assignments retain busy availability. |
| `NO_PIN_DELIVERY` | Existing legacy locked-PIN flow retained; ordinary status route rejected; driver completion and unpaid audit preserved. |
| `CANCELLED` | Legitimate staff/admin/request paths stay terminal; repeat self-cancellation rejected; driver release, cancellation source/history and existing refund initiation retained. |

All six disappear from active KDS queries, even if requested explicitly as queue statuses. History/detail reads retain their original terminal status and payment balance. Normal status, assignment, delivery start, and ETA writes require the expected current status; completion writes also check the expected driver assignment. A lost guarded write returns a conflict and rolls back transaction effects. No new `COMPLETED` status was introduced.

4. Corrected deletion eligibility

The outstanding-summary query now uses the same `status.notIn` six-terminal-status set as the active-order query. Existing historical unpaid orders qualify immediately at the next backend eligibility check, without a backfill. Tests cover every terminal status with `UNPAID`, `PAID`, `PENDING`, `PARTIALLY_PAID`, and `FAILED` summaries.

Actual pending payment rows, pending/approved refunds, account holds, unresolved support/disputes, open cancellation requests, wallet balances, catering inquiries, leased reward notifications, staff history, authorization/session checks and deletion cleanup remain protected. Final deletion still rechecks blockers in its existing serializable transaction. No debt is settled or forgiven by eligibility.

5. Financial and retention invariants

Ordinary pickup/delivery/no-show closure never sets `paymentStatusSummary` to `PAID`, creates a payment transaction, changes a payment balance, or writes a cash-drawer event. Tests reject any payment write during KDS completion. The existing unpaid-completion audit remains a reconciliation record, not a financial transaction. Authorized collection can still occur separately after fulfillment; existing collection and refund regression suites pass.

The existing cancellation balance presentation/refund policy is unchanged. Deletion still uses the existing personal-data minimization and record-retention policy; payment amounts, transaction references and accounting/audit evidence are retained as before. No production record was modified during this work.

6. Verification results

Run from the repository root:

`node scripts/verify-terminal-orders.cjs`

Final combined run exited successfully:

| Check | Result |
| --- | --- |
| API mocked unit tests, including KDS/admin/chat/deletion/payments/refunds/rewards/realtime/orders | 361 passed, 15 suites |
| Website tests | 46 passed, 5 suites |
| Mobile tests | 184 passed, 11 suites |
| API TypeScript, no emit | Passed |
| Website TypeScript, no emit | Passed |
| Mobile TypeScript, no emit, using its installed compiler | Passed |
| `git diff --check` | Passed |

Total: 591 tests across 31 suites. Test execution replaces PrismaService with a constructor that throws, supplies only in-memory dependencies, blocks networking, rejects environment-file loading, and overrides database connection URLs with an unusable loopback target. No Prisma CLI, migrations, seed/reset/db-push command, app startup or production-connected e2e test ran.

An initial mobile selection included its real loopback socket integration suite. Five tests failed under the deliberate network prohibition; that integration suite was then excluded from the mock-only runner. All selected mocked suites pass. This report does not claim real-socket, browser, device, or PostgreSQL integration verification.

7. Remaining risks and independent blockers

Mocked concurrency tests validate guarded application writes and side-effect ordering; actual database concurrency should also be exercised in an independently verified isolated PostgreSQL environment before release. Existing post-commit chat/email/realtime delivery behavior remains in place; no durable notification outbox was introduced.

An existing separate inconsistency remains: the KDS cancellation denial path stores `DENIED`, while deletion's resolved-cancellation list includes `REJECTED` and not `DENIED`. Such records may still cause `OPEN_CANCELLATION`; no production records were inspected to determine prevalence. This independent blocker was left unchanged in accordance with the requirement to preserve other deletion protections. Existing pending cancellation requests also remain blockers when an order finishes; staff must resolve them through the appropriate decision workflow.

Account deletion remains subject to its existing explicit activation/policy-version settings and disabled-online-payment requirement. No flags or environment variables were changed. There is no blocker to reviewing this implementation.

8. Schema and migration requirements

None for this change. The existing Prisma enum already supports all six statuses. No schema, migration, generated client, or backfill is needed or was executed.

9. Git state

Local branch: `fix/terminal-order-lifecycle`. Changes are uncommitted and unpushed. No new commit hash exists. Base HEAD: `0c4fe5bad41d057a0af15679d1575c8943a4d749`. No merge or deployment was performed.

10. Deployment recommendations

Review the branch and perform isolated staging concurrency and staff/customer smoke checks. Following explicit deployment authorization, release the API and website together and refresh existing KDS browser sessions. Ordinary internal delivery clients must use the existing PIN-protected completion endpoint; the explicit external-provider path remains available. This patch has no mobile production-source changes and requires no mobile binary update for the corrected backend rule. Confirm eligibility for designated historical unpaid terminal orders while independently pending refunds/payments/holds still block. Keep existing environment settings, payment-ledger reconciliation, and retention policies intact; do not run a production migration or backfill for this fix.
