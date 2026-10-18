# Wings4U portion, loyalty, saved-cart and mobile checkout review

Baseline: `1283e687ddb5010d01b615741c70899dc9e3589d`. Changes are local and uncommitted.

## Findings and disposition

| Original problem | Confirmed finding | Result |
|---|---|---|
| Incorrect count-based weights | The shared SKU helper and promotion size lookup divided display-name wing counts by 15. Party equivalents were 5 and 6.67 instead of 8 and 11. An older website builder also inferred weights from names. | **VERIFIED FIXED** in source and mocked tests: explicit stable SKU rules replace these conversions. |
| Party Specials excluded from earning | Earning accepted pound-based Wings/Combo slugs and excluded Party Specials. | **VERIFIED FIXED**: both Party SKUs earn their official equivalent, multiplied by quantity and aggregated before flooring. |
| Saved-cart errors lack recovery context | Strict rejection did not identify the offending line through a structured customer-facing error; mobile Cart lacked a direct edit handoff. Missing flavour arrays could also crash rendering/edit hydration. | **VERIFIED FIXED** for the tested Wings/Combo recovery paths. Friendly row errors, Edit/Remove, explicit review notices and successful re-quotation are covered. |
| Mobile quote lacks address identity | The selected normalized address was absent from the cart quote key, leaving a render-time eligibility gap before effects cleared the previous token. | **VERIFIED FIXED**: address snapshot participates in quote identity, and delivery-token readiness also requires its matching context. |
| Existing security and loyalty policies | SKU validation, catalogue pricing, eight-stamp cap, individual one-pound redemption, transaction locking and ledger uniqueness already existed. | **VERIFIED SAFE** within offline regression coverage; these policies remain in place. |
| Unspecified lunch portion policy | The five-wing lunch SKU historically uses 0.33 lb; owner authorization does not establish its official weight or loyalty policy. | **PARTIALLY FIXED** only in the sense that compatibility is retained and earning stays excluded. A new official lunch rule is **BLOCKED** on a business decision. |
| Live operational behavior | No production records, physical kitchen output, printer, real device, route provider or payment gateway were exercised. | **NOT TESTED**. Mocked checks do not establish production readiness. |

This report supersedes earlier review documents' portion and Party earning descriptions. Earlier reports remain unchanged as historical records.

## Authoritative portion mapping

Lookup uses exact catalogue slugs. Display names cannot change the result. The following rules do not create, enable or seed catalogue items.

| Wings slug | Equivalent | Pieces | Earning |
|---|---:|---:|---|
| `wings-1lb` | 1 lb | 9 | Yes |
| `wings-1.5lb` | 1.5 lb | 14 | Yes |
| `wings-2lb` | 2 lb | 18 | Yes |
| `wings-2.5lb` | 2.5 lb | 22 | Yes, if an actual catalogue SKU exists |
| `wings-3lb` | 3 lb | 27 | Yes |
| `wings-4lb` | 4 lb | 36 | Yes |
| `wings-5lb` | 5 lb | 45 | Yes |
| `party-75-wings` | 8 lb | 75 | Yes |
| `party-100-wings` | 11 lb | 100 | Yes |
| `wings-4u-special` | Existing 2 lb retained | Not newly assigned | Existing exclusion retained |
| `lunch-5-wings` | Legacy 0.33 lb retained | 5 | No; policy not authorized |
| Unidentified/unsupported slug | No authoritative result | Not inferred | No |

Existing `combo-1lb`, `combo-1.5lb`, `combo-2lb`, `combo-2.5lb`, `combo-3lb`, `combo-4lb` and `combo-5lb` identities use the corresponding regular weight/piece rule and require `WING_COMBO` builder type to earn. This supports the portion rule only where a real item exists. No 2.5 lb product or other catalogue record was created.

`wing_piece_count` is serialized alongside the authoritative builder `weight_lb`. Explicit values preserve 1.5 lb = 14 pieces and 2.5 lb = 22 pieces without proportional rounding. The owner's 1 lb packing convention (5 flats/4 drums or 4 flats/5 drums) remains a kitchen packing instruction; no new customer selector or automatic flat/drum inventory allocation was introduced.

Unknown wing identities fail closed in server SKU validation. No display-name fallback can authorize an order. The existing catalogue serializer's generic fallback for an unidentified builder option is not an ordering authorization; such a SKU still cannot pass authoritative quote/Checkout/POS validation.

### Party SKU, price and kitchen compatibility

**VERIFIED FIXED / VERIFIED SAFE:** actual Cart, Checkout and POS service methods were tested with isolated repositories. Each Party SKU:

