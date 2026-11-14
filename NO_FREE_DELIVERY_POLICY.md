# Mandatory distance delivery fees

See `PRODUCTION_READINESS.md` for the final full-suite results, successful correctly configured web build, LON01-scoped cleanup review, and revised deployment gates.

This policy supersedes the waiver behavior described in `DELIVERY_PRICING_AUDIT.md`. That report remains evidence of the historical #1077 investigation.

## Behavior

Every newly created delivery order retains the positive fee in its verified Google Routes quote. Neither subtotal nor discounts can waive it. Pickup remains fee-free. The existing distance tiers, metre boundaries, 20 km cap, London eligibility, signing context, and pricing-rule version remain unchanged because the distance calculation did not change.

Legacy `freeDeliveryThresholdCents` settings are ignored by cart, checkout and POS. The catalog always returns a null threshold, new-location seeding uses null, and settings updates cannot re-enable a threshold. The schema field is retained for compatibility; no migration is required.

Explicit FREE_DELIVERY codes reject with a helpful promotion error. First-order bundles skip delivery benefits but retain valid percentage/fixed food benefits and their redemption records. Customer offer discovery excludes free-delivery offers. Administrators cannot create/re-enable a waiver through code or first-order deal editors. Legacy records remain available for audit/archiving.

Cart and checkout also ignore any `waivesDelivery` result rather than allowing another promotion evaluator to undo the policy. Food discounts are still capped to eligible merchandise. POS creation caps its food discount to merchandise. Post-creation POS manual discounts are restricted to remaining food charges on delivery orders, under an order row lock and atomic transaction, so repeated requests cannot consume the delivery fee.

New quotes reject nonpositive signed fees, including correctly signed zero-fee payloads. A zero-fee Redis route-cache entry is discarded and rerouted. Valid positive quotes retain their existing signature, address/location binding, version and expiry checks. Catalog payload cache format is bumped to prevent old threshold values reaching POS estimates.

Delivery enters the payable sum once, and enters the taxable base once only when `taxDeliveryFee` is enabled. Tips, tax policy, wallet payment, food-discount eligibility, payment amount verification and checkout replay behavior remain intact. Wallet credit is a payment mechanism, not a delivery waiver. Web and mobile consume backend quote totals; POS estimates no longer use a threshold. Existing KDS rendering shows persisted positive charges and historical zero fees as Free, with no row for pickup.

No existing order, snapshot, settled payment or refund was updated. No historical fee is recomputed, including on idempotent checkout replay. No production deployment or settings update was performed.

## Production configuration verified read-only

The connected PostgreSQL database currently has location **LON01** with `free_delivery_threshold_cents = 4000`. There are **no FREE_DELIVERY promotion records**. Order **#1077** still has delivery fee 0, tax 708 and payable 6154 cents. Queries ran in `BEGIN READ ONLY` / `ROLLBACK`.

The backend policy will enforce paid delivery even before this stale threshold is cleared. Production cleanup is still pending explicit approval. The prepared SQL is `packages/database/sql/disable-free-delivery.sql`; its default final statement is ROLLBACK. It only clears location thresholds and deactivates legacy free-delivery promo records, retaining their history. It never updates orders or payments.

## Changed implementation files

- `apps/api/src/modules/cart/cart.service.ts`: retain quote fee, ignore threshold and promo waiver flags.
- `apps/api/src/modules/checkout/checkout.service.ts`: retain quote fee when calculating/persisting new orders; snapshot waiver remains false.
- `apps/api/src/modules/pos/pos.service.ts`: mandatory verified fee; food-only manual discounts with transactional row locking.
- `apps/api/src/modules/promotions/promotions.service.ts`: reject free-delivery codes, omit waiver benefits from mixed deals and customer offer discovery.
- `apps/api/src/modules/admin/admin-promos.service.ts`: block waiver configuration, expose first-order freeDelivery as false.
- `apps/api/src/modules/locations/location-settings.service.ts`: reject attempts to restore a threshold.
- `apps/api/src/modules/catalog/catalog.service.ts`: advertise no threshold.
- `apps/api/src/modules/catalog/catalog-cache.service.ts`: new payload namespace.
- `apps/api/src/modules/delivery-pricing/delivery-pricing.service.ts`: discard zero-fee cached routes.
- `apps/api/src/modules/delivery-pricing/delivery-quote-token.service.ts`: reject nonpositive fees.
- `apps/web/src/app/pos/pos-client.tsx`: no threshold calculation.
- `apps/web/src/app/admin/settings/settings-client.tsx`: remove threshold editor.
- `apps/web/src/app/admin/promos/admin-promos-client.tsx`: remove first-order free-delivery checkbox and initialize false.
- `apps/web/src/app/admin/promos/promo-modal.tsx`: disallow selecting free delivery; legacy entries are labeled disabled.
- `packages/database/prisma/seed-catalog.ts`: seed null threshold.

