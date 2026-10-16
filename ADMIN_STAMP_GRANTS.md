# Admin goodwill stamp grants

Global Search → Customer → Wings Rewards → **Give Stamps** credits the actual customer account. The confirmation form requires a positive whole number within the remaining capacity and a reason. Other requires an explanation. Both the account card and grant form use the server's reward threshold (currently 8).

## Release setup

1. Apply `20261015180000_stamp_grant_email_tracking` through the normal migration process **before** deploying the API. No existing reward data is rewritten. This migration has not been applied by the implementation or tests.
2. Generate the Prisma client (`npm run prisma:generate --workspace @wings4u/database`).
3. Configure `RESEND_API_KEY`, `RESEND_FROM`, and API-side `PUBLIC_SITE_URL`. The latter may be omitted if the API already has `NEXT_PUBLIC_SITE_URL` set to the canonical public website origin. Use a public HTTPS origin without a path, credentials, port, query, or fragment. No localhost/default domain is substituted. The CTA always points to `/menu` on that configured origin.
4. The API database role needs server-side access to `wings_stamp_grant_emails`. RLS is enabled with no public policies so browser/Supabase anonymous roles cannot read email payloads. Use the existing trusted server database role, not browser credentials.
5. Use a nonproduction database and a controlled verified recipient to perform the live checks below. No real emails or production data were used by the automated tests.

## API contract

`POST /api/v1/admin/customers/:customerId/stamps/grant`

Requires the existing authenticated ADMIN role, location guard and `X-Location-Id`. Actor identity comes from the session. Unknown browser fields such as `admin_user_id` and balances are discarded by the existing validation whitelist.

```json
{
  "stamps": 2,
  "reason": "SERVICE_RECOVERY",
  "note": "Customer received the wrong item",
  "request_id": "<UUID v4>"
}
```

Reasons: `WRONG_ORDER`, `MISSING_ITEMS`, `SERVICE_RECOVERY`, `OTHER`. Notes are trimmed, limited to 1000 characters and required for Other. Stamp counts must be JSON numbers, positive safe integers, and within the server cap. Inactive/archived/noncustomer accounts are rejected.

The normal API envelope contains `data` with:

```text
{
  grant_id, stamps_granted, replayed,
  summary: { available_stamps, lifetime_stamps, lifetime_redemptions,
             stamps_per_reward, reward_available },
  entry: { id, entry_type: "ADMIN_GRANTED", delta_stamps,
           balance_after_stamps, pounds_awarded: null, reason_text,
           created_at, order_id: null, order_number: null,
           order_fulfillment_type: null, order_accessible: false },
  email: { status, message, retryable }
}
```

Validation errors return 422; missing customers return 404. Capacity changes return 409 with error code `STAMP_CAP_CHANGED` and a readable current balance/maximum. Reusing a UUID with a different customer, count, reason, note, actor, or restaurant returns 409. Signed-out and nonadmin requests return 401/403 through the existing guards.

## Atomicity, concurrency and idempotency

The existing ledger UUID primary key doubles as the durable grant request ID. There is no new idempotency-key table or change to ledger columns. The original private input is kept in the append-only audit record; an identical replay returns the existing grant and a current summary, without crediting again. A unique-key collision rolls back before checking the existing request.

The rewards row is created/locked by an upsert with a nonempty increment-by-zero UPDATE, held until transaction completion. A conditional UPDATE additionally requires `availableStamps <= STAMPS_PER_REWARD - requestedStamps`. Automatic order accrual now takes that same row lock **before** calculating available room. Redemption already uses a conditional decrement on the same row. Earning rates, lifetime-earned rules, reward eligibility and redemption amounts are unchanged. Checkout, payment, refund, delivery and KDS code is unchanged.

The following writes commit or roll back together:

| Record | Fields written |
| --- | --- |
| CustomerWingsRewards | Increment availableStamps and lifetimeStamps by the grant; leave lifetimeRedemptions unchanged. |
| CustomerWingsStampLedger | id = request UUID, customerUserId, entryType = ADMIN_GRANTED, positive deltaStamps, actual balanceAfterStamps, orderId/poundsAwarded = null, reasonText = “Gifted by Wings 4 U — courtesy stamps added.”, DB-created timestamp. |
| AdminAuditLog | Authenticated actorUserId/actorRoleSnapshot, locationId, actionKey = CUSTOMER_STAMPS_GRANTED, entityType = CUSTOMER_WINGS_STAMP_GRANT, entityId = grant UUID, selected reason label; payload customer_id, grant_id, request_id, stamps, previous_balance, new_balance, reason, note, timestamp. |
| WingsStampGrantEmail | One PENDING notification row, keyed by the committed grant UUID. |