- Rejects its old 5 or 6.67 lb builder value before any order persistence.
- Accepts 8 or 11 lb, preserving the purchased menu-item ID and product-name snapshot containing 75 or 100 wings.
- Preserves the fixture catalogue base prices of 8,999 and 11,699 cents, quantity multiplication, five flavour slots and stored flavour rows.
- Writes 8 or 11 into the mocked `OrderItemWingConfig.weightLb` and order builder payload.

These prices are independently asserted fixture values, not a claim that production prices were inspected. No menu-price, menu-identity, flavour-count or kitchen-display data was changed. Existing kitchen piece-count names and flavour rows remain intact; physical preparation/printing needs staging verification.

The promotion administrator's size lookup now uses the same SKU rule and labels Party options as “75 wings” / “100 wings”. It retains the existing weight-based targeting representation and menu-item ID. No promotion records or evaluation policies were rewritten. Any existing production promotion explicitly targeting an old Party weight needs separate staging review; no data conversion was attempted.

The menu cache key includes an application format version so an existing Redis menu payload containing old weights is not reused after this change. Customer-saved configurations still require explicit editing rather than silent migration.

## Loyalty calculations and ledger behavior

**VERIFIED FIXED:** `sumRewardablePaidWingsPounds` uses the stored order's catalogue SKU relation and compatible builder type. It ignores untrusted builder weight for earning. Unknown slugs, unsupported sizes, invalid quantities, lunch and other unspecified products cannot earn through a forged payload. Checkout/POS separately continue rejecting mismatched payload weights.

`accrueForOrderInTransaction` sums eligible SKU equivalents times quantity, subtracts the existing redeemed free one-pound allowance when its redemption ledger row exists, then applies `Math.floor` once. Existing qualifying completions are `PICKED_UP`, `DELIVERED` and `NO_PIN_DELIVERY`. Non-completion statuses are rejected by the added guard. The no-PIN path was explicitly checked against its existing KDS accrual call site and tested to preserve earning.

Available credit is `min(calculated earned stamps, max(0, 8 - current available balance))`. Lifetime stamps increase by the full calculated earned amount. The EARNED ledger delta records the actually credited available amount, including zero when the wallet is already full. Its reason describes capped credit. No rollover balance or extra reward entitlement was added.

Independent fixture expectations below are asserted by the real rewards method with an in-memory ledger. Lifetime values shown are increments, not replacement totals.

| Purchase | Starting available | Eligible paid pounds | Calculated earned | Available credit | Ending available | Lifetime increment |
|---|---:|---:|---:|---:|---:|---:|
| One 75-wing special | 0 | 8 | 8 | 8 | 8 | 8 |
| One 100-wing special | 0 | 11 | 11 | 8 | 8 | 11 |
| Two 75-wing specials | 0 | 16 | 16 | 8 | 8 | 16 |
| Two 100-wing specials | 0 | 22 | 22 | 8 | 8 | 22 |
| 75 + 100 specials | 0 | 19 | 19 | 8 | 8 | 19 |
| 1.5 lb Wings + 75 special | 0 | 9.5 | 9 | 8 | 8 | 9 |
| One 100-wing special | 7 | 11 | 11 | 1 | 8 | 11 |
| Two 75-wing specials | 8 | 16 | 16 | 0 | 8 | 16 |
| 1.5 + 2.5 lb Wings | 0 | 4 | 4 | 4 | 4 | 4 |
| Three 1.5 lb Wings | 0 | 4.5 | 4 | 4 | 4 | 4 |
| 100 special + redeemed free 1 lb | 0, after redemption | 11 | 11 | 8 | 8 | 11 |

Additional trusted-SKU tests cover all seven regular portions (19 lb combined), two 1.5 lb Combos plus a 75 special (11 lb), tampered payload weights, lunch/unknown exclusions and guest orders. Each positive ledger fixture is replayed: available/lifetime totals and ledger-row count remain unchanged on the second call. A free-only redeemed order earns zero. A Party Special cannot become a redemption target even when its payload falsely claims one pound.

**VERIFIED SAFE:** the eight-stamp available cap and the eight-stamp cost of an eligible individual 1 lb Wings reward remain unchanged. Party earning does not make Party redemption eligible. Full lifetime earnings can exceed the available balance; changing that relationship or retaining overflow would require a separate business decision. No decision is necessary to implement the requested behavior with the existing cap.

