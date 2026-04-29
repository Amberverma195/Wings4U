# DB

Workspace anchor for database design and migration-related work.

## Current status against the checklist

- Real Prisma package: done at [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma)
- Prisma 7 CLI config: done at [`packages/database/prisma.config.ts`](../packages/database/prisma.config.ts)
- Baseline SQL file: done at [`db/sql/0001_wings4u_baseline_v1_4.sql`](sql/0001_wings4u_baseline_v1_4.sql)
- Prisma helper scripts: done in [`package.json`](../package.json) and [`packages/database/package.json`](../packages/database/package.json)
- Drift check process: documented below and still required before backend module work starts

## Recommended baseline structure

```text
db/
  sql/
    0001_wings4u_baseline_v1_4.sql
    0002_manual_sql_patches.sql   # support expansion
    0003_timeclock_schema_expansion.sql
    patch2.sql                    # same DDL as 0003 — short name for Supabase SQL editor
packages/
  database/
    prisma/
      schema.prisma
      seed.ts
    prisma.config.ts
```

### Ongoing schema changes (patches + SQL editor)

**Team workflow from here:** define schema deltas as **numbered patch files** under `db/sql/` (e.g. `0003_add_foo.sql`), then **run each patch in the Supabase SQL Editor** (or `psql`) against the live database when you deploy that change. Patches should be **idempotent or clearly one-shot** (use transactions; document if not re-runnable).

**Also do on every schema change:**

1. Update [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma) and run `npm run db:generate`.
2. Follow [`Docs/procedures/rules.md`](../Docs/procedures/rules.md) for task logging and drift checks.

**Greenfield / new databases:** either (a) keep folding accepted DDL into [`0001_wings4u_baseline_v1_4.sql`](sql/0001_wings4u_baseline_v1_4.sql) so a single `psql -f 0001` still matches production, **or** (b) document that new environments must apply `0001` then `0002`, `0003`, … in order. If you only add patches and never update the baseline, a fresh install from `0001` alone will **not** match a patched Supabase instance.

## What Is Canonical

Use this source-of-truth hierarchy:

1. SQL + Schema Spec are the canonical design reference.
2. [`db/sql/0001_wings4u_baseline_v1_4.sql`](sql/0001_wings4u_baseline_v1_4.sql) is the stable baseline used to create a fresh database.
3. [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma) is the executable Prisma app model that must mirror that baseline.
4. [`packages/database/prisma.config.ts`](../packages/database/prisma.config.ts) is the Prisma 7 CLI connection/config file.
5. [`packages/database/prisma/seed.ts`](../packages/database/prisma/seed.ts) is the starter seed entry point for future local/demo data.

Canonical schema sources (v1.4):

- SQL baseline for fresh database creation: [`db/sql/0001_wings4u_baseline_v1_4.sql`](sql/0001_wings4u_baseline_v1_4.sql)
- SQL design reference / upstream source: [`Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`](../Docs/Wings4U_schema_v1_4_postgres_FINAL.sql)
- Prisma executable app model: [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma)
- Prisma 7 CLI config: [`packages/database/prisma.config.ts`](../packages/database/prisma.config.ts)
- Seed entry point: [`packages/database/prisma/seed.ts`](../packages/database/prisma/seed.ts)

Application migrations and the Prisma client are owned by [`packages/database`](../packages/database).

## How The Database Is Created

1. Create database.
2. Run baseline SQL.
3. Run Prisma DB pull if regenerating schema.
4. Run Prisma generate.
5. Start backend.

```bash
createdb wings4u_local
psql "$DATABASE_URL" -f db/sql/0001_wings4u_baseline_v1_4.sql
npx prisma db pull --schema packages/database/prisma/schema.prisma   # optional when regenerating schema
npm run db:generate
npm run dev:api
```

### Existing database (e.g. Supabase) — support ticket expansion (2026-03-22)

If your database was created **before** the support schema expansion was folded into `0001`, open **Supabase → SQL Editor** (or any PostgreSQL client), paste and run:

[`db/sql/0002_manual_sql_patches.sql`](sql/0002_manual_sql_patches.sql)

Then regenerate the Prisma client (`npm run db:generate`). If `DROP CONSTRAINT` fails because PostgreSQL used a different constraint name, list check constraints with:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'support_tickets'::regclass AND contype = 'c';
```

(and the same for `support_ticket_events`).

### Existing database — timeclock expansion (2026-03-22)

If your database was created **before** the timeclock schema was folded into `0001`, run **either**:

- [`db/sql/patch2.sql`](sql/patch2.sql) *(short name, easy to find in SQL editor)*, **or**
- [`db/sql/0003_timeclock_schema_expansion.sql`](sql/0003_timeclock_schema_expansion.sql) *(same content)*

Then run `npm run db:generate`. Apply **after** `0002` if you still need the support patch.

## Prisma 7 Connection Rules

- [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma) now declares the database provider only. It no longer stores `url = env("DATABASE_URL")`.
- [`packages/database/prisma.config.ts`](../packages/database/prisma.config.ts) is now the CLI connection entry point for Prisma 7.
- `DIRECT_URL` is the preferred Prisma CLI connection variable.
- `DATABASE_URL` is still the runtime connection variable used by the Nest API and other app code.
- The current config falls back to `DATABASE_URL` if `DIRECT_URL` is not set, so local tooling still works while a separate direct URL is being introduced.

## How Prisma Is Generated

Use the Prisma schema at [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma).

Normal flow:

```bash
npm run db:validate
npm run db:generate
```

Only if you are regenerating Prisma from a real database state:

```bash
npm run db:pull
npm run db:validate
npm run db:generate
```

## How Drift Is Checked

After the baseline SQL has been applied and Prisma has been validated/generated, run:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/database/prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL"
```

Pass condition:

- no unexpected diff

If there is drift, fix it before starting auth, menu, orders, payments, or any other backend module work.`r`n`r`nThis script uses the Prisma 7 config at `packages/database/prisma.config.ts`, so it reads the real connection details from your configured environment instead of hardcoding secrets in the repo.

## What To Update When The Schema Changes

Whenever the schema changes, update in this order:

1. Update the canonical schema design first:
   - [`Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`](../Docs/Wings4U_schema_v1_4_postgres_FINAL.sql)
   - related schema/spec docs if the design changed
2. Update the repo baseline copy:
   - [`db/sql/0001_wings4u_baseline_v1_4.sql`](sql/0001_wings4u_baseline_v1_4.sql)
3. Update the Prisma executable model:
   - [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma)
4. Re-run the database proof steps:
   - baseline apply
   - `npm run db:validate`
   - `npm run db:generate`
   - drift check
5. Update Prisma 7 connection/config if needed:
   - [`packages/database/prisma.config.ts`](../packages/database/prisma.config.ts)
   - [`.env.example`](../.env.example)
6. Update documentation that depends on the schema:
   - [`Docs/procedures/tasks.md`](../Docs/procedures/tasks.md)
   - audit/review notes if the change affects implementation status

Simple rule:

- SQL / Schema Spec changes first
- Prisma mirrors them second
- Prisma config stays aligned with the chosen connection strategy
- drift check proves they still match

