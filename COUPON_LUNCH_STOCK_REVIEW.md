# Wings4U coupon exclusions, lunch loyalty and stock availability review

Baseline: `72ab7f73b879fb6ae9c1054b95f8784095fba65a`.

## Findings and classifications

| Area | Confirmed root cause / existing behavior | Disposition |
|---|---|---|
| Ordinary coupons | Percentage/fixed discounts and minimum-spend checks used the entire merchandise subtotal. BOGO considered all matching cart units. Neither path excluded Party SKUs. | **VERIFIED FIXED** in source and offline service tests. |
| First-order deal | The public first-order code evaluated its percentage/fixed/free-delivery benefits against the entire subtotal, without Party exclusion. | **VERIFIED FIXED**, including `MYFIRSTORDER`, individual benefit thresholds and the existing combined discount cap. |
| Product/category targeting | Admin creation/update stores target relations, but the evaluator did not load or apply them. | **VERIFIED FIXED** for the coupon bases under review. Product/category targets restrict the eligible merchandise; Party exclusion takes precedence. |
| Lunch stamps | `lunch-5-wings` already has `earnsStamps: false`; accrual derives weight from trusted stored SKU identity. | **VERIFIED SAFE**. Earning production code was preserved; completion tests were strengthened. |
| Stock | Shared validation checked archived state and `isAvailable`, but omitted stock status. Checkout's selected fields omitted it, and POS's validation adapter dropped it. | **VERIFIED FIXED** across actual mocked Cart Quote, Checkout and POS methods. |
| Client recovery | Both clients already consume structured item errors and authoritative quoted totals. Their coupon rejection classifiers needed the new exclusion message. | **VERIFIED FIXED** for message handling; **VERIFIED SAFE** for existing total rendering/recovery behavior. |
| POS staff overrides | POS exposes manual order discounts and custom/open-food items rather than customer coupon evaluation. These can reduce the amount paid for Party merchandise. | **PARTIALLY FIXED** only if “no discounts” is interpreted more broadly than the requested coupon ban. Coupon enforcement is complete in the customer coupon paths; staff override policy was deliberately preserved. |
| Production/device operation | No live database, payment, production promotion, deployed client or physical POS was used. | **NOT TESTED**. This report does not establish production readiness. |

No implementation portion is **BLOCKED**. A broader ban on staff manual Party discounts would require a separate owner decision. The owner's new lunch zero-stamp rule resolves the earlier uncertainty about lunch earning; it does not assign a new lunch weight.

## Promotion paths traced

The Prisma promotion enum contains exactly `PERCENT`, `FIXED_AMOUNT`, `BXGY` and `FREE_DELIVERY`. `PromotionsController` exposes active-offer discovery; it does not calculate discounts from client-provided prices. Cart Quote and Checkout are the only production callers of `evaluatePromo` and `evaluateFirstOrderDeal` found in the repository.

| Mechanism | Enforcement and test evidence |
|---|---|
| Percentage | Percentage uses eligible line totals only. The illustrated $90 Party + $15 burger / 10% case produces 150 cents, not 1,050 cents. Quantities and maximum discounts are exercised. |
| Fixed amount | Discount is capped to eligible non-party merchandise. A 5,000-cent coupon against that same mixed cart discounts 1,500 cents. Negative or excessive configured merchandise discounts cannot produce negative prices or consume Party value. |
| Global/location coupons | Both scopes reach the same evaluator and exclusion before calculation. Existing scope/date/activity query restrictions remain unchanged. |
| Product/category coupons | Server-loaded target relations filter the non-party lines. Product and category targets form a union; with no targets the coupon is global within its other restrictions. Targeting a Party product/category cannot override the exclusion. Tests exercise both targeting forms with all four types. |
| BOGO / Buy X Get Y | Party lines are removed before qualifying/reward quantities, target matching and size matching are calculated. They cannot qualify an eligible burger reward or become the reward. Existing eligible BOGO behavior, including product/category and size targeting, is tested. |
| Public first-order deal | Explicit opt-in still applies. Each percentage/fixed/free-delivery benefit uses eligible merchandise and its own configured minimum. The existing combined cap subtracts prior discounts and limits the new merchandise discount to remaining eligible value. Party-only requests reject. Prior-order checks remain in place. |
| Free-delivery coupons | Party-only carts reject. Mixed carts qualify using only eligible merchandise, including any target restrictions. Delivery-fee waivers remain separate from merchandise discount cents. Ordinary delivery pricing and its normal free-delivery threshold retain the full merchandise subtotal. |
| Automatic offers | No automatic application evaluator or `autoApply: true` production path was found. First-order discovery explicitly serializes `autoApply: false`; active coupons require explicit selection. A client-side “Auto” display branch is not a separate price calculator. |
| Loyalty redemption | Separate rewards mechanism, preserved. Party products earn stamps but do not qualify as the redeemed individual one-pound item. Coupon plus loyalty redemption still rejects with “Only one deal can be applied at a time”. |
| POS discounts | No promo-code field/coupon evaluator is used in POS create/manual-discount endpoints. Manual discounts are separate, audited staff/station actions and were not subjected to the coupon policy. |

