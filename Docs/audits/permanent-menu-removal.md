# Permanent Admin menu removal and initialization safety

Date: 2026-10-18. Baseline: latest `origin/main`, `8a7254f` (including PRs #7, #8 and #9). Production menu state was not inspected. This report concerns confirmed code paths, not proof that any script has run against production or undone the owner's cleanup.

## Root causes and severity

| Path | Confirmed behavior before this fix | Risk and protection |
|---|---|---|
| `sync-builder-config.ts` | `ensureGroupOptions()` set existing options active, overwrote prices/mappings/order, and created absent options. `ensureGroup()` rewrote limits/labels. `attachGroup()` upserted links; the main routine deleted/replaced addon and combo links, removed salad options, changed combo descriptions/types, archived a SKU and renamed options across locations. | High impact if explicitly invoked on an allowed existing database. Its strict local/disposable production guard already blocked hosted production targets; no evidence it was automatically running or caused this cleanup issue. The entire reconciliation writer is now retired. |
| Existing-location seed branch | Full creation was skipped, but legacy repair operations still rewrote menu labels, authorization mappings, recipe labels, item names and the Veggie Wrap description. It also overwrote some location settings and filled hours. | Existing admin values could be overwritten on a permitted local rerun. The strict production guard already existed. An existing LON01 now returns immediately with zero writes, including no legacy repairs or settings changes. |
| `import-menu.ts` | Confirmation plus no existing orders allowed destructive menu replacement, but there was no strict production target guard. | P1 safety gap: an explicit reset could reach a hosted database if its order-count condition allowed it. The same fail-closed local/disposable guard now runs before client construction or any DB query. Reset confirmation cannot bypass it. |
| `normalize-menu-legacy-sizes.ts` | Standalone legacy conversion deleted/recreated products, size modifiers and links and filled missing descriptions without a production guard. | High impact if manually invoked; no tracked caller was found. It now requires the same strict local/disposable guard before client construction. It was not executed. |
| Admin combo-side helper | Every product edit could reactivate an inactive linked side option, or recreate an absent option in every side group. | P1 persistence defect for option-level cleanup. Existing inactive/missing choices are now preserved on unrelated saves. New side products and deliberate false-to-true side membership changes retain explicit creation/restoration behavior. |
| Admin paid-extra removal | Sets `isActive: false`; shared-group edits copy for the edited product and unlink the original. | Intended behavior, not a hard-deletion defect. Active-only queries already exclude removed rows; real API catalog serialization and ordering checks are covered by stateful mocked regressions. |

## How removals persist

`updateAdditionalIngredients()` retains the existing inactive option ID and its historical row. `getItem()` and modifier-group lists request only active options. The public CatalogService also requests only active options, so both customer clients receive the same reduced catalog after refresh. Current API builder validation rejects inactive IDs and IDs whose groups are no longer linked to the selected product. An existing row is not permission to order it.

The existing transactional update and post-save API cache invalidation, website revalidation request and catalog realtime notification remain intact. Tests verify these invalidations occur on every successful save. Website revalidation depends on its configured callback; the existing bounded cache refresh remains the fallback. Mobile receives updated data after catalog refresh. No claim of live deployment/cache verification is made.

Soft deletion is required for paid modifiers: `OrderItemModifier.modifierOption` and `.modifierGroup` have `onDelete: NoAction` foreign keys, alongside immutable name and price snapshots. Saved carts store selections and removals as JSON; stale IDs must be reviewed/rejected rather than silently replaced. Admin audit payloads retain generic entity IDs/JSON, without a modifier-option cascade relationship. Removable recipe rows have no corresponding historical modifier FK; the existing per-item removal behavior is retained, including stable IDs for unchanged rows. No mass deletion, hard-delete rewrite, tombstone table or schema migration was added.

Shared-group cleanup preserves original groups/options for other products and historical orders; only the edited item moves to its private copy. Copying does not create item approval for old unscoped `__always__` values. IDs change where copies are required, not for ordinary exclusive-group removals. Unlinked groups stay unlinked; seed and builder comparison do not restore them. Hidden/archived products, removed recipe rows, selection limits, prices and explicit approvals remain authoritative.

Restoration remains possible through authorized Admin operations. An administrator can add a newly approved extra deliberately, including a previously removed name, without reactivating the historical inactive row. For an individually removed combo-side option, changing stock status or saving an unchanged side checkbox is insufficient to restore it: explicitly edit its option, or disable/save and re-enable/save side membership if restoration to the side groups is intended. This conservative behavior avoids guessing why an inactive option was disabled.

## Builder command and initial setup

`db:builder:sync` retains its familiar entry point but now performs **offline review only**. With no snapshot it explains the policy and exits without a connection or write. With `--snapshot <local-catalog.json>`, it compares the recorded catalog with the historical scoped addon specifications. It reports absent products, absent groups/links, absent options, inactive options, price/mapping differences, selection-limit differences, and hidden/archived products. Every difference has the action `PRESERVE_ADMIN_CONFIGURATION`; all supplied groups/options/scopes are retained in the report, including administrator-only extras such as Bacon. The comparison is not a complete desired-state diff for every former wing/combo mutation; those mutation paths were removed entirely.

The command does not load dotenv, import Prisma or construct a DB client. There is no apply, initialize or force mode. Missing records cannot distinguish deliberate removal from incomplete setup, so they are never created, reactivated or reattached. No snapshot was refreshed from production, and this CLI was not executed during verification; its pure comparison function was exercised by tests.

Fresh disposable development setup still uses the original Prisma seed entry point and strict production guard. The full fresh-location transaction was moved, byte-for-byte, into an import-safe provisioning routine to test it without a database client. The entry point retains environment loading, guard-before-client ordering and disconnect handling. No existing catalog can be reconciled through this initializer: the existence of LON01 causes an immediate return even if its menu is completely empty after intentional cleanup. The old builder reconciliation command is no longer an initialization mechanism. Existing local installations should use Admin; a genuinely fresh disposable setup uses the guarded seed. No database was installed, switched, reset or seeded for this task.

## Execution-path audit

- Root `db:builder:sync` and `db:menu:import` are explicit utility commands; merely defining them does not execute them.
- The tracked legacy-size conversion has no tracked automatic caller; its newly added guard also blocks hosted production use.
- Prisma config names `seed.ts` for explicit seed/reset workflows and applies the existing strict destructive guard. The seed entry point independently guards direct invocation.
- Root `ci` builds/generates locally and invokes API e2e. E2e global setup explicitly migrates, truncates and seeds **only after its strict local/disposable guard**. Neither root CI nor e2e was run for this task.
- API `prebuild` builds shared customization and generates local Prisma client files. API `build` compiles Nest; `start` runs `dist/main.js`. None invokes menu seed/sync/import. API startup has no menu reconstruction initializer. Existing Redis/KDS initializers do not reconcile menu definitions.
- Web build compiles Next; mobile start/build tooling does not reconcile database menus.
- The tracked overdue-delivery cron entry point handles overdue support tickets, not menu synchronization.
- No tracked Railway config, Dockerfile, Nixpacks config, Procfile or GitHub Actions workflow was found. A locally present `.github/workflows` CI file is ignored by git; it calls root CI, not builder sync. It is not evidence of an active remote workflow.
- Railway dashboard build/start/pre-deploy/cron overrides, remote Actions history and historical command execution logs were not available or inspected. Their settings need a separate authorized operational review if stronger deployment assurances are required.

## Remaining risks and separate authorization

Old binaries or externally copied scripts are outside the protection of new source. Deployments must use the current revision. An authorized administrator or direct database operator can deliberately restore inventory; that capability is intentionally retained.

Existing migration files contain data transformations: April 10/11 label and recipe-description updates; July 16 category splitting/insertion and dynamic combo-side linking. Their applied/pending production status is unknown because no DB inspection was authorized. Existing migrations were neither edited nor run. Do not add seed/sync/import or blindly apply pending data-changing migrations to deployment commands. Reviewing Railway settings, migration history, deployment status or live data requires separate authorization/access. No new migration or production configuration change is needed for this source fix.

The menu import remains an explicitly destructive, confirmed **local disposable** utility with its existing order-count refusal; it has no production override. Production cleanup and current owner-approved inventory are unchanged by this work. No broad inventory allowlist/denylist was introduced, and no Bacon, Cheese, sauce, avocado or jalapeno records were approved, removed, remapped or repriced in production.

## Files changed

- `apps/api/src/modules/admin/admin-menu.service.ts`: preserve inactive/missing combo-side options unless Admin explicitly enables membership.
- `apps/api/src/modules/admin/admin-menu-preservation.spec.ts`: stateful Admin/catalog/order-validation/removal/reopen/shared-group/repeated-plan tests.
- `packages/database/prisma/sync-builder-config.ts`: offline-only CLI, with no database access or writer.
- `packages/database/prisma/builder-defaults.ts`: former scoped defaults retained only for comparisons.
- `packages/database/prisma/builder-sync-plan.ts`: pure preserve-only comparison.
- `packages/database/prisma/seed.ts`: guarded CLI wrapper retained; delegates to import-safe core.
- `packages/database/prisma/seed-catalog.ts`: original fresh transaction; immediate no-write existing-location exit.
- `packages/database/prisma/import-menu.ts`: strict target guard before client creation.
- `packages/database/prisma/normalize-menu-legacy-sizes.ts`: same guard for the additional confirmed legacy conversion path.
- `packages/database/test/menu-preservation.test.mjs`: pure planner, mocked fresh/existing initialization, synthetic guard environments and historical-reference contracts.
- `packages/database/tsconfig.menu-tools.json`: type-check maintenance utilities without executing them.
- Root and database `package.json`: offline safety test and type-check commands.
- This report.

## Verification

Validation uses the existing outbound-socket-blocking preload; API tests also substitute the environment-loading Prisma service. The provisioning core receives only JavaScript fake repositories; its normal seed log messages refer exclusively to in-memory test writes. No database-backed CLI entry point is imported or executed by these tests.

The stateful regression sequence starts with five Chicken Burger extras, removes each of Avocado/Jalapenos/an ordinary sauce in separate cases, reopens the editor, saves unrelated changes, repeats the save and runs the pure builder comparison twice. It checks inactive-row retention, no duplicate ID creation, unchanged remaining option IDs/prices/mappings, absent public choices, rejection by current API validation, accepted approved Bacon at 150 cents and retained historical references. Additional cases cover shared-group isolation, intentional Admin restoration, removed links/recipe rows, archived/hidden products and explicit combo-side restoration. Separate mocked initialization tests cover a fresh full menu and repeated existing-location calls. Synthetic guard tests cover hosted, remote, mixed, malformed, missing and local targets; they never read/change real connection variables.

Final checks passed:

- New database utility safety suite: 7 tests, entirely mocked/in-memory.
- Shared customization: 46 tests and TypeScript build.
- API: 55 unit suites / 1,153 tests, including 9 new stateful preservation cases.
- Website: 13 suites / 117 tests.
- Mobile: 42 suites / 516 tests.
- Total: **1,839 tests passed**.
- API and mobile TypeScript no-emit checks; dedicated seed/import/legacy-conversion/planner TypeScript checks; shared and database package builds.
- Nest production build invoked directly to bypass Prisma generation/prebuild.
- Next production build and type validation, with 51 static pages served from an ephemeral loopback catalog stub during build rather than production API data.
- Fresh provisioning transaction compared byte-for-byte with the baseline source: unchanged.
- `git diff --check`.

Initial new API test fixture typing errors were corrected before the passing final runs. No signed native build, interactive device QA, live checkout or production deployment verification was performed. Existing untracked `.expo/` and root `tsconfig.json` are preserved and excluded from the commit. Next's generated `next-env.d.ts` change was restored after the build.

No production database reads or writes, migrations, seed/sync/import execution, real orders/payments, environment-file changes or database installations/switches occurred. No migration, mass deletion or production dashboard change is part of this fix. Git pushes/merging into main are explicitly authorized in the request; any resulting hosting rollout is not a live verification of the owner's menu.
