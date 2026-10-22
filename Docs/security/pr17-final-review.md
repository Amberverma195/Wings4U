# PR #17 final corrections before merge

Base reviewed commit: 58e86720aea91cc7bc843f9f858092a4b98b0cfa. Branch: fix/security-rate-limit-followup. These corrections are committed locally only. Do not push, merge, deploy, cancel deployments or change platform settings without new authorization.

## Effective Next routing

Installed Next version: 15.5.14. Its router-utils/resolve-routes.js orders filesystem checks, afterFiles rewrites, dynamic route resolution, then fallback rewrites. An array returned by rewrites() becomes afterFiles rules. Thus the broad /api/:path* external rewrite intercepts /api/v1/auth/login and /api/v1/cart/quote before the dynamic app/api/v1/[...path] route can generate trusted IP signatures. The original direct-export unit tests could not detect this.

The minimal fix returns the existing rewrites under fallback. Next-owned catalog, refresh-restore and station handlers resolve locally; normal /api/v1 paths reach the signed catch-all; remaining API/WebSocket rewrite destinations remain available. No upload-specific bypass of the signing handler was added. A proxy target equal to the incoming origin now returns 502 instead of looping.

Proof: node --test apps/web/integration/proxy-routing.test.cjs starts an actual Next server on loopback using copied, unmodified repository route sources and config, plus an isolated mocked Nest HTTP upstream. First it loads the reviewed commit's config and proves both login and cart bypass signing (the upstream receives the forged signature unchanged). Then it loads the corrected config and proves the HMAC is generated, forged attribution/server-only headers are dropped, and all specified application headers/bodies survive. The same positive login/cart proof passes against an actual production build/start of the isolated Next fixture. This is local framework execution, not a deployment or a build of the real website.

The HTTP checks also cover signup, both password-reset endpoints, refresh with three distinct Set-Cookie headers retaining attributes, CSRF, authorization, guest-cart cookies, location, signup device id, checkout idempotency, repeated query parameters, PUT/POST, response data, 307 Location, 429 Retry-After, KDS/POS dedicated login, station API forwarding, Next-owned catalog routes, refresh-restore redirect and public image retrieval. Client IP ingress in the fixture emulates Vercel; it does not prove the live platform overwrites those headers. The existing cryptographic API verification and trusted-peer extraction are unchanged.

See [Next rewrite precedence](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites). The test uses the installed router rather than relying solely on documentation.

## Image uploads and request limits

The complete source search found two multipart file endpoints:

- POST /api/v1/admin/menu/items/:id/image
- POST /api/v1/admin/menu/categories/:id/builder-image

Both retain ADMIN authorization, location scoping, existing item/category checks and the existing filesystem image-storage adapter. Existing database image fields and migrations are unchanged. Backend multipart parsing now limits one image and bounds its size. Accepted MIME types match the existing pickers: PNG, JPEG and WebP. This is MIME validation, not a new image transcoding or storage service.

Supported image file size is **4 MiB inclusive (4,194,304 bytes)** on both endpoints and both pickers. Multipart overhead is separately bounded by the REST proxy's **4 MiB + 64 KiB (4,259,840 bytes)** request limit. Normal JSON requests use that same proxy ceiling, while the API's existing per-route JSON/cart bounds still apply. The proxy streams request bodies through a byte-counting transform with Node fetch duplex half, rather than buffering request.arrayBuffer(). Content-Length is checked early; chunked requests without it are still counted. Exceeding the stream bound produces a 413 API envelope. API multipart limit exceptions also have a PAYLOAD_TOO_LARGE code.

The browser validates selected file size before uploading and translates a platform-generated/plain-text 413 into a helpful 4 MiB message. Streaming does **not** bypass Vercel's [4.5 MB function payload limit](https://vercel.com/docs/functions/limitations). Larger files remain unsupported through this function route. A future direct-upload/storage or specifically scoped ingress design would require separate review; this patch adds neither a new provider nor a privileged rewrite around the proxy.

Tests send small uploads through actual Next routing for both endpoints and a 4 MiB boundary upload; oversized and chunked bodies return 413. Separate isolated Nest HTTP tests use the real admin controller, auth/roles/location guards, multipart interceptor and image service with mocked persistence/storage. They verify both endpoints at exactly 4 MiB, rejection at 4 MiB + 1, missing/invalid images, foreign-item rejection, anonymous/customer/staff rejection, unchanged existing-image lookup and no persistence on rejection. A fixture image is served through Next's public filesystem path. This does not establish that Railway and Vercel share a persistent image filesystem in production; storage topology is unchanged and remains an operational check.

