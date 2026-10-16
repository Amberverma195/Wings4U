# Opt-in saved-address cleanup — code review only

Implemented October 16, 2026 under approval to **write and test code only**. The cleanup CLI was not executed, no database connection was opened, no database records were created/changed/deleted, no migration was applied, and nothing was deployed during implementation or review preparation. Tests used JavaScript fakes for every database client and file handle. Publishing a review branch or draft pull request does not authorize execution.

The duplicate-prevention implementation and additive migration are already in `main` in commit `9ceb8369bfb72e49db996eaabe402eca3422718a` (`Prevent duplicate saved customer addresses across checkout and apps`). The `fix/customer-address-deduplication` review branch starts at that commit. This follow-up keeps the executable cleanup utility separate; it does not replay or rewrite the prevention commit, and adds no migration.

## Files for review

1. `packages/database/prisma/customer-address-cleanup.mjs` — planning, metadata inspection, authorization validation and transaction engine (new).
2. `packages/database/prisma/cleanup-customer-address-duplicates.mjs` — guarded opt-in CLI, strict argument parsing and safe error output (new).
3. `packages/database/prisma/address-cleanup-io.mjs` — exclusive report creation and durable, hash-chained JSONL audit writer (new).
4. `packages/database/test/address-cleanup.test.mjs` — database-free safety tests (new).
5. `packages/database/package.json` — adds `test:address-cleanup-review`; no runtime/deployment hook or dependency was added.
6. `ADDRESS_DEDUPLICATION_IMPLEMENTATION.md` — marks the prior executable-cleanup restriction as superseded for implementation only.
7. `ADDRESS_CLEANUP_REVIEW.md` — this review guide (new).

Existing unrelated local changes remain untouched. There are no schema/migration changes in this follow-up.

## Default mode: detailed read-only report

The CLI requires an explicit `ADDRESS_RECONCILIATION_DATABASE_URL`. It does not load `.env`, use `DATABASE_URL`, or fall back to a database. Importing its module does not start the CLI or create a connection.

