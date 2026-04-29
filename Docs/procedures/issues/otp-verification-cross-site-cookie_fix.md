# OTP Verification Cross-Site Cookie: Fix Note

Last updated: 2026-04-13

## Quick Summary

### What this note is about

This note records the fix applied for the issue where the profile save after OTP verification returned `Missing or invalid authentication token`.

### Short answer

The `sameSite` cookie attribute on all auth cookies was changed from `"lax"` to `"none"` for non-production environments, and the `secure` attribute was set to always be `true`. This allows auth cookies to be sent on cross-site fetch requests in dev, where the browser calls the API on `127.0.0.1:3001` from a page on `localhost:3000`.

### Plain-English takeaway

One setting in the cookie configuration was wrong for the dev setup. Changing it unblocks the profile save step after OTP verification.

---

## Purpose

This note records:

1. what the issue was
2. why it mattered
3. exactly what changed in which file
4. the old code and the new code
5. the verification done

Related issue file:

- [`otp-verification-cross-site-cookie_issue.md`](./otp-verification-cross-site-cookie_issue.md)

Related map file:

- [`map.md`](./map.md)

---

## How To Read This Note

If you want just the code change, read `What Changed`.

If you want the full explanation, read from `What The Issue Was` through `Verification`.

---

## What The Issue Was

A new customer on the login page would:

1. Enter their phone number
2. Click "Send verification code"
3. Type `000000` (the dev bypass OTP)
4. Get accepted and see "Complete your profile"
5. Enter their name
6. Click "Save and continue"
7. See: `Missing or invalid authentication token`

The OTP flow was correct. Tokens were being generated. But the auth cookie was never sent on the profile save request.

**Root cause:** `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001` is set in `apps/web/.env.local`. The page runs on `localhost:3000`. These are different origins. Browsers treat them as cross-site. Cookies with `sameSite: "lax"` are not sent on cross-site fetch requests, even with `credentials: "include"`. So the profile PUT arrived at the API with no `access_token` cookie, and the auth guard rejected it.

Full root cause analysis is in:

- [`otp-verification-cross-site-cookie_issue.md`](./otp-verification-cross-site-cookie_issue.md)

---

## Why It Mattered

The customer completed the OTP step correctly. The profile page appeared. But the save failed with an auth error that is normally reserved for sessions that were never created. That is misleading and makes the auth flow appear broken when the actual problem was entirely in the cookie transport layer.

---

## What Changed

### File changed

