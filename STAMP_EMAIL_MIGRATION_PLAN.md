# Targeted stamp-email migration preflight and recovery plan

> Historical pre-execution plan. On 2026-10-16 the owner explicitly approved all four pending migrations; all four were subsequently applied and independently verified successfully. The current execution record is [.local/four-reviewed-production-migrations-report.md](.local/four-reviewed-production-migrations-report.md). The pending-migration restrictions and unexecuted status below describe the earlier plan, not the current database state.

Prepared 2026-10-15 (America/Toronto). **No database write, SQL application, Prisma resolution, commit, push or deployment has been performed.** All database inspection used explicit read-only transactions. This document is a plan, not permission to execute it.

## Verified target and remaining execution gates

- The configured Supabase project reference is `qdzwgollskyflllhdixs`; connection endpoint is `aws-1-us-east-1.pooler.supabase.com:5432`, database `postgres`, schema `public`.
- Existing Prisma configuration prefers `DIRECT_URL`, with `DATABASE_URL` as fallback. The API prefers `DATABASE_URL`, with `DIRECT_URL` as fallback. Both configured connections were independently checked and reach the `postgres` role in the configured database. No passwords or connection strings were printed.
- **Production is confirmed:** the owner directed production treatment, and read-only Railway checks now verify the service's actual production environment and active deployment snapshot point to this project.
- **One-time logical backup verified on 2026-10-16 under the owner's separate backup authorization.** The full PostgreSQL custom archive includes all 78 public table-data entries and other database schemas. Export, archive listing and full archive extraction-to-discard succeeded; no restore was performed. Provider snapshots, PITR, off-device coverage and successful restoration remain unverified. See the backup evidence below. Migration execution still requires separate explicit approval.
- After the owner authenticated the correct Railway account, read-only public GraphQL queries confirmed project `c68fed3d-58e7-427b-9a88-b37e94e22377` (`inspiring-radiance`), service `4e60e5c9-afb7-46cc-8af2-649ddc6baf0a` (`@wings4u/api`), production environment `64526bae-dbfc-400a-8ccc-814ff9c53c82`, and custom domain `api.wings4ulondon.ca`. No variables from the previously accessible unrelated project were read.
- Active successful deployment `6cd8be04-0eaa-4e35-bca8-2647c5b0c8b3` runs commit `ffb913ef4aaf1610cddaa8ce7a6f01240b1dc060`. Its saved deployment snapshot `1a204c3e-9567-4163-93fa-4dfa8bcd7cc7` was checked, rather than relying only on current settings that could be staged for a future deployment. Snapshot DATABASE_URL and DIRECT_URL both identify the expected Supabase project/database. Using the snapshot's actual runtime-preferred DATABASE_URL in an explicit read-only transaction confirmed effective role postgres, BYPASSRLS, schema USAGE/CREATE and parent-ledger REFERENCES. No secret variable values were logged or saved.
- Active deployment build logs confirm Prisma Client 7.5.0 generation, and that exact deployed commit contains the WingsStampGrantEmail schema model. This provides source/build compatibility evidence without SSH, redeployment or a real stamp grant. The new table's actual-role read still must be checked after creation.
- Obtain explicit approval covering **only** the new table/constraints/RLS and the subsequent supported Prisma history registration. Approval must not cover executing the July migrations, editing existing migration records, or redeploying the API.
- Coordinate a short window without manual stamp grants and prevent concurrent deployment/migration jobs. Ordinary database activity can continue, subject to the brief parent-ledger lock described below.

## Migration history investigation and exact recovery

Read `_prisma_migrations` names, checksums, started/finished/rollback timestamps and step counts. There are **39 successfully applied migration names**, plus two historical failed attempts subsequently recorded as rolled back and superseded by completed records. There are **no unresolved failed migration records**.

