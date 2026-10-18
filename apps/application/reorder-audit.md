# Mobile reorder implementation and validation audit

## Customer flow

Profile > Orders > Past retains its existing filtering and order-card navigation. Each terminal order has a separate Reorder action beneath the card. The same action is shared with the other mobile history and order-detail views. Eligibility matches the website: PICKED_UP, DELIVERED, NO_SHOW_PICKUP, NO_SHOW_DELIVERY, NO_PIN_DELIVERY and CANCELLED.

Reorder performs an authenticated preview POST scoped to the original order's location, with the cart's current fulfillment type and scheduled time. It never changes those preferences to match the historical order. The native “Review your reorder” sheet mirrors the website's copy and difference groups, and also explains configuration changes. It supports Cancel, backdrop dismissal and Android back. An entirely unavailable order offers only Close.

Only Add to cart adds the reviewed items using the existing cart actions. Existing lines are preserved and matching configurations merge quantities. Catalogue labels, prices and JSON key order do not affect configuration identity; flavour-slot order still does. Confirmation checks hydration, location, account, context and a two-minute review expiry. Logout, account/context changes, blur and unmount invalidate pending requests and approvals. Double taps cannot submit twice. Successful addition navigates to the existing Cart tab.

## Source changes

- `apps/application/src/components/reorder-button.tsx`: reusable native action and review sheet.
- `apps/application/src/lib/reorder.ts`: runtime response checks, typed conversion and error/copy helpers.
- `apps/application/src/components/order-history.tsx`, `app/(tabs)/profile.tsx`, `app/orders/[id].tsx`: shared eligible action, separate from the details link.
- `apps/application/src/context/cart.tsx`: deterministic configuration merging, including previously saved cart keys; refresh incoming catalogue metadata.
- `packages/contracts/src/reorder-contract.d.ts`, `src/index.ts`, `src/index.d.ts`: shared, backward-compatible preview types.
- `apps/api/src/modules/orders/reorder-preview.ts`, `reorder-builder.ts`: safe historical reconstruction and authoritative preview.
- `apps/api/src/modules/orders/orders.service.ts`, `orders.controller.ts`, `orders.module.ts`: delegation, optional ordering context and dependency wiring.
- `apps/api/src/modules/cart/cart.service.ts`: extracted read-only item validation/pricing shared by quote and reorder.
- `apps/api/src/modules/shared/builder-catalog-validation.ts`, `order-validation.ts`, `modules/checkout/checkout.service.ts`: shared group constraints, scheduling checks and fail-closed invalid timezones.
- `apps/web/src/components/reorder-button.tsx`: shared types and display of optional skip details/configuration changes; existing requests and confirmation/navigation continue to work.
- Tests: API `orders/reorder-preview.spec.ts`, shared `ordering-integrity.spec.ts`; mobile `reorder.test.cjs`, `reorder-api.test.cjs`, `website-reorder-parity.test.cjs`, `profile-tab.test.cjs`, `cart.test.cjs`.

Earlier uncommitted menu-card and checkout-dock changes were retained separately; this feature does not alter those flows.

## Backend audit and fixes

The old preview copied stored builder JSON directly, omitted stock status and timing checks, checked only the presence of required modifier groups, and calculated price without builder/add-on deltas.

The preview now rebuilds an allowlisted configuration and passes it through the same read-only `CartService.validateItems` used by Cart Quote. That path checks current SKU/location/archive/availability/stock, fulfillment restrictions, restaurant hours, local category/item windows, delivery service availability, scheduled lead time, ingredient removals, modifier ownership/activity, flavours, builder SKU weight and catalogue configuration, child availability and authoritative prices. Unknown configurations or missing builder-linked choices are skipped with a reason; no replacement flavour, portion or paid choice is guessed. Current labels and embedded add-on prices are returned after validation. Historical display prices are discarded and recalculated; unknown configuration fields require explicit reconfiguration. Legacy payload-only ingredient removals are reconciled against current ingredient IDs.

The audit also found incomplete shared modifier constraints. The catalogue validator now applies min/max and required-group checks to ordinary products, all lunch-child groups, and salad-child selections, as well as the existing wing/combo checks. Quote and checkout both use this helper. Quote and checkout now share scheduled lead-time validation; invalid restaurant timezones fail closed.

Tests cover regular/fractional Wings, Combos, 75/100 Party Specials at 8/11 lb, Wings-4-U Special/salad, lunch burger/wrap children, side/pop bundles, ordinary fixed-price products, flavour ordering/side placement, extra sauce, renamed/dropped options, obsolete removals, current prices, stock, scheduling and invalid configurations. Old Party Special weights that conflict with today's SKU are skipped for explicit reconfiguration, rather than silently changed. Side/pop bundles retain the existing server's label-based choices and authoritative bundle price; this feature introduces no new SKU mapping for those labels.

## What preview does not promise

A preview is not an inventory reservation, an aggregate financial quote, or permission to place an order later. It does not transfer historical discounts, coupons, rewards, wallet use, tips, payment data, tax, delivery fees or addresses. It does not calculate address-specific delivery eligibility or the merged cart's minimum delivery subtotal. Existing customer preferences remain in force.

Cart obtains a fresh server quote when items change. The existing `useCheckoutPreparation` / `validateCheckout` path requires confirmed ordering context, a fresh menu, delivery eligibility where applicable, and a fresh whole-cart quote before checkout. Checkout refreshes quotes for changed input and revalidates server-side before order placement. Later stock, timing, promotion, price and configuration changes may therefore reject a previously successful reorder. The review explicitly discloses this.

## Offline verification and remaining manual work

Verification uses mocked unit/UI suites and TypeScript checks. A temporary Node connection guard blocks external networking, TLS and PostgreSQL connections; API HTTP unit tests may use loopback HTTP only. No application service is started. No lint configuration or lint script is provided for these workspaces.

Final results:

| Check | Result |
| --- | --- |
| `npm run test:unit --workspace @wings4u/api -- --silent` | 51 suites, 896 tests passed |
| `npm test --workspace @wings4u/application -- --silent` | 38 suites, 351 tests passed |
| `jest --config apps/web/jest.config.cjs --runInBand --silent` | 10 suites, 89 tests passed |
| `tsc --noEmit -p` each of `apps/api/tsconfig.json`, `apps/application/tsconfig.json`, `apps/web/tsconfig.json` | All passed |
| `git diff --check` | Passed |

No test failures remain. No pre-existing failing suite was encountered in the final runs.

Manual staging/device checks remain: Android/iOS sheet layout at small widths and large font sizes, VoiceOver/TalkBack focus, native back/backdrop dismissal, and an end-to-end authenticated reorder against nonproduction fixtures. These have not been performed against production.

No production database access, database URL/environment change, schema change, migration, seed, real order, payment, email, KDS action, deployment, merge or push is part of this work. Test logs describing orders/emails/KDS events come from mocked fixtures.
