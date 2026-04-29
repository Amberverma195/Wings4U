# OTP Verification: Cross-Site Cookie Blocks Profile Save

Last updated: 2026-04-13

## Quick Summary

### What this note is about

This note explains why a user who successfully enters the OTP verification code (`000000` in dev) and reaches the "Complete your profile" screen is blocked from saving their name.

The button says "Save and continue" and the API returns:

- `Missing or invalid authentication token`

### Short answer

The OTP verify step sets auth cookies, but those cookies are never sent on the follow-up profile save request because the browser treats the web page and the API as cross-site.

The auth guard on the profile route sees no valid cookie and throws the 401 error.

### Important honesty note

The root cause was confirmed by code inspection of all files in the auth flow and by tracing the exact cookie behaviour expected under `sameSite: "lax"` between cross-site origins.

The cross-site cookie problem was additionally confirmed by reading the `.env.local` file which proved the direct-API-origin setup was active.

The fix was implemented and the code change is detailed in the paired fix note.

### Plain-English takeaway

The API and web front end are running on two different origins in this dev setup. When the API sets auth cookies on the verify response, those cookies are stored, but the browser will not send them back on the next fetch request to the same different-origin API. So the profile save arrives at the server with no auth cookie, and the guard rejects it.

---

## Purpose

This note records:

1. the plain-English problem
2. the technical path that produces it
3. what was directly verified in code
4. what the fix was
5. the verification status

Related fix file:

- [`otp-verification-cross-site-cookie_fix.md`](./otp-verification-cross-site-cookie_fix.md)

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

When running the app locally with a direct API origin, a new customer trying to create their profile hits a wall.

The flow looks like this from the customer side:

1. Enter phone number
2. Click "Send verification code"
3. Type `000000` (dev bypass code)
4. The code is accepted and the screen advances to "Complete your profile"
5. Type in a name
6. Click "Save and continue"
7. Error appears: `Missing or invalid authentication token`

The customer has already been verified. The app even knows it, because it advanced past the OTP step. But the profile save fails with an auth error.

That is confusing because it looks like the session was lost between steps even though the user did nothing wrong.

---

## Technical Path / Files Involved

The main files involved are:

- [`apps/web/.env.local`](../../../apps/web/.env.local)
- [`apps/web/src/components/customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx)
- [`apps/web/src/lib/api.ts`](../../../apps/web/src/lib/api.ts)
- [`apps/web/src/lib/env.ts`](../../../apps/web/src/lib/env.ts)
- [`apps/api/src/modules/auth/auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- [`apps/api/src/modules/auth/auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts)
- [`apps/api/src/common/guards/auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts)

### Step 1: OTP verify request

In [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx) at `handleOtpSubmit`:

The browser sends:

```
POST /api/v1/auth/otp/verify
```

via [`api.ts`](../../../apps/web/src/lib/api.ts) with `credentials: "include"`.

The API in [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts) processes this through `verifyOtp()` in [`auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts).

The `000000` bypass passes on line 270 of `auth.service.ts`.

The service calls `createSessionTokens()` on line 291 and returns a real `accessToken`, `refreshToken`, and `csrfToken`.

The controller calls `setAuthCookies()` on line 137 of `auth.controller.ts`, which sets three cookies:

- `access_token` — HttpOnly, `path: "/api"`, `sameSite: "lax"`, 15-minute TTL
- `refresh_token` — HttpOnly, `path: "/api/v1/auth/refresh"`, `sameSite: "lax"`, 30-day TTL
- `csrf_token` — readable, `path: "/api"`, `sameSite: "lax"`, 30-day TTL

The response body also returns `needs_profile_completion: true`.

### Step 2: Profile step advances

Back in [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx) at line 207, the component reads `body.data?.needs_profile_completion` from the OTP verify response body — not from any session call.

Because `needs_profile_completion` is `true`, the component advances the UI to the profile completion step.

This step happens without needing any cookie, because it is reading the response body.

This is why the UI correctly advances: the OTP body arrived fine even though the cookies were not stored correctly for cross-site use.

### Step 3: Profile save request fails

In [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx) at `handleProfileSubmit`, the browser sends:

```
PUT /api/v1/auth/profile
```

with `credentials: "include"`.

The global auth guard in [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts) runs for this route.

At line 50, the guard reads:

```ts
const cookieToken: string | undefined = req.cookies?.access_token;
```

No cookie is present. The guard returns null from `extractUser()`.

At line 41, the guard throws:

```ts
throw new UnauthorizedException("Missing or invalid authentication token");
```

That is the exact error the user sees.

### Why the cookie is missing: cross-site SameSite

The web front end runs on `localhost:3000`.

In [`apps/web/.env.local`](../../../apps/web/.env.local), the following is set:

```
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001
```

In [`env.ts`](../../../apps/web/src/lib/env.ts) at line 10, `getPublicApiBase()` reads this variable and returns it.

So the browser calls:

- OTP verify: `POST http://127.0.0.1:3001/api/v1/auth/otp/verify`
- Profile save: `PUT http://127.0.0.1:3001/api/v1/auth/profile`

The page origin is `localhost:3000`.
The API origin is `127.0.0.1:3001`.

Browsers treat `localhost` and `127.0.0.1` as different sites. They are not same-site.

Under `sameSite: "lax"`, cookies set by a cross-site response:

- **are stored** by the browser
- **are not sent** on subsequent cross-site fetch/XHR requests with `credentials: "include"`
- **are only sent** on same-site requests or top-level GET navigations

So the `access_token` cookie was stored after the OTP verify response, but it was never sent on the PUT profile request because the fetch is cross-site and `sameSite: "lax"` blocks it.

---

## Why This Mattered

### Customer impact

The customer successfully verified their phone number, saw the profile step, entered their name, and then hit a hard auth failure.

From their side, the session looked fine: the app showed the next step. But the profile save produced an error that usually means they are not logged in.

### Technical confusion

The OTP verify step succeeded. The tokens were generated correctly. The service code is correct.

The problem was entirely at the cookie transmission layer, not in the auth logic itself.

Without understanding the cross-site cookie behaviour, this error could be mistaken for:

- a broken OTP flow
- a session not being created
- a JWT signing failure

None of those were true.

---

## What Was Found

### 1. The OTP verify sets real tokens

Confirmed in [`auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts) lines 291–295:

```ts
const bundle = await this.createSessionTokens(identity.user, phoneE164);
const complete = isProfileComplete(identity.user);
bundle.profileComplete = complete;
bundle.needsProfileCompletion = !complete;
return bundle;
```

The tokens are real signed JWTs using the shared `JWT_SECRET`.

### 2. The cookies were set with sameSite: "lax" globally

Confirmed in [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts) `setAuthCookies()`:

All three cookies were set with:

```ts
sameSite: "lax",
```

That is correct for same-origin setups. It is a problem for cross-origin setups.

### 3. The env confirms the direct-API-origin setup

Confirmed in [`apps/web/.env.local`](../../../apps/web/.env.local):

```
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001
```

This was added as a Windows dev workaround to avoid the Next proxy returning plain-text 500 errors. It bypasses the same-origin proxy but creates the cross-site cookie problem.

### 4. The auth guard only reads the cookie

Confirmed in [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts) lines 50–54:

```ts
const cookieToken: string | undefined = req.cookies?.access_token;
if (cookieToken) {
  return this.decodeJwt(cookieToken);
}
return null;
```

There is no fallback. If the cookie is missing, the user is unauthenticated.

### 5. The UI advanced because the OTP body was read, not the cookie

The profile completion step is triggered by `body.data?.needs_profile_completion` in [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx) at line 207.

This reads the response body. The response body is available regardless of cookie behaviour.

That is why the UI appeared to work correctly through the OTP step.

---

## What Needed To Be Fixed

The cookie `sameSite` setting needed to be adjusted for dev environments where the browser calls the API on a different origin.

The options were:

1. Change `sameSite` to `"none"` in dev, paired with `secure: true`. Modern browsers treat `localhost` and `127.0.0.1` as secure contexts, so `Secure` cookies work over HTTP on those hosts.
2. Remove `NEXT_PUBLIC_API_ORIGIN` from `.env.local` so all calls go through the Next proxy. That restores same-origin behaviour but reintroduces the Windows proxy 500 issue.

Option 1 was chosen because it fixes the cookie problem without removing the workaround that was already needed on Windows.

---

## Files Changed

- [`apps/api/src/modules/auth/auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
  - replaced hardcoded `sameSite: "lax"` and `secure: IS_PROD` with constants
  - `COOKIE_SAMESITE` is `"lax"` in production and `"none"` in dev
  - `COOKIE_SECURE` is always `true`

---

## Verification

### What was directly verified

- Code inspection of [`auth.controller.ts`](../../../apps/api/src/modules/auth/auth.controller.ts)
- Code inspection of [`auth.service.ts`](../../../apps/api/src/modules/auth/auth.service.ts)
- Code inspection of [`auth.guard.ts`](../../../apps/api/src/common/guards/auth.guard.ts)
- Code inspection of [`customer-auth.tsx`](../../../apps/web/src/components/customer-auth.tsx)
- Code inspection of [`api.ts`](../../../apps/web/src/lib/api.ts)
- Code inspection of [`env.ts`](../../../apps/web/src/lib/env.ts)
- Direct read of [`apps/web/.env.local`](../../../apps/web/.env.local) confirming `NEXT_PUBLIC_API_ORIGIN` is set

### What was not verified in this pass

- Full browser runtime test of the fixed flow (API restart + cookie clear + retry was not captured)
- Cross-browser confirmation that `SameSite=None; Secure` works over HTTP on 127.0.0.1 in Firefox and Safari specifically

### Honest verification summary

The root cause was confirmed by code inspection and by confirmed presence of the cross-site env variable.

The fix is implemented in code.

Full browser runtime proof was not captured in this pass.

---

## Status

**Issue status:** fixed  
**Root cause identified:** yes  
**Code fix implemented:** yes  
**Verified by code inspection:** yes  
**Verified by runtime browser capture:** no  
**Best current description:** OTP verify cookies set with `sameSite: "lax"` were not sent on the subsequent cross-site profile PUT request because `NEXT_PUBLIC_API_ORIGIN` causes the browser to call a different origin than the page

---

## Plain-English Takeaway

The OTP worked fine. The session tokens were created correctly. The problem was that the cookies carrying those tokens were blocked by the browser's same-site cookie rules before they could reach the second request. The profile save arrived at the server with no auth, and the guard rejected it.

---

## Final Plain-English Summary

When the dev environment has `NEXT_PUBLIC_API_ORIGIN` set to a different host than the page, cookies set with `sameSite: "lax"` will not be sent on fetch requests, even with `credentials: "include"`. The OTP verify body arrives correctly because response bodies do not need cookies. But the next PUT request has no cookie to show the server, so the auth guard throws.

The fix changes the cookie `sameSite` to `"none"` in non-production environments, paired with `secure: true`, which modern browsers accept over HTTP on localhost and 127.0.0.1.
