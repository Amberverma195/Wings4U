# Backups

## Postgres (canonical data store)

**Local dev** (compose defaults from [`infra/docker/docker-compose.dev.yml`](../../infra/docker/docker-compose.dev.yml)):

- Host: `localhost:5432`
- Database: `wings4u`
- User / password: `postgres` / `postgres`

### Logical backup (dump)

```bash
pg_dump -h localhost -U postgres -d wings4u -Fc -f wings4u_$(date +%Y%m%d).dump
```

### Restore (into empty DB)

```bash
pg_restore -h localhost -U postgres -d wings4u --clean --if-exists wings4u_YYYYMMDD.dump
```

## Schema migrations

Application schema is owned by Prisma in [`packages/database`](../../packages/database):

- Baseline SQL: `prisma/migrations/*/migration.sql`
- Deploy: `npm run db:deploy` (from repo root)

Take a backup **before** running `db:deploy` in production.

## Drill checklist

1. Restore dump to a scratch database.
2. Run `npm run db:deploy` against scratch DB (idempotent if already applied).
3. Smoke `GET /api/v1/health` against an API instance pointed at scratch DB.
