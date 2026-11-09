# Google Routes production investigation — November 9, 2026

The production incident is **not yet resolved**. The supplied runtime event confirms a Google HTTP request rejection, but the deployed client discarded the HTTP status and Google error details needed to identify the exact cause. No speculative request, pricing, boundary, or production-configuration change was made.

Evidence:

- The supplied event is `delivery_route.failure`, `provider_result: invalid_request`, `latency_ms: 161`, ingested at `2026-11-09T06:06:37.405839939Z` (1:06:37 AM Toronto). Its canonical address fingerprint matches the reported address; the private address is not copied into this report or test fixtures.
- Deployment: `6efe4986-22d3-44b4-a552-970f15d213b1`; project: `c68fed3d-58e7-427b-9a88-b37e94e22377`; environment: `64526bae-dbfc-400a-8ccc-814ff9c53c82`; API service: `4e60e5c9-afb7-46cc-8af2-649ddc6baf0a`.
- Direct Railway log access for those identifiers was attempted and rejected: “You don't have the required role (viewer) on this resource.” The connected account lists only an unrelated project. No unrelated service logs or variables were read.
- No `GOOGLE_MAPS_ROUTES_API_KEY` is configured in this local process or the inspected local environment files. This says nothing about the production variable. No credential-backed live Google request could be executed here.
- The selected fulfillment time, November 9 at 12:15 PM Toronto, is `2026-11-09T17:15:00Z`. It is not the quote-attempt/log timestamp. The Routes request currently does not send `scheduled_for` or a departure time; schedule eligibility is checked separately by the backend.

What this event establishes:

- `INVALID_REQUEST` is thrown on a non-success HTTP response outside the separately classified 401/403, 429, and 5xx cases. HTTP 400 is a candidate, but the existing log cannot prove the exact HTTP status.
- It was not the `TIMEOUT`, `UNROUTABLE`, `OUTSIDE_CITY`, `MALFORMED_RESPONSE`, missing-key, or above-20-km path for this attempt. In particular, missing destination coordinates on HTTP 200 would have produced `malformed_response`, not `invalid_request`.
- Missing/invalid credentials cannot be entirely excluded: Google can report `API_KEY_INVALID` in an HTTP 400 error. The existing HTTP-only classification loses that distinction.
- There is no evidence yet selecting API restrictions, service enablement, billing, an invalid field mask/body, or another HTTP rejection as the exact cause. The normal 401/403, 429 and 5xx classifications do not match the supplied event; Google error details remain necessary.

Relationship to the delivery-price change:

- Pricing commit `bcbbb8f`, merged as `7649275`, changed approved tiers and bumped `DELIVERY_PRICING_RULE_VERSION` from 1 to 2. It did not change `google-routes.client.ts`, the Routes URL, origin, request body, or field mask. Fee amounts are not sent to Google.
- The cache key includes the pricing-rule version, so the change required fresh Google lookups instead of reusing the previous cache. This is a plausible way the price rollout exposed an existing request/configuration problem, **not a confirmed incident cause**.
- The later eligibility commit `f0055be` added the mandatory routed-endpoint municipal check and requested `routes.legs.endLocation.latLng`. That request is consistent with Google's current schema; no evidence justifies removing geographic verification.

Official documentation checked:

- [Compute Routes REST schema](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes): HTTPS POST endpoint, coordinate origin, address destination, `DRIVE`, `TRAFFIC_UNAWARE`, `computeAlternativeRoutes: false`, route distance and leg end location.
- [Response field masks](https://developers.google.com/maps/documentation/routes/choose_fields): the `X-Goog-FieldMask` header accepts comma-separated response paths. The current `routes.distanceMeters,routes.legs.endLocation.latLng` follows the documented schema.
- [Location schema](https://developers.google.com/maps/documentation/routes/reference/rest/v2/Location): `latLng` contains provider-returned destination coordinates.
- [Routes error responses](https://developers.google.com/maps/documentation/routes/handle-errors): Google returns structured HTTP error status/code/details; an `INVALID_ARGUMENT` response requires its specific evidence to diagnose the rejected parameter.
- [API setup and restrictions](https://developers.google.com/maps/documentation/routes/get-api-key), [billing and quota](https://developers.google.com/maps/documentation/routes/usage-and-billing), and [Google ErrorReason definitions](https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason).

Current implementation (application logging; no SSH HTTP tools required):

- Failed requests emit provider_http_status, provider_status (Google error.status), provider_error_reason (Google ErrorInfo.reason), provider_result (internal classification), failure_stage, and optional response_issue. Unknown/unavailable provider fields are explicit null values.
- Error response streams are limited to 16,384 decoded bytes before UTF-8 decoding and JSON parsing. Oversized Content-Length is rejected before reading; missing or dishonest Content-Length cannot bypass the streaming byte count. Oversized streams are cancelled. Exactly the limit is allowed. No partial JSON is parsed on overflow.
- Only fixed allowlisted status/reason values survive parsing. Messages, raw bodies, ErrorInfo metadata, headers, credentials, coordinates and customer information are never logged. Address fingerprints have also been removed from route-event logs; internal cache and signed-quote fingerprints are unchanged.
- HTTP classification survives oversized, unreadable or malformed error bodies. A body-read abort remains a timeout and retains the HTTP status when headers were received. Local exceptions such as signing failures are labelled internal_error rather than blamed on Google.
- Customer-facing messages and status codes remain unchanged. Google driving measurements, mandatory London boundary verification, the strict 20,000-metre maximum, approved prices, caches, and quote verification remain authoritative and fail closed.
- The earlier uncommitted standalone diagnostic utility and its tests were removed in favor of this application-log workflow, which does not depend on production shell tooling.

Exact changed files relative to the current commit:

1. apps/api/src/modules/delivery-pricing/google-routes.client.ts
2. apps/api/src/modules/delivery-pricing/google-routes.client.spec.ts
3. apps/api/src/modules/delivery-pricing/delivery-pricing.service.ts
4. apps/api/src/modules/delivery-pricing/delivery-pricing.service.spec.ts
5. GOOGLE_ROUTES_DIAGNOSIS.md

Verification:

- Full API suite: 80 suites / 1,820 tests and one snapshot passed.
- API TypeScript check and Nest build passed; git diff --check passed.
- Requested lint command was attempted but cannot run: @wings4u/api has no lint script, and no repository ESLint configuration was found. No lint dependency or configuration was introduced.
- Regression coverage includes HTTP 400/401/403/429/500, success, timeouts before and during body reads, malformed/non-object JSON, exact byte-limit responses, split multibyte UTF-8, oversized streamed responses, deceptive/missing Content-Length, privacy, unchanged customer errors, and no caching/signing of failed provider results. Existing pricing, municipal-boundary and distance-limit tests pass.
- Website/mobile sources did not change; their builds were not rerun for this API-only logging change. Tests use synthetic responses, not production requests.

After review and an explicitly approved deployment:

1. Record the API deployment ID and reproduce exactly one failed quote through the website, noting the actual request time in UTC (not the scheduled fulfillment time).
2. In the API service runtime logs, filter for delivery_route.failure around that time and deployment. Read provider_http_status, provider_status, provider_error_reason, provider_result, failure_stage and response_issue.
3. Share only that sanitized event. Never add raw provider-message/body logging or expose environment variables. No separate shell diagnostic is needed.
4. Use the resulting evidence for a targeted configuration/request fix. This logging change is not itself a demonstrated repair for Google's production rejection.

Remaining uncertainties: the actual production Google HTTP status and structured reason are still unknown. Google may omit ErrorInfo, return a reason outside the allowlist, or send malformed/oversized JSON; in those cases the event preserves the available HTTP/classification evidence and indicates the parsing issue without exposing arbitrary strings. Production reproduction and log inspection are intentionally pending deployment approval.

All changes remain local and uncommitted. No commit, push, deployment, environment/configuration change, migration, seed, production-data modification, or live Google request was performed. Prisma generation was local build preparation only.
