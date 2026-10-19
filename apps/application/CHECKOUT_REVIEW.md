# Mobile checkout redesign review

Implemented on `feat/mobile-checkout-redesign`. Website behavior was compared with the mobile checkout before making changes; the existing ordering and payment pipeline remains in place.

## Changes and parity

| Area | Result |
| --- | --- |
| Design | Cream background, rounded white cards, serif headings, warm borders, red selection states, accessible controls and a fixed bottom action within keyboard avoidance and safe areas. Content is width-constrained on tablets and prices can wrap on small screens. |
| Header | Back to Cart, fulfillment/timing summary, and Change Order Details using existing order setup. The checkout supplies its own header. |
| Order details | Expandable details replace the three-line truncation. Includes flavours and placement, preparation/size, combo modifiers, salad choices, lunch add-ons, removals, and full instructions. All displayed line prices come from the current server quote. |
| Address | Shared order-setup state remains the source of truth; Change Address opens its existing picker. Delivery quote status, attribution, expiry refresh, retry and pickup recovery remain available. |
| Handoff | None, Hand to me, Leave at door, Call on arrival, Text on arrival. Optional, matching the website and the backend's optional DTO field. None omits the request field. Pickup omits delivery handoff. |
| Promotions | Shared cart/promo contexts and existing coupon/reward validation remain intact. Original delivery fees are crossed out when the backend waives them. |
| Pricing | Server-confirmed subtotal, discounts, tax, delivery, tip and final total. Stale, estimated, incomplete or malformed quotes cannot authorize checkout. Tip selection and fresh pre-submit validation are preserved. |
| Recovery | Retains HTTP status/code classification: authentication opens the auth sheet, delivery minimum directs to the menu, order setup handles time/address errors, and pricing can be retried. |
| Login | Waits for authentication/profile completion, cart hydration, valid setup and a new quote. Changed order details or payable totals require review. Dismissing login cancels pending submission. |
| Payment | Pay at Store for pickup; Cash on Delivery or Card on Delivery for delivery. Existing Stripe configuration, PaymentSheet, paid-intent reuse and pricing validation code remains. Online payment is not exposed. |
| Submission | Existing ref lock, immediate server revalidation and idempotency keys remain. No request format or backend price calculation changes. |
| Confirmation | A themed confirmation shows order number, status, estimated time and total; Track Order navigates to `/orders/[id]`. Confirmation sits outside the setup guard so successful cart cleanup cannot hide it. |
| Cleanup | Cart/promo state clears only after a successful response containing an order ID. Existing cart clear performs local draft removal and saved-cart deletion. Failed or malformed responses retain the cart. |

## Intentional differences from the website

- Mobile retains order notes, native authentication/profile sheets and percentage tip selections through the existing shared cart context.
- Mobile uses its existing order-setup picker rather than the website's address provider and desktop controls.
- Mobile keeps Stripe support in the code but offers only the website-equivalent offline collection methods. Backend source inspection confirms online payments default off unless `ONLINE_PAYMENTS_ENABLED=true`, and public configuration also requires Stripe readiness. Production flag values were not inspected or altered; no online option was enabled.
- Lunch hours, restaurant schedules, eligibility and minimums continue to be enforced by the existing preflight and server quote/checkout validation. The mobile checkout does not duplicate backend pricing or lunch-window rules.
- Confirmation now pauses for Track Order instead of immediately redirecting to tracking, matching the requested confirmation experience.
- The previously requested Cart pricing-refresh notice removal is included in a separate commit.

## Files changed

- `apps/application/app/checkout.tsx`: checkout presentation, optional handoff, pricing recovery, safe auth resume, quote completeness checks and sticky action.
- `apps/application/app/_layout.tsx`: hide the default checkout header in favor of its own safe-area header.
- `apps/application/src/components/checkout-confirmation.tsx`: confirmation and tracking actions.
- `apps/application/src/components/checkout-entry-guard.tsx`: match checkout background and accent colors.
- `apps/application/src/lib/checkout-item-details.ts`: complete customer-facing customization descriptions.
- `apps/application/tests/mobile-checkout-quote-identity.test.cjs`: checkout regression coverage for details, handoff, collection methods, authentication resume/cancel, confirmation, failed requests, duplicate submission, retries, invalid quotes, attribution and Stripe gating; retains address/expiry/stale-pricing/free-delivery tests.
- `apps/application/tests/checkout-item-details.test.cjs`: lunch, combo and older saved-wing detail coverage.
- `apps/application/tests/cart.test.cjs`: saved-cart deletion/local-draft cleanup regression.
- `apps/application/app/(tabs)/cart.tsx`: remove the requested pricing refresh notice.
- `apps/application/tests/cart-tab.test.cjs`: expect that notice to remain hidden.
- `apps/application/CHECKOUT_REVIEW.md`: parity, validation and remaining verification notes.

No website, backend, production environment or deployment files were changed.

## Automated verification

- `npm test --workspace @wings4u/application -- --silent`: **49 suites passed, 726 tests passed**. Includes existing scheduling/preflight, coupon/reward, cart, session, navigation and Stripe quote-validation tests. APIs, storage and Stripe calls are mocked in the regression tests.
- `npx tsc --noEmit -p apps/application/tsconfig.json`: **passed**, no TypeScript errors.
- `git diff --check`: **passed**.
- A temporary React Native Web preview built successfully using mocked context/API/Stripe modules. Browser inspection could not execute: the browser tool returned `codex/sandbox-state-meta: missing field sandboxPolicy`. No screenshot or browser visual verification is claimed. Temporary preview code is outside the repository and is not part of the PR.

## Manual verification still required before release

Use an isolated environment with mocked or explicitly non-production services:

- Android and iOS: narrow phones, tablets, large text, notch/home-indicator safe areas, scrolling and long customization text; confirm no horizontal overflow.
- Keyboard open/close while entering multiline notes: bottom action remains reachable without covering content; check back navigation and screen-reader selection announcements.
- Address picker, scheduling changes, lunch restrictions, pickup/delivery transitions, expired delivery tokens and offline recovery with the real native UI.
- Full login/profile completion and cancellation, followed by totals changing during sign-in and safe review.
- Confirmation and Track Order navigation with a mocked successful order and a scheduled cart.
- Native Stripe PaymentSheet/cancel/intent retry requires a dedicated test configuration if online payment is ever exposed. This PR does not expose it or run a real charge.

No database commands, migrations, seeds, production order tests, reward redemptions, Stripe charges, deployments or merges were executed. Only the feature branch is intended to be pushed.
