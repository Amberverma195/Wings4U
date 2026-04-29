# Defer Device-Token Auth and Make KDS a Human Staff Browser Flow

## Summary

Treat the current device-auth issue as a **defer-and-clean-up** task, not a “finish the whole feature now” task.

Chosen direction:
- KDS on the tablet is an MVP **browser app used by staff**
- it should use the existing **cookie/JWT staff auth**
- `X-Device-Token` should be removed from the active auth path for now or made explicitly unsupported everywhere
- device-token auth becomes a future kiosk/device feature, not a half-enabled one

This is the right fix because the repo does **not** yet have:
- a device auth service
- device registration / token rotation endpoints
- a `req.device` identity model
- KDS/POS/timeclock controllers designed around device identity

## Key Changes

### 1. Make browser KDS explicitly human-auth only
Keep these flows on normal staff/admin auth:
- KDS tablet in browser
- POS browser/tablet
- timeclock browser/tablet

Keep using:
- cookie `access_token`
- existing `AuthGuard` JWT path
- existing `@Roles(...)` checks
- existing location/IP rules where already relevant

Do **not** try to make the browser KDS authenticate as a device in this MVP pass.

### 2. Remove the partial `X-Device-Token` behavior from active auth
Clean up the placeholder path so it no longer pretends device auth exists.

Required behavior:
- [auth.guard.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/common/guards/auth.guard.ts) should no longer contain a “future DeviceAuthService” branch that implies support exists
- if `X-Device-Token` is present, either:
  - ignore it completely and continue normal auth evaluation, or
  - reject with a clear “device auth not implemented / deferred” error
- choose one behavior and use it consistently in docs and tests

Recommended default:
- reject explicitly with a clear unsupported/deferred error on device-token-only requests

Reason:
- it is safer and more honest than silently accepting the header shape conceptually

### 3. Remove the CSRF exception for device tokens until real device auth exists
Right now [csrf.middleware.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/common/middleware/csrf.middleware.ts) skips CSRF whenever `X-Device-Token` is present.

That should be removed while device auth is deferred.

Required result:
- browser routes do not get a CSRF bypass just because a client sends `X-Device-Token`
- only the existing intended exceptions remain, such as OTP/POS login if those are still correct

This is an important part of “fixing the whole issue,” not just the guard.

### 4. Align docs and task tracking to the deferred decision
Update the active docs so they stop claiming device auth exists right now.

Required changes:
- API contract should state:
  - current MVP KDS/POS/tablet flow uses normal staff cookie auth
  - dedicated `X-Device-Token` device auth is deferred
- procedures docs (`issues`, `todo`, `tasks`) should reflect:
  - issue resolved by explicit deferral and cleanup
  - future kiosk/device-auth work remains a separate planned feature

Keep the DB fields as-is:
- `devices.api_token_hash`
- `device_registered_at`
- `token_last_used_at`

Those can stay for future device rollout. No schema migration is needed for this decision.

## Public/API Behavior

After this change, the active auth contract becomes:

- **Human browser flows**
  - auth via cookies/JWT
  - applies to KDS browser tablet, POS browser, admin/manager pages, timeclock browser

- **Device-token flows**
  - not supported in MVP
  - requests relying only on `X-Device-Token` should fail clearly
  - no CSRF bypass should remain tied to that header

This means there is no ambiguity:
- “shared tablet browser used by staff” = human auth
- “dedicated kiosk/device identity” = future feature, not active now

## Test Plan

Verify these scenarios:

- staff/admin browser login still works for KDS routes
- KDS routes continue to require normal authenticated `req.user`
- request with only `X-Device-Token` does not authenticate
- request does not get CSRF bypass merely because `X-Device-Token` is present
- docs no longer claim active device-token support in MVP
- no database/schema changes are introduced for this cleanup

## Assumptions

- Your current KDS/tablet is a browser app used as a staff surface, not a dedicated kiosk identity yet.
- MVP speed and clarity are more important than shipping a half-built device-auth system.
- Device-token auth will be revisited later only if you decide to build true registered hardware/device flows.
