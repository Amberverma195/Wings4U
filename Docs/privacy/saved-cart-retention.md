# Saved-cart inactivity and future cleanup

These durations are product policy, not statements of statutory retention obligations.

- Guest carts expire after 7 days without a meaningful persisted content update.
- Customer carts expire after 30 days without a meaningful persisted content update.
- Item, quantity, customization, fulfillment, schedule and tip changes restart the deadline. Identical PUTs and GETs do not. Successful guest saves set the protected cookie to the cart's remaining lifetime.
- Existing null-expiry records use `updatedAt + policy duration`. Missing or invalid timestamps are treated as expired. No backfill is required. A changed customer save records a new 30-day deadline.
- Expired ACTIVE rows return an empty snapshot with `expired: true`. They cannot contribute items to a login merge. A new explicit save replaces that identity/location's ACTIVE contents in a transaction rather than inserting a conflicting ACTIVE row. Advisory transaction locks serialize saves, merge and conversion for the same identity/location.
- Web and native recovery drafts are limited to 24 hours, scoped to their owner and rejected when the server reports expiration. Fresh unsaved changes still recover when the server is empty or unavailable. Merely reading or closing the website does not renew a cart deadline. Open clients clear their idle cart at its known server deadline.

## Expiration is not physical deletion

This change introduces no scheduled purge, startup cleanup, backfill or migration. Expired historical records are not bulk-deleted. Replacing an expired ACTIVE shopping cart only replaces that cart's shopping contents on a customer-initiated save. Orders, payment records, rewards and order-history snapshots are outside this policy and outside these changes.

Checkout conversion behavior is preserved. **Existing code already keeps only one CONVERTED slot per identity/location and removes the preceding CONVERTED cart when converting another cart.** This task adds no further deletion of CONVERTED history and does not change that existing constraint or conversion behavior. Preserving every historical converted cart would require a separately reviewed schema/retention design; expiry enforcement does not establish a complete physical-retention policy for those records.

## Separately approved future cleanup proposal — do not execute

1. Obtain explicit owner approval of the target environment, retention cutoffs, CONVERTED-history policy and allowable cart-only deletions. Do not infer approval from permission to push code.
2. Begin with a read-only dry run using a fixed UTC cutoff. Identify ACTIVE candidates using valid `expiresAt <= cutoff`, or for null expiry `updatedAt + 7/30 days <= cutoff` by guest/customer ownership. Report missing/invalid timestamps separately for review. Identify CONVERTED records by status separately; do not treat their old inactivity deadline as approval to delete them. Report ABANDONED records separately too.
3. Produce row counts by status, ownership type and location, plus item counts, age ranges and candidate IDs in a restricted review artifact. Avoid putting tokens or customer data in application logs.
4. Check actual production foreign keys and cascading relations. Verify that candidate cart/item removal cannot cascade to or invalidate orders, payments, rewards or support/order-history records. Do not assume the local schema fully describes deployed relations.
5. Verify a recent backup and a tested restore procedure before approving a mutation run. Record the immutable candidate manifest, cutoff and approval.
6. Propose small batches (for example 100 cart rows per transaction), starting with a tiny reviewed sample. Recheck status, expiry and `updatedAt` under locks immediately before each removal so a renewed cart cannot be deleted. Rate-limit batches, monitor lock contention, and stop on count mismatches or errors.
7. Reconcile deleted-cart and dependent-item counts against the approved manifest. Keep an operational audit without unnecessary customer content. Any CONVERTED cleanup requires its own explicitly approved policy and review.

No part of this proposal has been executed by this source change.

## Validation and deployment review

- Regression suites: 66 API, 21 web and 40 native tests passed using mocked dependencies/time. API tests preload the existing offline guard and mock Prisma; no database-connected e2e suite ran. These tests do not certify real PostgreSQL lock behavior under production concurrency.
- Web/native TypeScript checks and the API build passed. The web production build was attempted with the existing outbound-network-blocking preload and could not fetch Google Fonts. No network guard was bypassed. Native binary builds were not run on this Windows workspace.
- Before publication, GitHub reported successful Vercel and Railway API statuses for base main commit `a6363d850de6e6e8848d3fa71697d27aa57edf88`. The repository's CI workflow also runs on main pushes. A new main push can therefore start connected build/deployment automation; it is not a local-only publication. No deployment command or platform configuration change is part of this task.