Internal notes and compensation reasons are never copied into customer-visible history or email. Admin, web-account and mobile-account ledgers label the new event **Gifted by Wings 4 U**. EARNED and REDEEMED events retain their behavior.

## Email delivery and safe retry

After commit, the existing Resend HTTP configuration sends the branded HTML and text notification. Names are HTML-escaped, the copy handles one/multiple stamps and full-card eligibility, and the CTA uses the validated public origin. The recipient is selected server-side from the customer's current **verified primary** email identity. Missing/unverified contacts or missing configuration yield SKIPPED; no admin-entered address is accepted.

Notification states are PENDING, SENT, FAILED, SKIPPED, UNKNOWN. SENT means the provider **accepted** the email, not proof it arrived in the inbox. Provider errors/timeouts never roll back granted stamps. The UI reports stamp success separately and offers **Retry notification email** where safe.

The exact provider request is persisted before sending. A 60-second database lease/token coordinates instances; Resend receives `Idempotency-Key: stamp-grant/<grant UUID>`. Retries reuse the original payload, and an already SENT notification never sends again. The current verified identity is checked again; a changed contact prevents sending to a stale address.

Resend retains idempotency keys for [24 hours](https://resend.com/changelog/idempotency-keys). To avoid uncertain duplicate delivery, retries stop after 23 hours from the first provider attempt, returning UNKNOWN with `retryable: false`. Operators must check provider logs before arranging any separate manual notification; never issue another stamp grant to retry an email.

The dedicated retry endpoint is:

```text
POST /api/v1/admin/customers/:customerId/stamps/:grantId/email/retry
```

It requires ADMIN authentication and the original grant's restaurant scope, returns `{ status, message, retryable }` in the normal envelope, and performs **no reward mutation**. An admin can obtain the grant ID from the original response or the audit record's entityId. If the API stops between commit and email submission, retry the original grant with the same UUID or call this email-only endpoint. Expired leases can resume safely. There is no automatic background retry worker in this change.

The browser retains an unresolved grant UUID/input in session storage where available, including across dialog/profile close and page reload; retries check the same grant rather than creating another. Form fields are locked while its outcome is uncertain. Confirmed results or definitive validation failures clear the pending request. If browser storage is disabled, the key remains available while the customer modal stays mounted.

## Validation performed

- API unit/isolated-HTTP suite: **375 tests / 39 suites passed**. Real controller guards and DTO validation use mocked session/data services. Service concurrency tests model row locks/transaction rollback and call the real earning/redemption methods. Email tests mock fetch; no provider calls occur.
- Web suite: **54 tests / 3 suites passed**, including retry persistence, independent pagination, modal focus and existing order flows.
- API, web and mobile TypeScript checks and Prisma schema validation passed.
- Web production build generated all 51 static pages successfully.

Commands:

```text
npm run test:unit --workspace @wings4u/api -- --silent
npx jest --config apps/web/jest.config.cjs --runInBand --silent
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit --incremental false -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/application/tsconfig.json
npm run prisma:validate --workspace @wings4u/database
cd apps/web
npx next build --no-lint
```

Still requires live verification: applying the migration and server-role permissions in a nonproduction PostgreSQL database; concurrent transactions through the actual database; authenticated browser flows; and a single controlled-recipient Resend/inbox check. The automated suites do not connect to PostgreSQL or send customer email.

## Changed files

```text
.env.example
ADMIN_STAMP_GRANTS.md
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20261015180000_stamp_grant_email_tracking/migration.sql
apps/api/src/modules/admin/admin-customers.dto.ts
apps/api/src/modules/admin/admin-customers.service.spec.ts
apps/api/src/modules/admin/admin.module.ts
apps/api/src/modules/admin/admin-stamp-grant-request.dto.ts
apps/api/src/modules/admin/admin-stamp-grants.controller.ts
apps/api/src/modules/admin/admin-stamp-grants.service.ts
apps/api/src/modules/admin/admin-stamp-grants.service.spec.ts
apps/api/src/modules/admin/admin-stamp-grants.http.spec.ts
apps/api/src/modules/notifications/notifications.module.ts
apps/api/src/modules/notifications/stamp-grant-email.service.ts
apps/api/src/modules/notifications/stamp-grant-email.service.spec.ts
apps/api/src/modules/rewards/rewards.service.ts
apps/web/src/app/admin/admin.css
apps/web/src/app/admin/search/admin-customer-modal.tsx
apps/web/src/app/admin/search/admin-stamp-grant-dialog.tsx
apps/web/src/app/admin/search/use-admin-customer.ts
apps/web/src/app/account/profile/page.tsx
apps/web/tests/admin-customer-search.test.cjs
apps/application/app/(tabs)/deals.tsx
```
