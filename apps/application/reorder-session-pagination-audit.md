# Final P2 security and P3 pagination fixes

Reference: `10754315f8e4718aa79ff62f3b5e48c50b5fe47f`. Changes remain local.

## P2: authentication identity races

The old global refresh promise could be shared across accounts. Its two independent
token writes and subsequent callbacks had no identity check. An old refresh could
therefore restore A's credentials or clear the session after B signed in. Initial
session restoration and delayed native storage operations exposed the same race.

Changed production files:

- `src/lib/token-store.ts`: an in-memory generation changes on new credentials or
  logout. Login installs the access/refresh pair atomically; refresh rotation must
  match its originating generation and retains that generation. Cold native reads
  reject after identity changes. Native mutations run in one queue and check the
  generation before each operation. An already-started OS write cannot be canceled;
  newer credentials persist after it, and the old operation's remaining writes are
  skipped. Memory is never reverted. No persistent metadata or storage keys added.
- `src/context/session.tsx`: refresh single-flight is scoped to the generation;
  completion of an older flight cannot release a newer flight's lock. The helper
  checks identity after the initial response, after refresh, before callbacks and
  around the sole retry. Provider session responses are also generation-checked.
  A generation subscription immediately hides old identity/profile data until the
  new generation's session is confirmed, including during delayed native writes.
- `src/hooks/use-auth.ts`: login, verification and reset-session establishment
  capture the initiating generation. Delayed credentials and confirmation failures
  cannot replace/clear a newer session. Logout clears locally before waiting for
  HTTP; no late logout callback can clear a new login. Session clearing owns the
  single synchronous invalidation and asynchronous native deletion.

Existing account-data request/page guards remain unchanged. Their user isolation
now also benefits from immediately hidden old session state. Same-session refresh
still shares one request and retries each protected request at most once. Temporary
refresh failures preserve credentials; obsolete operations fail with a retryable
session-changed message and do not invoke refresh/clear callbacks.

Tests: `tests/session.test.cjs`, `tests/token-store.test.cjs`,
`tests/auth.test.cjs`. Real token-store/provider code runs against mocked HTTP and
SecureStore. Coverage includes cold restoration, successful retry, concurrent 401s,
no retry loops, transient/definitive failure, logout/B login during old refresh,
old success/rejection/server failure, separate flights, delayed token reads/native
writes/deletes, delayed login/session confirmation, immediate old-data hiding,
and the actual account Load More flow receiving an old refresh after B signs in.

## P3: deterministic order history

`apps/api/src/modules/orders/orders.service.ts::listOrders` now uses:

```ts
orderBy: [{ placedAt: "desc" }, { id: "desc" }]
```

The unique ID resolves timestamp ties. The existing ID cursor, `skip: 1`, `take:
limit + 1`, default 20 and cap 50 remain. Response stays `{ orders, next_cursor }`.
No route, frontend cursor type or serialization changed. Customer/mine, location,
status and local-date filters and controller role guards remain intact. A supplied
cursor must be a UUID and match the same filtered scope via `findFirst`; malformed,
deleted or out-of-scope anchors receive a generic HTTP 400 rather than a foreign
or misleading continuation. Clients retain their loaded rows on paging errors.

`orders-pagination.spec.ts` executes a mocked Prisma query interpreter applying
the actual filters, ordering, cursor, skip and take to fixtures. It deliberately
varies ties without a secondary key. Thirteen cases cover 65 rows across mixed
timestamps (20/20/20/5), 45 identical timestamps, exact final pages, cap 50, missing
and duplicate detection, scoped cursor rejection, Toronto date boundaries,
customer/location/status isolation, staff/mine behavior and the empty contract.
This is not a PostgreSQL integration test. No database was accessed.

Schema inspection: `idx_orders_customer(customerUserId, placedAt DESC)` supports
customer history but lacks the ID tie-breaker; the order ID primary key supports
anchor lookup. `idx_orders_loc_status_sched` serves different filters. Optionally
evaluate `(customerUserId, locationId, placedAt DESC, id DESC)` using an approved
nonproduction query plan if history volume warrants it. No index/schema/migration
change is needed for correctness or was executed.

## Verification and remaining QA

Final checks use only offline mocks. A temporary Node guard blocks external/TLS
connections and PostgreSQL ports; loopback HTTP is allowed for mocked Nest HTTP
tests. No application startup or database-connected e2e command was run.

| Command | Result |
| --- | --- |
| `tsc --noEmit -p apps/application/tsconfig.json` | Passed |
| `tsc --noEmit -p apps/api/tsconfig.json` | Passed |
| `npm test --workspace @wings4u/application -- --silent` | 40 suites, 396 tests passed |
| `npm run test:unit --workspace @wings4u/api -- --silent` | 53 suites, 935 tests passed |
| `jest --config apps/web/jest.config.cjs --runInBand --silent` | 10 suites, 89 tests passed |
| `git diff --check` | Passed |

The full runs include account pagination/Profile placement, mobile Reorder and
website contract parity, cart/quote/checkout and ordering service regressions.
No final failures. No UI, builder, CartService, CheckoutService, promotion,
loyalty, payment or navigation implementation changed.

**READY FOR MANUAL QA:** verify rapid account switching/background restoration on
iOS/Android SecureStore and Profile > Orders > Past paging/reordering with more
than 20 nonproduction orders, including timestamp ties and invalidated cursors.
Device behavior and actual PostgreSQL execution remain manual/staging checks.

No production database access, live authentication, migration, seed, environment
or connection change, real order/payment/refund/email/KDS action, deployment,
commit, push or merge occurred. Logs describing those actions are mocked fixtures.
