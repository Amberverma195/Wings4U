# Saved-address duplicate prevention

Implemented October 16, 2026. No application database was connected to, migrated, cleaned, or deployed during this task. All database verification used newly created, disposable in-memory PostgreSQL instances.

## Confirmed causes and affected paths

1. Saved-address postal normalization collapsed whitespace instead of removing it before reformatting, so `N5Y4J7` and `N5Y 4J7` did not compare equally.
2. Address lookup compared street and postal only, omitted city, and did not collapse internal street whitespace.
3. Create/ensure used a read-before-write check without a database uniqueness constraint; simultaneous requests could both create a record.
4. Edits did not check the resulting address against other saved addresses.
5. Website comparisons repeated the postal/street issues. Signed-in writes created temporary optimistic rows and swallowed server failures, so an edit could appear saved and close before its rejection arrived.
6. Mobile address-book saves and delivery checkout used different postal normalization. The API already had a suitable Canadian postal utility, but the address-book service did not use it.

The website address form, pending guest migration (`POST /customer/addresses/ensure`), mobile address book (`POST/PATCH /customer/addresses`), and delivery checkout converge on the address service/helper. Checkout already calls `ensureCustomerAddressExists` inside its order transaction, so its orchestration did not need rewriting. The mobile profile already displays save errors and refreshes account data after a successful save. Admin profiles read the authoritative address records and do not need a frontend filter.

## Comparison rules

- Ownership is always the authenticated user's ID.
- Street/unit and city: NFKC normalization, trim, collapse whitespace, compare without case differences.
- Postal code: NFKC normalization, remove whitespace, uppercase, format six characters as `A1A 1A1`. Comparison uses the compact form.
- Identity contains **street including unit, city, and postal code**, scoped by user. Postal code alone is never unique.
- Unit 111 and unit 112 remain distinct. Punctuation and street abbreviations are not guessed or geocoded into an identity.
- Stored street/city spelling is preserved except whitespace normalization. Saved postal codes use the Canadian display format. Existing order snapshots are untouched.

## Creation, edits, defaults and concurrent requests

Address writes acquire a transaction-scoped advisory lock for that customer. Manual create-or-reuse, ensure, editing, deletion and checkout share the lock convention. Create-or-reuse returns the existing ID; ensure preserves its label and default without updating it. A genuinely different address is appended. Default changes occur within the same transaction as the successful save, and a rejected operation cannot clear the old default.

Editing checks every resulting canonical identity against the customer's other rows and returns HTTP 409 with `This address is already saved.` on conflict. It does not merge, overwrite or delete another row. Database uniqueness failures also map to that response outside the rolled-back transaction.

The database migration adds a trigger-owned `canonical_key`, a unique `(user_id, canonical_key)` index, an expression lookup index, and a trigger using the same customer lock. The trigger calculates keys for new/changed identities and checks legacy rows as well. Direct writes cannot evade enforcement by supplying a null or forged key. A unique index protects simultaneous writes to a new identity; transaction locks make API create-or-reuse deterministic. Address ownership cannot be reassigned by an update.

## Website/mobile behavior

- Signed-in website saves wait for the API and store the returned database ID. Temporary guest IDs are replaced when guest migration succeeds.
- Failed edits preserve the previous cache and checkout draft, display the error, and keep the editor open. Repeated submit clicks are blocked while saving; a response after closing/reopening the editor cannot commit an obsolete draft.
- Guest comparisons, picker selection, saved drafts and checkout use canonical formatting, including city and unit identity.
- Cache responses from a previous account or a refresh started before a confirmed write cannot overwrite the new state.
- Mobile address-book saves and checkout use one normalization helper. Existing refresh/error behavior is retained.
- Address removal and default selection remain available. The admin profile continues to show actual saved records rather than concealing duplicates with a view-only filter.

## Migration and existing duplicates

Migration: `packages/database/prisma/migrations/20261016120000_customer_address_identity/migration.sql`.

It is intentionally additive and does **not** normalize, backfill, merge or delete existing customer rows. Legacy keys begin as NULL, allowing the unique index to be installed even when duplicate rows already exist. The trigger still compares against those legacy addresses, preventing another equivalent insert or an identity-changing edit into an existing address. It permits database metadata/default maintenance of unchanged legacy identities. The API edit endpoint is stricter and rejects an edit whose resulting address duplicates another row.

**Cleanup is not a prerequisite for installing this migration or preventing new duplicates. Existing duplicate rows remain visible until a separately approved cleanup.** Nullable legacy keys are intentional; full backfilling/NOT NULL enforcement would require resolving all duplicate groups first and is not part of this rollout.

## Read-only reconciliation report and review procedure

The preview works before or after the migration. It runs a read-only transaction, uses an explicitly supplied database URL without loading `.env`, and refuses to overwrite its output file.

```powershell
$env:ADDRESS_RECONCILIATION_DATABASE_URL = '<explicitly selected PostgreSQL connection string>'
node packages/database/prisma/preview-customer-address-duplicates.mjs address-duplicates-preview.json
```

No production preview was run during implementation. The report includes each duplicate group's user ID, canonical identity, street/unit, city, postal code, labels, default flags, created/updated timestamps, all address IDs, recommended retained ID and duplicate IDs. It also lists incoming database foreign-key references to the address table.

Retention is deterministic: prefer a default, then a labeled record, then the oldest created timestamp, then ID. If the preferred default has no label, recommend a valid group label. Conflicting nonempty labels are explicitly flagged for review. Different units, cities and customers are separate groups.

For a later approved reconciliation:

1. Review the report and approve exact customer/address IDs and retained labels. Resolve conflicting labels and inspect any incoming references first. The current Prisma schema has no incoming address-ID references, but the report checks the live catalog rather than assuming that.
2. Take the usual database backup and refresh the report if records changed. During the approved operation, lock each affected customer's address book, then recheck IDs, full address identity, labels, defaults, timestamps and references against the reviewed report.
3. Retain the selected ID, preserve the approved label/default, and remove only explicitly approved redundant address rows in one transaction. Do not modify accounts, orders, wallet/reward records or order snapshots. Existing client caches need an authoritative refresh when a redundant address ID is retired.
4. Save before/after records and the approved ID mapping in a durable audit report, verify only the reviewed rows changed, then commit. Roll back on unexpected differences or dependencies. Rerun the read-only preview afterward.

The initial delivery included only the read-only planner/preview after automatic approval review rejected an executable cleanup utility. The user subsequently approved implementing that utility **for code review only**. It is now implemented and documented in `ADDRESS_CLEANUP_REVIEW.md`; its CLI has not been executed and live deletion is still not authorized. The original planner/preview remain read-only.

## Exact files changed or added

1. `apps/api/src/modules/customers/customer-address-identity.ts` (new)
2. `apps/api/src/modules/customers/customer-addresses.service.ts`
3. `apps/api/src/modules/customers/customer-addresses.service.spec.ts`
4. `apps/api/src/modules/delivery-pricing/delivery-address.ts`
5. `apps/api/src/modules/delivery-pricing/delivery-address.spec.ts`
6. `apps/application/app/checkout.tsx`
7. `apps/application/src/hooks/use-account-data.ts`
8. `apps/application/src/lib/delivery-address.ts` (new)
9. `apps/application/tests/delivery-address.test.cjs` (new)
10. `apps/web/src/lib/delivery-address.ts`
11. `apps/web/src/Wings4u/components/order-method-modal.tsx`
12. `apps/web/src/components/delivery-address-provider.tsx`
13. `apps/web/src/app/account/addresses/page.tsx`
14. `apps/web/tests/delivery-address.test.cjs` (new)
15. `apps/web/tests/address-editor.test.cjs` (new)
16. `packages/database/prisma/schema.prisma`
17. `packages/database/prisma/migrations/20261016120000_customer_address_identity/migration.sql` (new)
18. `packages/database/prisma/address-reconciliation.mjs` (new)
19. `packages/database/prisma/preview-customer-address-duplicates.mjs` (new)
20. `packages/database/test/customer-address-identity.test.mjs` (new)
21. `packages/database/package.json`
22. `package-lock.json`
23. `ADDRESS_DEDUPLICATION_IMPLEMENTATION.md` (new)

The pre-existing mobile menu-screen edits, other migration edits/directories and stamp-email plan were left intact. Next's generated route-reference change was reverted after the build.

## Verification actually executed

- Relevant API Jest suites: **9 suites, 96 tests passed**. Command: `node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --testPathPattern 'customer-address|delivery-pricing|checkout-idempotency|admin-customers'`.
- All web Jest suites: **6 suites, 76 tests passed**. Command: `node node_modules/jest/bin/jest.js --config apps/web/jest.config.cjs --runInBand --silent`.
- All mobile Jest suites: **15 suites, 96 tests passed**. Command: `node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent`.
- Database/planner tests: **9 passed** (eight disposable embedded PostgreSQL tests, one deterministic planner test). Command: `npm run test:addresses --workspace @wings4u/database` (the equivalent `node --test packages/database/test/customer-address-identity.test.mjs` was executed).
- Prisma client generation and schema validation passed. Neither connects to an application database.
- API, web and mobile TypeScript checks passed. Commands: `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit`; `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false`; `node apps/application/node_modules/typescript/bin/tsc -p apps/application/tsconfig.json --noEmit`.
- API production build passed using `node ../../node_modules/@nestjs/cli/bin/nest.js build` from `apps/api`.
- Web production build passed using `node ../../node_modules/next/dist/bin/next build` from `apps/web` (51 static pages generated).
- The read-only preview modules passed `node --check`. `git diff --check` passed.
- Mobile has no production build script in its package; native release builds were not run. No browser visual verification was performed. Standalone ESLint is not configured.
- The repository's destructive database-backed end-to-end setup was not run. Embedded PostgreSQL executes the real migration, trigger and unique index on fresh databases, with no network/database credentials. Simultaneously submitted embedded queries are queued by its single backend; these tests are **not** a multi-connection PostgreSQL load test. Service tests also exercise concurrent requests with a serialized transaction mock.

## Production rollout

1. Review this release and all pending migrations. The workspace contains unrelated pre-existing migration work; do not deploy those changes blindly.
2. Validate the new migration on an isolated staging copy with existing duplicate rows. It requires PostgreSQL UTF-8 support for NFKC normalization.
3. During a coordinated schema/API cutover, install the reviewed additive migration before starting the updated API. Regenerate Prisma during the normal build. The generated API client expects `canonical_key` to exist. Pause address writes/delivery checkout during the cutover if the deployment system cannot coordinate it; the old API may encounter a duplicate-key rejection once the trigger is installed.
4. Deploy API, then web. Existing mobile clients remain API-compatible; release the mobile normalization change through the normal app release process. No API field is removed and no new runtime environment variable is required.
5. Run the read-only preview against the explicitly chosen database, review the output, and obtain approval for any legacy cleanup. Existing duplicates will continue to be displayed until that step is completed. No historical order snapshot needs rewriting.

Remaining limits: live cleanup has not been authorized or run. A subsequent review-only executable implementation is documented in `ADDRESS_CLEANUP_REVIEW.md`. A multi-connection PostgreSQL stress test/native mobile release build/browser visual check was not run. Address equivalence intentionally does not merge abbreviations, punctuation changes or different unit representations beyond case/whitespace/NFKC normalization.
