# Explicit paid extra approval

Date: 2026-10-18. Reviewed latest `origin/main` at `e8fda2f`, including merged PR #7 (`7d87036`) and PR #8 (`e8fda2f`). Work branch: `fix/explicit-paid-extra-approval`.

## Finding and required configuration

The checked-in `non-wing-catalog-readonly.json` snapshot records Buffalo Chicken Burger's Add Bacon option `f499330c-19f3-4c2b-9c7f-b8fa5d09262e` at 150 cents with `addon_match_normalized: null`. Its four mapped extras resolve to included Sriracha Mayo, Lettuce, Red Onion and Tomato; Bacon has neither a recipe mapping nor explicit item approval. A price and an active database record do not authorize an extra. This is the intended authorization filter, not the ampersand normalization bug fixed by PR #8. The snapshot is historical evidence; production state was not read.

The existing off-recipe workflow works. In Admin > Menu > Buffalo Chicken Burger > Additional Ingredients, set Add Bacon's Availability to **Approved paid extra for this item (off recipe allowed)** (previously **Approved for this item (off recipe allowed)**), retain **150 cents**, and Save. Leave removable ingredients unchanged. This production configuration step has **not** been performed; it requires the owner's authorized admin action.

The form sends `matches_ingredient: ""` only after explicit approval. `AdminMenuService.updateAdditionalIngredients()` saves `__always__` and retains the option ID and price when the group belongs exclusively to this item. New rows also require explicit mapping/approval. Unrelated saves omit the extras payload; unchanged unconfigured rows remain unconfigured. Shared-group edits copy records for the edited product and place new approvals in an exclusive Item Approved Extras group. Original shared records remain unchanged; copied groups cannot acquire approval merely through copying. IDs necessarily change when separating a shared group's options.

`dedicatedAddonScope()` establishes exclusive scope from all group links. `customizationCatalog()` accepts `__always__` only with matching item scope; it does not require that option to occur in removable ingredients. `resolveIngredientMapping()` handles only actual included-ingredient mappings, including PR #8's unambiguous legacy normalization compatibility. No resolver, catalog, API or mobile authorization change is necessary.

The historical group allows at most four simultaneous selections. Approval adds a fifth available choice without changing that existing limit. The owner can review selection limits separately if all five should be selectable together.

## Minimal implementation and parity

Only customer-neutral admin wording changed: availability choices now distinguish matches to included ingredients, explicit paid extra approval, and review-required extras hidden from customers. The explanatory text states that price alone is insufficient and that Save applies availability changes. No persistence semantics were changed.

Website `ItemCustomizationOverlay` and React Native `MenuItemBuilder` consume the shared catalog. API catalog serialization supplies the same exclusive item scope; `builder-catalog-validation.ts` applies the shared rules during cart, quote and checkout. Existing cache invalidation on admin save remains in place. Mocked regressions render both clients against the same recorded Buffalo burger fixture and validate the option ID and authoritative 150-cent price in the real ordering service methods.

The separate [35-record review report](paid-extras-review.md) lists every `unauthorized_or_overlapping_addon` finding from the existing snapshot, including Bacon. All 35 have NULL mappings in that snapshot. The 20 separately classified owner-confirmed unstocked avocado/jalapeno findings are not part of that count. They remain untouched and unavailable. An admin mechanism capable of enabling a record is not approval to sell it.

## Changed files

- `apps/web/src/app/admin/menu/menu-item-modal.tsx`: clearer availability choices and explanation.
- `apps/web/tests/admin-customization-integrity.test.cjs`: explicit Bacon approval for new and existing rows; recipe stays unchanged.
- `apps/web/tests/customization-parity.test.cjs`: rendered mapped/approved/unconfigured Bacon cases and cart ID/price.
- `apps/application/tests/menu-item-builder-edit.test.cjs`: equivalent rendered mobile cases.
- `apps/api/src/modules/admin/admin-menu.service.spec.ts`: mocked new approval and repeat edits, stable existing ID and price.
- `apps/api/src/modules/shared/ordering-service-parity.spec.ts`: cart/quote/checkout approve Bacon at 150 cents and reject missing approval, inactivity, shared scope and unavailable inventory.
- `packages/customization/test/buffalo-burger-fixture.cjs`: cloned historical snapshot fixture with isolated approval variant.
- `packages/customization/test/paid-extras.test.cjs`: four mapped extras, explicit approval, stable IDs/prices, no recipe addition and shared-group isolation.
- `package.json`: include new shared regressions in `test:customization`.
- `Docs/audits/paid-extras-review.md`: review-only 35-record report.
- This document.

## Verification and production safety

All tests/builds use the existing outbound-socket-blocking preload `packages/customization/offline-validation.cjs`. API unit tests additionally replace the environment-loading Prisma service with `test/offline-unit-setup.cjs`. Ordering persistence is mocked and deliberately stops at order creation, before any order or payment can occur.

Passed:

- Shared customization: 46 tests and TypeScript build.
- Website: 13 suites / 117 tests.
- Mobile: 42 suites / 516 tests.
- API: 54 suites / 1,144 tests.
- API and mobile TypeScript no-emit checks; Next production type validation.
- Nest production build invoked directly, bypassing Prisma generation prebuild.
- Next production build with an ephemeral local HTTP catalog stub (51 static pages), with process-local API overrides.
- Android production JavaScript export with `EXPO_NO_DOTENV=1`; no native source changed.
- `git diff --check`.

The first new admin test incorrectly asserted that the form omits recipe rows when approving an extra. The existing form submits unchanged recipe rows; the corrected assertion proves those rows remain unchanged. All final suites pass. Existing ts-jest warnings are nonfatal.

No production database reads or writes, migrations, seeds, sync scripts, customer orders, payments, environment-file changes, deployment commands or main merges occurred. The original audit snapshot and all inventory records remain unchanged. Existing untracked `.expo/` and root `tsconfig.json` are preserved and excluded from the commit; mobile export artifacts are local only. Signed native builds, interactive device QA and live deployment verification were not performed. The production admin approval still needs to be saved before Bacon appears to customers.