Before recovery, 37 applied names existed locally and their file bytes matched all 37 stored SHA-256 checksums exactly. Two applied May migrations were absent locally. Current/older local branches, fetched origin history, reflogs, local Git objects, editor histories and available Codex session history were investigated. The two files did not appear in reachable branch history. A May local session recorded them as untracked; later in that session they were absent. This supports an untracked-file loss as the explanation; the exact deletion event was not established.

Scanning 1,890 small Git blob objects located both **exact original files** in the local object store. No SQL was guessed or recreated from the current schema. Their raw bytes were restored locally only after their hashes matched the live database history:

| Migration | Source Git blob | SHA-256 recorded by database and recovered file |
| --- | --- | --- |
| `20260511120000_menu_item_image_crop` | `cab2a59c96d886ecf64243db121db0f5f9542516` | `c6c95f3575fc5a445ba5ac23f1aa64be3d46df8c6d969bdce01c25160d178aab` |
| `20260512120000_ensure_menu_item_image_crop` | `83d00b9aac735132b0f781ce83cf2235824fe24a` | `35a7e20ee5fa3c7179b75839cf7c4e644b21066128754b6eb9c54e23d499ff65` |

The originals add `menu_items.image_crop` (the second uses `IF NOT EXISTS`). The already applied `20260513120000_drop_menu_item_image_crop` later removes that column; the live column is absent, consistent with that later migration. **Do not execute either recovered May file.** They are already applied history and are restored solely to repair local history completeness.

After restoring them, Prisma sees **43 local migrations**, no missing-history warning and exactly four pending migrations. `migrate status` exits 1 because pending migrations remain; that is expected and is not an unresolved failure. No database migration record was changed to obtain this result.

## July changes: read-only comparison against actual SQL

| Pending migration | Live findings | Decision |
| --- | --- | --- |
| `20260721120000_normalize_wing_flavour_sort_order` | Recomputed the migration's exact ranking expression: 75 qualifying rows inspected; **35 would change**. | Not already applied; leave pending. |
| `20260722100000_delivery_distance_pricing_base_fee` | Column default and the sole location's current delivery fee are **499 cents**, not 500. Its postal-code config is a JSON string containing a valid array, not a JSON array. | Its intended changes are not complete; leave pending. |
| `20260722113000_unique_provider_transactions` | Neither the named unique index nor an equivalent unique index on `(provider, provider_transaction_id)` exists. Only the payment PK and order lookup index exist. There are currently **zero duplicate non-null provider/transaction groups**. | Duplicate-free data does not substitute for the missing constraint; leave pending. |

No delivery fee, flavour ordering, postal configuration, payment row or payment index was modified. Do not mark any July migration applied. A general `db:deploy`/`migrate deploy` remains inappropriate for this task.

## Independent application is supported

The stamp-email SQL references only the existing `public.customer_wings_stamp_ledger(id)` UUID primary key. It has no dependency on the three July migrations. The connected role has public-schema USAGE/CREATE, REFERENCES privilege on the parent ledger, and BYPASSRLS; the locally configured API connection was independently checked as the same effective server role.

The local generated Prisma Client is **7.5.0** and contains `WingsStampGrantEmail` and its mapped fields. `AdminStampGrantsService` creates its pending row inside the grant transaction; `StampGrantEmailService` uses the same model after commit. Their source matches the proposed schema. The active Railway commit contains that model and its build logs confirm Prisma Client 7.5.0 generation; the exact deployment-snapshot database connection's role has now also been verified read-only. A table read using that role remains a post-creation check because the table is still absent.