**VERIFIED SAFE:** existing reward-summary row locking, caller transaction boundaries, ledger audit history and the unique `(orderId, entryType)` constraint remain intact. Existing concurrent grant/accrual tests pass. KDS rejects terminal status transitions before beginning an accrual transaction; new tests cover replays for all three qualifying terminal statuses. Delivery completion methods also retain their existing prerequisite-status guards. No scan, backfill, recalculation job, historical correction endpoint or ledger mutation script was added or run. Future eligible completions use the corrected rules; previously completed orders are not automatically revisited.

## Saved-cart recovery

**VERIFIED FIXED:** Cart Quote, Checkout and POS wrap per-line 422 validation failures with `CART_ITEM_CONFIGURATION_INVALID` or `CART_ITEM_UNAVAILABLE`, friendly text, the menu-item ID and the zero-based request-line index. Indices distinguish two differently configured lines of the same SKU. Internal validation reasons stay available on the server exception for diagnostics/tests but are not emitted in this customer envelope. Infrastructure failures retain their original handling.

Both API clients preserve the error envelope in `ApiRequestError`. Website/mobile Cart show the message on the identified line and provide Edit/Remove. Unavailable products have a distinct remove/choose-another message. Editing hands off the original cart-line key; mobile first reloads the current menu and opens the matching concrete SKU/builder. An item absent from that menu gets a separate unavailable alert. The promotional menu navigation effect is constrained to promotional requests so it cannot clear a cart edit.

Missing flavour arrays are safe to render and hydrate. Website summaries mark missing sauces “Needs review”. Builders preserve quantity and valid saved choices, reject unknown flavour IDs, and disclose removed paid options or changed portion information before Save. Draft pruning does not alter the persisted cart. A portion update or removal of an unavailable paid choice occurs only when the customer explicitly saves the reviewed builder; closing the editor leaves the cart unchanged. No automatic cart deletion or portion/flavour replacement was introduced.

Checkout still requires fresh successful server validation. Cart's checkout action can be retried deliberately after a failure, but cannot navigate successfully on a rejected preflight. Checkout errors also link back to Cart. Website ignores obsolete background quote responses and prevents an outdated preflight from navigating after the cart changes. Mobile retains its existing checkout-preparation cancellation and snapshot guards. Server Checkout/POS remain independently strict even if a client bypasses its UI.

Coverage includes both old Party weights, missing builder fields, inactive paid modifiers, invalid flavour IDs, duplicate SKU row identification, valid companion lines, guest and signed-in mobile carts, local-draft edit handoff, explicit Party builder Save and re-quotation. The client screen tests mock structured server rejection; independent API parity tests exercise actual validators and prove rejection before writes. The tests are layered, not a real network/database end-to-end run.

Persisted cart storage, guest/account synchronization and the cart replacement implementation were inspected and preserved rather than migrated. Existing cart/provider regression suites pass. Malformed lunch add-on extraction performed before the per-line loop retains its existing rejection; this patch does not claim every possible malformed cart payload now receives row-specific context.

## Mobile delivery quote freshness

**VERIFIED FIXED:** the quote key includes the same memoized normalized `{ line1, city, postal_code }` snapshot sent to delivery quote, cart quote and checkout. Unit information is carried in `line1` by the existing address model. London remains the fixed delivery city and Canadian postal normalization remains unchanged.

The separate successful-delivery context key includes address, location, fulfillment and schedule. An address change makes token readiness false immediately during render, before asynchronous effects clear old state. The existing quoted-context equality check then blocks Place Order. Fresh delivery and cart requests must succeed before submission is eligible. Existing cancellation/abort handling ignores obsolete responses. Pickup uses a null address identity and needs no delivery token.

The actual mobile checkout screen was rendered with mocked network/session/Stripe dependencies. Six tests cover:

1. Street A to B, immediate blocked submission, fresh requests and matching submitted address/token snapshots.
2. Unit-only change with the same checks.
3. Postal-code-only change with the same checks.
4. A previous in-flight delivery response arriving after selection changes; its token never authorizes the new address.
5. An old cart quote arriving after quantity, tip and promotion changes; only current pricing becomes eligible.
6. Delivery quote failure/retry, delivery to pickup without an address/token, then pickup to delivery requiring fresh quotes.

The tests settle with a finite number of requests and no effect loop. Existing payment-option, scheduling/setup and checkout-preparation suites also pass. Live payment collection, real route-provider responses and device interaction remain **NOT TESTED**.

## Exact changed source files and functions

Paths below are repository-relative. Test files are listed separately.