`first-order-deal.ts`, `bxgy-rule-payload.ts`, `admin-promos.service.ts`, the promotion controller, Cart, Checkout, POS and the Prisma promotion/target models were inspected. The first-order code and BOGO payload formats needed no rewrite. No promotion rows, historical rules or admin settings were changed.

### Trusted identity and discount boundaries

`PromoPricingLine.menuItemSlug` is mandatory internal evaluator data. Cart and Checkout populate it from their server-loaded menu-item maps, together with server-calculated unit prices, quantities and category IDs. It is not read from request names, product-slug fields or requested prices. Unknown SKU identity cannot authorize a coupon. Actual service tests submit misleading names, slugs and prices alongside real menu IDs and verify the catalogue values win.

The common `couponMerchandise` filter excludes exactly `party-75-wings` and `party-100-wings`, then applies stored targeting. Discount bases and promotional minimum spend use its subtotal. Ordinary `itemSubtotalCents` remains the full order merchandise amount for order reporting, standard delivery rules and the existing pricing engine; it cannot widen the coupon base. Direct evaluator tests deliberately pass an inflated aggregate subtotal to prove this separation.

Percentage/fixed/BOGO merchandise discounts are clamped between zero and eligible merchandise value. First-order benefits also share the existing remaining-discount cap. Party item IDs, unit-price snapshots, piece-count names, quantities, builder weights and flavour selections are not rewritten. Discounts remain order-level accounting as before; no per-line redistribution was introduced. Tax is recalculated by the unchanged shared pricing logic using the configured discount/tax policy.

All ineligible-item errors use the existing 422 `promo_code` shape and explain: “No eligible items for this promo. Party Specials are excluded from coupons.” Minimum-spend failures retain the existing minimum-order message. Both clients recognize the new rejection, show the explanation and can re-quote without the rejected code. Coupon displays include a concise Party exclusion note.

### Old Party weights and existing promotions

Old Party weights of 5 or 6.67 lb cannot re-enable eligibility. The SKU exclusion runs before BOGO's size matching; tests also exercise 8 and 11 to prove this is an identity rule, not a particular weight comparison. Independent ordering integrity tests continue rejecting old Party builder weights before order persistence.

Existing admin size lookup already returns the official equivalents and Party piece labels from the prior change, so it was preserved. An old production promotion explicitly targeting a Party product/category or its previous size will no longer discount or qualify Party lines. It may still apply to matching eligible non-party products where its rule permits. No automatic promotion cleanup or migration was performed; a staging review of such configurations is still appropriate.

## Mixed-cart calculation evidence

The following independent fixture expectations are asserted against real Cart and Checkout methods with a real `PromotionsService` and mocked repositories. Prices are illustrative test values, not inspected production catalogue prices. Tax rate is the fixture setting of 13%; default policy reduces the taxable base by the discount.

