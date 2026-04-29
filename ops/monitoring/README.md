# Monitoring

## HTTP health (Nest API)

- **Endpoint:** `GET /api/v1/health`
- **Expected:** JSON envelope `{ "data": { "status": "ok", "service": "api" }, "meta": { "request_id": "…" }, "errors": null }`
- **Default dev port:** `3001` (see `PORT` in [`apps/api/src/config/env.ts`](../../apps/api/src/config/env.ts))

Use this for load-balancer / orchestrator probes. Prefer **GET** (no CSRF, no `X-Location-Id`).

## Process checks

| Process | Role |
|---------|------|
| Nest API (`npm run dev:api`) | REST + Socket.IO (`/ws`) |
| Next web (`npm run dev:web`) | UI; proxies `/api/*` to API in dev ([`apps/web/next.config.ts`](../../apps/web/next.config.ts)) |
| Postgres / Redis | [`infra/docker/docker-compose.dev.yml`](../../infra/docker/docker-compose.dev.yml) |

## Future metrics

When adding Prometheus/OpenTelemetry, instrument:

- Request latency and 5xx rate on `/api/v1/*`
- WebSocket connection count on `/ws`
- Queue/worker depth if background jobs are enabled (`apps/api` jobs module)
