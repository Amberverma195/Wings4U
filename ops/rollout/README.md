# Rollout

## Release order (recommended)

1. **Backup** Postgres (see [../backups/README.md](../backups/README.md)).
2. **Migrate:** `DATABASE_URL=… npm run db:deploy` (applies Prisma migrations in [`packages/database`](../../packages/database)).
3. **Deploy API** (Nest): ensure `PORT`, `DATABASE_URL`, `REDIS_URL` (if used) are set.
4. **Deploy web** (Next): set `API_PROXY_TARGET` / server env so `/api/*` rewrites target the live API origin.
5. **Smoke:**
   - `GET https://<api-host>/api/v1/health`
   - Spot-check customer flow: menu (`GET /api/v1/menu` + `X-Location-Id`) if catalog is live.

## Rollback

- **Application:** redeploy previous API/web artifacts (keep one previous image/tag).
- **Database:** avoid down-migrations in prod unless a migration is explicitly reversible; prefer restore from backup if a bad migration shipped.

## Feature flags / config

Document any location-specific toggles in [`location_settings`](../../Docs/Wings4U_schema_v1_4_postgres_FINAL.sql) (or admin UI when implemented) per runbook needs (e.g. trusted IP ranges for POS).