| File | Changed function/type and purpose |
|---|---|
| `apps/api/src/modules/shared/wing-sku.ts` | `REGULAR_WING_PORTIONS`, new `getWingSkuPortion`, `getWingSkuWeightLb`; explicit portions. Existing `requireWingSkuWeightLb` keeps authoritative rejection. |
| `apps/api/src/modules/catalog/catalog.service.ts` | `SerializedBuilderOption`, `serializeBuilderOption`; correct weights and optional piece metadata for existing direct/synthetic builder serialization. |
| `apps/api/src/modules/catalog/catalog-cache.service.ts` | `MENU_FORMAT_VERSION`, `CatalogCacheService.menuKey`; prevents old cached menu-format reuse. |
| `apps/api/src/modules/admin/admin-promos.service.ts` | `collectItemSizes`; removed `extractWingWeightLbFromName`, uses official SKU sizes and Party piece labels. |
| `apps/api/src/modules/rewards/rewards.service.ts` | `sumRewardablePaidWingsPounds`, `accrueForOrderInTransaction`; trusted SKU earning and existing completed-status guard; removed `isRewardableWingsByPoundSlug`. |
| `apps/api/src/modules/shared/cart-item-error.ts` | New `throwCartItemError`; customer message and line context. |
| `apps/api/src/modules/cart/cart.service.ts` | `CartService.computeQuote`; per-line validation error context. |
| `apps/api/src/modules/checkout/checkout.service.ts` | `CheckoutService.placeOrder`; same context without relaxing validation/persistence. |
| `apps/api/src/modules/pos/pos.service.ts` | `PosService.createPosOrder`; same context, preserving open-food and catalogue pricing. |
| `apps/api/src/common/filters/api-exception.filter.ts` | `ApiExceptionFilter.catch`; forwards explicit structured error detail. |
| `packages/contracts/src/api.ts` | `ApiErrorCode`; two cart recovery codes. |
| `apps/web/src/lib/api.ts`, `apps/application/src/lib/api.ts` | `apiJson`, new `ApiRequestError`; retain body/status for recovery. |
| `apps/web/src/lib/cart-validation.ts`, `apps/application/src/lib/cart-validation.ts` | New `getCartItemIssue`, `issueAffectsLine`, `savedSelectionReview` and issue type. |
| `apps/web/src/lib/types.ts`, `apps/application/src/lib/types.ts` | `BuilderMenuOption`; optional `wing_piece_count`. |
| `apps/web/src/Wings4u/components/cart-page.tsx` | `CartPage`, background quote and checkout-preflight callbacks; row errors, Edit and stale-response guards. |
| `apps/web/src/app/checkout/checkout-client.tsx` | `CheckoutClient` error rendering; Review cart link. |
| `apps/web/src/components/wings-builder.tsx`, `apps/web/src/components/combo-builder.tsx` | `WingsBuilder`, `ComboBuilder`, saved-state hydration and `validate`; missing-field safety, current flavour membership and review notice. |
| `apps/web/src/lib/cart-line-summary.ts` | `buildSaucingSummaryLines`, `buildWingSummaryLines`; missing-slot safety and review text. |
| `apps/web/src/Wings4u/components/wing-builder.tsx` | Removed `parseWeightFromName`; `catalogueWeightLb` and `WingBuilder` now read the exact existing weight/combo option. No active imports of this legacy component were found. |
| `apps/application/app/(tabs)/cart.tsx` | `CartScreen`, `payloadSummary`; row errors, Edit route, safe rendering. |
| `apps/application/src/screens/menu-screen.tsx` | `MenuScreen` cart-edit request effect and promotional effect guard; fresh menu and original edit-line handoff. |
| `apps/application/src/components/mobile-wings-builder.tsx`, `apps/application/src/components/mobile-combo-builder.tsx` | `WingsBuilderMobile`, `ComboBuilderMobile`; safe saved-state hydration and explicit review notice. Existing flavour-membership checks retained. |
| `apps/application/app/checkout.tsx` | `CheckoutScreenContent`, delivery/quote identity and delivery success handling; `cartItemDetails` missing-field safety; Review cart action. |
| `apps/application/src/components/checkout-entry-guard.tsx` | `CheckoutEntryGuard`; Review cart action after preflight failure. |

Cart/Checkout/POS diffs include indentation of their existing validation loops inside `try/catch`. Their pricing and validator sequence were retained. No KDS production code, Prisma schema, migration, environment file, menu seed, promotion record or historical data was changed.

### Added and updated regression files

API:

