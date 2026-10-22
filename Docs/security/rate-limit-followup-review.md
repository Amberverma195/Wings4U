# Security and rate-limiting follow-up review

Reviewed main at afb6931. Work branch: fix/security-rate-limit-followup. No Prisma schema change or migration is required.

## Confirmed findings and fixes

| Finding | Focused change |
| --- | --- |
| Internal overdue alerts consumed the customer's order-ticket allowance. | Customer duplicate lookup excludes SYSTEM_OVERDUE_DELIVERY. Customer creation and admin linking keep their order-row locks and authoritative duplicate recheck. The public controller still hardcodes CUSTOMER_APP and ignores caller source/bypass fields. Other existing ticket sources retain their existing behavior. |
| Overdue alert deduplication was a job-level precheck vulnerable to overlapping jobs. | Internal alert creation locks the order and rechecks the same system source and DELIVERY_OVERDUE type in the transaction. Customer-first and alert-first sequences both work. Existing tickets are not rewritten. |
| Customers could list/view an internal alert tied to their customer account. | Customer lists exclude these alerts; customer detail, messages and reopening reject them. Staff/admin queues retain them. Existing public-message/internal-note filtering remains. Support creation has no customer email/push notification side effect in the inspected source. |
| Resolved/closed tickets had no customer reopening flow. | POST /support/tickets/:id/reopen requires CUSTOMER explicitly, location scope and ownership. It locks the ticket, rechecks authorization, conditionally changes RESOLVED/CLOSED to OPEN, clears current resolution summary fields and adds exactly one STATUS_CHANGED event. Historical messages and resolution records remain. Repeated active-ticket requests make no changes. Attempts share a 10/hour/customer policy. Customer replies to resolved/closed tickets now direct the customer to reopen first. |
| Website/mobile interfaces could strand customers after resolution. | The existing website conversation form offers Reopen ticket, retains the draft, then permits Send Reply. Native support rows open a conversation screen with the same two steps and history. Duplicate-ticket responses link to that original conversation; the native account form offers a View ticket action. Staff's default OPEN queue includes reopened tickets. |
| IP attribution trusted an undocumented leftmost Railway XFF assumption; ordinary web rewrites did not sign visitor attribution; server helpers signed arbitrary fallback headers. | API trust decisions start at the socket peer. Signed headers still require HMAC verification. Configured Railway ingress peers use validated X-Real-IP, with no leftmost-XFF shortcut. Other configured proxies retain right-to-left chain processing. The web helper signs only validated x-vercel-forwarded-for under Vercel. A same-origin /api/v1 catch-all proxy generates signatures and copies only allowed application headers; it never forwards caller signatures, raw forwarding headers or privileged catalog-server headers. Cookies, CSRF, location, signup-device identity, checkout idempotency and Retry-After survive. |
| Refresh-token hashing reset the budget on every rotation; simultaneous refreshes could create two successors. | After matching the entire opaque refresh token to an active database session, the service obtains its stable lineage. Legacy tokens initialize lineage from that verified session's id; successors retain it as an opaque token prefix. The full token, including its prefix, is still hashed and verified against the database, so client-selected prefixes grant no identity. The controller enforces the existing 20/5-minute policy against lineage before mutation. A transactional conditional claim permits only one successor. IP, invalid-IP and token controls remain. HttpOnly cookies and native secure storage remain. 429 never changes cookies/sessions; both clients treat 409 contention as transient alongside 408/429/5xx. |
| Public catalog route traffic can invoke Vercel even on cache hits; upstream 429 became 502. | Reject unknown/repeated parameters and malformed ISO dates, preserve canonical minute buckets and ordering horizon, canonicalize location casing before cache lookup, retain cache tags/30-second revalidation and constant trusted-server HMAC, and propagate upstream 429/Retry-After without caching it. No per-function memory counters were added. Edge request-volume protection requires the WAF rule below. |
| Cart quote collections/structured customizations were unbounded. | Match saved-cart's 200-line and 999-quantity limits. Bound modifiers to 128/line, removed ingredients to 64/line, names to 200 characters, notes to 2,000, promo/location/schedule/token text, and optional JSON to 32 KiB, depth 8, 4,096 nodes, 128 entries/array, 64 keys/object and 2,000 characters/string. A cart-only 1 MiB JSON parser rejects nesting over 16 before transformation; parser failures return API envelopes with 413/400. Other endpoints keep Nest's existing default body limit. |
| Redis fallback is process-local; other Redis consumers could repeatedly reconnect; pipeline command errors could be mistaken for empty counters. | Keep availability-oriented fallback, add shared Redis-service connection backoff and a two-second command timeout, and treat failed transaction results as outages. Existing limiter backoff remains. Mock two-instance tests demonstrate both the outage limitation and return to shared counters after recovery. |