Prisma supports applying reviewed SQL with [`db execute`](https://docs.prisma.io/docs/orm/v7/reference/prisma-cli-reference#db-execute), which does not modify migration history, then registering the already-completed change using [`migrate resolve --applied`](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/patching-and-hotfixing#reconciling-your-migration-history-with-a-patch-or-hotfix). These commands target this one file/name and do not execute the earlier pending migrations. Installed CLI help was checked. In this Prisma 7 version, `db execute` uses `--config`; it does **not** accept `--schema` or `--url`.

## Exact schema changes and reviewed files

The unchanged original migration is:

`packages/database/prisma/migrations/20261015180000_stamp_grant_email_tracking/migration.sql`

SHA-256: `f3e8b10cb2108681aa909561a15571a408e91877c39bc6912bd6523ccbf718a5`.

Its only durable operations are `CREATE TABLE wings_stamp_grant_emails` with its PK/FK and `ALTER TABLE wings_stamp_grant_emails ENABLE ROW LEVEL SECURITY`. CREATE TABLE also creates its PK index and foreign-key enforcement metadata. It performs no INSERT/UPDATE/DELETE on customer, order, payment, reward, ledger or settings tables.

| Column | PostgreSQL type | Required | Default |
| --- | --- | --- | --- |
| grant_id | UUID | Yes, primary key | None |
| status | TEXT | Yes | PENDING |
| payload_json | JSONB | No | None |
| first_attempt_at | TIMESTAMPTZ(6) | No | None |
| lease_until | TIMESTAMPTZ(6) | No | None |
| attempt_token | UUID | No | None |
| sent_at | TIMESTAMPTZ(6) | No | None |
| provider_email_id | TEXT | No | None |
| last_error | TEXT | No | None |
| created_at | TIMESTAMPTZ(6) | Yes | CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ(6) | Yes | CURRENT_TIMESTAMP |

Constraints: `wings_stamp_grant_emails_pkey(grant_id)` and `wings_stamp_grant_emails_grant_id_fkey`, referencing `customer_wings_stamp_ledger(id)` with ON DELETE CASCADE / ON UPDATE CASCADE. RLS is enabled, not forced; no public access policies are added. The trusted server role bypasses RLS. No new grants, policies or changes to existing loyalty data are required.

Prepared operational wrapper: `.local/stamp-email-reviewed-apply.sql` (ignored local artifact, **not an additional Prisma migration**). It contains the exact original migration bytes unchanged, surrounded by:

1. BEGIN and local 5-second lock timeout / 30-second statement timeout / public search path.
2. Preconditions: expected database/role, absent target table, existing parent, no active target history record or unresolved failures, create/reference privileges.
3. The existing migration's unchanged DDL.
4. Assertions for all 11 columns, types/nullability/defaults, exact PK/FK columns and actions, RLS enabled with zero policies, ownership and trusted role access, and an initially empty tracking table.
5. COMMIT only after all assertions pass. An assertion failure aborts the transaction.

Wrapper SHA-256: `3a67bfb45c5be232690bc61dc735a5ce655b2e5a3805a124ffd564962ba53670`.

Prepared independent read-only postflight: `.local/stamp-email-verify.sql`. It returns metadata, permissions, migration state and a tracking-row count without reading recipients or email payloads. Neither prepared SQL file has been executed against the database. Their transaction/assertion SQL has been reviewed but not integration-tested on a disposable PostgreSQL instance.

## Execution procedure — requires fresh preflight and explicit approval

**Do not run these commands now.** Before execution: confirm the project/environment and Railway role/artifact, verify backup coverage, coordinate the short grant/migration pause, obtain approval and ideally rehearse the wrapper against a disposable schema-equivalent database. Recheck current migration rows/table absence/permissions and both hashes immediately before executing; stop on any new discrepancy.

Commands below run in PowerShell from `D:\Projects\Websites\Wings4U\Code\packages\database`, use the installed local Prisma CLI, and use the unchanged `prisma.config.ts` connection precedence. Confirm the shell's environment has not overridden the approved target. Never print secret URLs.

```powershell
# Local file-integrity checks only; these do not connect to the database.
if ((Get-FileHash -LiteralPath 'prisma/migrations/20261015180000_stamp_grant_email_tracking/migration.sql' -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'f3e8b10cb2108681aa909561a15571a408e91877c39bc6912bd6523ccbf718a5') { throw 'Migration SQL changed; stop' }
if ((Get-FileHash -LiteralPath '../../.local/stamp-email-reviewed-apply.sql' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3a67bfb45c5be232690bc61dc735a5ce655b2e5a3805a124ffd564962ba53670') { throw 'Reviewed wrapper changed; stop' }

# FIRST PRODUCTION WRITE — only after approval and all prerequisites pass.
node ../../node_modules/prisma/build/index.js db execute --config prisma.config.ts --file ../../.local/stamp-email-reviewed-apply.sql
if ($LASTEXITCODE -ne 0) { throw 'DDL outcome must be inspected before retry or history resolution' }
```

**Stop between DDL and history registration.** Run `.local/stamp-email-verify.sql` through the existing `pg` driver/trusted SQL client in a read-only transaction against the verified project. Prisma `db execute` is not a query-results viewer, so do not use it as evidence of returned metadata. Independently confirm every column/default, PK/FK, RLS/policies, owner, API-role privileges and no active target history record. An actual-role read can safely use `SELECT grant_id FROM public.wings_stamp_grant_emails LIMIT 0`; do not insert test rows to test write privileges. Save the results. If ANY intended schema change is missing, do not mark applied.

Only after DDL success and independent verification:

```powershell
# SECOND PRODUCTION WRITE — supported registration of the already-verified change.
node ../../node_modules/prisma/build/index.js migrate resolve --config prisma.config.ts --applied 20261015180000_stamp_grant_email_tracking
if ($LASTEXITCODE -ne 0) { throw 'Inspect migration history; do not reapply SQL' }

# Read-only status; exit 1 is expected while the three July migrations stay pending.
node ../../node_modules/prisma/build/index.js migrate status --config prisma.config.ts
```

The second write adds only the target migration's supported Prisma history record. It must have the original migration checksum, finished_at set and rolled_back_at null. It must not rewrite the May records or mark the July migrations. Prisma resolution is intentionally separate from the DDL transaction; see the recovery cases below.

Final read-only postflight must show:

- New table with all reviewed metadata, PK/FK and RLS, zero public policies, and expected trusted server-role permissions.
- Exactly one successful target migration record with SHA-256 `f3e8b10cb2108681aa909561a15571a408e91877c39bc6912bd6523ccbf718a5`.
- Both restored May migrations remain successful with their original checksums. All pre-existing history rows retain their statuses/checksums.
- Exactly the **three July migrations remain pending**; no unresolved failed rows and no missing-history warning.
- Delivery default/fee still 499, postal configuration remains unchanged, payment index inventory unchanged, and no flavour-ordering DML was executed. Normal live business activity can change counts, so count equality alone must not be claimed as proof of unchanged business data; the reviewed SQL contains no business-data writes.
- Local/deployed Prisma table reads work through the actual API DB role, without granting stamps or sending email. Do not claim inbox delivery or full feature readiness from a schema-only check.

## Risks and rollback/recovery

- **Backup and approval gates:** the Wings4U Railway target/role and the one-time logical export below are verified. Archive readability is verified, but a restore rehearsal, provider backup/PITR and off-device coverage are not. Backup authorization is not migration authorization; explicit approval for the targeted DDL and subsequent verified history registration is still required.
- **Concurrent migrations:** stop other migration/deployment jobs; these two commands are not one distributed atomic operation. Do not run a general deploy as a shortcut.
- **Parent lock:** adding a foreign key can briefly lock the existing stamp ledger and contend with activity. A 5-second lock timeout makes the transaction fail rather than wait indefinitely; choose a quiet window. No parent rows are changed.
- **Error before COMMIT:** the explicit transaction rolls back table/index/FK/RLS creation and verification assertions. No history registration should be attempted. Confirm absence/status via a fresh read-only connection before retry.
- **Network loss / uncertain COMMIT:** do not assume rollback. Inspect table and history on a fresh connection. If absent, re-preflight before any retry. If complete, do not replay CREATE TABLE; proceed only to verification and supported history registration. If partial/unexpected, stop for investigation.
- **DDL committed, resolve failed:** keep the complete table. Verify it independently and retry **only** `migrate resolve --applied` if no successful target row exists. Never mark applied to hide a schema failure. Never execute the July migrations to repair this gap.
- **Resolve succeeded but its response was lost:** verify the successful row and checksum and do not invoke resolution again if already applied.
- **Problems after successful registration:** retain the table/history and fix forward. Do not drop the table once real grant emails can exist. Any compensating schema migration/export/restore needs a separately approved plan. Never DELETE/UPDATE migration history manually, and do not try to mark a successfully applied migration rolled back with the failed-migration resolution command.
- **Lost/expired email state:** dropping tracking rows can defeat delivery idempotency, so preserving any real notification records takes priority over returning the schema to its previous shape.

## Application and notification readiness

Resend key/from variables are present both locally and in the active production deployment snapshot; no provider call was made and provider-side validity is not claimed. Neither `PUBLIC_SITE_URL` nor API-side `NEXT_PUBLIC_SITE_URL` is configured locally or in the active snapshot. Database readiness is separate from email readiness: the missing public URL currently causes an honest email skip. Configure and verify the API's canonical HTTPS origin and verified sender through a separately approved configuration/deployment change before a later controlled-recipient email test. No configuration change, API redeploy, real grant or email is included in this procedure.

## Local changes from this investigation

- Restored the two exact May `migration.sql` files as untracked local files.
- Added this report and two ignored operational SQL artifacts under `.local/`.
- Preserved the previously uncommitted mobile heading/spacing change in `apps/application/src/screens/menu-screen.tsx`.
- Nothing was staged, committed, pushed, deployed or written to the production database.

## Final pre-execution checklist

The final review retained the existing SQL and both pinned hashes unchanged. All checks below are either verified read-only or are explicitly pending; no step authorizes execution.

| Check | Final status |
| --- | --- |
| Handle Supabase `qdzwgollskyflllhdixs` as production | Confirmed by owner's instruction and verified Railway production environment/active deployment snapshot. |
| Original stamp migration and guarded wrapper unchanged | Verified against both pinned SHA-256 hashes; wrapper contains the exact original SQL bytes. |
| Scope only table / 11 columns / PK / FK / RLS | Reviewed. No business-data DML; no July SQL or migration registration in the wrapper. |
| Transaction and lock limits | BEGIN/COMMIT with 5s lock timeout, 30s statement timeout, preconditions and pre-commit metadata assertions reviewed. Not integration-tested on a disposable PostgreSQL instance. |
| Existing applied history | Fresh read-only check: all 39 applied migration file checksums match; zero unresolved failed records. |
| Stamp table and target history absent | Fresh read-only check: table absent and zero target migration records. |
| July history untouched | Fresh read-only check: no history records for any of the three pending July migrations. Leave all three unapplied. |
| Locally configured database role | Fresh read-only check: effective role postgres, BYPASSRLS true, public schema USAGE/CREATE true, parent-ledger REFERENCES true. This does not establish Railway's role. |
| Wings4U production Railway DATABASE_URL / fallback DIRECT_URL | **Verified:** correct project/service/production environment and api.wings4ulondon.ca binding. Active deployment snapshot points both database settings to the expected Supabase project; a read-only connection using its DATABASE_URL confirms effective postgres role and BYPASSRLS. |
| Deployed API Prisma client and role access | **Verified source/build compatibility:** active commit ffb913e includes the model and its build logs confirm Client 7.5.0 generation. Schema USAGE/CREATE and parent REFERENCES privileges verified through the active snapshot connection. New table access remains a post-creation check. |
| Recent backup / PITR and recovery steps | **Logical archive verified:** one full pg_dump export, including all 78 public table-data entries, with successful full-read verification and SHA-256. Restore rehearsal, PITR and off-device coverage remain unverified. See evidence below. |
| No competing deployment/migration/manual grant activity | **Pending:** coordinate execution window. |
| Explicit approval to execute only the stamp-email DDL and subsequent verified Prisma registration | **Not granted; execution remains paused.** |

Additional review notes: `current_database() = 'postgres'` and `current_user = 'postgres'` are useful guards but do not uniquely identify a Supabase project. The correct identity has now been verified from the active deployment snapshot and must be rechecked immediately before execution. The wrapper checks the executing role; the matching Railway role was independently verified through the snapshot connection. SQL application and Prisma registration are two separate writes, so preserve the table and verify before retrying registration if the second step fails. No general deployment command is part of this plan. No migration or history-resolution operation has been run following these read-only checks.

## One-time backup evidence — 2026-10-16

The owner explicitly authorized a full `pg_dump` backup outside the repository, with no production restore and no migration execution. The previously verified Wings4U local DIRECT_URL was checked against the expected Supabase project, session-pooler host, port and database before use. The database reported PostgreSQL 17.6 and effective role postgres. This backup run did not independently refresh Railway authorization or read another project's variables.

- Archive: `C:\Users\Amber\AppData\Local\Wings4U\DatabaseBackups\2026-10-16T04-26-49-406Z\wings4u-production.dump`
- Size: **812,078 bytes** (approximately 793 KiB).
- Export started: **2026-10-16T04:26:49.406Z**. Export completed: **2026-10-16T04:27:00.561Z** (**00:27:00.561 America/Toronto, EDT**). Full-read verification completed: **2026-10-16T04:27:29.436Z**.
- SHA-256, independently rechecked after verification: `20dece86b694e0f84e6022813da85da969686b6634fa438fec6820d7f8c1547c`.
- PostgreSQL 17.11 portable client binaries were obtained from EDB's official download link. No database server was installed or started. The client ZIP SHA-256 is `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`; this is a locally computed integrity identifier, not a vendor signature claim.
- `pg_dump --format=custom --no-password --verbose --lock-wait-timeout=10s --file=<private archive>` ran without schema/table/data exclusions, with `default_transaction_read_only=on` enforced in its connection environment. Exit code **0**, **zero warnings**. Credentials were supplied through a private temporary password file, never process arguments or output; the file was removed and its absence verified.
- `pg_restore --list <archive>` succeeded. There are **1,090 archive entries** and **116 table-data entries**: auth 27, public 78, realtime 2, storage 8, vault 1. All inventoried ordinary non-extension tables have table-data entries; partition parents do not require their own data entry. Public includes the existing application and Prisma migration-history tables.
- `pg_restore --file=- <archive>` succeeded with stdout discarded and no database connection parameters or credentials. This read and decompressed the whole archive into SQL without executing it. It is a readability check, **not a restore rehearsal**.
- The archive's Windows ACL was independently verified to allow only the current Windows account and SYSTEM; its private root has inheritance disabled. The archive, inventory, table of contents, logs and credential-free `manifest.json` are outside the repository. Nothing was uploaded, staged, committed or pushed.
- The initial verification runner stopped before its full-read stage because of an exclusive-create log-file flag. The flag was corrected locally, and verification resumed against the **same completed archive**. A second export was not run. Both final archive checks passed.

Recovery coverage: a consistent single-database logical snapshot, including all public data, other dumpable non-system schema/data, sequences, constraints, functions, triggers, RLS and ownership/grant metadata under pg_dump's normal extension-member handling. Future recovery should first be rehearsed in an isolated compatible PostgreSQL/Supabase environment using the matching client, required extension versions and roles, with application validation before any separately approved production recovery. The archive does **not** provide cluster-wide roles/passwords, server configuration, WAL/PITR, external Supabase Storage file contents or an off-device copy. No production restore has been performed or authorized.

A fresh read-only check after backup still shows the stamp-email table absent, zero stamp-email migration-history rows and zero history rows for the three July migrations. Both reviewed SQL hashes remain unchanged. No production schema, business records or migration history were modified. **Stop here for explicit approval before executing only the guarded stamp-email SQL and, after independent schema verification, its supported Prisma history registration.**