| Merchandise | Coupon | Merchandise discount | Tax | Final payable |
|---|---|---:|---:|---:|
| 75 Party $90 + burger $15 | 10% | $1.50 | $13.46 | $116.96 |
| 75 Party $90 + burger $15 | $50 fixed | $15.00 | $11.70 | $101.70 |
| 75 Party $90 + 3 burgers at $15 | 10% | $4.50 | $16.97 | $147.47 |
| 75 Party $90 + 2 burgers at $15 | Buy one eligible item, get one | $15.00 | $13.65 | $118.65 |
| 100 Party $120 + burger $15 | 10% | $1.50 | $17.36 | $150.86 |
| 75 Party $90 + burger $15 | First-order 10% | $1.50 | $13.46 | $116.96 |
| 75 Party $90 + burger $15 | First-order $50 fixed | $15.00 | $11.70 | $101.70 |
| 75 Party $90 + burger $15 | Free delivery / first-order free delivery | $0 merchandise; $5 delivery waived | $13.65 | $118.65 |
| 75 Party $90 + burger $15 | 10%, tax policy does not reduce taxable base | $1.50 | $13.65 | $117.15 |

For a $25 promotional minimum, Party + one $15 burger rejects, while Party + two $15 burgers qualifies. Tests cover regular, free-delivery and first-order thresholds. A test with a $100 standard free-delivery threshold verifies the full $105 subtotal still qualifies under the ordinary delivery policy; the coupon percentage still discounts only the burger.

Direct evaluator tests cover additional eligible products, quantity changes, maximum merchandise discounts, unchanged non-party size-restricted BOGO, all Party-only coupon types, target records and the combined first-order percentage/fixed/free-delivery bundle. The existing same-SKU BOGO calculation still requires separate qualifying and reward units.

These tests stop at a mocked order-write boundary after asserting the proposed stored totals. They do not complete a real order, payment or database transaction.

## Lunch and Party loyalty evidence

**VERIFIED SAFE:** no earning implementation change was necessary. `getWingSkuPortion('lunch-5-wings').earnsStamps` remains false. `sumRewardablePaidWingsPounds` uses trusted stored catalogue identity with a compatible builder type; a forged WINGS payload/weight cannot make lunch rewardable. Quantity does not change its zero eligible pounds.

New real rewards-method tests exercise each case below at `PICKED_UP`, `DELIVERED` and `NO_PIN_DELIVERY`, then replay the same order:

| Purchase | Eligible pounds / calculated whole stamps | Available credit from zero | Lifetime increment |
|---|---:|---:|---:|
| One lunch five-wing special | 0 / 0 | 0 | 0 |
| Three lunch five-wing specials | 0 / 0 | 0 | 0 |
| Three lunch specials + 2 lb Wings | 2 / 2 | 2 | 2 |
| Lunch special + 75 Party | 8 / 8 | 8 | 8 |
| Lunch special + 100 Party | 11 / 11 | 8 | 11 |

Existing tests retain ordinary/fractional Wings, Combos, Party quantities, aggregation before flooring, a balance near eight, a full balance, guests, free-one-pound subtraction, redemption restrictions and ledger idempotency. The available balance cap remains eight. Lifetime accounting still records all calculated earned stamps. Existing KDS terminal-transition replay tests prevent historical completed-order replay from starting an accrual transaction. No historical scan, backfill, correction or reward write was added or run.

Checkout/POS continue persisting the actual purchased SKU and validated payload. Party equivalents remain 8/11. The legacy lunch 0.33 payload and its pre-existing one-decimal storage precision concern were not changed; the confirmed zero-earning rule does not require a schema or weight-policy change.

## Stock enforcement and saved-cart behavior

**VERIFIED FIXED:** `ValidationMenuItem.stockStatus` is now required, making omitted production adapters visible to TypeScript. `assertMenuItemOrderable` rejects `UNAVAILABLE` independently of `isAvailable`, after the existing archived/availability checks. It emits `CART_ITEM_UNAVAILABLE` with an understandable out-of-stock explanation. `throwCartItemError` preserves that explanation and adds the exact request-line index/menu ID. Duplicate SKU lines remain distinguishable.

Cart's existing include query already loads scalar stock status. Checkout now explicitly selects it. POS's existing include query also loads it, and `menuItemRowToValidationPayload` now carries it into shared validation. Catalogue scalar/stock serialization was inspected and preserved. Existing clients already receive `stock_status`; backend enforcement no longer depends on their UI checks or menu-cache freshness.

All combinations below were exercised through the actual mocked Quote, Checkout and POS methods, including archived combinations with both values of `isAvailable`:

| isAvailable | stockStatus | Archived | Result in all three services |
|---|---|---|---|
| true | NORMAL | No | Allow when otherwise valid |
| true | LOW_STOCK | No | Allow when otherwise valid |
| true | UNAVAILABLE | No | Reject before order write, row-specific out-of-stock error |
| false | NORMAL | No | Reject before order write |
| false | LOW_STOCK | No | Reject before order write |
| false | UNAVAILABLE | No | Reject before order write |
| Either | Any of the three | Yes | Reject before order write |

This is 36 stock-matrix service cases. Three additional service cases preserve lunch child stock rejection. Existing scheduling, fulfillment, ingredient/modifier, archived and builder-security checks pass. Existing POS open-food tests still pass when no catalogue SKU is used.

Website and mobile renderer tests cover an old saved cart rejected with the new stock message. The affected line displays its error, checkout cannot navigate successfully, and Remove invokes only that line's key; the companion line object and quantity remain intact. No cart rewrite, automatic deletion or replacement was introduced. Existing saved-cart/edit/re-quote and mobile address-freshness regressions also pass.

## POS manual discounts and remaining pathways

**VERIFIED SAFE within the requested scope:** POS create/manual-discount endpoints are gated by location, store-network and POS-station guards. No customer promo-code evaluator is invoked there. The catalogue stock check applies even if the request supplies a custom name or price alongside an existing unavailable catalogue ID. Open-food/custom items remain a distinct staff facility.

**PARTIALLY FIXED if a wider discount prohibition is desired:** `PosService.createPosOrder` accepts `discountAmountCents` for a manual order discount; `applyManualDiscount` can discount an existing Party order. These paths record `MANUAL` discounts and audit attribution. They do not distinguish Party merchandise or individual manager approval. The latter method retains its existing total-reduction/clamping behavior. Staff can also intentionally use custom/open-food pricing. These are preserved staff-authorized mechanisms, not customer coupon bypasses. No new policy restricting them was inferred from the coupon ban.

Separately, schema fields for promotion valid days/time-of-day exist, while the current evaluator's active filter enforces date bounds/activity/archive rather than those day/time fields. This pre-existing policy gap was not expanded into a promotion rewrite; it cannot override the new Party exclusion, but deserves a separate review if the restaurant relies on those restrictions. Live scope, usage-limit concurrency and active promotion configurations were not inspected against production.

## Exact files and functions changed

| Source file | Functions/types and change |
|---|---|
| `apps/api/src/modules/promotions/promotions.service.ts` | `PromoPricingLine`; new `COUPON_EXCLUDED_SKUS`, `couponMerchandise`, `rejectNoCouponItems`; `evaluatePromo`, `evaluateFirstOrderDeal`: trusted SKU exclusions, target relations, eligible bases/minimums/caps. Existing BOGO matching/discount algorithm is reused with filtered lines. |
| `apps/api/src/modules/cart/cart.service.ts` | `CartService.computeQuote`: attaches server-loaded slug to promo lines and supplies the same lines to first-order evaluation. |
| `apps/api/src/modules/checkout/checkout.service.ts` | `CheckoutService.placeOrder`: selects stock status, supplies trusted slug/lines to both promotion paths inside the existing transaction. |
| `apps/api/src/modules/shared/order-validation.ts` | `ValidationMenuItem`, `assertMenuItemOrderable`: required stock field and authoritative unavailable-stock rejection. |
| `apps/api/src/modules/shared/cart-item-error.ts` | `throwCartItemError`: preserves shared unavailable-stock code/message while attaching affected-row context. |
| `apps/api/src/modules/pos/pos.service.ts` | `menuItemRowToValidationPayload`: carries actual stock status. No manual-discount policy change. |
| `apps/web/src/lib/promo-errors.ts` | `isPromoRejectedQuoteError` pattern list: recognizes the new inapplicable-coupon explanation. |
| `apps/application/src/lib/promo-selection.ts` | `isPromoRejectedQuoteError` pattern list: matching mobile behavior. |
| `apps/web/src/Wings4u/components/cart-page.tsx` | `CartPage` coupon display: one explanatory Party exclusion note. |
| `apps/application/app/(tabs)/cart.tsx` | `CartScreen` coupon display: same note. |
| `apps/application/app/checkout.tsx` | `CheckoutScreenContent` coupon display: same note. |

