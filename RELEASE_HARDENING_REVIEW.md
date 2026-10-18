# Ordering SKU and release hardening — 2026-10-17

Baseline: `1eb44d5f5e71adf6511cd2d2305eedd040b006a7`, matching HEAD at inspection. All changes in this review remain local and uncommitted. No production connections or queries, environment/connection changes, schema changes, database scripts, deployments, commits, or pushes were performed.

## Release decision

**Not release-ready on the evidence available.** Weight input validation, bundle pricing, and request-scoped query batching are implemented and tested. Exact persistence for all wing products is **BLOCKED** by the repository schema: `OrderItemWingConfig.weightLb` is `Decimal(3,1)`, while the existing catalogue conversion produces `6.67` for 100 wings and `0.33` for five wings. Those values cannot be represented exactly in that column. The schema was not changed, no alternative conversion or rounding policy was chosen, and no precision migration was attempted.

The code now passes the trusted catalogue value into Prisma and retains the validated value in builder JSON. That does **not** resolve the database column's representational limitation. PostgreSQL numeric-scale coercion would change those two-decimal values. Actual production schema precision was not queried; no claim is made that production matches the repository schema. A separate schema/business-rule decision is required before claiming exact persisted weight integrity for these products. The existing legitimate fractional pound SKUs, such as 1.5 lb, fit the declared column.

## Confirmed and disproved findings

| Finding | Cause / evidence | Classification |
| --- | --- | --- |
| P1: client weight could disagree with purchased SKU | Baseline validator ignored `weight_lb`; Checkout/POS used `Number(builderPayload.weight_lb ?? 1)`. A pre-fix test submitted 100 against a one-pound SKU and was accepted. | **PARTIALLY FIXED** overall: input validation and authoritative write inputs are **VERIFIED FIXED**; exact two-decimal database persistence is **BLOCKED**. |
| P2: saved bundle money changed displayed totals | Website and mobile helpers read serialized `price_cents`; pre-fix mobile tests failed for 0, -999 and 10000. Website summary text also read serialized money. | **VERIFIED FIXED** for the tested pricing helpers. |
| Fixed-size wing cards could submit the fallback 1 lb | Catalogue direct-item serialization omitted SKU options. Both active builders used their local fallback, which parses pound names and otherwise returns 1, with a special-case 2 for Wings-4-U Special. | **VERIFIED FIXED** for newly serialized catalogue cards: direct WINGS/COMBO items now include one concrete SKU option. Historical/cached payload compatibility still needs staging checks. |
| An earlier quote could remain usable while the cart changed | Both checkout screens retained a quote while fetching another one; mobile also had a 250 ms debounce window. | **VERIFIED FIXED** in source with request-identity guards; mobile guard logic is unit-tested. Full screen/browser interaction is **NOT VERIFIED**. |
| Extra validation reads repeated per line | Baseline fetched mappings for each builder line and a child separately for each lunch line. | **VERIFIED FIXED** by request/transaction-scoped batching and query-count tests. |
| Missing `sideFlavourSlot` in wing config persistence | Slot number survived builder JSON but was omitted from the existing dedicated config field. | **VERIFIED FIXED** against mocked writes: both paths copy the validated slot field; tests assert slot 2, matching placements, and null for single-flavour configurations. |
| Suspected server bundle amount/quantity duplication | Server already charged 499 cents; inspected clients multiply unit price by quantity once. | **VERIFIED SAFE** for tested server/helper paths; no restaurant price changed. |
| POS open food would become subject to catalogue builder requirements | Shared loader skips non-catalogue lines; no builder validation is applied to ordinary open-food entries. A mocked POS order at 550 × 2 retains 1100 cents and performs no mapping reads. | **VERIFIED SAFE** for this regression fixture. |

No complete production-parity claim follows from these classifications.

## Weight source and implementation

New `apps/api/src/modules/shared/wing-sku.ts` extracts the existing catalogue convention into `getWingSkuWeightLb` and `requireWingSkuWeightLb`:

- `wings-4u-special`: 2 lb, retaining the existing explicit exception.
- Catalogue names containing a numeric pound value: that fractional or whole number.
- Catalogue names containing a wing count: the existing `count / 15`, rounded to two decimals. This rule was already in the catalogue serializer; it is not a new physical-weight guarantee for party packs.
- An unresolvable ordering SKU fails closed. The catalogue's historical display fallback remains 1; ordering does not treat that fallback as authoritative.

`assertBuilderCatalogValid` requires a finite number exactly equal to the concrete loaded menu item's catalogue weight. Strings, absent/null values, negative/zero values, NaN/infinity, objects, and mismatched quantities are rejected. Client `weight_lb` no longer supplies the dedicated persisted wing-config weight: Checkout and POS independently obtain it from their scoped `menuItemMap`.

Fixtures cover 1, 1.5, 2, 3, 4 and 5 lb; Wings-4-U Special at 2; 75-wing packs at 5; 100-wing packs at 6.67; and five-wing items at 0.33. The last two expose the persistence blocker above. Party packs remain count-defined menu products; their physical-weight business interpretation was not independently verified.

`CatalogService.serializeBuilderOption` uses the shared extractor. `serializeMenuItem` supplies a single option for fixed-size builders, preserving the existing builder field names and concrete SKU IDs. `buildSyntheticCard` still groups ordinary pound Wings/Combo SKUs. Modifier mappings now use the same deterministic ordering in catalogue serialization and validation: `sortOrder`, then `modifierGroupId`.

Valid JSON-round-tripped items retain their selections. Old party/five-wing carts containing fallback `weight_lb: 1` are inconsistent with the catalogue convention and must be rebuilt from a fresh menu; this change does not silently reinterpret them as valid. Old application versions using stale menu responses may still generate those incomplete payloads and require refresh/update. No automatic repair of an invalid historical order was introduced.

## Pricing and quotation

`apps/web/src/lib/cart-item-utils.ts` changes `getBuilderPriceDelta` and `sidePopComboDisplayLines` to use `SIDE_POP_BUNDLE_PRICE_CENTS`. `apps/application/src/lib/wing-builder-logic.ts` makes the equivalent helper change. Structured labels remain unchanged; only untrusted saved monetary values are ignored.

Independent assertions use a 1000-cent base item with one 499-cent bundle: unit price 1499; quantity three subtotal 4497; 10% delivery tip 450. These remain the expected results for saved prices 499, 0, -999 and 10000. JSON round trips model editing/reorder payloads. Existing server service tests continue to expect 2998 cents for two such bundles and reject unsupported selections.

Both checkout screens associate successful quotes with the exact request context. Web's guard includes cart contents, location, fulfillment, schedule, tip, deals, delivery token and selected address; it blocks submission and disables the order button for an older context. Mobile associates responses with its existing quote key, adds location to that key, blocks through `checkoutPricingBlock`, and sets loading before debounce. Quote response cancellation handling remains intact. Server Checkout still independently validates/prices all submitted items.

Mobile `validateCheckout` tests confirm a fresh quote API call for stale bundle prices, corrected local tip inputs, exact requested quantities and acceptance of the server's returned total. No locally calculated payable amount substitutes for that server response. UI rendering of stale-to-current quote transitions on real devices/browser remains a manual test requirement.

## Catalogue compatibility review

Inspected schema models, seed definitions, builder synchronization source, catalogue serialization, active web/mobile builders, service validation and POS custom-item flow. No scripts in `packages/database/prisma` were executed.

