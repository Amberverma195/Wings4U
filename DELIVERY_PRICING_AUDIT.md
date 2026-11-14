# Delivery pricing and KDS audit — November 13, 2026

## Result for order #1077

Read-only access through the repository's configured PostgreSQL connection was available. Queries ran inside `BEGIN READ ONLY` / `ROLLBACK`; no production writes, migrations, or deployment were performed. No customer address, credentials, or quote token is included here.

The matching delivery order was placed at 5:55:32 PM America/Toronto on November 13. Its stored columns and pricing snapshot agree:

| Field | Stored value (cents) |
| --- | ---: |
| item_subtotal_cents | 6745 |
| item_discount_total_cents | 1299 |
| order_discount_total_cents | 0 |
| delivery_fee_cents | 0 |
| driver_tip_cents | 0 |
| wallet_applied_cents | 0 |
| taxable_subtotal_cents (snapshot) | 5446 |
| tax_cents | 708 |
| final_payable_cents | 6154 |

Snapshot `delivery_pricing` records `rule_version: 2`, `stated_delivery_fee_cents: 800`, and `delivery_fee_waived: true`. The actual location's current `free_delivery_threshold_cents` is **4000**, `discounts_reduce_taxable_base` is true, `tax_delivery_fee` is true, and `tax_tip` is false. The seed also sets a $40 threshold. Both cart and checkout compare the **pre-discount item subtotal** with that threshold. Thus $67.45 qualifies; no delivery charge is due under that configuration. Even its discounted subtotal exceeds $40.

No promo redemptions, order-discount rows, or payment rows existed for this order when inspected. Its snapshot requests `CARD_ON_DELIVERY`; an absent payment record is not evidence of a missing delivery charge. The $12.99 is in item discounts, not a delivery promo redemption.

Arithmetic: `6745 - 1299 = 5446`; `round(5446 * 13%) = 708`; `5446 + 0 + 0 + 708 - 0 = 6154`. There is no evidence that checkout lost an applicable fee. The snapshot explicitly records a waiver and the current threshold explains it. Historical location settings and the original signed token are not retained in this snapshot, so the exact threshold at placement and original quote's signature/expiry cannot be independently reconstructed. The current checkout path requires a valid quote even when delivery is free.

Additional read-only integrity check at this location: **16 delivery orders, 12 with positive delivery fees, zero arithmetic-total mismatches, zero snapshot-versus-column final-total mismatches**. This is evidence about those records, not a guarantee for every order or deployed software version.

## Confirmed defects and changes

1. `apps/web/src/app/kds/kds-client.tsx`, pricing summary: the `delivery_fee_cents > 0` condition hid legitimate free delivery. It now renders `DeliveryFeeRow` from `apps/web/src/app/kds/delivery-fee-row.tsx`. Every delivery order shows the persisted amount, or **Free** for zero; pickup never shows the row. Existing row styles are preserved. No frontend repricing or new database fee field is introduced. The historic snapshot has a waiver boolean but no specific reason; the UI does not invent one.
2. `apps/api/src/modules/pos/pos.service.ts`, `createPosOrder`: POS ignored `discountsReduceTaxableBase=false`, causing POS/online tax differences for that configuration. It now honors the setting while adding taxable delivery exactly once. POS also omitted the existing applied-tax flags from order creation; it now saves `taxDeliveryFeeApplied` and `taxTipApplied`. This affects new orders only.
3. `apps/api/src/modules/catalog/catalog.service.ts` supplies `discounts_reduce_taxable_base` in the catalog location payload; `apps/web/src/app/pos/pos-client.tsx` honors it in its estimate. `catalog-cache.service.ts` changes the menu format namespace so cached payloads lacking the field cannot survive this change. No pricing-rule version bump is needed: distance prices did not change.

Tests changed/added: `apps/web/tests/kds-delivery-fee.test.cjs`, `apps/web/tests/pos-delivery.test.cjs`, `apps/api/src/modules/shared/pricing.spec.ts`, `apps/api/src/modules/cart/cart-delivery-pricing.spec.ts`, `apps/api/src/modules/delivery-pricing/delivery-pricing.constants.spec.ts`, `apps/api/src/modules/delivery-pricing/pos-delivery.spec.ts`, and `apps/api/src/modules/catalog/catalog-cache.service.spec.ts`.

Pre-existing edits to `GOOGLE_ROUTES_DIAGNOSIS.md`, `apps/web/src/Wings4u/components/cart-page.tsx`, and `apps/web/tests/cart-refresh-pages.test.cjs` were preserved.

## End-to-end flow and safety checks