[`apps/api/src/modules/auth/auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)

### What was changed

Two constants were introduced to replace the inline `secure` and `sameSite` values in all cookie-setting calls.

- `COOKIE_SAMESITE` — `"lax"` in production, `"none"` in development
- `COOKIE_SECURE` — always `true`

All three places in the file that set auth cookies were updated to use these constants instead of hardcoded values.

---

## Old Code Removed

### Constants section (before line 73)

```ts
const IS_PROD = process.env.NODE_ENV === "production";
```

### setAuthCookies function — access_token cookie

```ts
res.cookie("access_token", accessToken, {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
  path: "/api",
  maxAge: 15 * 60 * 1000,
});
```

### setAuthCookies function — refresh_token cookie

```ts
res.cookie("refresh_token", refreshToken, {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
  path: "/api/v1/auth/refresh",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

### setAuthCookies function — csrf_token cookie

```ts
res.cookie("csrf_token", csrfToken, {
  httpOnly: false,
  secure: IS_PROD,
  sameSite: "lax",
  path: "/api",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

### refresh endpoint — access_token cookie (inline, not using setAuthCookies)

```ts
res.cookie("access_token", result.accessToken, {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
  path: "/api",
  maxAge: 15 * 60 * 1000,
});
```

### refresh endpoint — refresh_token cookie (inline)

```ts
res.cookie("refresh_token", result.refreshToken, {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
  path: "/api/v1/auth/refresh",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

---

## New Code Added

### Constants section (replacing the single IS_PROD line)

```ts
const IS_PROD = process.env.NODE_ENV === "production";
// Dev: web runs on localhost:3000, API may run on 127.0.0.1:3001 (cross-site).
// SameSite=Lax would block cookies on cross-site fetch; use None+Secure instead.
// Browsers treat localhost/127.0.0.1 as secure contexts, so Secure works over HTTP there.
const COOKIE_SAMESITE: "lax" | "none" = IS_PROD ? "lax" : "none";
const COOKIE_SECURE = true;
```

### setAuthCookies function — access_token cookie

```ts
res.cookie("access_token", accessToken, {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api",
  maxAge: 15 * 60 * 1000,
});
```

### setAuthCookies function — refresh_token cookie

```ts
res.cookie("refresh_token", refreshToken, {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api/v1/auth/refresh",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

### setAuthCookies function — csrf_token cookie

```ts
res.cookie("csrf_token", csrfToken, {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

### refresh endpoint — access_token cookie (inline)

```ts
res.cookie("access_token", result.accessToken, {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api",
  maxAge: 15 * 60 * 1000,
});
```

### refresh endpoint — refresh_token cookie (inline)

```ts
res.cookie("refresh_token", result.refreshToken, {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api/v1/auth/refresh",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

---

## Why These Specific Values

### sameSite: "none" in dev

`SameSite=None` tells the browser to send the cookie on all requests regardless of whether the initiating page and the target are the same site.

This is the correct setting when the frontend and API run on different origins in dev.

In production, `sameSite: "lax"` is kept because the frontend and API will be on the same domain, so cross-site is not a concern there.

### secure: true always

`SameSite=None` requires the `Secure` attribute. Without it, modern browsers reject the cookie entirely.

`Secure` on HTTP is normally only allowed over HTTPS. However, both `localhost` and `127.0.0.1` are treated as secure contexts by Chrome, Firefox, and Safari. So `Secure` cookies over HTTP on those hosts work correctly.

Setting `COOKIE_SECURE = true` unconditionally is safe because:

- in dev: `localhost`/`127.0.0.1` accept Secure cookies over HTTP
- in production: the app will be on HTTPS anyway

Previously `secure: IS_PROD` meant `secure: false` in dev, which would allow `SameSite=None` to be overridden or rejected depending on the browser. Setting it to `true` is the correct companion to `SameSite=None`.

---

## Bonus Fix In The Same Session

A second unrelated bug was also fixed during this session.

### File

[`apps/web/src/app/order/page.tsx`](../../../apps/web/src/app/order/page.tsx)

### Problem

The order page used `React.use(searchParams)` inside an `async` server component. `React.use()` is for client or synchronous components. In an async server component, the correct pattern is `await`.

That mismatch caused:

```
Error: Expected a suspended thenable. This is a bug in React.
GET /order?fulfillment_type=PICKUP 500
```

### Old code removed

```ts
import React from "react";

export default async function OrderPage({ searchParams }) {
  const params = searchParams ? React.use(searchParams) : {};
```

### New code added

```ts
export default async function OrderPage({ searchParams }) {
  const params = searchParams ? await searchParams : {};
```

The `React` import was also removed as it was no longer needed.

---

## Files Reviewed

- [`apps/api/src/modules/auth/auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts) — changed
- [`apps/api/src/modules/auth/auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts) — reviewed, no change needed
- [`apps/api/src/common/guards/auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts) — reviewed, no change needed
- [`apps/web/src/components/customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx) — reviewed, no change needed
- [`apps/web/src/lib/api.ts`](../../../apps/web/src/lib/api.ts) — reviewed, no change needed
- [`apps/web/src/lib/env.ts`](../../../apps/web/src/lib/env.ts) — reviewed, no change needed
- [`apps/web/.env.local`](../../../apps/web/.env.local) — reviewed, confirmed cross-site origin present
- [`apps/web/src/app/order/page.tsx`](../../../apps/web/src/app/order/page.tsx) — changed (bonus fix)

---

## Verification Run

### What was verified

- Code inspection of all auth cookie-setting paths in `auth.controller.ts`
- Confirmed `setAuthCookies()` and the inline refresh endpoint cookies both updated
- Confirmed `COOKIE_SAMESITE` and `COOKIE_SECURE` constants are consistent
- Confirmed `env.ts` reads `NEXT_PUBLIC_API_ORIGIN` which causes the cross-site request
- Confirmed `.env.local` has `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001` proving the cross-site setup is active
- Code inspection confirmed `auth.guard.ts` reads only `req.cookies?.access_token` — no fallback

### What was not verified in this pass

- Full runtime browser flow: restart API, clear cookies for `127.0.0.1`, re-run phone → OTP → profile save
- Cross-browser check for `SameSite=None; Secure` over HTTP on `127.0.0.1` in Firefox and Safari

### Honest verification summary

The fix is implemented in code and is correct based on the browser cookie specification and the confirmed cross-site origin setup.

Runtime browser verification still needs to be done after the API is restarted.

---

## Remaining Caveats

1. **API restart required.** The old cookies (set with `SameSite=Lax`) must be cleared from the browser before retesting. DevTools → Application → Cookies → clear `127.0.0.1` cookies.

2. **Safari on iOS may handle `SameSite=None` differently.** This has not been tested on Safari/iOS. If issues appear there, check browser-specific restrictions on `SameSite=None` without a proper HTTPS context.

3. **This setting is dev-only.** In production, `sameSite: "lax"` is preserved. If the production setup ever moves the API to a separate subdomain than the web app, this same cross-site issue would appear in production and would require `sameSite: "none"` there too, with proper HTTPS.

---

## Final Conclusion

The OTP verification auth cookie issue was caused by the `sameSite: "lax"` setting being incompatible with the dev cross-site origin setup. The fix is minimal: two constants replace the inline values and correctly set `SameSite=None; Secure` in dev. The auth logic, token generation, and guard are all correct and did not need to change.

---

## Plain-English Summary

One cookie attribute was wrong for how dev is set up. The browser was storing the login cookie but refusing to send it back because the page and the API were on different addresses. Changing the cookie to allow cross-site transmission lets the profile save request carry the auth token, and the guard accepts it.
