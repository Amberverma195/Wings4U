# Final menu builder fixes

Branch: `fix/non-wing-customization-parity`

## Root causes and changes

The admin form treated every unconfigured extra as a new approval request whenever any row changed. The API then detached all add-on groups and created a replacement, discarding stable option IDs and existing option availability. The form now submits option IDs, permits untouched unconfigured rows, and requires a mapping choice for new or changed unconfigured rows. The API validates ownership and duplicate IDs, updates only changed records, deactivates removed options, and preserves existing group links, ordering, defaults, prices, mappings and availability. Existing order references remain intact. Catalog cache, web revalidation and realtime invalidation still run after a successful transaction.

An affected shared group is copied for the edited product only. Its original records remain available to other products and historical orders. The copy retains unconfigured and previously unscoped mapping semantics; copying cannot create an item approval. An explicitly requested new approval is placed in an exclusive item group. Repeated saves of unchanged options perform no option recreation.

The Special's salad builders used local keyword and `Add`-prefix fallbacks, including an authorization bypass for size-specific extras. API validation checked group membership rather than shared eligibility. A shared `embeddedSaladCatalog()` now invokes `customizationCatalog()` with actual Small size IDs and returns its authorized add-on groups. Web and mobile use these groups for display, validation, prices and serialization. API cart validation, quotes and checkout load the child recipe and complete group ownership and apply the same rules. Unauthorized, inactive, stale, duplicate and Large-only IDs are rejected. Saved selections remain present for validation until the customer explicitly reviews and clears invalid choices.

## Verification

- Shared package: 24 tests passed.
- Web: 102 tests in 13 suites passed.
- Mobile: 503 tests in 42 suites passed.
- API: 968 tests in 54 suites passed.
- API, web and mobile TypeScript checks: passed.
- Shared package, Nest API and Next.js web production builds: passed.
- Android and iOS production JavaScript exports with source maps: passed.
- Real Metro development and production runtime exports, including the new salad helper: passed. The regression has isolated transform/file-map caches so it can run alongside Expo.

Regression coverage includes both requested named admin removals, untouched unconfigured rows, stable IDs/prices/mappings/defaults/availability, repeat saves, copied shared groups, explicit approvals, foreign/duplicate IDs, Caesar/Garden/Greek Small salad parity, authorized extras and prices, unauthorized/inactive/stale/size-ineligible options, conflicting prices, duplicate charge prevention, saved-cart review, and existing wings/combo flows. API quote/checkout/POS tests use mocked persistence; no real order is written.

All mutation tests use mocks and fixtures. No production query, mutation, migration, seed, sync, admin removal, environment connection change, merge or deployment was performed. Production builds use the existing offline-validation preload to refuse outbound sockets. Prisma generation generates local client code only. The other 35 ingredient candidates were not reviewed or modified.

## Limitations

- Editing a shared group necessarily creates new IDs for that group's copy on the edited product. Affected saved carts require review; other products' IDs and historical orders remain intact. Exclusive groups retain their existing IDs.
- Verification uses component tests, real Metro bundles, and Android/iOS exports. It does not establish an interactive native-device smoke test or produce signed native binaries.
- Removed options remain inactive for historical references. This change does not purge historical data.

## Changed files

- `apps/api/src/modules/admin/admin-menu.controller.ts`
- `apps/api/src/modules/admin/admin-menu.service.ts`
- `apps/api/src/modules/admin/admin-menu.service.spec.ts`
- `apps/api/src/modules/orders/reorder-preview.spec.ts`
- `apps/api/src/modules/shared/builder-catalog-validation.ts`
- `apps/api/src/modules/shared/ordering-service-parity.spec.ts`
- `apps/application/src/components/mobile-wings-builder.tsx`
- `apps/application/src/lib/salad-catalog.ts`
- `apps/application/tests/final-wing-builder-stability.test.cjs`
- `apps/application/tests/wing-builder-parity.test.cjs`
- `apps/application/tests/metro-customization-runtime.cjs`
- `apps/web/src/app/admin/menu/menu-item-modal.tsx`
- `apps/web/src/components/wings-builder.tsx`
- `apps/web/src/lib/salad-catalog.ts`
- `apps/web/tests/admin-customization-integrity.test.cjs`
- `apps/web/tests/embedded-salad.test.cjs`
- `packages/customization/src/index.ts`
- `packages/customization/test/fixtures.cjs`
- `packages/customization/test/embedded-salad.test.cjs`
- `package.json`
- `Docs/audits/final-menu-builder-fixes.md`