| Area | Evidence / limits |
| --- | --- |
| Wings by the Pound and fractional variants | Shared weight extraction matches pound-name catalogue metadata. Existing linked-flavour groups still determine slot counts; product names do not determine flavour counts. |
| Wing Combo | Actual service fixtures cover required preparation, side/drink membership and paid side pricing. Existing metadata-based selection limits and payload/charged-selection consistency remain enforced. |
| Wings-4-U Special | Existing 2 lb override retained; special salad group requirement and web/mobile salad tests retained. Full nested-salad relationship security was not re-audited. |
| Party packs | Direct catalogue single options fix the missing SKU-weight representation; three/five-slot saucing tests remain. The two-decimal database limitation and physical-weight interpretation are unresolved. |
| Plain/sauce placement/preparation | Existing plain, side-sauce, sequential-slot, required-note, boneless/non-breaded and modifier-limit regressions pass. Mocked order serialization uses catalogue sauce names rather than client labels. |
| Lunch burger/wrap | Previous child-category, ownership, availability, ingredient and schedule rules remain; children and mappings are now batched without being cached between requests. |
| Side/pop bundle | Existing parent slug eligibility and supported labels remain; all displayed/helper monetary deltas now use 499 cents. |
| Pickup/delivery/scheduled | Shared weight validation is independent of fulfillment/time; earlier restriction validators remain in place. Existing backend/mobile scheduling and delivery suites pass. New wing service parity fixtures exercise pickup; a full new three-service delivery/scheduled matrix was not executed. |
| UI-only groups | Flavour and size builder representations retain their existing exceptions. Ordinary required groups still enforce metadata min/max; no new blanket requirement was added. |

There is no production menu-data verification. Group metadata/name variations, missing expected weight labels or unusual legacy contexts must be checked in staging with a production-equivalent fixture. If production data inspection is required, see the separate read-only plan; it has not been executed and requires explicit authorization.

## Performance evidence

New `loadBuilderCatalogContext` batches all applicable parent mappings into one query and all distinct lunch child IDs into one query. The context exists only for the current service request/transaction. Each line is still independently validated against its configuration, fulfillment and schedule. No global cache, schema field or index was introduced.

| Applicable lines | Baseline additional validation reads | New additional validation reads |
| --- | --- | --- |
| 25 lunch lines, same or different valid parent/child combinations | 25 mapping reads + 25 child reads | 1 mapping query + 1 child query |
| Multiple Wing/Combo lines | One mapping query per line | 1 mapping query |
| No builder products / POS open food only | 0 | 0 |

These counts refer to the new validator's additional Prisma read calls, not total endpoint queries or measured SQL statements. Prisma relation includes can emit multiple underlying SQL statements. Checkout still performs its pre-existing separate basic mapping/category/ingredient/option queries. The 25-duplicate-line count and exact 57500-cent subtotal are asserted through each actual service method. A separate loader test checks distinct SKU IDs, deduplicated child IDs, location scoping and mapping order. A second quote after a child becomes unavailable reloads data and rejects it, demonstrating no cross-request availability reuse. Query latency, database load and execution plans were not measured.

## Changed files and functions

- `apps/api/src/modules/shared/wing-sku.ts`: new weight extraction and required-authority helpers.
- `apps/api/src/modules/shared/builder-catalog-validation.ts`: `loadBuilderCatalogContext`, context types, and strict weight checks in `assertBuilderCatalogValid`.
- `apps/api/src/modules/catalog/catalog.service.ts`: builder option weight reuse, direct-item single options, deterministic modifier order.
- `apps/api/src/modules/cart/cart.service.ts`: `computeQuote` creates/passes one catalogue context.
- `apps/api/src/modules/checkout/checkout.service.ts`: `placeOrder` creates/passes one context, derives wing-config weights from catalogue records, copies validated side slot.
- `apps/api/src/modules/pos/pos.service.ts`: equivalent changes in `createPosOrder` for catalogue lines.
- `apps/web/src/lib/cart-item-utils.ts`: authoritative bundle delta and display summary.
- `apps/web/src/app/checkout/checkout-client.tsx`: quote request identity and submission guards.
- `apps/application/src/lib/wing-builder-logic.ts`: authoritative bundle delta.
- `apps/application/src/lib/payment-options.ts`: optional quote-freshness input to `checkoutPricingBlock`.
- `apps/application/app/checkout.tsx`: quote request identity and immediate loading guard.
- Backend tests: `catalog.service.spec.ts`, `ordering-integrity.spec.ts`, `ordering-service-parity.spec.ts`.
- Client tests: new web/mobile `bundle-price-integrity.test.cjs`; extended mobile `checkout-preparation.test.cjs` and `payment-options.test.cjs`.

