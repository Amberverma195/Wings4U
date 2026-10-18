# Ordering integrity review — 2026-10-17

Repository baseline: `d389051ec28ff5bd69cf707ca1d8ff65f61e1b16` (matched HEAD at inspection).

Changes are local and uncommitted. No production database connection, migration, seed, schema change, deployment, payment, or real order was used. Test writes are Jest mocks only. This report does not establish production readiness.

## Findings

| Finding | Severity | Investigation | Classification |
| --- | --- | --- | --- |
| Lunch child eligibility and add-on ownership | P1 | Confirmed: the previous shared validator checked add-on existence/activity but did not load the child or establish its relationship to the parent. | Verified fixed against isolated catalogue fixtures |
| Lunch add-on client-price fallback and malformed rows | P1 | Confirmed: unresolved options could use `price_delta_cents`; malformed rows were silently skipped. | Verified fixed |
| Missing/incomplete Wings and Combo configuration | P1 | Confirmed: no payload returned successfully, empty flavour slots passed the old test, and required catalogue selections were not enforced. | Verified fixed against isolated catalogue fixtures |
| Unsupported side/pop selections | P2 | Confirmed: bundle eligibility and fixed price existed, but arbitrary labels were accepted. | Verified fixed |
| Existing bundle price | P2 review | The existing server charge was already 499 cents. | Verified safe; retained |
| Production catalogue configuration and physical device/POS operation | Verification limit | Deliberately not queried or exercised. | Not tested |

Four isolated attack regressions failed on the original implementation: missing Wings payload, malformed lunch add-on extraction, unresolved add-on pricing without catalogue context, and unsupported bundle contents. They pass after the changes. Child ownership was additionally confirmed by tracing the old validator and the two clients' category-selection rules.

## Files and functions changed

| File | Function / change | Effect |
| --- | --- | --- |
| `apps/api/src/modules/shared/pricing.ts` | `getLunchAddonOptionIds` | Rejects non-array collections, non-object rows, absent/non-string/empty/whitespace IDs, and duplicate IDs. An omitted add-on list still means no add-ons. |
| Same | `getBuilderPriceDelta` | Every lunch charge requires a resolved active catalogue option with a safe integer price. Removes the client-money fallback. Catalogue zero prices remain valid. |
| `apps/api/src/modules/shared/order-validation.ts` | `assertBuilderPayloadValid` | Requires the correct builder for Wings, Combo, lunch-burger, and lunch-wrap; rejects incomplete wing fields and unrecognized builder types; validates bundle labels and eligibility; uses strict lunch parsing/pricing. |
| `apps/api/src/modules/shared/builder-catalog-validation.ts` | New `assertBuilderCatalogValid` | Reads catalogue relationships and validates lunch children, child add-ons/removals, wing configuration, flavour membership/count/placement, modifier limits, and Combo side/drink serialization. |
| `apps/api/src/modules/cart/cart.service.ts` | `CartService.computeQuote` | Calls the shared catalogue validation before pricing the line. |
| `apps/api/src/modules/checkout/checkout.service.ts` | `CheckoutService.placeOrder` | Calls the same validation using the transaction client before pricing/persisting the order. |
| `apps/api/src/modules/pos/pos.service.ts` | `PosService.createPosOrder` | Calls the same validation for catalogue menu items. Existing POS custom-item support remains separate. |
| `apps/api/src/modules/shared/order-validation.spec.ts` | Existing regressions | Replaces obsolete expectations that permitted incomplete wings, skipped malformed add-ons, or pricing without catalogue context. |
| `apps/api/src/modules/shared/ordering-integrity.spec.ts` | New mocked catalogue regressions | Covers attacks, valid configurations, edits, free/paid options, special packs, and normal items. |
| `apps/api/src/modules/shared/ordering-service-parity.spec.ts` | New service regressions | Exercises actual quote/checkout/POS methods with mocked repositories; stops checkout/POS at mocked persistence. |
| `apps/api/test/offline-unit-setup.cjs` | Optional offline test setup | Mocks the environment-loading Prisma service before module execution, blocks external socket connections and unmocked fetch, and prevents real Prisma service construction. Loopback HTTP remains available for mocked unit HTTP suites. |

## Business rules and compatibility

Lunch eligibility uses the existing rules from `lunch-special-builder.tsx` and mobile `menu-item-builder.tsx`: lunch-burger selects the burgers category; lunch-wrap selects wraps. It rejects helper rows, hidden/unavailable/archived children, location mismatches, fulfillment restrictions, and child schedule conflicts. Child add-on groups use the established `addon` context, with the mobile builder's existing `Extras` group fallback. Ingredient removals must match that child's catalogue ingredient IDs and names. Parent lunch scheduling remains in the existing schedule-validation path.

Wing flavour counts come from the concrete ordered SKU's modifier groups containing linked flavour records, matching `catalog.service.ts`; counts are not inferred from product names or client weight fields. Slots must be sequential, complete, active, and valid for their corresponding group. Preparation fields use existing enum choices and must agree with any selected preparation catalogue modifier. Required groups and maximum counts are checked from catalogue metadata, including required special salad and lunch drink groups. Flavours and size variants have their existing builder representations rather than requiring duplicate ordinary modifier selections.

