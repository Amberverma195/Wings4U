# Ingredient normalization fix

Date: 2026-10-18. Baseline: main at `7d87036` (PR #7).

## Cause and affected paths

The admin form and admin service discarded ampersands; shared customization expanded them to `and`. An explicitly saved mapping could therefore fail the shared recipe check, hiding the option in both clients and rejecting its ID during ordering.

`normalizeIngredientText()` in `@wings4u/customization` remains the canonical implementation. The admin form, admin service, seed source and builder-sync source now import it. Neither database script was executed. No separate normalizer was added. Salad selection and display formatting retain their distinct existing purposes.

The website item, lunch and included-salad builders and the mobile menu-item builder already consume `customizationCatalog()` / `embeddedSaladCatalog()`. API cart, quote, checkout and POS use the same catalog through `builder-catalog-validation.ts`. These consumers inherit the fix without duplicating it.

## Compatibility and owner review

The existing checked-in `non-wing-catalog-readonly.json` audit was inspected offline. It contains no removable ingredient names with `&`; this is historical evidence, not verification of the current database. No database connection or operation was performed for this task.

Shared `resolveIngredientMapping()` recognizes an existing explicit legacy mapping by deriving the old ampersand-discarding representation through the canonical normalizer. It requires exactly one canonical ingredient identity on the same product. Missing mappings, reserved markers and ambiguous legacy collisions remain blocked. Equivalent canonical/legacy duplicate extras share the existing duplicate/conflicting-price checks.

Example string fixtures `A & B` and `A B` demonstrate an ambiguous old value `a b`: it cannot identify which recipe identity was intended, so it requires owner review. These strings are not products or inventory. If such data exists, the owner should inspect the actual product relationship and explicitly select its intended mapping. No migration, rewrite, correction script or inventory cleanup was executed or added.

The admin selector retains the raw saved mapping as a visible choice even when canonical choices differ. Unrelated saves omit additional ingredients as before; unchanged rows retain their stored mapping bytes. Canonical values are written only when the owner explicitly changes/creates a mapping through the existing workflow.

IDs, prices, modifier groups, item scope and explicit approval rules were not changed. The other 35 unconfigured candidates remain untouched. Existing unavailable avocado/jalapeño records in the historical audit are not treated as approval to sell them. This fix does not remove, activate or repair those legacy records; their separate owner-controlled cleanup remains necessary. No Crème Fraîche, jalapeños or avocado were introduced or authorized. Negative tests cover unavailable names with no valid mapping; they do not claim to repair pre-existing erroneous item approvals.

## Regression coverage

Pure string tests cover ampersands, accents, punctuation, hyphens, repeated spaces, letter case, idempotence, compatibility and ambiguity. `mapped-menu-fixtures.json` is a restricted projection of the existing audit, preserving actual IDs, recipe mappings and prices for Extra Cheese on Chicken Loaded Fries, Extra Caesar Dressing on Chicken Caesar Wrap, Extra Romaine / Caesar Dressing on Caesar Salad, and Extra Tomato / Feta on Greek Salad. It excludes unavailable extras and does not approve unconfigured options.

Shared tests, rendered web/mobile builders and mocked API cart/quote/checkout tests use those relationships. Tests check selected IDs, authoritative prices, required sizes, stale/inactive/removed mappings, foreign-recipe rejection and unavailable/unconfigured options. Admin tests cover unchanged bytes, repeated saves, explicit mapping through the shared function, and preservation of unrelated unconfigured rows. Checkout persistence is mocked and deliberately stops at order creation; no payment is executed.

## Changed files

- `packages/customization/src/index.ts`
- `packages/customization/test/normalization.test.cjs`
- `packages/customization/test/mapped-menu-fixtures.json`
- `packages/customization/test/mapped-menu.test.cjs`
- `packages/customization/test/rules.test.cjs`
- `apps/web/src/app/admin/menu/menu-item-modal.tsx`
- `apps/web/tests/admin-customization-integrity.test.cjs`
- `apps/web/tests/customization-parity.test.cjs`
- `apps/api/src/modules/admin/admin-menu.service.ts`
- `apps/api/src/modules/admin/admin-menu.service.spec.ts`
- `apps/api/src/modules/shared/ordering-service-parity.spec.ts`
- `apps/application/tests/menu-item-builder-edit.test.cjs`
- `apps/application/tests/metro-customization-runtime.cjs`
- `packages/database/prisma/seed.ts`
- `packages/database/prisma/sync-builder-config.ts`
- `packages/database/package.json`
- `package.json`
- `package-lock.json`
- This report.

## Verification

Database scripts, root CI (which includes database generation/e2e), real checkout and payments were excluded. Builds used the existing generated Prisma client; the API build invoked Nest directly to bypass `prebuild`. The web production build used an ephemeral local HTTP catalog stub, not production services. Android export disabled dotenv loading for the build process. No database connection settings or environment files were changed.

All final checks passed:

- `npm run test:customization`: 43 tests, including shared TypeScript build.
- API Jest: 7 suites / 417 tests (admin menu, shared customization, ordering service parity, order validation, ordering integrity, catalog and checkout idempotency).
- Website Jest: all 13 suites / 113 tests.
- Mobile Jest: 5 suites / 54 tests (menu-item builder, bundle pricing, saved cart validation, menu parity and final wing-builder stability).
- Real Metro runtime probe: development and production bundles execute the canonical normalizer and legacy mapping resolver from shared source.
- TypeScript: mobile and database `tsc --noEmit`; API Nest production build; web Next production type validation; shared package build.
- Production builds: Nest API, Next website (51 static pages with local catalog stub), Expo Android export (Hermes bundle).
- `git diff --check`.

The initial new test fixtures exposed missing required size selections and a snake-case/camel-case mismatch in the checkout persistence mock; those fixtures were corrected before the passing final runs. These were test setup failures, not changes to production rules. Existing test-tool deprecation/ts-jest warnings and Metro scanning warnings did not fail verification. No migrations, seeds, sync, database reads/writes or payment operations occurred. No deployment was invoked separately from the requested Git push.
