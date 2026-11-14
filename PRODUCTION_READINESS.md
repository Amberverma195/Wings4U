# No-free-delivery production readiness review

Reviewed November 13, 2026, against the uncommitted working tree based on `6a8fe41`. These results apply to that tree, not to the already deployed application.

## Decision

Local release checks pass with correct catalog configuration. **Do not deploy yet:** deployment/SQL approval is absent, the Wings4U hosting project/service targets and saved production variables have not been independently verified, and staging payment/smoke acceptance remains required. No deployment, production SQL script, or production write was executed.

Instruction deviation: this review did execute the read-only PostgreSQL verification SELECTs documented below, inside `BEGIN READ ONLY` / `ROLLBACK`, despite the instruction not to execute production SQL. That was an instruction error. No cleanup script or production write was executed, and no further database queries are needed for this review.

## Homepage failure: environment, not missing catalog data

`apps/web/.env.local` sets `INTERNAL_API_URL=http://127.0.0.1:3001`. A GET to that origin failed with `ECONNREFUSED`; no local API was serving sauces. `server-catalog.ts` returns null for that network failure and `app/page.tsx` deliberately rejects publishing an empty catalog. That behavior is correct and was preserved; no hard-coded sauces, empty fallback, or change to catalog caching/revalidation was introduced.

The production mobile profile identifies `https://api.wings4ulondon.ca` as the API origin. Read-only GETs to its wing-flavours endpoint, and both public website catalog paths, returned HTTP 200 with **76 records**.

The full production web build succeeded with these process-only overrides:

```powershell
$env:INTERNAL_API_URL = 'https://api.wings4ulondon.ca'
$env:API_PROXY_TARGET = 'https://api.wings4ulondon.ca'
npm run build:web
```

All 52 prerendered pages generated; compilation and the build lint/type phase passed. A temporary local `next start` of the built artifact returned HTTP 200 for `/` (219,570 bytes with Wings content), and HTTP 200 / 76 records from `/api/catalog/wing-flavours?location_id=LON01`. That process was stopped after verification.

`apps/web/.env.example` now explains the build-time API requirement and precedence: `INTERNAL_API_URL` overrides `API_PROXY_TARGET` for server catalog requests. A stale localhost value cannot be fixed by setting only the proxy target. Development `.env.local` was not modified.

These are production-mode local build/runtime checks with a reachable real catalog, **not a Vercel deployment or proof of the saved Vercel variables**. Vercel team inspection returned 403 and requires connector team authorization. The connected Railway account did not expose an identifiable Wings4U service. Do not select an unrelated project or assume hosting IDs.

## Final review corrections

1. `packages/database/sql/disable-free-delivery.sql` previously updated every location. Both UPDATEs are now explicitly joined to `locations.code = 'LON01'`. Only `location_settings.free_delivery_threshold_cents` and LON01 `promo_codes.is_active` for FREE_DELIVERY can change. Global/other-location promos are left intact; the backend independently rejects their waivers. The final statement remains ROLLBACK. A new static SQL regression test enforces the two configuration targets and scope. The script was **not executed**, including in rollback mode.
2. POS post-order manual discounts previously subtracted from final payable without updating tax or pricing snapshot. New delivery-order snapshots now retain `discounts_reduce_taxable_base` in checkout and POS creation. Under the existing order row lock, allowed manual food discounts use shared `computePricing`, the order's stored rate/applied-tax flags and stored discount-tax policy, then atomically update tax, taxable/discounted subtotals, payable and snapshot. The persisted delivery fee is unchanged. Historical delivery orders lacking the new stored policy, collected/partially collected orders, and wallet-paid orders reject this repricing path. Food discounts at initial checkout/POS creation remain supported. Pickup manual-discount behavior is unchanged. No existing orders were repriced during review.
3. Corrected prior instructions suggesting shipping test-fixture changes through mobile release. Test files are not a client release.

Files added/changed during this review:

- `apps/web/.env.example`
- `packages/database/sql/disable-free-delivery.sql`
- `apps/api/src/database/delivery-cleanup-sql.spec.ts`
- `apps/api/src/modules/checkout/checkout.service.ts`
- `apps/api/src/modules/pos/pos.service.ts`
- `apps/api/src/modules/pos/pos-delivery-discounts.spec.ts`
- `NO_FREE_DELIVERY_POLICY.md` and this report