## Cart limit rationale

The existing saved-cart DTO already allows 200 lines and quantity 999. Quoting now agrees with persistence. Website/mobile wing builders carry flavour slots, optional extra sauce, child salad modifiers/removals, and lunch child add-ons. Their modifier counts depend on menu groups, so the new limits provide ample headroom rather than assuming a small fixed number of groups. A fixture with 200 lines, 20 wing flavour slots per line, child salad data and quantity 999 passes validation and isolated HTTP parsing. Structured bounds leave all current payload shapes intact. Menu/pricing/tax/discount calculations are unchanged. Review the caps if future menu configuration materially expands.

## Client-IP deployment checks ? requires manual verification

Code-path trace:

- Website same-origin REST: visitor ? Vercel ingress ? Next /api/v1 proxy ? generated HMAC headers ? Nest extractClientIp ? existing rate-limit call sites.
- Direct native REST: visitor ? Railway HTTP ingress ? configured socket-peer trust plus X-Real-IP ? Nest. Never trust headers from an arbitrary peer.
- WebSocket/polling: direct realtime origin ? Railway ingress ? request/socket IP extraction using the same helper. The handshake address represents the peer. Existing customer/store budgets and store allowlist checks remain.
- Next server-side station/restore requests: incoming Vercel headers ? signed helper ? Nest. Cached catalog fetches intentionally use the existing shared server budget rather than fragmenting caches by visitor. Ordinary server requests without visitor context use their server peer.

Before approving rollout, verify in an isolated preview environment with a disposable database:

1. API_PROXY_TARGET points directly to the API rather than looping through the website. JWT_SECRET is configured consistently on both services. Verify equality operationally without recording values.
2. The Next app actually runs behind Vercel, whose ingress supplies/overwrites x-vercel-forwarded-for. Non-Vercel hosts intentionally do not sign caller-provided forwarding headers. Ensure no custom proxy changes that trust contract.
3. Observe Railway's actual socket peers without logging full request headers/tokens. TRUSTED_PROXY_IP_RANGES must contain only controlled ingress peers, never all addresses. A shared private CIDR alone cannot distinguish a trusted ingress from another process that can access that network; confirm network access restrictions before trusting it.
4. Confirm Railway overwrites X-Real-IP for REST, polling and upgrade requests on the deployed routing path. Send forged XFF, X-Real-IP and unsigned x-w4u headers and confirm they cannot alter attribution. The repository and public header documentation cannot prove the live ingress overwrite behavior.
5. Compare two separate networks and IPv4/IPv6. Counters should separate visitors; clients behind the same NAT intentionally share the generous IP-wide budgets while authenticated/session dimensions remain independent. Verify normal staff fan-out against the store-network allowance. Do not weaken trust to avoid a shared-proxy false positive.
6. Exercise website/mobile login, token refresh/429, KDS/POS station access, checkout idempotent retry and order tracking in that isolated environment. Do not load-test production or use production credentials.

