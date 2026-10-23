# Proposed retention cleanup plan — not authorized for implementation

October 23, 2026. Companion: [audit and priorities](data-retention-audit.md), [owner-review SELECTs](data-retention-readonly-queries.sql).

**Proposal only.** No database access, dry run, backup/export, cleanup, migration, scheduler or production test was performed. No code/schema/UI/API behavior is changed. The initial audit did not include a commit. The three data-retention documents were subsequently committed as `afb6d7d` and pushed to GitHub `main` with separate explicit owner approval. That publication did not authorize production database operations or cleanup; connected CI/deployment automation may run on push and was not verified here. The operator must obtain separate explicit owner approval for each environment and operation below; permission to review, commit or push these documents is not permission to connect.

## Proposed rules and scope

Preserve guest cart logical validity of seven days without meaningful persisted update, customer validity of thirty days, and local recovery draft validity of at most twenty-four hours. GETs and identical usable-cart saves must not renew validity. Preserve owner/location isolation, explicit new saves and current account-deletion behavior.

For a fixed approved UTC instant `T`, define effective expiration `E`:

- Valid explicit `expires_at`: use that instant, not scan time.
- Null explicit expiry with valid owner and usable finite `updated_at`: `updated_at + 168 hours` for guests or `updated_at + 720 hours` for customers, matching the source's fixed millisecond durations.
- Invalid, nonfinite, contradictory, unsupported dates or ambiguous ownership: quarantine for review; an unusable application cart is not automatically safe to physically delete.

**Proposed physical-age threshold:** ACTIVE carts become age candidates when `E + 720 hours <= T`, an additional thirty-day grace period after logical expiration. With no meaningful updates, this is approximately thirty-seven days from the last guest save or sixty days from the last customer save. Grace is not a new usable/restoration window. Equality is eligible at the exact boundary; dates after it are excluded. Owners must approve this rule and the treatment of legacy null deadlines before implementation.

| Category | Initial proposal |
|---|---|
| ACTIVE with valid expiration, clean ownership and approved location | Age candidate only after the additional grace; actual deletion requires all safety gates and a current recheck. |
| ACTIVE with legacy null expiration | Separate dry-run bucket using original `updated_at` fallback. Include only if explicitly approved and runtime/database dates validate. No automatic backfill. |
| Invalid/no/mixed ownership, blank guest token, invalid/contradictory dates, unknown references | Exclude and investigate. Never infer guest/customer from a null field alone in the executor. |
| CONVERTED | Excluded, regardless of old expiry or age. Existing conversion behavior is unchanged; status can also arise from explicit cart clear. |
| ABANDONED | Excluded until its provenance and separate policy are approved. Do not reclassify ACTIVE to ABANDONED as part of this plan. |
| Orders, payments/refunds/tax, rewards/wallets/ledgers, support/messages, audit histories, deletion requests/holds/tombstones | Excluded. No clearing of obligations, cascading customer deletion or modification of financial/history records. |
| Browser/native local data | Existing validity and cleanup remain unchanged. Any compatibility change is a separate approved implementation. |

Only cart roots and their verified dependent cart items may be physically removed in an approved future executor. Do not delete by account inactivity, cascade from a User, modify station/auth data or touch provider copies through this job.

## Prerequisites and evidence gates

1. Owner approves purposes, grace, permitted locations/statuses, legacy handling, hold exclusions, evidence access, operating window, maximum rows/time and abort thresholds. Financial/legal periods need their own owner/legal decision; no period is invented for them.
2. Owner separately approves a bounded read-only production inspection or executes the SQL themselves. Confirm schema/column types, enum values, ownership rules, unique indexes, FK directions, triggers, RLS visibility, extensions/external jobs and any application/JSON references. A restricted role's zero count is not proof that rows do not exist. The local schema alone is insufficient evidence.
3. Verify backups and recovery before approving mutations: actual restore points, snapshot consistency, off-site copies, encryption/access, retention window, RPO/RTO and an isolated restore drill. Database backup coverage does not automatically include Supabase Storage, logs, printers or exports. Taking a production backup/export is itself a separately approved data operation; do not run it casually for this audit.
4. Demonstrate client compatibility with both expired-row and physically absent-row responses. Existing clients may restore a fresh unsaved draft when a cart is empty/unavailable. Require web/native tests for known expired deadlines, unknown/legacy deadlines, owner switches and offline/reconnected clients. Thirty days of grace reduces but does not prove absence of resurrection risk. If old clients cannot safely distinguish obsolete data from intentional fresh unsaved changes, keep cleanup off until a separately approved compatibility/version strategy exists.
5. Prove concurrency/lock ordering with disposable Postgres, fake customers/orders and no production connection. Mocked tests alone cannot establish PostgreSQL lock/FK/trigger behavior.