Test files added:

- `apps/api/src/modules/promotions/promotions-security.spec.ts`: all four types, first-order benefits, product/category targets, BOGO/size exclusions, minimums, caps and trusted subtotal boundaries.
- `apps/api/src/modules/shared/coupon-service-parity.spec.ts`: real Quote/Checkout calculations, tampered client labels/prices, thresholds, tax policy, normal delivery threshold and stacking.
- `apps/web/tests/promo-errors.test.cjs`: new coupon explanation recognized; stock/network errors remain separate.

Test files updated:

- `apps/api/src/modules/shared/ordering-service-parity.spec.ts`: complete stock table, lunch-child rejection, fixture stock field.
- `apps/api/src/modules/shared/order-validation.spec.ts`, `ordering-integrity.spec.ts`: explicit stock fields in typed fixtures.
- `apps/api/src/modules/shared/cart-item-error.spec.ts`: stock message/code/row preservation.
- `apps/api/src/modules/rewards/rewards.service.spec.ts`: confirmed lunch exclusion across all qualifying completion statuses and mixed orders/replay.
- `apps/web/tests/cart-recovery.test.cjs`, `apps/application/tests/cart-tab.test.cjs`: affected-line removal and companion preservation after stock rejection.
- `apps/application/tests/promo-selection.test.cjs`: new rejection-message compatibility.
- `apps/application/tests/final-wing-builder-stability.test.cjs`: fixes an existing Saturday-only hours fixture by pinning that specific parity test's clock to its intended Saturday. No scheduling production logic was changed.

No changes were needed to reward earning code, KDS production code, catalogue serialization, admin promo persistence, first-order code format, BOGO payload format, shared tax/pricing engine, cart persistence, schema or inventory records.

## Offline validation and limits

Package scripts and Jest setup were inspected before tests. Root CI/e2e/build/database scripts were not used. Backend runs inject `offline-unit-setup.cjs`, which replaces the environment-loading Prisma service, rejects external socket connections and requires mocked fetch. Repositories, routing, payment and order allocation use mocks/in-memory fixtures. Customer-address persistence in delivery parity tests is explicitly stubbed. Fixture logs describing emails, routing, Redis or cron operations are not live operations.

| Check | Result |
|---|---|
| Guarded API Jest | **PASS: 49 suites / 746 tests** |
| Website Jest | **PASS: 10 suites / 89 tests** |
| Mobile Jest | **PASS: 35 suites / 307 tests**, after the deterministic-clock correction |
| API TypeScript | **PASS**, no emit |
| Website TypeScript | **PASS**, no emit / no incremental output |
| Mobile TypeScript | **PASS**, no emit / no incremental output |
| Diff whitespace | **PASS**, `git diff --check`; one Git line-ending normalization notice, no whitespace errors |

Commands:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --setupFiles '<rootDir>/../test/offline-unit-setup.cjs' --silent
node node_modules/jest/bin/jest.js --config apps/web/jest.config.cjs --runInBand --silent
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project apps/web/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/application/tsconfig.json --noEmit --incremental false
git diff --check
```

Intermediate failures were resolved without relaxing production validators: new parity fixtures needed proper catalogue modifier mappings and a valid all-Plain saucing method; the mock option-array type needed an explicit common type. The existing mobile hours fixture failed when the real clock rolled beyond its Saturday schedule; only that test's clock was fixed.

**NOT TESTED:** live database persistence, deployed promotion records, real customer carts/loyalty, real transactions or concurrency against PostgreSQL, browser/device visual interaction, physical POS/printer, payment collection and production deployment health. No database-backed integration suite was attempted because the local root environment points to live Supabase.

Staging should verify actual global/targeted/first-order/BOGO/free-delivery promotion configurations, including old Party size-targeted rules; mixed-cart tax receipts; unavailable stock selected from current/cached menus; customer edit/remove recovery; eligible completion stamp ledgers; and permitted staff overrides. Those checks need a safe staging environment and are not a claim of production readiness.

No schema migration is required. No live connection, database mutation, promotion edit, inventory edit, price change, historical recalculation, environment/credential change, real order/payment, migration, seed, commit, push, merge or deployment was performed. Changes remain local for review.
