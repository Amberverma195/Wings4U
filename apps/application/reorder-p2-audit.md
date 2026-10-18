# Final Reorder Sprint: P2 pagination and backend audit

## A. Pagination implementation

Changed mobile files:

- `app/(tabs)/profile.tsx`: Past-only Load More Orders button, loading copy/spinner, disabled state, page-error retry, honest partial-history empty state and loaded-count explanation.
- `src/hooks/use-account-data.ts`: reuse the existing authenticated 20-order cursor endpoint and ID-based append/deduplication; protect the page lock and latest cursor against stale callbacks, refresh, logout, account changes and unmount. A customer ID is required before fetching private account data. A stale response cannot refresh/clear a different customer's session.
- `tests/account-orders-pagination.test.cjs`: mocked hook coverage for initial loading, cursor encoding, append/deduplication, mixed/empty pages, failure/retry, exhaustion, duplicate taps, stale callbacks, refresh and account isolation.
- `tests/profile-tab.test.cjs`: Past pagination UI, loading/error/empty states, older order Reorder actions, unchanged Active/Past selection and independent detail navigation.
- This report: `reorder-p2-audit.md`.

The button appears below the historical cards only while `ordersNextCursor` exists. It uses `loadMoreOrders()` and `loadingMoreOrders`, requests `limit=20`, and retains previous rows on page failure. Retrying uses the same cursor. Active-only or empty pages with a next cursor remain loadable. A null cursor removes the button. The selected filter remains Past as new pages append. Existing `OrderRow` / `OrderReorderAction` rendering automatically supplies Reorder for newly loaded terminal orders; neither the action nor its confirmation implementation changed.

`src/components/order-history.tsx` and `app/(tabs)/orders.tsx` were inspected and left unchanged. The signed-in legacy Orders route already redirects to Profile; it is not a second pagination implementation.

The pre-existing uncommitted `app/(tabs)/cart.tsx` edit/delete-button layout change was retained without modification in this task.

## B. CartService changes

Compared `d9feb2eaf88c1c681a12f0bf9f72e9d3f0bb778d` with `1b54a95f47b987f8805e6440bd166255cc01c410` and current HEAD. HEAD is still `1b54a95`; there are no newer commits to audit. `CartService` itself is unchanged by this sprint.

Before, `computeQuote()` contained item loading, validation, line pricing and financial totals. After, its existing item-processing block lives in public, read-only `validateItems(locationId, fulfillmentType, items, scheduledFor)`. `computeQuote()` keeps its signature and delegates to that method, then executes the original financial calculation block.

The extraction is not entirely behavior-neutral. These checks were added:

1. Positive safe-integer quantities at the service boundary.
2. Rejection of missing/inactive locations at quote time.
3. Scheduled lead-time checking at quote time, aligning quotes with checkout's existing policy.

The item block otherwise retains the same SKU, stock, fulfillment, category/item scheduling, removal, flavour and builder checks, authoritative line-price calculation and indexed cart-item error wrapping. Stock UNAVAILABLE and official wing/Party Special weights were already enforced in the previous Cart/Checkout paths; they were not introduced by this extraction.

An exact normalized-text comparison from `let deliveryFeeCents = 0` to EOF returned **unchanged**. That block includes delivery fee/minimum/waiver behavior, delivery verification/customer eligibility, pricing policy, coupon and first-order evaluation, loyalty stacking, subtotal/tax/tip/wallet calculations and the quote response. No payment operation was added. `validateItems` returns extra internal lookup maps for reorder; these are not exposed in the public quote response.

Shared helpers did change in the reorder commit:

- `getScheduleContext()` now rejects invalid timezones/dates instead of silently falling back.
- `loadBuilderCatalogContext()` loads ordinary-product modifier mappings too.
- `assertBuilderCatalogValid()` enforces ordinary modifier min/max/required constraints, all lunch-child groups, and salad-child constraints. Valid wing/combo rules and authoritative prices were retained.

Those changes affect website/mobile quotes, checkout, POS (which already called the same shared helper), and reorder. They intentionally reject some requests previously accepted despite invalid/unavailable configurations. They also introduced the concrete valid-configuration regression described below; it is fixed narrowly in the shared helper, without changing `CartService`.

HTTP compatibility: the quote success shape is unchanged. New validation failures remain HTTP 422 through the existing API envelope filter. Item failures still use `CART_ITEM_CONFIGURATION_INVALID` / `CART_ITEM_UNAVAILABLE` and affected item IDs/indices, which both website and mobile recovery helpers understand. Global location/time errors remain readable through the existing generic API error helpers. These intentional earlier rejections are behavior changes, not new response schemas.

## C. CheckoutService changes and reproduced regression

`CheckoutService.placeOrder()` replaced its inline scheduled lead-time block with `assertScheduledOrderingTime(params.scheduledFor, settings)`. No other direct `CheckoutService` code changed in that commit or this sprint.

For valid timestamps and settings the helper is equivalent:

- Busy mode uses a truthy busy-mode prep time, otherwise the default; zero/null retain the previous fallback.
- Exact minimum lead time is accepted; one millisecond earlier is rejected.
- ASAP/omitted scheduling skips the check.
- The same 422 message and `scheduled_for` field are preserved.
- Equivalent UTC/offset timestamps behave equally.
- Malformed timestamps are now explicitly rejected rather than relying on later validation. This is intentional stricter behavior.

`reorder-change-audit.spec.ts` compares the previous block's formula with the helper across all these valid boundaries and fallback cases. Pricing, taxes, tips, coupons, loyalty, delivery, payment, transaction and order-persistence code in `CheckoutService` were not edited.

### Confirmed regression and minimal fix

**Root cause:** the newly added salad-child group validation required a standalone salad-size modifier even inside the Wings-4-U Special. Both current builders deliberately serialize only salad add-on selections (`mobile-wings-builder.tsx` and website `wings-builder.tsx`); the Special's salad size is already the included Small. Local catalog source defines a required standalone Salad Size group. The new check therefore rejected a valid supported customer payload.

**Affected behavior:** quote, checkout, POS and reorder all use the same shared helper. A Special with nested salad customization and no standalone size ID could fail with `CART_ITEM_CONFIGURATION_INVALID` / `Invalid selections for salad-size`.

**Reproduction:** three new offline tests using the actual Cart, Checkout and POS services failed before the fix. They use an add-on-only nested salad payload matching both customer builders and a required Small/Large standalone size group. Existing tests had supplied an explicit salad size, so they missed this case.

**Applied fix:** in `modules/shared/builder-catalog-validation.ts::assertBuilderCatalogValid`, treat only nested `contextKey='size'` groups on `wings-4u-special` as represented by the parent when checking minimum counts. All selected-option membership/activity checks, maximum counts and other required groups remain enforced. No choice, portion or price is changed. Independent salads still require their own size.

Changed backend files in this sprint:

- `apps/api/src/modules/shared/builder-catalog-validation.ts`: this narrow correction only.
- `apps/api/src/modules/shared/ordering-service-parity.spec.ts`: nine quote/checkout/POS cases covering the real included-small payload plus missing/too-many add-ons.
- `apps/api/src/modules/shared/reorder-change-audit.spec.ts`: lead-time compatibility and independent-salad regression checks.

The nine service cases pass after the fix, including authoritative expected totals and rejection of invalid add-ons before mocked persistence. No CartService or CheckoutService refactor was performed.

Customer-facing UI is separate: in the reorder commit, mobile cart `checkoutDock.bottom` changed from 72 to 0, placing it above the navigator-owned footer; its scroll-padding comment changed too. This is positioning only. `app/checkout.tsx` has no diff between the audited commits and was not changed here. The existing pending edit/delete layout change is also UI only.

## D. Verification actually executed

All tests were offline/mocked. The final runs used a temporary Node guard blocking external connections, TLS, and PostgreSQL ports. Local HTTP is allowed only for mocked HTTP unit tests. No application service or database-connected e2e suite was started.

| Command | Result |
| --- | --- |
| `tsc --noEmit -p apps/application/tsconfig.json` | Passed |
| `tsc --noEmit -p apps/api/tsconfig.json` | Passed |
| `npm test --workspace @wings4u/application -- --silent` | 39 suites, 372 tests passed |
| `npm run test:unit --workspace @wings4u/api -- --silent` | 52 suites, 922 tests passed |
| `jest --config apps/web/jest.config.cjs --runInBand --silent` | 10 suites, 89 tests passed |
| `git diff --check` | Passed |
| Exact comparison of CartService's financial calculation tail against `d9feb2e` | Identical |

The mobile run includes Profile, the account pagination tests, session/account isolation, native reorder, website reorder compatibility, cart, fresh quote and checkout-entry tests. The API run includes all Cart/Checkout/POS ordering parity, reorder, coupon timing/caps, rewards, builder, payment-policy and pricing tests.

**Failed reproduction before correction:** 3 included-small-salad service cases. **Final failures:** none. No unrelated pre-existing failing suite was encountered. Lint/build/database/e2e commands were not run; these workspaces have no configured lint script, and a full build was unnecessary.

Still requiring manual QA: Android/iOS paging with more than 20 seeded nonproduction orders, poor-network retry/spinner behavior, repeated Active/Past switching, opening/reordering an older card, and Wings-4-U Special salad customization through website/mobile/POS on staging fixtures. No live catalog was queried. Newly enforced modifier rules can expose catalog configuration drift, so staging menu coverage remains necessary.

## E. Final sprint verdict

**READY FOR MANUAL QA**

Pagination, state isolation and the reproduced regression have automated coverage and pass all final checks. This verdict is not production deployment approval or proof of the live catalog's configuration.

No production database connection/query/mutation, environment/connection/schema/deployment change, migration, seed, genuine order/payment/email/KDS operation, commit, push, merge or deployment was performed. Test logs describing those actions are mocked fixtures. Changes remain local for review.