With no `--apply`, it only accepts dry-run arguments. It requests `default_transaction_read_only=on` at connection setup and uses `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. It selects the fixed `public.customer_addresses` table, sets UTC for exact timestamp comparison, and collects:

- Database name, server address/port and table OID to bind review to the inspected target.
- Columns/types/nullability, incoming foreign keys, user triggers and their function definitions, indexes, table/RLS flags, rewrite rules and the canonical identity-function definition.
- Every duplicate member's ID, owner, street/unit, city, postal text, label, default flag, microsecond timestamps and canonical key.
- Deterministic retained-ID recommendation, exact redundant IDs, proposed retained metadata, conflicting-label flags and schema blockers.
- A SHA-256 snapshot of each affected customer's entire address book, including nonduplicate rows.
- A SHA-256 checksum of the complete version 2 report. Object-key order/JSON indentation do not affect this checksum.

Example for a **future separately authorized preview**, not executed in this task:

```powershell
$env:ADDRESS_RECONCILIATION_DATABASE_URL = '<explicitly selected PostgreSQL URL>'
node packages/database/prisma/cleanup-customer-address-duplicates.mjs --out new-address-plan.json
```

`--dry-run --out new-address-plan.json` is equivalent. Existing report files are never overwritten. The older read-only preview remains available, but its version 1 output cannot authorize cleanup; the new engine requires a version 2 plan with schema/target snapshots.

## Canonical record and metadata preservation

The existing canonical identity rules remain unchanged: owner ID plus normalized street including unit, city and postal code. Different units/cities/customers are never combined. No fuzzy abbreviation/geocoding match is introduced.

Retention prefers a default, then a labeled record, then the oldest creation timestamp, then ID. The selected canonical ID, owner, street/unit, city, original postal text and `created_at` remain unchanged. If the default record lacks a label and the group has one unambiguous label, that label is transferred. The group's existing default status is preserved. If display metadata needs no change, the retained `updated_at` is preserved exactly; otherwise it advances to at least the existing timestamp. The existing database trigger backfills the retained canonical key after redundant rows are removed.

Conflicting nonempty labels and incomplete address fields block that group. The utility does not silently choose one conflicting label. An authorization may select a complete subset of unblocked groups; other groups and customers remain untouched. Orders, historical address snapshots, customer accounts, rewards and wallet records are never update/delete targets.

## Exact execution gates

The current user approval does **not** authorize running cleanup. A future execution requires all of the following:

1. A separately reviewed version 2 dry-run plan, with its checksum unchanged.
2. A separate operator-created authorization JSON artifact. No approval file is generated by the tool.
3. The explicit literal `DELETE_ONLY_REVIEWED_DUPLICATE_CUSTOMER_ADDRESSES`, an approver name, target copied from the reviewed report, exact keep/delete IDs, matching deletion count and a current authorization interval of at most 24 hours.
4. `--apply`, `--plan`, `--authorization`, a new `--audit` path, `--confirm-plan-sha256` and `--confirm-delete-count`. Missing/duplicate/unknown arguments and combined dry-run/apply modes are rejected.
5. Exact matching of the selected IDs to complete, unblocked recommended groups. Duplicate IDs, unrelated IDs, arbitrary keeper substitutions, partial groups, empty selections and count mismatches are rejected.
6. Separate plan/authorization/audit file paths. Audit creation must succeed before connecting, and its prepared entry must be durably written before starting the transaction.

Authorization shape for review (placeholders deliberately are not usable approval):

```json
{
  "version": 1,
  "plan_sha256": "<checksum from the reviewed version 2 report>",
  "target": "<replace with the exact target OBJECT from the reviewed report>",
  "approved_by": "<identified approving operator>",
  "approved_at": "<UTC approval timestamp>",
  "expires_at": "<later UTC timestamp, no more than 24 hours after approval>",
  "authorization": "DELETE_ONLY_REVIEWED_DUPLICATE_CUSTOMER_ADDRESSES",
  "delete_count": 1,
  "groups": [
    {
      "keep_id": "<reviewed retained UUID>",
      "delete_ids": ["<reviewed redundant UUID>"]
    }
  ]
}
```

Future invocation syntax, **not executed or authorized by this implementation task**:

```text
node packages/database/prisma/cleanup-customer-address-duplicates.mjs --apply --plan REVIEWED_PLAN.json --authorization SEPARATE_APPROVAL.json --audit NEW_AUDIT.jsonl --confirm-plan-sha256 REVIEWED_SHA256 --confirm-delete-count EXACT_COUNT
```

These are explicit operator attestations, not digital signatures or an identity-verification service. File access and the real human approval process remain necessary; the code cannot independently authenticate who typed `approved_by`.

## Reference and schema checks

Apply is conservative: **any incoming foreign-key constraint blocks cleanup**, even if it currently references no rows. It does not disable constraints, cascade through unknown references, or reassign foreign keys. The dry run exposes reference definitions for separate review.

It also blocks unknown/missing address columns, nonordinary/partitioned tables, RLS, custom rewrite rules, unexpected/disabled/privileged user triggers, a missing/invalid canonical unique index, and a missing/nonimmutable/privileged identity function. It requires the already-installed duplicate-prevention migration; it never installs that migration itself.

All inspected schema/function definitions and the target must still match the reviewed report after locks are acquired. This catches schema/reference changes since preview. External client caches, URLs or IDs stored without database foreign keys cannot be discovered by catalog inspection; clients must refresh after an approved cleanup retires a redundant ID.

## Transaction and failure handling

- One transaction covers the complete explicitly selected batch.
- Customer advisory locks are acquired in sorted order using the same hash/seed as address saving.
- A `SHARE ROW EXCLUSIVE` lock on the address table holds writers and relevant DDL while allowing ordinary readers. This briefly affects all saved-address writers, so a future execution needs an appropriate maintenance window/batch size.
- Affected address books are reread with row locks; their full snapshot hashes and selected duplicate groups must match the reviewed report before any mutation.
- Lock timeout is 5 seconds, statement timeout 15 seconds, and idle-in-transaction timeout 30 seconds. No automatic retry is performed.
- Deletions use bound owner ID, exact redundant UUIDs and canonical identity together, with full returned-record comparison. The retained row is then updated by its exact ID/owner. Final snapshots must equal the intended results; unrelated rows must remain unchanged.
- Authorization expiry is rechecked around writes and immediately before commit. A mismatch, stale plan, unexpected row count, metadata change, expired authorization or precommit audit failure rolls back the entire batch.
- A failed rollback acknowledgement is reported as unconfirmed. A failed commit acknowledgement is reported as **COMMIT_OUTCOME_UNKNOWN**, never as a successful rollback. Acknowledged commit followed by final audit/close failure is explicitly reported as committed. Those cases require manual audit/database reconciliation before any retry.

## Audit reporting

The JSONL audit uses exclusive creation (`wx`) and requested owner-only file mode (`0600`), never overwriting an existing file or symlink. Each entry includes a run UUID, UTC time, sequence number, previous-entry hash and current-entry SHA-256. Entries are synced to disk before proceeding. Reports/audits contain personal address data and must be stored in a restricted directory; on Windows, directory ACLs must provide the intended access restriction because POSIX modes alone are not equivalent to Windows ACL enforcement.

Events include the reviewed plan checksum, target, authorization, prepared full before snapshots, per-group before/after records and removed-ID mappings, an explicitly uncommitted `commit_requested` event, then committed/rolled-back/unknown status. A disk error makes the audit writer unusable; precommit failures prevent commit. Hash chaining detects accidental editing unless the entire chain is recomputed; it is not a signed, externally anchored audit service.

Credentials and connection strings are not placed in reports/audits or console error messages. Unexpected failures use sanitized codes. Audit/connection-close failures do not mask a more important transaction-outcome error.

## Verification actually performed

**55 database-free tests passed, 0 failed.**

Command executed:

```text
node --test --test-reporter=spec packages/database/test/address-cleanup.test.mjs
```

The package also exposes `npm run test:address-cleanup-review --workspace @wings4u/database`, which runs only this mocked review suite. Tests import the guarded modules and exercise pure logic and injected fakes; they do not execute the CLI entry point, create a real database client, execute SQL, touch database records, run migrations, or produce real authorization/audit files.

Coverage includes read-only defaults, deterministic planning, units/customer separation, metadata/default retention, conflicting-label blocking, incoming references, unexpected schema/triggers/RLS, exact authorization/target/checksum/count binding, expiration, stale records/new address rows, atomic rollback, changed delete counts, audit disk failures, commit uncertainty, close failures, credential redaction and exclusive/fsynced/hash-chained file handling.

All three new executable modules passed `node --check`; `git diff --check` passed. No dependency was added and no API/web/mobile production behavior was changed by this follow-up, so application builds were not rerun.

**Remaining verification limits:** SQL/catalog behavior, real transaction concurrency, actual filesystem durability and live server permissions were not integration-tested under this review-only authorization. A separately authorized disposable PostgreSQL integration run and review of the function/schema snapshots are required before considering future live execution. No live cleanup report or approval artifact was generated in this task.