- New: `apps/api/src/modules/shared/wing-sku.spec.ts`, `shared/cart-item-error.spec.ts`, `admin/admin-promos-portions.spec.ts`.
- Updated: `shared/ordering-integrity.spec.ts`, `shared/ordering-service-parity.spec.ts`, `catalog/catalog.service.spec.ts`, `catalog/catalog-cache.service.spec.ts`, `rewards/rewards.service.spec.ts`, `admin/admin-stamp-grants.service.spec.ts`, `kds/kds.service.spec.ts` (paths under `apps/api/src/modules/`).

Website:

- New: `apps/web/tests/cart-recovery.test.cjs`, `apps/web/tests/saved-cart-validation.test.cjs`.

Mobile:

- New: `apps/application/tests/mobile-checkout-quote-identity.test.cjs`, `apps/application/tests/saved-cart-validation.test.cjs`.
- Updated: `apps/application/tests/cart-tab.test.cjs`, `footer-promotional-screen.test.cjs`, `mobile-wings-builder.test.cjs`.

## Offline verification

Package scripts and test configuration were inspected before execution. Commands below invoke Jest/TypeScript directly, bypassing scripts that could build, seed or deploy. Backend tests use the established guard that mocks the environment-loading Prisma module, rejects external socket connections and requires mocked fetch. Repository/HTTP/payment dependencies use in-memory fixtures and mocks. Test logs describing emails, Redis or cron activity are fixture logs, not production actions.

| Check | Result |
|---|---|
| Complete guarded API unit suite | **PASS: 47 suites, 623 tests** |
| Updated rewards suite after four additional ledger combinations | **PASS: 1 suite, 32 tests**, including four additions after the complete API run (627 distinct API tests passed across these runs). |
| Complete website unit suite | **PASS: 9 suites, 87 tests** |
| Complete mobile unit suite | **PASS: 35 suites, 306 tests** |
| API TypeScript | **PASS**, `--noEmit` |
| Website TypeScript | **PASS**, `--noEmit --incremental false` |
| Mobile TypeScript | **PASS**, `--noEmit --incremental false` |
| Final mobile Cart fixture check | **PASS: 1 suite, 17 tests**, after adding the required modifier display label to a test fixture; already included in the 306-test total. |
| Whitespace/diff check | **PASS**, `git diff --check`; only Git line-ending normalization notices, no whitespace errors. |

Commands:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --setupFiles '<rootDir>/../test/offline-unit-setup.cjs' --silent
node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --setupFiles '<rootDir>/../test/offline-unit-setup.cjs' --silent --runTestsByPath apps/api/src/modules/rewards/rewards.service.spec.ts
node node_modules/jest/bin/jest.js --config apps/web/jest.config.cjs --runInBand --silent
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project apps/web/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/application/tsconfig.json --noEmit --incremental false
git diff --check
```

Intermediate failures were resolved: old portion/message expectations were updated without weakening validators; a mobile menu effect that dismissed a pending cart edit was corrected; fixture postal normalization, button selectors and required modifier display metadata were corrected. Whitespace introduced by loop indentation was removed. No unresolved failure is intentionally accepted.

## Schema, unresolved decisions and limits

**VERIFIED SAFE:** `packages/database/prisma/schema.prisma` retains `OrderItemWingConfig.weightLb @db.Decimal(3, 1)`. All owner-confirmed weights, including 8 and 11, fit. No database schema change or migration is necessary for these official rules, and none was made.

**BLOCKED — lunch policy:** owner confirmation is needed for the official equivalent and stamp eligibility of `lunch-5-wings`. Its existing 0.33 payload also exceeds the schema's one-decimal scale. This patch preserves that legacy value and excludes earning rather than assigning a new policy or changing precision. Database rounding/persistence for this existing lunch case was not tested against a real database. Any future resolution needs a separate proposal; it is not a reason to migrate the schema for 8/11 lb Party weights.

**VERIFIED SAFE:** `wings-4u-special` retains its existing 2 lb compatibility and prior earning exclusion. No new piece count or broader earning policy was invented for it.

**NOT TESTED:** real Supabase persistence, live customer carts/loyalty data, deployed catalogue contents, old installed mobile binaries, signed-in cross-device synchronization against the live API, real browser/device visual QA, physical kitchen packing/printing, live delivery routing, Stripe/payment/refund flows and deployed promotion data. Existing mocked suites cover relevant provider/setup/payment logic, but do not replace staging checks. No database-backed integration test was attempted because the root environment targets production.

No production connection, real order/payment/stamp operation, historical backfill, environment edit, migration, seed, commit, push, merge or deployment was performed. HEAD remains the requested baseline. Implementation and offline regression work are complete; production readiness is not claimed.
