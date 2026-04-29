# Cart Quote Auth-Token Fix

Last updated: 2026-04-10

## Quick Summary

This fix changed the customer flow so cart quoting works for guests, but checkout still requires a valid customer session and a completed profile.

In plain English, the original problem was that the cart page was calling a protected quote route too early. That produced `Missing or invalid authentication token` even before the customer was actually trying to place an order.

The implemented fix did three things:

1. made `POST /api/v1/cart/quote` public so guest carts can receive a real server quote
2. added a proper customer session and profile-completion flow for OTP login and checkout
3. improved the frontend so checkout can pause for auth, resume after OTP/profile completion, and silently refresh expired customer sessions on protected calls

### Honest short status

The code changes are implemented and both app builds passed.

The API e2e suite was updated for the new routes and behaviors, but the full e2e run was blocked in this environment because the local test database configured in `apps/api/test/.env.test` was not available on `localhost:5432`.

---

## Purpose

This note records:

1. what the original cart auth-token issue was
2. what changed across the API and web app
3. what was verified directly
4. what caveats still remain

Related current issue note:

- [`cart-quote-auth-token_issue.md`](./cart-quote-auth-token_issue.md)

Related map file:

- [`map.md`](./map.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What Changed`
- `Verification Run`
- `Final Conclusion`

If you want the full technical path, read the note from `What the issue was` through `Remaining caveats`.

---

## What The Issue Was

The original problem was not cart math.

The real problem was that the cart page was trying to fetch a real server quote from a route that required a logged-in customer:

- `POST /api/v1/cart/quote`

That meant a guest or expired customer session could still see cart items and a fallback subtotal, but the quote request itself would fail auth and show:

- `Missing or invalid authentication token`

This created two user-facing problems at the same time:

- the cart looked broken because it showed a visible total and an auth error together
- the visible number could be only a local subtotal, not the authoritative quoted total with server-side tax and fee calculation

The deeper product problem was that the app needed a cleaner guest-to-customer flow:

- guests should be able to build a cart and see pricing
- checkout should require OTP auth only when the customer actually places the order
- customers with incomplete profiles should be forced to complete their name before order placement

---

## Why It Mattered

This mattered because the old flow mixed three different states together:

- guest browsing
- authenticated customer checkout
- expired customer session recovery

Without separating those states clearly, the cart was doing protected-customer work too early.

That caused:

- confusing cart errors
- unclear pricing trust
- no clean inline checkout auth flow
- no explicit profile-completion gate for phone-placeholder customer accounts

---

## What Changed

## Backend cart, auth, and checkout changes

The cart quote route is now public in:

- [`cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)

That means guest carts can now call `POST /api/v1/cart/quote` without a customer token, while still using the same quote logic and location validation.

The customer auth controller and service were extended in:

