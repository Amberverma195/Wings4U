# fix: separate internal support alerts, reopen customer tickets, and harden rate-limit boundaries

Delayed-delivery alerts no longer consume a customer's one-ticket-per-order allowance. Customers can reopen resolved or closed conversations from the website and native app, retain their history, and return the ticket to the staff OPEN queue. Order locking still prevents duplicate customer tickets; internal alerts now have a locked deduplication check too.

The patch also signs normal same-origin REST forwarding, validates ingress attribution, keeps refresh budgets stable through rotation, atomically claims rotated sessions, bounds cart-quote bodies/customizations, preserves catalog 429 responses and cache behavior, and backs off Redis failures across consumers. No Prisma migration is required.

Validation: 1,357 API, 184 website and 1,039 native tests pass; all three TypeScript checks and diff checks pass. Tests use mocks/isolated local HTTP and an unreachable database override. ESLint is not installed/configured. No database-backed e2e or live deployment tests ran.

Review [the full findings, changed-file inventory and deployment verification checklist](https://github.com/Amberverma195/Wings4U/blob/fix/security-rate-limit-followup/Docs/security/rate-limit-followup-review.md). WAF rate limiting and Railway/Vercel ingress assumptions require manual verification. Redis fallback remains per process during outages; real PostgreSQL lock/isolation behavior still needs isolated infrastructure tests.

Online payment/Stripe and online refund code, pricing, coupons, inventory, attendance and address business logic are untouched. No production database mutation, migration, deployment, merge, settings change or environment-variable change was performed.

Draft for review. The repository owner confirmed that automatic Vercel preview deployments and Railway PR environments are disabled for this branch and authorized PR publication. The review commit skips the repository's database-backed CI; safe local checks are recorded above. Do not merge or deploy without explicit approval.
