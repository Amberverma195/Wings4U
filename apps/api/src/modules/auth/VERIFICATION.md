# Signup verification and resend

## Changed files

- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/otp-sender.ts`
- `apps/api/src/modules/auth/otp-sender.spec.ts`
- `apps/api/src/modules/auth/auth-otp.spec.ts`
- `apps/api/src/modules/auth/VERIFICATION.md`
- `apps/api/src/modules/notifications/email-brand-template.ts`
- `apps/web/src/components/customer-auth.tsx`
- `apps/web/src/hooks/use-resend-cooldown.ts`
- `apps/web/tests/customer-auth-resend.test.cjs`
- `apps/application/src/components/auth-sheet.tsx`
- `apps/application/tests/auth-sheet.test.cjs`
- `apps/application/tests/auth.test.cjs`

## Findings

- Website signup verification omitted the reset flow's cooldown props and never started a countdown, including after unverified login.
- `resendEmailVerification` discarded every issuance error; its controller always claimed `otp_sent: true`. The same catch in unverified login hid provider/storage errors along with throttles.
- An eligible request generated a fresh six-digit code, but delivery preceded storage. A storage failure after Resend acceptance could leave a received code unverifiable.
- Cooldown/window/active checks and insertion were separate operations, so concurrent requests could pass the same checks.

## Behavior

- Signup verification and password reset share a deadline-based countdown. Signup and unverified login start 30 seconds. A synchronous request guard blocks overlapping resends; longer server retry instructions extend the deadline. Code entry and verification remain available during cooldown.
- Public signup resend acknowledges a request, not delivery. It does not return identity-specific send, throttle, existence or verification state. Work starts on the next event-loop turn, after acknowledgement, so provider latency and identity-specific checks do not affect the response. The public-IP limit (30 requests per 15 minutes) uses the existing limiter and can return `Retry-After` independently of the submitted identity. Its existing Redis/in-memory fallback behavior is unchanged.
- A short PostgreSQL advisory transaction lock serializes OTP eligibility and insertion across processes. The existing 30-second, five-per-15-minute, five-active-code and five-invalid-attempt limits remain. No schema change is needed. The hash is committed before contacting Resend, and no database transaction spans the provider request.
- There is exactly one provider attempt per eligible issuance, with a 10-second timeout. A definitive rejection removes the new record, preserving the previous working code. A timeout, network error, HTTP 408 or 5xx is ambiguous: retain the persisted code in case it arrives; never automatically retry the email. A deletion failure is separately reported for investigation. A database outage can prevent that compensating cleanup; it must not be misreported as successful cleanup.
- Verification checks the latest issued record, including its expiry, consumption and attempt count, so consuming or expiring the latest code cannot reactivate an older code. Hashing, code lifetime, token issuance and the verified-email session gate are unchanged.
- If initial email issuance fails after account creation, signup still advances to verification with `otp_sent: false`, allowing resend or password-authenticated unverified-login recovery without another account. No session is issued until verification.
- Structured `email_otp` events distinguish acceptance, cooldown, window/active limits, concurrency, unknown/verified identities, storage/lookup failure and provider rejection/timeout/network/ambiguity. They contain only purpose and optional internal identity ID, never email addresses, codes, hashes, provider bodies or credentials. The existing explicitly selected non-production console sender is unchanged; production still forbids it.
- The resend acknowledgement is intentionally not a durable queue. A process restart before deferred work finishes may interrupt it; the customer can request again after cooldown. There are no background email retries. The persisted code remains verifiable if an interrupted provider attempt delivered it.

## Email

Verification uses the existing Wings Rewards table layout and palette, with an optional centered code highlight. Callers that do not select this option retain their exact previous HTML (covered by the order snapshot). The contiguous six-digit code appears in both HTML and plain text, with five-minute expiry, an unexpected-code security notice and Wings 4 U closing. Sender, subject, endpoint and credentials are unchanged. No remote image is required.

## Final P2: initial signup recovery

Both clients previously started 30 seconds unconditionally after a successful signup HTTP response, ignoring `otp_sent: false`. Initial signup now also returns `retry_after_seconds`. Accepted sends retain the normal 30 seconds. On failure, the API checks persisted codes and the existing cooldown, send-window and active-code limits: zero means a retry is currently eligible, while a retained potentially delivered code or an applicable limit returns the remaining wait. Concurrent issuance and an unavailable retry-state lookup conservatively require 30 seconds. Every actual resend still checks eligibility under the existing database lock.

Website and mobile always allow entry to verification, show a friendly confirmation-failure notice when appropriate, and use this server delay instead of inventing a wait or assuming that a code was never stored. A definite rejection with successful cleanup and no remaining limit permits immediate recovery without another signup. Ambiguous failures keep the potentially delivered code usable while enforcing the remaining wait. Missing or invalid retry metadata defaults to 30 seconds for compatibility. Ordinary rerenders preserve the deadline; rapid clicks cannot overlap requests. Password reset and unverified-login behavior are unchanged.

The retry hint is restricted to the account-creation response. Anonymous resend remains the same uniform acknowledgement and exposes no identity-specific timing, state or provider outcome. No OTP, hash, password, token or provider diagnostic is added to public responses.

The final P2 follow-up changes only `auth.service.ts`, `auth.controller.ts`, `auth-otp.spec.ts` and this document in API auth; website `customer-auth.tsx`, `use-resend-cooldown.ts` and `customer-auth-resend.test.cjs`; mobile `auth-sheet.tsx`, `use-auth.ts`, `auth-sheet.test.cjs` and `auth.test.cjs`. All branded-email source files remain unchanged.

Final P2 validation: 115 API tests in seven suites plus the unchanged order-email snapshot, 156 website tests in 15 suites, and 642 mobile tests in 46 suites passed. API, website and mobile TypeScript checks and `git diff --check` passed. The API coverage includes definitive rejection/cleanup, ambiguous provider outcomes, persistence failure, uncertain cleanup/lookup, an existing cooldown, full send-window and active-code limits, concurrent issuance, immediate recovery and a verified recovery code establishing a session. Client coverage includes successful signup, zero and nonzero retry hints, notices, verification during cooldown, rapid clicks, rerenders, unverified login and password reset. These checks use mocked database/provider calls and fake timers; no live accounts, OTP emails, database writes or deployments occurred.

## Manual provider verification

No live email was sent during development. After an approved release, use the Resend dashboard to check sender-domain verification, API-key permissions, quotas, suppressions, acceptance, delivery, bounces and spam placement. API acceptance does not prove inbox delivery. Gmail, Outlook, Apple Mail and physical mobile-device rendering still need actual client QA. No database migration, hosted environment change or Resend configuration change is required by this patch.

## Mocked verification for the original redesign

- API: 104 tests in seven suites, plus the existing order-email snapshot. Includes sender, issuance/recovery, authentication input, rate limiter, order email and stamp email regressions. Prisma is mocked before importing the authentication service; no live database is instantiated.
- Website: 149 tests in 15 suites, including signup/login entry, countdown updates, overlapping clicks, longer retry periods, reset behavior and timer cleanup.
- Mobile: 635 tests in 46 suites, including the new request-acknowledgement contract and initial-send failure recovery.
- API, website and mobile TypeScript checks passed. Nest compilation passed without running the Prisma prebuild or starting the API.
- The initial isolated website build compiled and typechecked, but homepage prerendering failed because its catalog API was deliberately unreachable. The subsequent production build passed using a local read-only fictional catalog fixture, with API origin overrides confined to that shell process. The generated Next.js type-reference file was restored afterward.

These checks do not establish real inbox delivery, database-lock behavior against a live PostgreSQL instance, or actual email-client rendering. No deployment, live account creation, production OTP/email, payment, database mutation, migration or hosted configuration change was performed.
