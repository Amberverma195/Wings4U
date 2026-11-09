# Scheduled delivery review — November 9, 2026

The website used `getDeliveryUnavailableMessage(menu)` to disable Delivery in both order-settings panels and the initial order-method dialog. That catalog flag describes the committed schedule, not the panel's draft schedule. Consequently, closure at the currently committed time prevented customers from selecting Delivery to discover valid future slots. Delivery date keys and UTC timestamp construction also used the browser's local clock, unlike the existing restaurant-aware pickup calculation.

The reproduction is covered by rendered menu/cart/modal tests using a closed current catalog response and a valid November 9, 12:45 PM Toronto draft. Production configuration, customer addresses, orders, and database contents were not accessed.

The fix separates permanent method restrictions (management's `delivery_disabled` and the customer's no-show restriction) from time-dependent availability. Closure allows customers to select Delivery. Slot generation and final draft validation use the selected date/time, configured daily delivery window, weekly delivery service hours, effective kitchen preparation time, and configured minimum delivery lead. The panels validate again before committing, including when a previously valid slot becomes too soon.

Delivery service hours take precedence over store hours, with store hours used when no delivery rows exist, matching the backend. The existing 11:00–23:00 fallback remains only when neither source supplies hours, matching existing backend behavior; the reported 10:00 PM cutoff is not hardcoded. Configured opening times are inclusive and closing times exclusive. Explicit closed days, overnight windows, and 24-hour weekly windows are respected.

Date keys, date labels, and UTC timestamps now use the restaurant timezone (default `America/Toronto`). Delivery slots iterate actual instants, omit nonexistent spring-forward times, and preserve both fall-back occurrences with EDT/EST labels. Existing seven-day scheduling and 15-minute slot intervals remain. Pickup retains its advertised estimate and effective preparation-time validation.

Current closure copy says “Delivery is closed right now” and offers scheduling. Management disable says “Delivery has been disabled by the restaurant” in the website and API. The order-method dialog's existing stale “FROM $5” label was corrected to “FROM $8”; fee calculation was not changed.

Checkout continues to use the committed saved schedule in quote and order requests. Its existing backend preparation-time, service-hours, delivery-window, customer-eligibility, and delivery-quote checks remain authoritative. New tests confirm that cart and checkout restore a newly chosen delivery timestamp after refresh before autosave. The strict 20,000-metre driving limit, approved $8/$10/$12+ pricing, taxes, discounts, and order storage are unchanged.

Changed files:

| File | Change |
| --- | --- |
| `apps/web/src/lib/order-scheduling.ts` | Restaurant-clock delivery slots, management window, preparation/lead checks, midnight/DST handling, shared date keys |
| `apps/web/src/lib/delivery-restrictions.ts` | Separate permanent method restrictions from draft-time validation and closure copy |
| `apps/web/src/Wings4u/components/menu-page.tsx` | Select Delivery while closed, validate draft settings, refresh notices/options |
| `apps/web/src/Wings4u/components/cart-order-settings.tsx` | Same draft behavior for cart; explicit select labels |
| `apps/web/src/Wings4u/components/order-method-modal.tsx` | Discover future delivery slots, validate schedule/address steps, distinguish closure/disable, correct price label |
| `apps/api/src/common/utils/delivery-availability.ts` | Distinct manual-disable message; availability rules unchanged |
| `apps/web/tests/delivery-scheduling.test.cjs` | New scheduling/helper/rendered menu/cart/modal regressions |
| `apps/web/tests/cart-refresh-pages.test.cjs` | Cart/checkout future delivery schedule restoration |
| `apps/web/tests/pickup-eta.test.cjs` | Retain pickup checks; delivery slots also respect busy kitchen preparation |
| `apps/api/src/modules/shared/delivery-scheduling.spec.ts` | Real catalog, quote service, and shared cart/checkout validator regressions |
| `apps/api/src/modules/delivery-pricing/delivery-pricing.service.spec.ts` | Assert distinct management-disable message |
| `SCHEDULED_DELIVERY_REVIEW.md` | Findings and verification report |

Verification:

- Website: 46 suites / 378 tests passed.
- API: 80 suites / 1,787 tests and one snapshot passed.
- Website scheduling, pickup, and refresh regressions also passed with `TZ=Pacific/Auckland` to check browser-timezone independence.
- Website and API TypeScript checks passed; website production build and API Nest build passed.
- `git diff --check` passed. Pricing constants, shared financial calculations, checkout implementation, database schema, migrations, and seeds have no changes.
- One initial API suite failed to load the generated Prisma client while tests overlapped local client generation. It passed without the transform cache; the full suite passed after clearing Jest's cache. No application workaround was added.

Validation limits: API tests use mocked infrastructure and rendered website component tests run in Node. A real-browser/database end-to-end order and live production configuration verification were not performed. Management or customer eligibility changes after the catalog was loaded are still enforced by authoritative quote/cart/checkout requests.

Verification was completed locally before publication. The user subsequently authorized committing and pushing these changes to main; that push may trigger production auto-deployment. No manual deployment, migration, seed, or production-data modification was performed. Prisma client generation was local build preparation only.
