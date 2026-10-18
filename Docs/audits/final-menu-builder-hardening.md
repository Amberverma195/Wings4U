# Final menu builder hardening and merge readiness

Verdict: **READY TO MERGE**, subject to the verification limits below. No merge or deployment performed.

Reviewed branch: `fix/non-wing-customization-parity`. Starting HEAD was `cf40142`, newer than the supplied review baseline `7582cfa`. The newer order-details UI was preserved without changes.

## Findings and exact changes

### P1: included salad identity

Confirmed that extras were validated against the submitted child item, without tying that child to the selected parent salad option. The API now requires exactly one active parent salad choice and the Special's salad customization payload. The existing label-to-slug mapping determines the permitted child. The database child ID, slug, category and location must agree; client `salad_name` and `salad_slug` do not prove identity. The existing database uniqueness constraint on `(locationId, slug)` makes this resolution unambiguous.

The child must be visible, unarchived and available, in an active, unarchived salad category. Existing fulfillment, special-instruction and category/item scheduling rules are applied at the requested order time. A real active Small option must satisfy its size group's selection limits. The existing shared catalog still validates extras, stale IDs and duplicates. Valid order prices remain authoritative database prices.

Moved the established five salad mappings, their exact normalization and included-size label into `@wings4u/customization`; web and mobile retain their existing utility interfaces through imports/re-exports. No alternative mapping, keyword inference or new restaurant restriction was introduced.

Regression scenarios run through cart validation, quote, checkout and POS: valid Caesar/Garden/Greek; mismatched or arbitrary/non-salad child; wrong category/location; missing child; archived/hidden/unavailable/out-of-stock item; inactive/archived category; incompatible fulfillment; closed category/item schedule; absent/inactive/invalid Small; forged client names/slugs; unknown/inactive/missing/duplicate parent choice; missing customization; unauthorized/stale/size-ineligible/duplicate/conflicting-price extras; valid prices without duplicate charges.

### P2: copied shared-group authorization

Already fixed at the starting HEAD; no admin mutation implementation change was needed. Copies carry the persisted `[shared copy]` marker, and `dedicatedAddonScope()` denies item-specific scope to those copies. Exclusivity after copying therefore cannot authorize inherited `__always__` rows. The admin API exposes modifier groups read-only for linking; item renames do not remove the marker. Explicit new approvals use an exclusive item approval group. Mutations remain in the existing transaction.

Added a mixed fixture containing `__always__`, null mappings, a recipe mapping, an inactive `__always__` row, and duplicate-looking recipe extras. Removing one option leaves all original shared records/IDs unchanged; copied prices, mappings, defaults, activation and sort order are preserved except for the intended removal. The resulting catalog contains only the authorized recipe extra, charges it once, and never exposes the inherited approval. A second test proves an unchanged shared group is not copied. Existing explicit-approval and unconfigured-row regressions continue to pass.

### P3: optional SINGLE deselection

Confirmed that the selection handler always re-added SINGLE choices. It now clears a selected choice only when the shared minimum is zero. Required choices remain enforced. Optional single-choice inputs use checkbox semantics, so a second click or Space can actually trigger deselection; checked radio inputs do not emit a change when clicked again. Optional dropdowns also accept their empty choice. Regression tests verify selected/cleared prices, required choices and emitted cart IDs.

### P3: validation scrolling

Confirmed that `catalog-review` had no registered target and that required-selection errors could lack a visible message. The review alert now registers that key, displays selection errors after submission, and is programmatically focusable with assertive accessible messaging. Scrolling runs after the alert mounts; repeat submission also scrolls. Special-instruction sections are focusable too. Tests assert actual scroll/focus calls for stale carts, missing required choices and conflicting prices. No unrelated layouts changed.

## Final verification

| Check | Passed | Failed |
| --- | ---: | ---: |
| Shared customization | 26 | 0 |
| Web, 13 suites | 108 | 0 |
| Mobile, 42 suites | 510 | 0 |
| API, 54 suites | 1,077 | 0 |
| **Total automated tests** | **1,721** | **0** |

API, web and mobile TypeScript checks passed. Shared package, Nest API and Next.js production builds passed. Expo Android/iOS production JavaScript exports with source maps passed. The real Metro regression passed its historical failure reproduction and development/production source-export probes, including the newly shared mapping functions.

Commands: `npm run test:customization`; `npm run test --workspace @wings4u/web -- --silent`; `npm run test --workspace @wings4u/application -- --silent`; `npm run test:unit --workspace @wings4u/api -- --silent`; `npx tsc -p apps/{api,web,application}/tsconfig.json --noEmit` (each project separately); `npm run build:api`; `npm run build:web`; `npx expo export --platform android --platform ios --source-maps --no-bytecode --max-workers 2`; `npm run test:metro-customization --workspace @wings4u/application`; `git diff --check`.

An initial API run had 1,066 passes and one failure: a generic Special weight fixture omitted the now-required parent salad choice and child customization. The fixture was corrected to represent a valid complete Special. Final counts above include the additional shared-group and category eligibility regressions; no failing checks remain.

Existing suites cover Wings by the Pound, Wing Combo, Wings-4-U Special, Lunch Specials, burgers/wraps, tenders/fries, standalone salads, cart editing, ingredient additions/removals, pricing and duplicate prevention. The Special reorder fixture now contains a real matching parent salad choice and Small salad.

## Safety and remaining limits

- All mutation and service tests use mocked persistence and isolated fixtures. No production database reads or writes, migrations, seeds, sync scripts, actual admin removals or live integration tests were performed for this task.
- Existing environment connections were not changed. Builds/exports used the existing offline socket-blocking preload; Prisma generation only generated local client code. No local PostgreSQL installation, merge, deployment or production operation occurred.
- The other 35 production ingredient candidates were not reviewed, approved, removed or changed.
- No interactive native-device testing or signed native build was performed. Android/iOS verification covers production JavaScript exports and real Metro runtime exports, plus component tests.
- Invalid or incomplete historical Special cart configurations now require customer review instead of bypassing child eligibility. Existing persisted orders are not modified.
- The existing shared-copy marker must remain intact in future group-editing tools. Shared-group edits still necessarily give the edited product copied group/option IDs; historical orders and other products retain their original IDs.

## Modified files

1. `apps/api/src/modules/admin/admin-menu.service.spec.ts`
2. `apps/api/src/modules/orders/reorder-preview.spec.ts`
3. `apps/api/src/modules/shared/builder-catalog-validation.ts`
4. `apps/api/src/modules/shared/ordering-integrity.spec.ts`
5. `apps/api/src/modules/shared/ordering-service-parity.spec.ts`
6. `apps/application/src/lib/salad-catalog.ts`
7. `apps/application/tests/metro-customization-runtime.cjs`
8. `apps/web/src/components/item-customization-overlay.tsx`
9. `apps/web/src/lib/salad-catalog.ts`
10. `apps/web/tests/customization-parity.test.cjs`
11. `packages/customization/src/index.ts`
12. `packages/customization/test/embedded-salad.test.cjs`
13. `Docs/audits/final-menu-builder-hardening.md`