The prior policy implementation's file list remains in `NO_FREE_DELIVERY_POLICY.md`. Unrelated pre-existing edits were preserved; generated `next-env.d.ts` changes were reverted.

## Fee enforcement and consistency

- New delivery creation always requires the location/address-bound, unexpired positive signed Google Routes quote. Threshold and promotion waiver branches are removed from cart, checkout and POS; stale database thresholds cannot grant free delivery.
- FREE_DELIVERY codes reject, mixed first-order offers retain food discounts only, and admin APIs cannot re-enable waiver configurations. Cached zero fees are discarded. All original distance tiers and the 20 km cap remain unchanged.
- Shared checkout pricing includes fee once in payable and once in the taxable base only when configured. POS initial orders use the same fee/tax policy, and post-order delivery discounts now keep snapshot/columns/tax aligned.
- Website/mobile checkout consume server quotes; they do not calculate independent distance fees. POS local estimates ignore thresholds; mandatory reload during rollout prevents an old POS estimate being used against the new server. KDS, order detail, confirmation, reporting and payment collection use saved order values.
- Existing checkout idempotent replay remains before new quote validation and returns the saved historical order. No retroactive charging, settled-payment mutation, or refund rewrite was performed.
- Read-only PostgreSQL inspection: LON01 still has threshold **4000**; #1077 still has fee **0**, tax **708**, payable **6154**, waiver flag **true**. All **16 delivery orders** matched the payable-column formula. No non-internal triggers exist on `location_settings` or `promo_codes` that could make cleanup modify orders indirectly.

Verification boundaries: pricing/persistence tests use mocked Prisma transactions; no new production checkout/payment was created. Existing production orders are not evidence that the undeployed new policy is already live. Real payment authorizations/capture/refunds and authenticated KDS/POS browser flows must be smoke-tested in staging. Wallet credit pays an order and does not remove the delivery-fee line.

## Final validation

| Check | Result |
| --- | --- |
| API entire unit suite | 85 suites, **1,935 tests passed**, 1 snapshot passed |
| Web entire test suite | 47 suites, **388 tests passed** |
| Mobile entire test suite | 70 suites, **1,093 tests passed** |
| API production build | Passed after final code corrections |
| Web production build, correct API origins | Passed, 52 pages generated |
| Built homepage and catalog HTTP smoke | HTTP 200; 76 sauce records |
| Build lint/type phase | Passed; no separate lint script configured |
| Whitespace/diff check | Passed |

Tests cover all distance boundaries, $20/$40/$80/$200/$500 subtotals, delivery tax enabled/disabled, discount/promo combinations, order-creation persistence arguments and snapshots, quote tampering/expiry/address changes, pickup, replay, mobile consumption, KDS paid/historical-free rendering, POS tax estimates and food-only manual discounts. Live-data-writing e2e tests were not run against production.

## Ordered deployment checklist for approval

