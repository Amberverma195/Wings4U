Wings4U local delivery review — November 8, 2026

The earlier implementation report was incorrect about the approved pricing schedule. It described the stale local checkout, not the approved remote source. That report is superseded by this review.

`git fetch origin main` succeeded. At the start of the review, local `main` was at `e871337` and `origin/main` was at merge commit `7649275a386bc757970b6de4de852af0334358ff`. Local HEAD was two commits behind: the fee-tier implementation `bcbbb8f` and its merge `7649275`. The earlier work inspected local constants without fetching/comparing upstream. This was a review error, not an unresolved business-rule question.

The review retained the existing eligibility edits. A patch backup and copies of the new geographic files were saved under ignored `.local/delivery-review-backup` before applying upstream source changes. For the subsequent authorized commit/push, local `main` was advanced to the fetched upstream merge using an index-only reset, with all 39 changed/new working files verified byte-for-byte unchanged. A further backup was saved under ignored `.local/delivery-publish-backup`. The delivery commit is based on the approved upstream merge, so the already-upstream schema, seed, and migration files are not new changes in this commit. The authorized push may trigger production auto-deployment; no manual deployment, migration, seed, or direct production-data action is part of publication.

Approved pricing is preserved using the exact calculation from `origin/main`:

| Google driving distance | Delivery fee before any approved waiver |
| --- | --- |
| 0–4,950 m | $8 |
| 4,951–7,999 m | $10 |
| 8,000–9,999 m | $12 |
| 10,000–10,999 m | $13 |
| Each subsequent kilometre interval | Another $1 |
| 14,000 m | $17 |
| 19,999 m | $22 |
| Exactly 20,000 m | $23; eligible subject to London and other ordering rules |
| Above 20,000 m | Rejected; no usable quote |

`DELIVERY_MAXIMUM_DISTANCE_METRES` remains exactly `20_000`. The only difference between the pricing constants file and `origin/main` is the new quote-signing context, which invalidates quotes without the combined approved-price and municipal eligibility checks. The pricing rule version remains upstream version 2. The obsolete pricing rollout flag no longer selects a cheaper fee or skips routing: true, false, and unset all require the approved distance calculation. There is no $5 pricing fallback. Unquoted cart estimates start at $8. Catalog output uses the code-owned $8 base instead of a potentially stale database setting, and website/mobile cart copy now says “From $8”. The upstream checkout change that removes its hardcoded $5 display fallback was also incorporated.

The upstream Prisma schema default, seed source, and existing migration file were copied exactly into the working tree. The migration contains a location-settings UPDATE, but it was NOT executed. Neither migration nor seed commands were run. Local Prisma client generation was build preparation only. No database or production data was changed. Runtime quote pricing does not depend on executing that migration.

Postal and municipal eligibility:

- Delivery no longer gates quotes or checkout using the legacy `allowedPostalCodes` whitelist. Valid Canadian postal syntax remains required; N6K is evaluated even when legacy configuration contains only N5W. Existing settings data is preserved and its admin description identifies the postal list as legacy reference information.
- The backend asks Google Routes for `routes.distanceMeters` and `routes.legs.endLocation.latLng`. It does not accept client-supplied distance, radius eligibility, coordinates, or price as geographic evidence.
- The provider-returned destination endpoint is tested against the City of London, Ontario municipal polygon using an even/odd point-in-polygon algorithm. Polygon edges are included, holes are respected, and the source coordinates retain their precision. This is not a bounding-box or postal-prefix test.
- The polygon snapshot is sourced from [City of London StreetBase layer 6](https://maps.london.ca/server/rest/services/StreetBase/MapServer/6), requested in WGS84 using `where=1=1`, `outSR=4326`, `returnGeometry=true`, and `f=json`. Source and retrieval date are recorded in `london-boundary.ts`.
- The typed city remains an input-format restriction; typing “London” cannot authorize a Google destination outside the municipal polygon. Missing or invalid provider coordinates fail closed. Tests include Byron/N6K, other London points, adjacent municipalities, London UK, polygon edges, and an outside-city Google endpoint despite “London” in the submitted address.
- Google request failures remain separate from eligibility failures. Malformed requests return a safe provider-unavailable response; empty or omitted routes return an unroutable-address response. API keys, submitted addresses, and private provider error bodies are not copied into diagnostics or public errors.

Bypass review:

- Google distance above 20,000 metres prevents signing any eligible quote, regardless of order value, fee waivers, or pricing flag.
- Quote HMAC verification binds the approved fee, location, normalized-address fingerprint, eligibility, pricing version, and expiration. Changing a submitted price/address or forging the token fails verification.
- Legacy fixed-price quotes, upstream price-only quotes, and quotes from the first local boundary implementation are rejected by the new signing context. Old pricing-version payloads and expired tokens are also rejected. Browser quote storage is now version 4 and discards previous storage versions; backend route and catalog cache namespaces also changed.
- New customer orders always require a valid delivery quote before promotions, thresholds, discounts, or order creation can authorize anything. Cart previews without a quote are estimates; a supplied token must verify. Both website and mobile use the shared authoritative API.
- Regression tests run real cart/checkout verification against high-value carts, zero free-delivery thresholds, ordinary coupons, and first-order/free-delivery promotions. These fail before order writes when eligibility evidence is invalid. POS threshold waivers similarly require verification first.
- Idempotent replay of an already-created order remains a read of that existing order. It does not create a new order or change its historical address/pricing. Existing request ownership and fingerprint checks remain intact.

POS/phone operational review:

The previous local blanket rejection would have stopped every phone delivery, including legitimate addresses within 20 km. It has been replaced with a verified delivery workflow.

Phone staff can enter a street address and London postal code, check the address, review the quoted delivery fee, then collect payment. Payment buttons stay disabled until eligibility is confirmed. Changing the address or expiring its quote disables collection again. Rejected delivery routes show an error and staff can switch to pickup. POS/phone API requests now support `address_snapshot_json` and `delivery_quote_token`; the backend verifies both before starting the order transaction and stores the normalized address on the new order.

The server uses the verified fee, applies the existing configured free-delivery threshold only after eligibility, and applies the configured delivery-tax setting. The POS preview includes the delivery amount and delivery-tax policy; pickup and existing manual-discount handling are retained. Historical orders are not rewritten. Tests exercise valid $17/$23 phone deliveries, address/token tampering, fee waivers, and configured delivery taxation.

Operational impact: staff and any custom POS integrations must now supply and verify a delivery address before placing a delivery order. Addressless legacy delivery submissions are deliberately rejected. Staff quote requests use `/api/v1/pos/delivery/quote`, protected by the existing location, store-network, and POS-station guards. They call the same authoritative pricing service and retain its shared Google provider budgets and cache, without making the store share the public customer limit of 12 attempts per 15 minutes. Provider quotas were not increased. Pickup does not require a delivery quote.

Verification completed:

- API: 79 suites, 1,769 tests and one snapshot passed.
- Website: 42 suites, 330 tests passed, including rendered POS delivery interaction tests.
- Mobile: 70 suites, 1,092 tests passed.
- API, website, and mobile TypeScript checks passed.
- API Nest build and website production build passed.
- Android and iOS production JavaScript/Hermes exports passed, using the API origin already checked into `apps/application/eas.json`. These are local bundle exports, not signed APK/IPA builds or deployments. Output is under ignored `apps/application/dist/delivery-review`.
- React best-practices review covered hook ordering/dependencies, quote expiration, stale address responses, input labels, payment gating, and server authority. `git diff --check` passed.

Remaining validation limits and operational follow-up:

Live Google routing, production API credentials/billing/restrictions, and actual device/physical-terminal ordering were not exercised. Provider responses and database writes were mocked in the regression suites. Google's route endpoint can be snapped to a road rather than the exact property location: municipal boundary-road addresses need live acceptance checks, and this implementation does not independently validate cadastral/property coordinates. The municipal polygon is a dated snapshot and must be refreshed if the city boundary changes, together with the eligibility namespace. No production-affecting action was taken.