## Support conversation/status concurrency

addMessage previously checked status outside its write transaction. A resolver/closer could commit after that check, allowing a customer reply into a final ticket without reopening.

All four conversation/status writers now lock the same support_tickets row with SELECT FOR UPDATE and then read mutable state inside an interactive transaction:

- addMessage repeats ownership, location, internal-alert visibility and final-status checks while locked; message, audit event and updatedAt commit together.
- reopenTicket uses the same lock and retains its conditional final-status update, ownership checks and single reopening event.
- updateStatus reads its audit from_value under that lock, then writes status and event atomically.
- resolve checks final status under the lock and writes its existing resolution summary/history/event atomically.

Hourly/per-ticket message limits remain outside the lock, with unchanged keys/policies; no Redis/network operation is awaited while holding the ticket lock. Staff notes remain permitted on final tickets. Customer replies require the explicit reopen endpoint. These operations lock one ticket and do not acquire an order lock, avoiding a new reverse order relative to existing order-linking locks.

The new transaction-aware mock harness holds a row mutex until commit, checks that transaction reads/writes follow FOR UPDATE, stages writes and discards them on rollback. It covers both lock-winning orders for customer replies against RESOLVED/CLOSED, both orders of staff updates against reopening, simultaneous reopening, staff notes during closure/resolution, ownership/location/internal-alert rejection, preserved history/active queue visibility and audit-insert rollback. It validates intended locking/control flow, not PostgreSQL implementation semantics. No demonstrably isolated PostgreSQL instance was supplied; real cross-process lock waits, transaction isolation and deadlock/pool behavior remain unverified.

## GitHub/Vercel deployment evidence

Read-only GitHub queries verified:

| Field | Value |
| --- | --- |
| PR | #17, open draft, unmerged |
| Head SHA inspected | 58e86720aea91cc7bc843f9f858092a4b98b0cfa |
| Commit status context | Vercel |
| Commit status state | success |
| GitHub deployment id | 7242832668 |
| Deployment creator | vercel[bot] |
| Deployment task/environment | deploy / Preview |
| production_environment | false |
| Deployment created | 2026-10-22 03:19:10 UTC (October 21, 11:19:10 p.m. Toronto) |
| Deployment status | success, description: Deployment has completed |
| Deployment status timestamp | 2026-10-22 03:19:11 UTC |
| Separate check run | Vercel Preview Comments, completed/success |