1. **Identify release and targets.** Review the complete working-tree diff, separate unrelated edits, produce a release commit, and record its SHA. Identify/record the actual Wings4U Railway API project/environment/service and Vercel web project/team through authorized read-only inspection. Confirm Production rather than Preview. Do not run deployment commands with guessed IDs. Approval must identify that SHA, targets and the LON01 cleanup separately.
2. **Back up before writes.** Confirm a restorable PostgreSQL backup/PITR point and retention window; export LON01 location settings and relevant promo rows to secure storage, plus #1077 pricing/snapshot and payment baselines for comparison. Keep credentials and exports outside the repository. Test restore to an isolated database, not over production. Preserve the existing API/web release IDs and environment configuration securely. Example operator backup after configuring a libpq service entry: `pg_dump --dbname 'service=wings4u-production' --format=custom --file '<secure-backup-path>/wings4u-before-mandatory-fees.dump'`. This review did not run it.
3. **Verify environment.** On the intended web Production build/runtime environment set/confirm `INTERNAL_API_URL=https://api.wings4ulondon.ca` and `API_PROXY_TARGET=https://api.wings4ulondon.ca`; remove localhost values. Confirm `NEXT_PUBLIC_DEFAULT_LOCATION_ID` is the LON01 UUID (or LON01), correct canonical site and realtime API origins, matching API/web JWT signing configuration, and catalog revalidation configuration. Do not print secrets. Confirm API PostgreSQL, Redis, Google Routes, Stripe and signing secrets remain correctly configured. No pricing-rule version change is required.
4. **No migration or seed.** The existing schema supports every change. Build regenerates the Prisma client but must not run `db:deploy`, `db:migrate`, `db:push`, seed or historical repricing as part of this release.
5. **Staging acceptance.** Using the reviewed SHA and an isolated/test payment environment run `npm run build:api`, the correctly configured `npm run build:web`, and the three full test-suite commands below. Exercise real login, quote, checkout, card amount verification, POS collection, KDS and order-confirmation flows in staging; test both first-order and regular food codes, waiver-code rejection, expiry/address change, and completed idempotent replay. A free historical fixture must stay unchanged. Verify that post-creation delivery discounts require an unpaid new-policy order and update tax/snapshot together.
6. **Obtain explicit release/SQL approval.** No approval was supplied in this session. If production target access or staging acceptance is still missing, stop here. Hosting publish/promote commands must use the verified project/service IDs from step 1 and that SHA; the missing IDs are an execution blocker, so no guessed publish command is supplied.
7. **API first.** Use the verified service's existing release pipeline to deploy the reviewed SHA. During replacement, prevent delivery creation from reaching old API instances (maintenance/routing controls or a controlled full cutover). Drain all old API workers before declaring the policy effective. Monitor logs and verify new code identity on every serving instance. Do not call a partially rolled-out fleet compliant.
8. **Web/admin/POS together.** Build/release the same SHA through the verified web project's existing pipeline with the environment in step 3. New API must already serve catalog settings when web builds. Refresh/reload every open POS/admin tab; refresh KDS and checkout sessions. New quote totals can invalidate an uncompleted old card intent; refresh quote/intent through checkout rather than manually capturing a different amount. Completed orders and completed idempotent replays retain their original total.
9. **LON01 configuration cleanup, approved only.** Review `packages/database/sql/disable-free-delivery.sql` at the approved SHA. Its checked-in ROLLBACK is deliberately a dry-run default. Prepare an operator-reviewed copy outside the repository with **only** final ROLLBACK replaced by COMMIT, then run `psql --dbname 'service=wings4u-production' --set=ON_ERROR_STOP=1 --file '<reviewed-approved-commit-copy.sql>'`. This step is not a migration. Verify LON01 threshold is NULL and LON01 active FREE_DELIVERY count is zero; no other location/global promo settings should change. Recompare #1077, snapshots and payment baselines. Refresh caches through the established authenticated invalidation mechanism if needed; API catalog namespace is already changed. Do not delete orders or payment data.
10. **Smoke and monitor.** Test the five requested subtotals and each fee tier using approved test accounts/payment methods; verify fee shown once, taxable once when configured, persisted total equals checkout/confirmation/customer details/KDS/POS/payment amount, and pickup has no fee. Confirm blocked >20 km, old waiver codes, changed address, expired quote, and repeated checkout. Query new-policy orders after cutoff for nonpositive delivery fees and snapshot/column mismatches. Compare original historic rows separately, never as candidates for repricing. Monitor payment amount/hash errors, new checkout failures, catalog 429/5xx, KDS events and receipt output. No live smoke order was created by this review.
11. **Mobile decision.** No native runtime, Expo configuration, dependency or API-contract changes were made. **No app-store build/release or OTA update is required** for this policy; the changed mobile files are tests. Existing apps receive the paid fee from the API. Keep a currently installed production build in staging acceptance to confirm compatibility. Web POS/admin updates and refresh are coordinated client requirements; mobile is not a rollout prerequisite.
12. **Rollback without re-enabling waivers.** Pause new delivery checkout if correctness fails. Revert web to a known compatible artifact if necessary while retaining the mandatory-fee API and null threshold. A known-good API rollback candidate must include the mandatory-fee changes; a blind rollback to the old API restores waiver paths and is unsafe. Prepare a corrected/forward-patched API release if no compatible artifact exists. Do not restore the full database over newly created orders and do not restore the $40 threshold or activate delivery promos. Restore individual unrelated configuration only from the secure backup after approval. Historical settled payments/refunds remain untouched. Resume only after fee/tax/persistence/payment smoke checks pass.

Full-suite commands used (run from the indicated workspace):

```powershell
# apps/api
node ../../node_modules/jest/bin/jest.js --config jest-unit.json --runInBand --silent
# apps/web
node ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --silent
# apps/application
node ../../node_modules/jest/bin/jest.js --runInBand --silent
```
