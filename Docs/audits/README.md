# Audits

**Last updated:** 2026-03-24

This folder holds **repository audit notes**. The file you are reading is the **current implementation audit summary** — it replaces an older snapshot that described the repo as mostly stubbed and mentioned a CSRF bypass for device tokens; that no longer matches the code.

**Canonical “what’s still wrong”:** [`../procedures/issues/issues.md`](../procedures/issues/issues.md)  
**Canonical progress log:** [`../procedures/tasks.md`](../procedures/tasks.md)

---

## 1. Executive snapshot

| Area | Current read |
|------|----------------|
| **Monorepo** | Workspaces (`apps/*`, `packages/*`); `npm run build:api`, `npm run build:web`, and `npm run ci` (or equivalent) are the primary gates. |
| **API surface** | Real modules for auth (OTP, refresh, logout, POS login), catalog/menu, cart quote, checkout (idempotent), orders (list/detail/cancel), KDS, drivers, timeclock, chat, support tickets, admin, refunds, wallets, realtime, health. |
| **E2E** | Jest + Supertest against a **dedicated test DB** with global setup (migrate + truncate + seed). The suite is intended as a regression check when configured; see [`../../apps/api/test/`](../../apps/api/test/) and Progress Entry 39–40 in `tasks.md`. |
| **Web (`apps/web`)** | Customer flows: menu → cart → checkout; order tracking and “My Orders”; order detail with cancel window, realtime status, order chat, and support ticket entry on terminal orders — not placeholder stubs. |
| **Open risk** | Wallet/refund ledger `entry_type` vs SQL CHECK — **Issue 1** in `issues.md`. |

---

## 2. Security & middleware (audited behavior)

### CSRF ([`apps/api/src/common/middleware/csrf.middleware.ts`](../../apps/api/src/common/middleware/csrf.middleware.ts))

- Applies to mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`).
- If a `csrf_token` cookie is present, the request must send a matching `X-CSRF-Token` header or the API returns **403** with the standard error envelope.
- **Skips** (by path prefix only): `POST` flows under `/api/v1/auth/otp` and `/api/v1/auth/pos/login` so the browser can obtain cookies before CSRF is available.
- **There is no device-token CSRF bypass.** The former `X-Device-Token` branch was removed (see Progress Entry 37 in `tasks.md`).

### Auth ([`apps/api/src/modules/auth/`](../../apps/api/src/modules/auth/))

- **Not stubs:** OTP request/verify, token refresh, logout, POS employee login — implemented with cookie/JWT behavior in `auth.controller.ts` + `auth.service.ts` (see repo for current routes and guards).

### App bootstrap ([`apps/api/src/app.setup.ts`](../../apps/api/src/app.setup.ts))

- Shared configuration for production and e2e: prefix `api/v1`, envelopes, validation, CORS, cookies, CSRF middleware, request id, etc.
- **Health** is public (`@Public()` on health controller) so unauthenticated probes work.

### Roles

- Global `RolesGuard` enforces `@Roles()` where applied; health and other `@Public()` routes stay accessible without a session.

---

## 3. Domain implementation (high level)

These are **real services backed by Prisma**, not placeholder controllers:

| Module | Role |
|--------|------|
| **Cart** | `POST /cart/quote` — pricing/validation against menu and location rules. |
| **Checkout** | `POST /checkout` — idempotency, order creation, integrates with checkout pipeline. |
| **Orders** | List, detail (items, events, payments), customer cancel within `cancel_allowed_until`, chat close on cancel. |
| **Chat** | Order-scoped messages, sender surface derived from auth, terminal-order closure, realtime emits. |
| **Support** | Ticket create/list/detail, messages, staff-only flows where applicable. |
| **Realtime** | Socket.IO gateway; channels such as `order:{id}`, `chat:{order_id}`, location-scoped feeds — see gateway implementation. |

For exact request/response shapes, treat **[`Docs/API_Spec/`](../../Docs/API_Spec/)** (and the duplicate under `Docs/`) as the contract reference.

---

## 4. Web client alignment

| Concern | Implementation |
|---------|------------------|
| **HTTP** | [`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts) — `credentials: "include"`, CSRF header when cookie exists, optional `X-Location-Id`. |
| **Realtime** | [`apps/web/src/lib/realtime.ts`](../../apps/web/src/lib/realtime.ts) — `socket.io-client` to API origin, path `/ws`; used for order and chat updates on tracking surfaces. |
| **Env** | `API_PROXY_TARGET`, `NEXT_PUBLIC_REALTIME_ORIGIN`, `NEXT_PUBLIC_DEFAULT_LOCATION_ID` — see `apps/web/next.config.ts` and `src/lib/env.ts`. |

---

## 5. Verification commands (maintainer expectations)

From the repository root (after `npm install`):

| Goal | Command |
|------|---------|
| API compile | `npm run build:api` |
| Web compile | `npm run build:web` |
| Full CI script | `npm run ci` — see root [`package.json`](../../package.json) (`db:generate` → builds → `test:e2e`) |
| API e2e | `npm run test:e2e` — requires a configured test database (e.g. `apps/api/test/.env.test`); see `tasks.md` Progress Entry 39. |

---

## 6. Honest gaps (not “everything is stubs”)

1. **Money path:** Wallet/refund ledger alignment — **`issues.md` Issue 1**; treat wallet-heavy flows as unproven until fixed and retested.
2. **Production hardening:** Rate limits, full observability story, and production cookie domains may still need work — see [`ops/`](../../ops/) and root README.
3. **Optional packages:** Some workspace packages (`packages/pricing`, `packages/contracts`, `apps/print-agent`, etc.) may be partially integrated; rely on `package.json` scripts and CI for what is actually enforced.

---

## 7. How to use this document

- **For auditors:** Start with §1–§3, then confirm against `issues.md` and a green `build:api` + `build:web` (+ e2e if DB available).
- **For historians:** Older narrative in git history described “stub-only” routes and a device-token CSRF exception; that predates the current auth, CSRF, checkout, orders, and web flows above.

Add **new dated audit files** under `Docs/audits/` (e.g. `2026-03-security-review.md`) when you run a formal review; keep this `README.md` as the rolling **current summary** unless superseded by an explicit doc migration.
