# Cart Quote Auth-Token Failure on Cart Page

Last updated: 2026-04-10

## Quick Summary

### What this note is about

This note explains why the cart page can show:

- a visible total
- the message `Missing or invalid authentication token`

at the same time.

### Short answer

The cart page is trying to fetch a server-side quote from a protected API route, but that request is reaching the API without a valid customer `access_token` cookie.

So the cart math itself is not what is failing first.

The auth check is failing first.

### Important honesty note

The code-level cause is clear.

The exact browser-session trigger for the reported run was **not** fully runtime-proven in this pass.

That means the issue note can say with confidence that the request had no valid customer auth token, but it cannot yet prove whether that happened because:

- the customer was not logged in
- the 15-minute access token expired
- the browser switched between `localhost` and `127.0.0.1`
- or the auth cookie was otherwise missing/cleared

### Plain-English takeaway

The cart page is asking the API for a real quoted total, but the API treats that request like a protected customer action. If the customer auth cookie is missing or expired, the quote fails and the cart falls back to a local subtotal while showing the auth error.

---

## Purpose

This note records:

1. the plain-English problem
2. the technical path that produces it
3. what was directly verified in code
4. what was inferred but not fully runtime-proven
5. what still needs to be decided or fixed

Related tracker file:

- [`tasks.md`](../tasks.md)

Related map file:

- [`map.md`](./map.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `What was found`
- `Status`

If you want the detailed version, read the note from `Problem In Plain English` through `Verification`.

---

## Problem In Plain English

The customer can open the cart and still see a total on screen, but the page also shows:

- `Missing or invalid authentication token`

That is confusing because it makes the cart look half-working.

From the customer side, it looks like:

1. the cart knows the items and price
2. but the cart also says auth is broken

Those two things are both happening because the page has two different pricing paths:

- a local fallback subtotal calculated in the browser
- a real server quote fetched from the API

The fallback subtotal can still render even when the protected quote request fails.

---

## Technical Path / Files Involved

The main files involved are:

- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`api.ts`](../../../apps/web/src/lib/api.ts)
- [`cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)
- [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts)
- [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

### Frontend request path

In:

- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

the cart page calls:

- `POST /api/v1/cart/quote`

inside `fetchQuote()`.

That happens automatically when cart items exist.

### API protection path

In:

- [`cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)

the quote route is marked with:

- `@Roles("CUSTOMER")`

So this is not a public quote route.

### Auth extraction path

In:

- [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts)

the global auth guard only treats the request as authenticated if it can read and verify:

- `req.cookies?.access_token`

If no valid user is extracted, the guard throws:

- `Missing or invalid authentication token`

### Cookie issuance path

In:

- [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)

customer auth sets:

- `access_token`
- `refresh_token`
- `csrf_token`

The access token cookie is:

- HttpOnly
- scoped to `path: "/api"`
- short-lived (`15` minutes)

That means the cart quote request only succeeds when the browser still has a valid customer `access_token` cookie for the current web/API host.

---

## Why This Mattered

This mattered for both customer experience and technical correctness.

### Customer impact

The customer sees an auth failure in a place that feels like a basic cart screen.

That makes the app feel unstable, because the page shows a total and an error at the same time.

### Product impact

When the server quote fails, the cart falls back to local math.

That means the visible total may not include:

- tax
- delivery fee
- any other server-validated pricing rules

So even if the page still shows a number, it is not the authoritative checkout quote.

### Developer impact

The behavior is easy to misread as:

- a broken cart calculator
- a bad menu item payload
- or a pricing bug

But the real first failure is auth.

That distinction matters because the fix path is different.

---

## What Was Found

### 1. The cart page always tries to fetch a protected server quote

The cart page calls `POST /api/v1/cart/quote` as soon as it has cart items.

That call is made through the shared API helper.

### 2. The API helper does include cookies, but only whatever the browser already has

In:

- [`api.ts`](../../../apps/web/src/lib/api.ts)

the request uses:

- `credentials: "include"`

So the frontend is not dropping cookies on purpose.

It is asking the browser to send them.

### 3. The quote route is intentionally protected

This route is not public guest pricing.

It requires a valid authenticated `CUSTOMER` user.

### 4. The auth guard only trusts the `access_token` cookie

The guard does not read customer auth from:

- local storage
- query params
- custom frontend headers

It only reads `req.cookies?.access_token`.

### 5. The cart still renders a fallback total when the quote fails

In:

- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

the summary uses:

- `quote?.final_payable_cents ?? fallbackSubtotal`

So when the quote is missing, the UI still shows a locally calculated total.

That is why the cart can display `TOTAL $59.95` and the auth error together.

### 6. The current repo already expects unauthenticated cart quotes to fail

In:

- [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

there is already an explicit test that:

- `POST /cart/quote without auth returns 401`

So the current backend behavior matches the codebase's existing expectation.

### 7. The exact session-level trigger was not fully isolated

The root cause is:

- no valid auth cookie reached the protected quote route

The still-unproven session-specific trigger is which of these happened in the reported browser run:

- not logged in as a customer
- access token expired after `15` minutes
- browser host changed between `localhost` and `127.0.0.1`
- cookie was cleared or otherwise unavailable

This last part is an inference from the cookie model and the observed error, not a fully instrumented browser capture.

---

## What Still Needs To Be Fixed

The repo still needs a product decision and then an implementation decision.

### Decision 1: should cart quote require auth at all?

Right now, the backend says yes.

If guest carts are supposed to work fully before login, then the quote route design is too strict for the current UX.

### Decision 2: if auth is required, where should login enforcement happen?

Right now, the cart page allows the customer to reach the screen and only discovers the auth failure when the quote request runs.

That is late and confusing.

Possible fix directions include:

- force login before cart quote / checkout
- silently refresh expired auth before quoting
- or make guest quote public while keeping checkout protected

### Decision 3: improve cart fallback messaging

If the quote cannot be fetched, the UI should probably avoid presenting the fallback subtotal as if it were a final authoritative total.

---

## Files Changed

For the application behavior itself:

- no code fix was implemented in this pass

For documentation:

- this issue note was added

---

## Verification

### What was directly verified

- Code inspection of [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)
- Code inspection of [`api.ts`](../../../apps/web/src/lib/api.ts)
- Code inspection of [`cart.controller.ts`](../../../apps/api/src/modules/cart/cart.controller.ts)
- Code inspection of [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts)
- Code inspection of [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- Code inspection of [`app.e2e-spec.ts`](../../../apps/api/test/app.e2e-spec.ts)

### What was verified from existing test coverage

Verified in existing test expectations:

- unauthenticated `POST /cart/quote` returns `401`

### What was not verified in this pass

Not runtime-proven in-browser:

- the exact cookie state of the reporting session
- whether the specific trigger was expiry, missing login, or host mismatch

### Honest verification summary

The backend cause is verified.

The exact browser-session reason for the missing cookie is not fully verified yet.

---

## Status

**Issue status:** open  
**Root cause identified:** yes  
**Code fix implemented:** no  
**Verified by code inspection:** yes  
**Verified by runtime browser capture:** no  
**Best current description:** protected quote route is being called without a valid customer `access_token` cookie

---

## Plain-English Takeaway

This is happening because the cart is asking the server for a protected quote without a valid customer auth cookie. The page still shows a number because it falls back to local cart math, but that number is not the fully server-quoted total.

---

## Final Plain-English Summary

The cart auth error is real, and it is caused by the quote request failing auth before pricing is calculated server-side.

The most important distinction is:

- this is not primarily a cart math bug
- it is a customer-auth / session / cookie problem on a protected quote route

The exact reason the cookie was missing in the reported browser session still needs a small runtime check, but the code path causing the error is already clear.



Plan -


# Guest Cart + OTP Checkout + Customer Account Completion

## Summary

Implement a customer flow where cart and pricing work for guests, but order placement requires phone OTP authentication and a completed customer profile. Use the existing JWT + HttpOnly cookie model, keep staff/POS auth unchanged, make customer auth canonical under `/auth/*`, and use Infobip only in production-like environments with the current console OTP fallback in dev.

Chosen defaults:
- Guest cart quote is allowed before login.
- Checkout auth happens inline in a modal/drawer on the checkout page.
- Name is required only for new or incomplete customer profiles.
- Signup and login share the same phone-OTP backend.
- Optional email is stored unverified in v1.
- Existing phone-as-name customer accounts must complete name on next auth.
- Customer auth routes live under `/auth/*`; do not repurpose the existing ops `/register` route.

## Key Changes

### Backend auth and session flow

- Keep the current cookie model (`access_token`, `refresh_token`, `csrf_token`) and JWT session flow.
- Keep using the existing OTP primitives, but treat customer records created during OTP initiation as provisional/incomplete until profile completion is done.
- Extend customer OTP verify to return session state, not just `user`: include `profile_complete` and `needs_profile_completion`.
- Add a public `GET /api/v1/auth/session` route that always returns `{ authenticated, user?, profile_complete, needs_profile_completion }`. This becomes the frontend source of truth.
- Add an authenticated `PUT /api/v1/auth/profile` route for customer profile completion and later edits. Request shape: `{ full_name, email? }`.
- On profile save:
  - store the full string in `user.displayName`
  - best-effort split into `user.firstName` / `user.lastName`
  - upsert optional email into a `UserIdentity` row with provider `EMAIL`, unverified in v1
- Define profile completeness as: authenticated customer with a real name present, not just a phone-placeholder display name. Legacy phone-placeholder users therefore get forced through the name step once.
- Keep `POST /api/v1/auth/otp/request` phone-only. No profile data needs to be persisted before OTP.
- Keep `POST /api/v1/auth/refresh`; use it for silent refresh on expired access tokens.

### Cart and checkout policy

- Make `POST /api/v1/cart/quote` public so guests can get authoritative cart pricing before auth. Because the global guard already hydrates `req.user` on public routes when a valid cookie exists, this can remain one route, not a guest clone.
- Keep `POST /api/v1/checkout` authenticated and customer-only.
- Add backend enforcement that authenticated customers cannot place an order if their profile is incomplete; return a structured `403 PROFILE_INCOMPLETE` error.
- Do not implement guest order creation in this pass. Order creation continues to require a real customer user ID and completed profile.
- Treat guest quote as catalog/tax/delivery pricing only. User-specific features such as wallet or future personalized discounts remain checkout-only after auth.

### Web customer UX

- Add a small auth/session client layer in the web app:
  - app-level session fetch via `GET /api/v1/auth/session`
  - one-time silent refresh on `401` for protected customer requests
  - signed-out state if refresh fails
- Replace the placeholder customer login UI with real customer auth pages:
  - `/auth/login`: phone -> send OTP -> verify -> complete profile only if required
  - `/auth/signup`: full name + optional email + phone -> send OTP -> verify -> complete profile
- Keep `/login` as a redirect/alias to `/auth/login`.
- Leave the ops `/register` route unchanged.
- Implement a shared customer auth component usable in three modes:
  - login page
  - signup page
  - checkout inline modal
- Checkout behavior:
  - if session is authenticated and profile is complete, Place Order behaves as it does now
  - if unauthenticated, Place Order opens phone -> OTP -> profile completion (if needed) -> resumes checkout submit automatically
  - if authenticated but profile is incomplete, skip phone/OTP and open the name/email completion step directly
- Add an `/account/profile` surface for later edits to full name and optional email.
- Change cart/checkout messaging so guest fallback numbers are not presented as if they are the final signed-in order total when the authoritative quote is unavailable.

### SMS delivery

- Introduce an OTP sender abstraction with two implementations:
  - `InfobipOtpSender` for production-like environments
  - `ConsoleOtpSender` for local dev/test
- Add explicit provider config:
  - `SMS_PROVIDER`
  - `INFOBIP_BASE_URL`
  - `INFOBIP_API_KEY`

  - `INFOBIP_SENDER_ID`
- Keep the current dev console OTP logging behavior as the default outside production-like environments.
- Add request throttling / resend cooldown to protect SMS cost and abuse:
  - per-phone request cooldown
  - max active code window
  - existing max verify attempts remains enforced

## Public API / Interface Changes

- `POST /api/v1/cart/quote`
  - becomes public
  - request shape stays the same
- `GET /api/v1/auth/session`
  - new
  - returns current session and profile-completion state
- `POST /api/v1/auth/otp/verify`
  - response extended with `profile_complete` and `needs_profile_completion`
- `PUT /api/v1/auth/profile`
  - new
  - authenticated customer route for initial completion and later edits
  - request: `{ full_name: string, email?: string }`
- Web routes
  - canonical customer auth pages: `/auth/login`, `/auth/signup`
  - `/login` redirects to `/auth/login`
  - add `/account/profile`
  - keep ops `/register` untouched

## Test Plan

- Auth API
  - request OTP for new phone returns success and creates/updates challenge state
  - verify OTP for new phone sets cookies and returns `needs_profile_completion=true`
  - verify OTP for existing completed customer returns `needs_profile_completion=false`
  - invalid OTP, expired OTP, and max-attempt cases still behave correctly
  - refresh rotates tokens and preserves customer auth
- Profile completion
  - `PUT /auth/profile` completes a new customer profile and stores optional email unverified
  - legacy phone-placeholder users are flagged incomplete until name is saved
  - duplicate email is rejected cleanly
- Cart and checkout API
  - guest `POST /cart/quote` returns `200`
  - guest `POST /checkout` remains unauthorized
  - authenticated but incomplete customer `POST /checkout` returns `403 PROFILE_INCOMPLETE`
  - authenticated complete customer checkout succeeds unchanged
- Web flows
  - guest can add items, view cart, and see quote without login
  - guest checkout opens inline auth modal and resumes order submit after OTP + name
  - login page works with phone OTP only
  - signup page works with name/email/phone + OTP
  - existing user with complete profile logs in without a name prompt
  - existing placeholder-name user is forced through profile completion once
  - refresh-on-401 recovers expired access token without dumping the customer out of checkout
- SMS integration
  - console sender used in dev/test
  - Infobip sender used only when configured for production-like envs

## Assumptions and Defaults

- The existing OTP schema remains in use; provisional auth rows may still be created before profile completion, but a customer is not considered checkout-ready until the name step is done.
- Signup with a phone number that already exists does not create a duplicate account; it behaves as login. If that account is incomplete, the submitted signup fields complete it. If it is already complete, the flow signs the customer in and does not silently overwrite their existing profile.
- Email is optional and unverified in v1; phone OTP remains the only customer login factor.
- Staff/POS/admin auth flows and routes are out of scope and remain unchanged.