- [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- [`auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts)

The backend now includes:

- public `GET /api/v1/auth/session`
- authenticated `PUT /api/v1/auth/profile`
- OTP verify responses that include `profile_complete` and `needs_profile_completion`
- a reusable customer profile-completeness check for checkout gating
- per-phone OTP resend throttling
- OTP sender abstraction through console and Infobip sender classes

The checkout controller now blocks incomplete customer profiles with a structured `403 PROFILE_INCOMPLETE` response in:

- [`checkout.controller.ts`](../../../apps/api/src/modules/checkout/checkout.controller.ts)

One important follow-up fix was needed here: the exception filter was flattening custom error codes back to generic HTTP codes. That was corrected in:

- [`api-exception.filter.ts`](../../../apps/api/src/common/filters/api-exception.filter.ts)

After that change, the checkout gate can return the intended custom code instead of losing it during envelope formatting.

The OTP sender abstraction lives in:

- [`otp-sender.ts`](../../../apps/api/src/modules/auth/otp-sender.ts)

This provides:

- `ConsoleOtpSender` for dev and test
- `InfobipOtpSender` placeholder wiring for production-like SMS delivery

## Frontend customer session and checkout flow

The web app now has a real session layer in:

- [`session.tsx`](../../../apps/web/src/lib/session.tsx)

That provider now does three important jobs:

- fetches session state from `GET /api/v1/auth/session`
- exposes `authenticated`, `profileComplete`, and `needsProfileCompletion`
- supports one-time silent refresh for protected customer API calls

The customer OTP flow is implemented through a shared component in:

- [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx)

That shared component is used for:

- login
- signup
- checkout inline auth

The customer auth pages were replaced with real OTP-based flows in:

- [`/auth/login`](../../../apps/web/src/app/auth/login/page.tsx)
- [`/auth/signup`](../../../apps/web/src/app/auth/signup/page.tsx)

The legacy `/login` route now redirects to the real customer login page in:

- [`/login`](../../../apps/web/src/app/login/page.tsx)

The checkout flow now opens inline auth and resumes order placement after successful auth/profile completion in:

- [`checkout-client.tsx`](../../../apps/web/src/app/checkout/checkout-client.tsx)

Customer profile editing was added in:

- [`/account/profile`](../../../apps/web/src/app/account/profile/page.tsx)

The cart messaging was improved in:

- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

The cart now distinguishes between:

- real quoted totals
- fallback estimated subtotal

and shows that tax and fees are calculated later when a full quote is unavailable.

## Silent refresh follow-up hardening

During review of the implemented work, one real gap was still present:

- the silent refresh helper existed, but it had not actually been wired into the protected customer flows

That was corrected by wiring it into the protected frontend actions in:

- [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx)
- [`checkout-client.tsx`](../../../apps/web/src/app/checkout/checkout-client.tsx)
- [`page.tsx`](../../../apps/web/src/app/account/profile/page.tsx)
- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`order-chat.tsx`](../../../apps/web/src/components/order-chat.tsx)
- [`support-ticket-form.tsx`](../../../apps/web/src/components/support-ticket-form.tsx)

The helper itself was also tightened so it only treats refresh as successful when the API actually returns:

- `{ refreshed: true }`

and clears local session state if refresh fails.

## Test coverage updates

The API e2e suite was updated in:

- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

The new or updated coverage now includes:

- guest `POST /cart/quote`
- OTP request throttling
- OTP verify response flags
- public `GET /auth/session`
- authenticated `PUT /auth/profile`
- `403 PROFILE_INCOMPLETE` checkout behavior

---

## Files Reviewed / Files Changed

Primary API files reviewed or changed:

- [`cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)
- [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- [`auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts)
- [`checkout.controller.ts`](../../../apps/api/src/modules/checkout/checkout.controller.ts)
- [`otp-sender.ts`](../../../apps/api/src/modules/auth/otp-sender.ts)
- [`api-exception.filter.ts`](../../../apps/api/src/common/filters/api-exception.filter.ts)
- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

Primary web files reviewed or changed:

- [`session.tsx`](../../../apps/web/src/lib/session.tsx)
- [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx)
- [`checkout-client.tsx`](../../../apps/web/src/app/checkout/checkout-client.tsx)
- [`page.tsx`](../../../apps/web/src/app/account/profile/page.tsx)
- [`page.tsx`](../../../apps/web/src/app/auth/login/page.tsx)
- [`page.tsx`](../../../apps/web/src/app/auth/signup/page.tsx)
- [`page.tsx`](../../../apps/web/src/app/login/page.tsx)
- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`order-detail-client.tsx`](../../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`order-chat.tsx`](../../../apps/web/src/components/order-chat.tsx)
- [`support-ticket-form.tsx`](../../../apps/web/src/components/support-ticket-form.tsx)

---

## Verification Run

### Directly verified

- Code inspection of the full cart, auth, profile, checkout, and session flow
- Build verification of the API workspace
- Build verification of the web workspace
- Review of the updated API e2e suite

### Commands run

- `npm run build --workspace @wings4u/api`
- `npm run build --workspace @wings4u/web`
- `npm run test:e2e --workspace @wings4u/api`

### What passed

- API build passed
- Web build passed

### What did not fully run

The API e2e suite did not complete in this environment because Jest global setup depends on:

- [`apps/api/test/.env.test`](../../../apps/api/test/.env.test)

That file points at:

- `postgresql://postgres:postgres@localhost:5432/wings4u_test`

and there was no local PostgreSQL server listening on `localhost:5432` during this run.

### Honest verification summary

The implementation is build-verified and code-reviewed.

The updated e2e suite is written, but full runtime e2e proof is still blocked by the missing local test database.

---

## Remaining Caveats

There are still a few honest caveats to keep on record.

### 1. Infobip is still a placeholder integration

The sender abstraction exists, but the `InfobipOtpSender` implementation is still a placeholder/logging stub until real credentials and the actual HTTP send call are enabled.

### 2. Full e2e runtime proof is still pending

The e2e file was updated, but the suite could not be fully executed in this environment because the test database bootstrap could not connect to local PostgreSQL.

### 3. This fix intentionally keeps checkout protected

Guest quote is now allowed, but guest order placement is still not implemented. Checkout still requires:

- a valid customer session
- a completed customer profile

That is intentional and matches the agreed plan.

---

## Final Conclusion

The original cart auth-token failure was fixed by correcting the product boundary, not by hiding the error.

The important shift is:

- cart quote is now guest-safe
- checkout is still customer-auth-only
- OTP auth and profile completion now happen at the checkout boundary instead of breaking cart quote earlier

The implementation also now has the missing session pieces needed to support that flow properly:

- session discovery
- profile completion
- inline checkout auth
- silent refresh
- structured incomplete-profile errors

The remaining work is mostly operational verification:

- run the e2e suite against a working local or dedicated test database
- enable the real Infobip sender when production credentials are ready

---

## Plain-English Summary

The fix changed the app so anyone can build a cart and get a real quote, but only a verified customer with a completed profile can place the order.

That removes the old cart auth error from the guest cart path and moves login to the correct place: right before checkout.