KDS files from the preceding audit already implement paid/free/pickup display correctly and need no further change for this policy. The other pre-existing workspace edits are preserved.

## Test coverage

Updated tests: cart delivery policy, real cart/checkout coupon parity, POS delivery persistence, quote tokens, route cache, promotion security/schedules, catalog namespace, web POS, mobile checkout quote identity and mobile cart.

New tests: `apps/api/src/modules/locations/no-free-delivery.spec.ts` and `apps/api/src/modules/pos/pos-delivery-discounts.spec.ts`.

The cart/checkout matrix covers subtotals $20/$40/$80/$200/$500 at driving distances 0/4951/8000/10000/20000 metres with delivery taxation both enabled and disabled, checking Prisma creation arguments, snapshots and totals. POS independently runs the same subtotal/distance matrix using actual signed quotes. Existing tests cover every subsequent kilometre boundary, >20 km refusal, signature tampering, expiry, address changes, pickup and idempotent replay. Additional tests cover rejected waiver-only codes, mixed first-order food benefits, large food discounts, stale thresholds (including zero), positive fees displayed by mobile/POS and historical free KDS display.

Database persistence tests assert the data passed to Prisma inside mocked transactions; they do not create test orders in production. Mobile tests mock backend responses and verify consumption of the authoritative paid fee rather than independently calculating distance prices.

Validation results:

- API: 20 targeted suites, **433 tests passed**.
- Web: 4 targeted suites, **14 tests passed** (KDS, POS, promotion errors, first-order disclosure).
- Mobile: 4 targeted suites, **179 tests passed** (checkout identity, cart, preparation and pricing).
- Web TypeScript check passed. Web production build compiled and passed its lint/type phase, then failed during homepage prerendering because the catalog API could not supply sauces (the same external-data blocker seen during the preceding audit).
- Final sequential API build passed, including the manual-discount guard. An earlier concurrent retry exhausted native Node memory during Prisma generation; the sequential retry resolved it.
- `git diff --check` passed. No standalone lint script is configured. Live payment/browser smoke tests remain deployment verification steps.

## Deployment instructions (approval required)

1. Review the changes and obtain explicit approval for deployment and the configuration cleanup. No schema migration is needed.
2. Deploy the API to every serving instance and drain all old instances. A mixed old/new fleet can still accept waived orders through old code; the code rollout must be complete before the policy is considered live.
3. Deploy the web/admin/POS clients and reload open POS sessions. Mobile runtime code is unchanged; test fixtures do not ship to users and require neither an app-store release nor an OTA update. The new catalog cache namespace avoids old cached thresholds without clearing route prices.
4. With approval, review and run `packages/database/sql/disable-free-delivery.sql`, changing its final ROLLBACK to COMMIT. Confirm LON01's threshold is NULL and active FREE_DELIVERY promo count is zero. Do not seed/reprice production orders.
5. Refresh any cart/checkout opened before rollout. A card payment intent based on old waived totals will fail existing amount/hash validation; refresh pricing and the payment intent through the existing checkout flow. Do not manually capture a stale lower amount or change settled payments. Completed idempotent replays continue to return original historical orders.
6. Smoke-test delivery at the five requested subtotals, paid fee/tax/total across checkout and POS, pickup without delivery, mixed first-order food discounts, and KDS/confirmation/order-details persistence. Use a test payment environment for payment verification. Recheck #1077 remains fee 0 / total 6154, and query recent new delivery orders for nonpositive fees or snapshot/column total discrepancies.
7. A rollback to waiver-capable application code could restore free-delivery behavior. Do not roll back the mandatory-fee paths without a new policy decision; clearing the threshold alone cannot block all old promotion code paths.