Saucing validation mirrors the established web/mobile rules, including plain flavours, single/two-flavour cases, the three-flavour tell-us-how policy, and the existing party-75/party-100 special identities. Side slots must identify a sauced flavour; placements must agree with the method. Tell-us-how requires a customer note. Extra flavours must be active, non-plain records with a supported placement. Combo side/drink arrays must match the SKU's groups and the charged modifier selections.

Bundle labels use the website's exact established set: Fries, Onion rings, Wedges, Coleslaw; Pepsi, Diet Pepsi, Pepsi Zero, Coke, Diet Coke, Coke Zero, Mountain Dew, Diet Mountain Dew. Eligibility uses the existing eight burger/wrap slugs. The charge remains exactly 499 cents regardless of submitted price. No new schema, modifier groups, or identifiers were introduced.

Website and mobile serialization were inspected. The active mobile menu routes Wings and Combos through `WingsBuilderMobile` / `ComboBuilderMobile`, which include saucing fields. The older generic `MenuItemBuilder` still contains a wing branch with incomplete new-order saucing serialization, but the inspected active menu routing does not use it for wing products. A future caller of that legacy branch must use the active builders or supply a valid configuration; the backend will reject incomplete orders.

Existing structured bundle payloads with supported labels and JSON round-tripped edits remain accepted. Incomplete historical wing configurations and stale/inactive catalogue selections must be edited; the server does not guess missing sauce choices. The website already strips legacy `Add-on: Small fries + pop` instruction paragraphs when editing. Free-text notes alone are not promoted into structured, priced bundle selections by this change.

## Verification

Final results:

- Backend: **44 suites, 522 tests passed** with the offline guard.
- Targeted mobile: **8 suites, 76 tests passed** (wing logic/parity, Wings, Combo, special stability, cart, editing, checkout preparation).
- API TypeScript: passed, `--noEmit`.
- Website TypeScript: passed, `--noEmit --incremental false`.
- Mobile TypeScript: passed, `--noEmit --incremental false`.
- `git diff --check`: passed.

The service tests independently expect 2,300 cents for two 1,000-cent lunch items with a 150-cent catalogue add-on, despite a submitted -900-cent add-on price. The same three paths independently expect 2,998 cents for two 1,000-cent burgers with a 499-cent bundle, despite a submitted zero bundle price. Foreign children, malformed add-ons, missing required wing builders, and unsupported bundle labels are rejected before mocked order persistence.

Additional fixtures cover valid burger/wrap children; location-scoped lookup; availability/archive/hidden/fulfillment/schedule/helper-row rejection; child ingredient removals; add-on ownership and inactive options; missing/empty/non-string IDs and duplicates; zero, negative, and extreme client prices; valid free options; wing counts and sequential slots; inactive flavours and linked options; invalid preparation; conflicting preparation modifiers; sauce placement/side slots; plain wings; extra flavours; three/five-slot special packs; tell-us-how notes; required special salad selection; missing Combo sides/drinks; wrong group ownership and selection limits; valid/invalid bundles; cart JSON editing; optional builders on ordinary products.

Failures encountered: four expected pre-fix reproduction failures; two initial service-fixture failures because the checkout mock omitted `modifierGroup.findMany` (fixed in the mock). No failures remain in the checks listed above. Mobile tests emit the existing `react-test-renderer` deprecation warning. Backend suites emit expected mocked error/fallback logs; these are not real external operations.

Reproduce from repository root without build or database lifecycle scripts:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --setupFiles '<rootDir>/../test/offline-unit-setup.cjs'
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project apps/web/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/application/tsconfig.json --noEmit --incremental false
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --runTestsByPath apps/application/tests/wing-builder-logic.test.cjs apps/application/tests/wing-builder-parity.test.cjs apps/application/tests/mobile-wings-builder.test.cjs apps/application/tests/mobile-combo-builder.test.cjs apps/application/tests/menu-item-builder-edit.test.cjs apps/application/tests/final-wing-builder-stability.test.cjs apps/application/tests/cart.test.cjs apps/application/tests/checkout-preparation.test.cjs
git diff --check
```

## Remaining limits and manual requirements

No remaining bypass was demonstrated for the four scoped findings under the mocked catalogue contract. This was not an exhaustive audit of all nested salad relationships, all ordering endpoints, POS custom-price privileges, or free-text kitchen instructions. Existing nested salad availability/ingredient/modifier validation is retained; the new tests establish the required parent salad-group selection, not complete nested-salad integrity.

Production catalogue data was not inspected. Missing/misconfigured required groups fail closed and may require catalogue corrections; no such corrections are authorized or performed here. There is no general lunch-child relation table: only the two established burger/wrap relationships are supported. Any future lunch child category needs an explicit business rule.

The new validator adds catalogue reads per applicable cart line. No load/performance measurement was run. No database-backed end-to-end tests, real Stripe flows, browser session tests, physical-device tests, printer tests, or KDS submission tests were run.

Before any separate deployment approval, use an isolated staging environment to manually exercise web desktop/mobile viewport flows, Android/iOS cart editing and reordering, all concrete wing sizes and party packs, special salads, lunch window boundaries and scheduled fulfillment, all Combo side/drink slots, supported bundles, and POS catalogue/custom-item flows through kitchen display/printing. Verify production-equivalent catalogue metadata without mutating production. Deployment requires separate explicit approval.
