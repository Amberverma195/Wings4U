# SQL baseline

This folder documents the baseline database story for Wings4U.

## Recommended baseline structure

```text
db/
  sql/
    0001_wings4u_baseline_v1_4.sql
    0002_manual_sql_patches.sql   # add only if a real unsupported feature requires it
packages/
  database/
    prisma/
      schema.prisma
      seed.ts
    prisma.config.ts
```

## Current source-of-truth roles

- SQL baseline for fresh database creation: `db/sql/0001_wings4u_baseline_v1_4.sql`
- Upstream canonical SQL reference: `Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`
- Prisma executable app model: `packages/database/prisma/schema.prisma`
- Prisma 7 CLI config: `packages/database/prisma.config.ts`
- Seed entry point for starter data work: `packages/database/prisma/seed.ts`

## New developer / CI flow

1. Create a PostgreSQL database.
2. Run the baseline SQL.
3. Run Prisma DB pull only if you are regenerating Prisma from the live database.
4. Run Prisma generate.
5. Start the backend.

### Commands

```bash
createdb wings4u_local
psql "$DATABASE_URL" -f db/sql/0001_wings4u_baseline_v1_4.sql
npx prisma db pull --schema packages/database/prisma/schema.prisma   # only if regenerating schema
npm run db:generate
npm run dev:api
```

## Prisma 7 note

- `schema.prisma` no longer stores the CLI connection URL.
- `packages/database/prisma.config.ts` now owns Prisma CLI connection settings.
- `DIRECT_URL` is the preferred Prisma CLI environment variable.
- `DATABASE_URL` is still the runtime app connection string.

## Practical rule

The SQL baseline is the first proof that a clean database can be created.
Prisma is the executable app model used by the backend after that baseline exists.
Use manual SQL patch files only when a real PostgreSQL feature cannot be expressed safely in Prisma.