- `google-routes.client.ts` calls Google's computeRoutes endpoint with `travelMode: DRIVE`, `routingPreference: TRAFFIC_UNAWARE`, and the `routes.distanceMeters` field. Pricing consumes metres directly; no straight-line substitution or floating-point kilometre conversion is used. Additional London city eligibility applies before the 20 km cap.
- `DeliveryPricingService.createQuote` checks location/fulfillment availability, calculates the distance tier, caches the derived fee/eligibility, and signs it. Provider failures fail closed. Redis and local keys include rule version 2, the approved-tier namespace, location, and normalized-address fingerprint; both caches expire after one hour. Future rule changes must change the rule version or namespace and signing context as appropriate. Cache values are not used as client authority.
- `DeliveryQuoteTokenService` verifies HMAC-SHA256 with timing-safe signature comparison, payload shape, current rule version, and expiration. The signing context rejects older quote contexts. `DeliveryQuoteVerifierService` binds location and normalized address fingerprint. Changing an address or location invalidates a quote. Fixed-context quotes cannot bypass the distance verifier. Payload time claims are trusted because they are signed; the signer issues a one-hour lifetime.
- `CartService.computeQuote` allows an explicitly marked base-fee estimate before exact quoting. Exact checkout always requires a verified route quote. `CheckoutService.placeOrder` verifies before opening a new checkout transaction; it never takes a client-submitted delivery fee as authority. Location flat-rate settings do not replace the verified route fee.
- Threshold waivers use raw item subtotal consistently in cart, online checkout, and POS. Explicit FREE_DELIVERY promotions and first-order deal evaluation may waive delivery after eligibility checks. A normal monetary discount does not itself erase delivery. Promotion caps and eligibility are enforced server-side. Settings remain unchanged: removing the $40 waiver would be a business-policy change.
- Shared `computePricing` applies configured discount tax policy, adds delivery and optionally tip to the taxable base, rounds tax once, then computes discounted subtotal + delivery + tip + tax - wallet credit. Checkout uses the same resulting object for snapshot, order columns, and verified Stripe amount. Wallet spending is row-locked and transactional.
- Order creation writes delivery fee, tax, payable, and the pricing snapshot together. KDS and customer-order serializers return stored fields. Reports aggregate stored final totals; payment balance/collection uses stored final payable. Web/mobile checkout submit bound tokens and consume backend cart totals. POS computes its estimate from menu settings and the signed quote; the server still computes and persists the actual order.
- Existing idempotency replay returns a completed order before expired-quote validation, preventing a retry from repricing it. Fresh checkout requests require validation. Existing transaction uniqueness/fingerprint checks and Stripe amount/hash validation were left intact. Tests exercise changed requests and completed retries.
- Customer order details in web/mobile and POS selected-order details still omit zero delivery rows; their total values are persisted values. The requested always-visible delivery row is implemented in KDS. Full end-to-end payment collection and every customer screen were not exercised against production.

## Distance policy verification

The existing constants **and existing tests** implement the following, unchanged:

| Driving metres | Fee |
| --- | ---: |
| 0 through 4950 | $8 |
| greater than 4950, below 8000 | $10 |
| 8000 through below 10000 | $12 |
| 10000 through below 11000 | $13 |
| 11000 through below 12000 | $14 |
| subsequent 1000 m bands | +$1 per band |
| 19999 | $22 |
| exactly 20000 | $23 |
| greater than 20000 | unavailable |

Boundary tests include 4950, 4950.01, 4951, 7999, 8000, 9999, 10000, 10999, 11000, 19999, 20000, 20000.01, and 20001; invalid negative/NaN/infinite inputs are rejected.

**Policy discrepancy needing a business decision:** “exactly 10 km: $13; each additional started kilometre: +$1” can instead mean $14 at 10001 m and $23 at 20000 m, using a ceiling after 10 km. Existing intentional tests explicitly require $13 at 10999 m, $14 at 11000 m. Those prices were preserved rather than silently changing a tier. Below 10 km the requested tiers and constants agree. The public request alone cannot establish which interpretation the business intends above 10 km.

## Validation

- Final API targeted audit suite: 16 suites / 207 tests passed, covering every kilometre increment boundary, provider errors, cache behavior, token tampering/expiry/address/location binding, server enforcement, POS persistence arguments, checkout replay, KDS service, catalog, and six threshold/promotion/pickup cart cases.
- Web KDS/POS: 2 suites / 11 tests passed, including paid/free delivery, pickup, both POS discount-tax policies, address changes and quote expiry.
- Mobile pricing and checkout preparation: 2 suites / 44 tests passed.
- API build passed on retry. Initial concurrent build hit a native Node allocation assertion, not a TypeScript diagnostic.
- Web `tsc --noEmit` passed. Production web build compiled successfully and passed its lint/type phase, then failed prerendering `/` because the catalog API could not supply homepage sauces. No standalone lint script is configured. Production UI/browser and live payment tests were not run.
- No database schema change, production data mutation, historical repricing, payment rewrite, or deployment.

Reusable read-only SQL is in `packages/database/sql/audit-delivery-pricing.sql`.