Evidence comes from the [deployment record](https://api.github.com/repos/Amberverma195/Wings4U/deployments/7242832668) and its [status records](https://api.github.com/repos/Amberverma195/Wings4U/deployments/7242832668/statuses), not merely from a URL. Vercel's completed-deployment status is distinct from its comment check. GitHub records a completed Preview deployment for the inspected commit; it is not just a pending integration.

The Vercel detail target recorded by the commit status is [the deployment dashboard](https://vercel.com/wings4u88-5012s-projects/wings4-u-web/4enuzsJtKtxoUdc4yk1DJiwvxP4R). The preview was not visited. No connected Vercel settings tool or local project configuration was available to establish current branch deployment settings. We cannot verify whether the preview currently serves traffic, which secrets it has, or whether previews were disabled after that deployment. The prior owner confirmation must not be presented as independently verified configuration. Existing local review/PR-description artifacts have been corrected; the remote PR description was not edited under this no-push/no-deployment request.

## Validation actually executed

- Safe runner: API 68 suites / 1,378 tests; website 23 suites / 187 tests; native 66 suites / 1,039 tests, all passed. API snapshot passed. All three TypeScript --noEmit checks passed. The runner's original six Next routing checks passed.
- Final website rerun after adding the loop-guard test: 23 suites / 188 tests passed, 0 failed.
- Final standalone Next integration run (including isolated production build): 7 checks passed, 0 failed.
- Focused API upload/concurrency run: 2 suites / 21 tests passed.
- git diff --check: passed.

Reproduce the entire current set with node scripts/verify-security-followup.cjs. It now includes the isolated Next routing fixture. All database targets are overridden to an unreachable loopback port, Redis is disabled, test secrets are used, and the actual API AppModule/e2e/migration/seed entry points are never started. The fixtures have no copied .env files and their child process starts in the isolated directory. The production build is of that minimal copied fixture only, with upstream requests limited to the local mock Nest server. Existing web/mobile auth, support, checkout, KDS/POS and realtime regression suites pass. This evidence does not certify live end-to-end production operation.

During development, the new multipart boundary tests exposed Busboy's threshold behavior; parser options were corrected to accept exactly the documented maximum and still reject the next byte. Early Next fixture failures were Windows cross-drive module paths and a missing fixture contracts alias; those test-environment defects were corrected. Existing test expectations were not weakened to suppress failures. No remaining failing checks were ignored. ESLint remains unavailable in this repository and was not installed.

## Remaining checks and safety

Manual verification is required for current Vercel preview/PR deployment settings, live ingress overwrite/trust behavior, platform 413 behavior, WAF settings, production image-storage topology and isolated PostgreSQL concurrency. Do not use the live Supabase database for these checks. No remote preview cancellation, redeployment, environment change or platform-setting change was attempted.

No schema/migration, production database access/mutation, seed, deployment command, merge or push occurred in this final-fixes pass. Online payment/Stripe, online refund implementation, pricing, coupons, inventory, attendance and address business logic were untouched. Existing rate-limit policies, refresh lineage, HttpOnly cookies/native token storage, customer/internal ticket separation, single customer ticket per order, catalog cache/query protection, cart size/nesting bounds and Redis fallback protections remain intact.

## Modified files and purpose

| File | Purpose |
| --- | --- |
| apps/web/next.config.ts | Place the existing external rewrites after local/dynamic route resolution. |
| apps/web/src/app/api/v1/[...path]/route.ts | Stream bounded requests, map 413, reject same-origin proxy loops; preserve signed forwarding and response handling. |
| apps/web/src/lib/api-proxy-body.ts | Count streamed bytes and identify size-limit errors, including wrapped fetch failures. |
| apps/web/src/lib/menu-image-upload.ts | Shared picker size/MIME validation and useful API/platform upload errors. |
| apps/web/src/app/admin/menu/menu-item-modal.tsx | Apply the shared image limit/error handling to item uploads. |
| apps/web/src/app/admin/menu/admin-menu-client.tsx | Apply the same handling to builder-category uploads. |
| apps/api/src/modules/admin/admin-menu.controller.ts | Use bounded multipart options for both existing upload endpoints. |
| apps/api/src/modules/admin/menu-image-upload.ts | Define inclusive 4 MiB parsing bounds, one-file limits and accepted MIME types. |
| apps/api/src/common/filters/api-exception.filter.ts | Map HTTP 413 to the existing PAYLOAD_TOO_LARGE error convention. |
| apps/api/src/modules/support/support.service.ts | Coordinate message/status/resolve/reopen transactions on the ticket row lock. |
| apps/api/src/modules/support/support-concurrency.spec.ts | Test competing writers, access rules, exactly-once reopening events and audit rollback with transaction-aware mocks. |
| apps/api/src/modules/admin/menu-image-upload.http.spec.ts | Exercise real multipart/controller/guard/service handling with mocked repositories and storage. |
| apps/web/integration/fixtures/next.config.reviewed.ts | Preserve the reviewed rewrite configuration as a standalone regression baseline; shallow clones need no historic git object. |
| apps/web/integration/next-proxy-server.cjs | Run an isolated Next dev/production server for actual routing tests. |
| apps/web/integration/proxy-routing.test.cjs | Prove the original bypass and fixed dev/production routing over HTTP; test cookies, uploads, own routes and station forwarding. |
| apps/web/tests/menu-image-upload.test.cjs | Test shared upload limits, platform 413 messaging, chunked bounds and proxy-loop rejection. |
| scripts/verify-security-followup.cjs | Include actual isolated Next routing checks in the existing safe regression runner. |
| Docs/security/rate-limit-followup-review.md | Correct earlier preview/no-deployment assertions and link this follow-up. |
| Docs/security/rate-limit-followup-pr.md | Correct the prepared local PR-description artifact; do not mutate the remote PR. |
| Docs/security/pr17-final-review.md | Record fixes, routing proof, exact limits/status evidence, executed checks and remaining uncertainties. |