## Executed checks

| Check | Result |
| --- | --- |
| Backend unit tests with established offline guard | **44 suites / 565 tests passed** |
| Website Jest tests | **7 suites / 80 tests passed** |
| Targeted mobile Jest tests | **11 suites / 91 tests passed** |
| API TypeScript, `--noEmit` | Passed |
| Web TypeScript, `--noEmit --incremental false` | Passed |
| Mobile TypeScript, `--noEmit --incremental false` | Passed |
| `git diff --check` | Passed |

Pre-fix failures: one weight-tampering test resolved successfully when rejection was expected; three manipulated-price mobile tests returned the saved price rather than 499. During service-fixture development, three POS cases failed because the mock modifier options omitted the relation returned by the real POS include query; the fixtures were corrected, and those cases pass. No remaining automated test failures were observed. Existing React renderer deprecation messages were observed in earlier targeted runs; later broad runs used Jest `--silent`. Backend suites emit expected mocked fallback/error logs.

Mocked Checkout/POS tests execute the actual service validation, pricing and wing/flavour serialization. They allow only in-memory mocked writes, assert weights 1.5 and 3, preparation, side slot 2, standard/extra flavour placements and catalogue names, and deliberately stop before payment/completion. Other service cases stop at mocked `order.create`. No live order, payment, customer, address, receipt or KDS event was created.

Reproduction commands, from repository root (do not substitute `build`, database scripts or e2e scripts):

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --setupFiles '<rootDir>/../test/offline-unit-setup.cjs' --silent
node node_modules/jest/bin/jest.js --config apps/web/jest.config.cjs --runInBand --silent
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent --runTestsByPath apps/application/tests/bundle-price-integrity.test.cjs apps/application/tests/wing-builder-logic.test.cjs apps/application/tests/wing-builder-parity.test.cjs apps/application/tests/mobile-wings-builder.test.cjs apps/application/tests/mobile-combo-builder.test.cjs apps/application/tests/menu-item-builder-edit.test.cjs apps/application/tests/final-wing-builder-stability.test.cjs apps/application/tests/cart.test.cjs apps/application/tests/checkout-preparation.test.cjs apps/application/tests/payment-options.test.cjs apps/application/tests/checkout-entry-guard.test.cjs
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project apps/web/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/application/tsconfig.json --noEmit --incremental false
git diff --check
```

## Remaining staging and release requirements

1. Resolve the weight-column precision/business-rule blocker under separate explicit authorization. Do not round catalogue weights, change pack contents or run a migration implicitly.
2. Verify production-equivalent SKU names, contexts, flavour group order/counts and selected modifier constraints in an isolated staging database. Unknown catalogue weights intentionally fail closed.
3. Exercise web and Android/iOS new orders, valid cart edits/reorders, stale party pack payloads, manipulated bundle prices, quantity/tip changes and quote failures/races. Confirm that stale requests cannot submit or authorize payments.
4. Exercise each actual SKU through pickup, delivery and scheduled flows, including lunch boundaries, all Combo side/drink slots, special salads and party packs.
5. Verify full KDS/printer output, saucing notes, side slot and extra-flavour snapshots with staging orders only. The mocked serialization tests do not establish device behavior.
6. Measure endpoint latency/query timings under realistic staging carts. Batching reduces query count; no performance benchmark or production compatibility claim was made.
7. Handle catalogue cache expiry/versioning and client menu refresh during any separately approved rollout so older fixed-pack card shapes are not reused. No cache invalidation or deployment was executed here.
