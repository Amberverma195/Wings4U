# Wings 4 U Platform

Repository for the Wings4U product: multi-surface ordering, in-store ops, payments, chat, and support. Canonical specs live under `Docs/` (API Contract v1.0, Postgres schema v1.4, Prisma mirror).

## Structure

- `Docs/`: product, architecture, schema, API, and review-log documents.
- `Docs/logs`: issue and fix tracking notes.
- `Docs/audits`: audit notes and review artifacts.
- `apps/web`: Next.js customer and operations routes; dev proxy to API (`/api/*`).
- `apps/api`: NestJS API (`/api/v1` JSON envelope, CSRF for browser mutating requests, `X-Location-Id` on scoped routes, Socket.IO at `/ws`).
- `apps/print-agent`: local print/drawer agent placeholder.
- `packages/contracts`: shared cross-surface contracts and enums.
- `packages/database`: Prisma schema, client, and migrations (baseline aligned to schema v1.4).
- `packages/pricing`: money-engine package placeholder.
- `infra/docker`: local Postgres and Redis (`docker-compose.dev.yml`).
- `ops`: monitoring, backup, rollout notes, and runbooks (aligned to current endpoints and schema).
- `frontend`, `backend`, `api`, `db`, `audits`: organizational anchors.

## Current status

- **Database:** Prisma schema mirrors [`Docs/schema.prisma`](Docs/schema.prisma); initial migration under [`packages/database/prisma/migrations`](packages/database/prisma/migrations). Run `npm run db:generate` / `npm run db:migrate` / `npm run db:deploy` from the repo root.
- **API:** Core cross-cutting behavior (envelope, exception mapping, CSRF, location guard) plus stub routes for auth, menu, cart quote, checkout, orders, and health. Point `DATABASE_URL` at Postgres when using Prisma at runtime.
- **Web:** Home page checks `GET /api/v1/health` (via proxy); menu and cart call `GET /api/v1/menu` and `POST /api/v1/cart/quote`. Realtime strip connects Socket.IO to `NEXT_PUBLIC_REALTIME_ORIGIN` (default `http://127.0.0.1:3001`). Copy [`apps/web/.env.example`](apps/web/.env.example).

## Quick start (dev)

1. `docker compose -f infra/docker/docker-compose.dev.yml up -d` (Postgres + Redis).
2. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wings4u npm run db:migrate` (or `db:deploy` in CI).
3. `npm run dev:api` (port `3001` by default) and `npm run dev:web` (port `3000`).

## Verify the monorepo (install → build → test)

From repo root after `npm install`:

| Command | Purpose |
|---------|---------|
| `npm run build:api` | Nest compile |
| `npm run build:web` | Next production build |
| `npm run test:e2e` | Jest e2e: hits `GET /api/v1/health` with full HTTP stack |
| `npm run ci` | `db:generate` + database package build + API + web + e2e (same as GitHub Actions) |

CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Audit log: [`Docs/audits/README.md`](Docs/audits/README.md).
