# Procedures Rules

## Simple Rule For Future Updates


## add this in tasks.md file in procesdured folder
Whenever a meaningful task is completed:

1. Add the new finished item under the latest dated entry.
2. Move the related next step into a smaller remaining task.
3. Write the update in plain English first, then technical detail second.

---

## Non-Negotiable Rules Going Forward

### Rule 1

**No module invents schema.**

If auth needs a column that does not exist in Schema Spec/SQL/Prisma, it does not get to just "add it in code mentally."

### Rule 2

**No doc-only schema changes.**

If schema spec changes, Prisma and migration path must change too.

### Rule 3

**No Prisma-only secret changes.**

If someone edits `schema.prisma` without updating the schema spec / migration path, that is drift.

### Rule 4

**No old v1.0 references survive.**

Kill them. Dead. Buried. Not "kept for context."

### Rule 5

**Postgres truth, Prisma execution, shared docs ownership.**

### Rule 6
 **Any schema change must update, in the same PR:**
**SQL baseline or migration**
**schema.prisma**
**Schema Spec if the design changed**
**API contract if request/response or enum meaning changed**

### Rule 7

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


That is the whole model.