## Read-only dry-run procedure, after separate approval

The supplied SQL contains only SELECT statements/CTEs and aggregates or catalog metadata. It is an **unexecuted review artifact** and not a cleanup script. It contains an illustrative fixed UTC instant; the owner must replace it with the approved instant. Do not put an unreviewed `now()` into a deletion predicate that drifts between batches.

Use an approved read-only database role/transaction configured by the owner, with bounded statement duration and resource limits. Do not elevate permissions, disable RLS or modify settings automatically. SELECTs can still consume I/O and take normal relation-read locks. Inspect catalog metadata first; stop if schema differs. Run at a low-traffic time with owner monitoring. Do not use an automatic COUNT at application startup or a scheduled dry run.

Report counts by status/owner/location, null-expiry and anomaly buckets, expired ACTIVE and age candidates, plus dependent item counts. Report CONVERTED/ABANDONED separately. Root counts must not be multiplied by item joins; preaggregate items per cart. Age counts are **not** final authorized deletion counts: they omit final obligation/reference/client gates. Repeat with the same instant to quantify drift; do not treat snapshot drift as an error that justifies expanding the cohort.

If a future restricted candidate manifest is authorized, store only cart UUID, location, owner-kind plus restricted lock identity, observed status, expiry, `updated_at`, item-count/content revision and approval/run ID. Guest token/user ID may be needed internally to acquire the correct lock, but must not appear in ordinary application logs, a public PR or user-facing report. Encrypt/restrict the manifest, define its own expiry and record who approved access. The supplied aggregate SQL deliberately does not output those identities or cart contents.

## Concurrency and idempotency design — pseudocode in prose, no executor provided

Current `DbCartStore` serializes saves, merge and conversion using `pg_advisory_xact_lock(hashtextextended(key::text, 84543))`, where `key` is JavaScript `JSON.stringify([kind, identity, locationId])`. Guest merge locks guest identity first, then user identity. Preserve this convention; do not substitute PostgreSQL JSONB's spaced text for compact JS JSON, a different seed or a row UUID. That would acquire unrelated locks and give false safety.

Recommended initial operating shape:

1. Discover a bounded, nonlocking page of candidate IDs/metadata, e.g. up to one hundred, ordered deterministically. Do not claim or lock a cart row yet. Re-read lock identity at execution rather than trusting old manifest ownership. Do not log it.
2. Execute **one cart per short transaction initially**. Acquire the exact identity/location advisory lock nonblockingly; skip contention instead of waiting behind live customers. Never row-lock first and then wait for the advisory lock: writers hold advisory locks before changing rows, which can deadlock with that reversed order.
3. For customer carts, acquire the owner User row lock before the cart row, nonblockingly or with a separately approved tight limit. A `FOR UPDATE`-strength owner lock coordinates with account deletion and the checked-in hold trigger's `FOR KEY SHARE` owner lock. A merely shared owner lock would not serialize new holds. Do not hold a candidate cart row while waiting for deletion's User lock. Deletion does not use the cart advisory key; locking User before cart prevents the obvious reverse row-lock cycle. Verify all other writers in the deployed system and test this order rather than assuming it is universally safe.
4. Under those locks re-read owner, location, status, timestamps and applicable holds/obligations. Skip missing/deleted/reassigned rows; exclude active legal/business/refund holds. During the first conservative rollout, also skip customers with active orders, pending payments/refunds, nonzero wallet or unresolved support/cancellation obligations until the owner has explicitly approved independent cart-only disposal for such accounts. Never call the account-deletion endpoint or consume deletion authorization to perform these checks.
5. Lock the individual candidate cart row without long waits. Revalidate again against the fixed `T` and current database state: ACTIVE only; exactly one valid owner; approved location; finite/valid effective expiration plus grace; unchanged observed update/expiration/status/revision. Recount dependent items as necessary. Any renewal/content/owner change is skipped for a new dry run, not forced through using the older timestamp.
6. Only a verified cart/item deletion may be contemplated after every gate. An approved future implementation should use conditional affected-row checks even while locked. A cart already deleted by merge/deletion is an idempotent skip. A newly created row in the same identity slot has a different UUID and is outside the old manifest. Missing or renewed carts never cause deletion of the replacement.
7. Commit promptly, release locks and rate-limit before the next transaction. A scheduler or distributed overlap lock, if later approved, must have explicit lease/ownership/stop behavior. Do not install one now. Hash collisions can cause harmless conservative skips; do not change the hash convention to avoid them.