Primary references: [Vercel request headers](https://vercel.com/docs/headers/request-headers) documents overwritten ingress attribution; [Railway networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits) identifies X-Real-IP. Their documentation does not establish this deployment's private-network trust boundary.

## Catalog WAF recommendation ? requires manual configuration

No dashboard settings were changed, and no current WAF configuration was verified. Code validation and the Nest shared-server budget do not stop Vercel cache-hit invocation traffic.

Suggested single rule, compatible with a one-rate-rule plan:

| Setting | Recommended value |
| --- | --- |
| Name | Wings4U public catalog requests |
| Condition | Request path is /api/catalog/menu OR /api/catalog/wing-flavours |
| Counting key | Source IP only, shared across both paths; exclude query string and caller headers |
| Strategy | Fixed window |
| Window | 60 seconds |
| Limit | 240 requests |
| Exceed action | Default HTTP 429; no permanent IP deny |

An operator should first observe the equivalent Log rule against representative shared-network browsing, then enable the rate-limit action after approval. On isolated preview infrastructure, warm the application cache, exceed the limit, verify edge 429s occur before function execution, verify the next window recovers, and check a second network independently. Confirm existing bypass rules do not skip the catalog paths. Use platform Retry-After if supplied; the Next handlers separately preserve API Retry-After on upstream limits.

These are proposed settings, not a verified production policy. Vercel documents that WAF counters are per region, so this is not a strict globally aggregated cap. Distributed attackers still require platform DDoS/bot controls and traffic monitoring. See [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

## Redis outage and concurrency limitations

All RateLimiterService request budgets and socket slots depend on Redis for cross-instance enforcement, including session refresh and reopening. During an outage, each Railway process has its own budget; instance restarts/scale-out add fresh allowances. Memory hits and socket leases are not replayed to Redis after recovery, so recovery can introduce another budget window. Tests explicitly demonstrate this limitation. No new all-request fail-closed behavior was added. Consider a separately approved outage policy for expensive signup/OTP sending if abuse warrants reduced availability; ordinary ordering should remain available. Do not change REDIS_URL or install infrastructure as part of this patch.

Support order creation/linking and system-alert deduplication serialize on the order row; reopening locks only its ticket row. The link path obtains order then ticket, and reopening does not acquire an order lock, so these paths do not introduce an opposite lock order. Checkout keeps its per-customer transaction advisory lock, committed-order checks, idempotency ownership/fingerprint validation and transaction rollback. Its idempotency row is acquired before the customer advisory lock; requests here do not subsequently claim each other's idempotency rows. No checkout implementation was changed.

These checks assume PostgreSQL READ COMMITTED statement snapshots, the normal default. Non-default isolation settings require separate verification: a pre-lock snapshot under REPEATABLE READ can undermine the post-lock duplicate check. Prisma's existing transaction timeouts bound application waits, but exact lock timing, cancellation, deadlocks with other writers, connection-pool behavior and cross-process races have not been proved against a real database. Mock races verify intended control flow, not PostgreSQL semantics. No demonstrably isolated test database was supplied; no database-backed tests were executed.

## Validation and safety

With workspace dependencies installed/generated, reproduce the safe check set with node scripts/verify-security-followup.cjs. The runner overrides database targets to an unreachable loopback port, disables Redis, uses test secrets, and runs only mocked unit/component/isolated HTTP tests and TypeScript checks. It never loads .env or invokes API startup, e2e, build, Prisma CLI, migration or seed scripts.

Final results are recorded below. Existing API baseline: 1,325 tests pass at afb6931. Existing native baseline: 1,036 tests pass. During implementation, the new cart parser initially caused Nest to skip its default parser for other routes; the failures were introduced by this patch and fixed with a distinct middleware wrapper. New reopen authorization tests caught the global admin-role bypass; the endpoint now explicitly requires CUSTOMER. A stale Babel/Jest transform-cache run failed native secure-store mocks; fresh-cache full and focused runs pass without changing those tests. Type-check failures in new code were fixed.

ESLint could not run: the repository has no ESLint configuration, script or installed package. npx --no-install eslint --version confirmed the missing dependency. No dependency/lockfile changes were made to add unrelated tooling.

Regression evidence includes KDS/POS, checkout/idempotency, website/native auth and refresh, tracking/realtime and customer-support tests. This confirms mocked regressions pass; it does not certify live production workflows. Online payment/Stripe and online refund implementation files were untouched. No production database access/mutation, schema migration, seed, deployment, merge, environment-variable change, WAF publication or Railway/Vercel settings change was performed.

## PR publication prerequisite

The requested PR is intended for main from the separate work branch. Before publishing the branch/PR, automatic Vercel preview deployments and Railway PR environments must be confirmed disabled for it, consistent with the explicit no-deployment constraint. Railway's connected app returned reauthentication required during a read-only project lookup; no configuration was available. Repository files alone cannot establish those external settings. The existing GitHub workflow invokes database-backed e2e setup; it should not be run against live infrastructure. A review commit can carry [skip ci], with the safe local validation evidence attached, until isolated CI is approved.

## Final test results

- API: 66 suites, 1,357 tests passed, one snapshot passed.
- Website: 22 suites, 184 tests passed.
- React Native: 66 suites, 1,039 tests passed.
- TypeScript --noEmit: API, website and React Native all passed.
- git diff --check: passed.
- Safe runner exit status: 0.
- ESLint: unavailable as described above.
- Database-backed concurrency/e2e, live ingress and WAF: not run; manual/isolated verification required.

## Changed files

- apps/api/src/app.setup.ts
- apps/api/src/common/filters/api-exception.filter.ts
- apps/api/src/common/utils/store-ip.spec.ts
- apps/api/src/common/utils/store-ip.ts
- apps/api/src/modules/auth/auth.controller.ts
- apps/api/src/modules/auth/auth.service.ts
- apps/api/src/modules/auth/refresh-budget.spec.ts
- apps/api/src/modules/cart/bounded-customization.ts
- apps/api/src/modules/cart/cart-payload.spec.ts
- apps/api/src/modules/cart/cart.controller.ts
- apps/api/src/modules/kds/overdue-delivery.job.ts
- apps/api/src/modules/rate-limit/abuse-prevention.spec.ts
- apps/api/src/modules/rate-limit/rate-limit.policies.ts
- apps/api/src/modules/rate-limit/rate-limit.service.spec.ts
- apps/api/src/modules/rate-limit/rate-limit.service.ts
- apps/api/src/modules/redis/redis.service.spec.ts
- apps/api/src/modules/redis/redis.service.ts
- apps/api/src/modules/support/support-followup.spec.ts
- apps/api/src/modules/support/support.controller.ts
- apps/api/src/modules/support/support.http.spec.ts
- apps/api/src/modules/support/support.service.ts
- apps/application/app/(tabs)/profile.tsx
- apps/application/app/support/[id].tsx
- apps/application/src/components/order-help-modal.tsx
- apps/application/src/context/session.tsx
- apps/application/src/hooks/use-account-data.ts
- apps/application/tests/customer-support-reopen.test.cjs
- apps/web/src/app/account/support/[id]/ticket-detail-client.tsx
- apps/web/src/app/api/catalog/menu/route.ts
- apps/web/src/app/api/catalog/wing-flavours/route.ts
- apps/web/src/app/api/v1/[...path]/route.ts
- apps/web/src/components/support-ticket-form.tsx
- apps/web/src/lib/catalog/catalog-route-params.ts
- apps/web/src/lib/catalog/server-catalog.ts
- apps/web/src/lib/server-station-gate-headers.ts
- apps/web/src/lib/server-station-login-proxy.ts
- apps/web/src/lib/session.tsx
- apps/web/tests/customer-support-reopen.test.cjs
- apps/web/tests/refresh-rate-limit.test.cjs
- apps/web/tests/security-proxy-catalog.test.cjs
- scripts/verify-security-followup.cjs

- Docs/security/rate-limit-followup-review.md
- Docs/security/rate-limit-followup-pr.md