Account deletion can win the User lock and remove the candidate first; the cleanup then skips it. Cleanup can finish first only within its approved cart-only scope; deletion still evaluates all independent obligations afterward. Hold creation and cleanup must have an agreed ordering/linearization point. No cleanup result can mark an order paid, forgive a balance, cancel a pending order or erase a support/audit/financial record.

Guest merge may wait on guest/user locks. A cleanup that acquired the guest lock first either removes a sufficiently expired guest candidate or skips it; merge must never import that candidate. A merge that acquired the locks first may remove/reassign the source, which cleanup must skip. No multi-owner execution batch should be introduced until it has a globally consistent lock order and real database race tests.

## Backups, rollback limits and post-cleanup checks

Before a future run, owner records backup/restore proof and a restricted approved manifest with schema/version/cutoff/counts. A backup is not an excuse to over-delete. Restoring rows can itself reintroduce personal data removed later by account deletion.

- **Before commit:** a failed cart transaction can roll back its own changes. Errors, deadlocks or lock timeouts should produce bounded skips/retries and a stop signal under approved thresholds, not bypasses.
- **After commit:** there is no universal undo button. Do not rewind production to a pre-cleanup backup: that can undo real orders, payments, inventory and account deletions. Restore to a separate authorized environment, validate and selectively reconcile only approved cart data under a new authorization. Reapply all later deletion/hold/owner/status changes, never resurrect deleted customers, and do not overwrite renewed carts. Recovery itself creates sensitive copies that need restricted access/disposal.
- **Expected cascade:** independently reconcile root-cart and dependent-item removal counts. No order/payment/reward/wallet/support/audit count or hash should change as a consequence of cart cleanup. Concurrent business operations can change global totals, so validate bounded manifests and causal audit records; a live global-count difference alone cannot prove corruption.
- **Post-run checks:** repeat approved aggregates at the same `T`; reconcile approved, skipped, renewed, concurrently removed and actually deleted cohorts; verify converted/abandoned cohorts untouched by this executor; sample retained current carts using authorized synthetic/staging evidence. Recheck login/cart merge, fresh save, delivery setup and checkout flows without placing production orders.
- **Monitoring/abort:** owner-approved per-run maximum, lock-contention/query-duration/error limits, row/item mismatch and unexpected FK/trigger errors are stop conditions. Keep summaries/run IDs, not cart text, tokens, addresses or error payloads. Do not auto-retry an uncertain cohort without reconciliation.

## Native sign-up identifier: recommendation for a separate approved task

Current `getSignupDeviceId()` stores a raw ID indefinitely in SecureStore and memory. It has no timestamp or in-flight creation promise. Logout and `forgetDeletedAccount()` explicitly preserve it. The web record already uses a fixed 180-day lifetime. Recommend a **fixed, non-sliding 180-day native rotation** if approved by owner/security, with these safeguards:

1. Keep a versioned record such as `{v, id, createdAt, expiresAt}` in a separately versioned SecureStore key; require finite timestamps, a valid random ID, a supported version and `expiresAt = createdAt + 180 × 24h`. Reads do not renew the deadline. Validate expiry on every signup-ID retrieval, even if a memory cache exists; no claim of a background erase while the app is stopped.
2. Use a process-wide single-flight initialization/rotation promise and serialized storage writes so parallel signup requests cannot create or persist different IDs. The caller must use the ID that actually won the local operation. Define write/read failure behavior explicitly: stable process-memory fallback, no per-request random rotation, no silent authentication failure, and no logging of raw IDs. SecureStore does not provide a general cross-process compare-and-swap; document single-runtime assumptions and test any background/multi-runtime use.
3. Choose the legacy upgrade policy explicitly. Creation time of a raw existing ID is unknowable. Recommended compatibility option: preserve a valid legacy ID once, recording migration time as the start of a **transitional** 180-day window. This can extend old-ID retention by up to 180 days after upgrade; it is not proof of a retroactive maximum lifetime and must be approved/disclosed. Immediate rotation would minimize that transition but reset device-rate-limit identity at upgrade. Do not infer creation time from an opaque UUID. Do not repeatedly reset the migration window on restarts or failed persistence.
4. For new installations, create once with the fixed lifetime; at exact expiry rotate once. Define invalid/future timestamps and clock rollback handling before coding. Prefer preserving a valid restrictive identity during uncertain clock/storage conditions over minting a fresh ID on every attempt; bound any fallback and require tests so corruption does not become permanent retention.
5. Preserve the rule that logout/account deletion does not immediately rotate the abuse-prevention ID; those actions must not reset the signup bucket. Preserve backend email/IP/device throttles. Device rate limits currently use a seven-day window; 180-day rotation changes the device bucket at boundaries, so test boundary abuse with existing IP/email enforcement and have security approve that tradeoff. Do not add a permanent old/new linking table merely to compensate without a separate retention purpose.
6. Account for OS behavior. Expo documents Android uninstall removal and iOS Keychain persistence across reinstall for the same app identity; secure storage is not a universal persistent installation clock or guaranteed uninstall wipe. Android backup exclusion and iOS accessibility/Keychain settings need release-specific verification. Public reference reviewed: [Expo SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/); project uses Expo 57, whose version-specific page was not retrievable in this review. Validate against the installed SDK and devices before implementation.
7. Update the public privacy/native-storage disclosure only when the behavior is actually implemented/released. Today it must continue to disclose **no native application TTL**. Authentication access/refresh storage and generation guards must remain independent of signup-ID metadata.

Proposed mocked/offline tests: pre-expiry reuse; exact/post-expiry single rotation; no sliding extension; valid/invalid legacy migration; restart after migration; concurrent reads/rotations; failed reads/writes; unsupported versions; future/corrupt timestamps; clock rollback; in-memory fallback stability; logout/deletion preservation; upgrade/downgrade behavior; no token/session-generation regression. Device tests: iOS reinstall/Keychain/accessibility and Android uninstall/backup/restore, using test devices/builds. Backend mocked tests must demonstrate unchanged device/IP/email limits, including the boundary/legacy transition. No such lifecycle change or test run was performed here.

## Phases and approvals

| Phase | Work / complexity | Exit evidence |
|---|---|---|
| 0: this task | Source/public-doc audit and proposal; completed without data access | Three documentation artifacts; no executable cleanup, application change or production counts. |
| 1: separately approved inspection | Owner-run or explicitly authorized read-only counts/catalog review; low–medium | Fixed UTC snapshot, schema/RLS/reference evidence, anomaly and age buckets. No deletion. |
| 2: policy and recovery approval | Owner/legal/security/operations; medium–high | Signed scope/exclusions, hold procedure, provider inventory, backup/isolated-restore and retention decisions. |
| 3: separately approved implementation | Bounded dry-run/executor and client compatibility work on a branch; medium–high | Offline unit tests and disposable Postgres concurrency/constraint tests; no live endpoint/DB needed. Native ID rotation is a separate task/approval. |
| 4: staging rehearsal | Synthetic isolated data; medium | Threshold boundaries, renewal/merge/deletion/hold races, dry-run nonmutation, overlap/retry/crash recovery, resource limits and recovery exercise pass. |
| 5: separately approved production canary | Restricted operator, one tiny manifest at a time | Before/after cohort and item reconciliation, preserved current carts/financial records and no unexplained errors. No scheduler by default. |
| 6: separately approved ongoing operation | Monitoring, kill switch, runbook and eventually scheduling if justified | Documented limits/owner, repeatable reporting and periodic policy/provider review. |

Additional cart tests: guest seven-day/customer thirty-day validity and twenty-four-hour drafts unchanged; millisecond/grace equality; null/invalid/nonfinite deadlines; mixed/no owner; same owner across locations; identical save not renewal; changed save wins over cleanup; conversion excluded; ABANDONED excluded; merge in both race orders; deletion and hold in both race orders; pending refund/wallet/support exclusions; new UUID in reused slot; no orphan items or cross-table cascade; transaction rollback; overlapping cleaners; schema drift; wrong role/RLS visibility; no raw identity/contents in logs.

**Decision required before further action:** approve only a precisely bounded next phase. This plan does not authorize implementation, a production SELECT, backup/export, migration, cleanup or deployment. Stop after documentation until explicit approval is given.
