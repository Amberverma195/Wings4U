# Wings4U Task Tracker

Last updated: 2026-04-08

## Purpose

This file explains:

1. What work has already been completed.
2. What still needs to happen next.
3. What the current status means in plain English for non-technical readers.

Use this file as the simple progress page for product, operations, and development.

---

## How to read this file (verified reality first)

**Source of truth for what is still broken or unproven:** [`issues.md`](./issues/issues.md) and [`todo.md`](./todo.md). If this file disagrees with those, trust `issues.md` first.

**Status vocabulary (use this mentally for each area):**

| Label | Meaning |
|---|---|
| **Implemented** | Code paths exist and compile; behavior may still be unproven. |
| **Partially verified** | Some checks passed (e.g. `tsc`, manual spot checks) but not full automated proof. |
| **Blocked** | Open issue in `issues.md` or contradictory work in `todo.md` prevents calling the area trustworthy. |
| **Verified** | Code + schema/contracts agree + proof passed (e.g. green e2e on deterministic data, or an agreed targeted run). |

**Promotion rule — do not treat an area as “done” in this log unless all of these are true:**

1. The code path exists and matches the canonical schema/contracts.
2. There is **no** open matching issue in [`issues.md`](./issues/issues.md) for that area.
3. There is **no** contradictory open item in [`todo.md`](./todo.md).
4. Verification actually passed (green e2e or another recorded proof), not only “implemented.”

**Implemented ≠ verified.** Entries below describe implementation history; they are not a guarantee the full system is safe to build on until the open issues are closed and tests are green.

---

## Quick Decision Summary

| Question | Current answer | Plain-English meaning |
|---|---|---|
| Can the team continue coding? | Yes | The repo is beyond stub stage: substantial backend modules exist, builds succeed, and most areas are **implemented**. |
| Can this go to production today? | No | API e2e is green on deterministic seed data (Progress Entry 40), but at least one money-path schema alignment is still open ([`issues.md`](./issues/issues.md) Issue 1 — wallet/refund ledger types). |
| Can a customer browse the menu and place an order in the web app? | Partially verified | End-to-end UI for menu → cart → checkout exists (Progress Entry 41). Cart quote and checkout require a **CUSTOMER** session (e.g. OTP); wallet-heavy UI was intentionally de-emphasized until Issue 1 is closed. |

---

## Progress Entry - 2026-03-20

## What Has Been Completed So Far

### 1. The workspace can now build and run a basic test

- [x] API build completed successfully.
- [x] Web build completed successfully.
- [x] End-to-end health test completed successfully.

**In simple terms:**  
This means the project can now be installed, compiled, and checked in a basic automated way. Earlier, this looked more like a scaffold. Now it behaves like a working development workspace.

**What was verified at the time:**  
- `npm run build:api`
- `npm run build:web`
- Basic e2e health run; the full suite status is recorded in Progress Entry 40 (wallet/refund proof still tied to [`issues.md`](./issues/issues.md) Issue 1).

**Why this matters:**  
If a project cannot build or pass even a basic test, the team cannot safely add real features. This step turns the codebase into something engineers can actually work on.

---

### 2. The database design has been moved into an executable app model

- [x] A Prisma version of the schema now exists.
- [x] The Prisma schema is documented as the executable mirror of the v1.4 SQL design.
- [x] A fresh-database SQL baseline file now exists at `db/sql/0001_wings4u_baseline_v1_4.sql`.
- [x] Database scripts now exist for pull, validate, generate, migrate, and deploy steps.
- [x] A baseline migration has been added to the database package.

**In simple terms:**  
The written database design is no longer "just a document." There is now an app-ready version of the database structure that developers can use when they start building real features.

**Why this matters:**  
This reduces confusion. It gives the team one practical way to create tables, generate the database client, and keep code and schema in sync.

**Important reality check:**  
Having `schema.prisma` in the repo is not the finish line. The database work is only fully proven when a brand-new empty PostgreSQL database can be created directly from the SQL baseline file with no manual fixes.

---

### 3. The API foundation has been aligned with the documented contract

- [x] The API now uses the `/api/v1` global prefix.
- [x] A shared app setup exists for both normal startup and end-to-end tests.
- [x] Response envelope handling is in place.
- [x] Error envelope handling is in place.
- [x] Request ID middleware is in place.
- [x] Cookie parsing is in place.
- [x] CSRF checking is in place for browser mutating requests.
- [x] Validation pipe setup is in place.
- [x] CORS setup is in place.
- [x] Socket.IO bootstrap exists for realtime wiring.

**In simple terms:**  
The backend now has the basic "rules of the road" that every request should follow. It is not just random endpoints anymore. Requests and responses are starting to behave in a consistent way.

**Why this matters:**  
This makes frontend work safer and more predictable. It also gives a cleaner path for later security, testing, and production deployment.

---

### 4. The web app is now connected to the backend in a basic but real way

- [x] The web app has a dev proxy for `/api/*`.
- [x] The home page checks the API health endpoint.
- [x] The menu page calls the menu endpoint.
- [x] The cart page calls the cart quote endpoint.
- [x] Realtime connection setup exists for the web app.

**In simple terms:**  
The frontend is no longer just showing static pages. It now knows how to talk to the backend and check if core services are alive.

**Why this matters:**  
This is the start of real end-to-end behavior. It gives the team a usable base for menu, cart, checkout, and order tracking work.

---

### 5. Project documentation is much clearer than before

- [x] The root README now explains the current architecture and how to start the project.
- [x] The API README and API spec README now point to the current contract.
- [x] Database README files now explain where SQL and Prisma live.
- [x] Operations README files now explain monitoring, backups, and rollout at a first-pass level.
- [x] Audit documentation now records what changed and what is still open.

**In simple terms:**  
New team members can now understand the project much faster. The repo tells people where things live and what each area is for.

**Why this matters:**  
Good documentation reduces mistakes, speeds up onboarding, and makes it easier for non-developers to follow progress.

---

### 6. Operations notes now exist, but they are still early-stage

- [x] Monitoring notes now describe the health endpoint and process checks.
- [x] Backup notes now describe dump, restore, and migration order.
- [x] Rollout notes now describe a recommended deployment order.
- [x] Runbooks now include verification notes tied to current endpoints and schema tables.

**In simple terms:**  
The operations side is no longer empty. There is now a first draft of how to monitor, back up, and roll out the system.

**Important reality check:**  
These documents are helpful starter notes, but they are not yet the same as full production-ready procedures.

---

### 7. Shared runtime contracts have been aligned to the frozen API contract

- [x] The runtime global prefix is locked to `/api/v1`.
- [x] Shared API envelope and error types now live in `packages/contracts`.
- [x] The web API client now uses shared transport types instead of its own local copies.
- [x] Shared realtime event names now follow the frozen API contract naming.
- [x] Shared realtime event envelopes now use contract fields: `event_type`, `payload`, and `timestamp`.
- [x] The Socket.IO path remains aligned to `/ws`.

**In simple terms:**  
Frontend and backend now have a much clearer common language for API responses and realtime events. This reduces the risk that one side follows the document while the other side follows a different local type file.

**Why this matters:**  
This makes frontend integration, mocks, test fixtures, and future endpoint work more stable. It also reduces the chance of silent breakage caused by inconsistent shared contract files.

---

### 8. The required database verification gate is now defined

- [x] The team has agreed that database readiness means "SQL-baselined + Prisma client", not just "schema.prisma exists".
- [x] The required checks before backend module work are now explicit: SQL baseline applies cleanly, Prisma schema validates, Prisma client generates, and the drift check is clean.
- [x] The Prisma drift-check command and the need for a shadow database are now part of the documented next-step process.

**In simple terms:**  
The team now has a clear rule for when the database foundation is trustworthy enough for real backend work. This helps stop feature work from starting on top of a schema that still might be out of sync.

**Why this matters:**  
Without this gate, the code can look correct while the real database and the Prisma model quietly disagree. That usually creates expensive bugs later in auth, orders, payments, and migrations.

---

### 9. The baseline onboarding flow is now documented and locally proven

- [x] The SQL README and DB README now explain the baseline structure and the new developer / CI flow.
- [x] A seed entry point now exists at `packages/database/prisma/seed.ts`.
- [x] A clean local PostgreSQL database was created from `db/sql/0001_wings4u_baseline_v1_4.sql`.
- [x] Prisma schema validation completed successfully.
- [x] Prisma client generation completed successfully.

**In simple terms:**  
A new developer now has a clearer path to getting a working local database and app-ready Prisma client. This is no longer just theory in a document. It has been tested locally against the current baseline SQL.

**Why this matters:**  
This is the first practical proof that the baseline setup path works. It reduces onboarding confusion and makes future backend work less risky.

**What was verified locally:**  
- Fresh local database: `wings4u_local_baseline_20260321`
- Baseline apply: `psql -h 127.0.0.1 -p 55432 -U postgres -d wings4u_local_baseline_20260321 -f db/sql/0001_wings4u_baseline_v1_4.sql`
- Prisma validate: `npm run db:validate` with local `DATABASE_URL`
- Prisma generate: `npm run db:generate`

---

### 10. The Supabase baseline apply has now been confirmed

- [x] The baseline SQL was applied in Supabase.
- [x] The remote schema now shows the expected public table count.
- [x] The remote schema now shows the expected public enum count.
- [x] A sample table listing confirms the expected Wings4U objects exist in `public`.

**In simple terms:**  
The hosted database is no longer just assumed to be ready. The baseline schema is now visibly present in Supabase and matches the expected object counts from the verified local baseline run.

**Why this matters:**  
This is the first direct proof that the shared remote database environment has the Wings4U schema loaded, not just the local test database.

**What was verified remotely:**  
- `public_tables = 68`
- `public_enums = 25`
- Sample tables include `admin_audit_logs`, `auth_sessions`, `checkout_idempotency_keys`, `devices`, and `driver_payouts`

---

### 11. Prisma ORM has now been upgraded to Prisma 7

- [x] `prisma` and `@prisma/client` are now on Prisma 7.
- [x] Prisma CLI connection settings now live in `packages/database/prisma.config.ts`.
- [x] `packages/database/prisma/schema.prisma` no longer stores `url = env("DATABASE_URL")`.
- [x] The API now creates Prisma clients through the PostgreSQL adapter instead of the older direct client-only setup.
- [x] The seed entry point now uses the same adapter-based connection approach.
- [x] Environment templates now include `DIRECT_URL` for Prisma CLI work.
- [x] Prisma validate, Prisma generate, database build, and API build all passed after the upgrade.

**In simple terms:**  
The project has now been moved onto Prisma's newer connection model. The schema file still describes the database shape, but the actual connection details for Prisma tooling now live in a dedicated config file instead of being mixed into the schema itself.

**Why this matters:**  
This removes the schema warning you were seeing, lines the repo up with Prisma 7 expectations, and gives the team a cleaner split between database design, CLI connection settings, and runtime app behavior.

**What was verified:**  
- `npm run db:validate`
- `npm run db:generate`
- `npm run build:database`
- `npm run build:api`

---

## Progress Entry - 2026-03-21

## Full Backend Implementation

### 12. Seed data for development and testing

- [x] `packages/database/prisma/seed.ts` now creates real seed data.
- [x] 1 location (Wings 4 U - London, ON, code LON01) with full location settings (HST 13%, delivery fee $3.99, trusted IP ranges, allowed postal codes).
- [x] 5 users: 1 admin, 1 manager (STAFF), 1 cashier (STAFF), 1 driver (STAFF), 1 customer.
- [x] Phone identities for all users (PHONE_OTP provider, verified).
- [x] Employee profiles for manager, cashier, and driver linked to the location.
- [x] Admin location assignment for the admin user.
- [x] Driver profile with vehicle info and OFF_SHIFT status.
- [x] Customer profile and wallet (zero balance).
- [x] 4 menu categories: Wings, Sides, Drinks, Combos.
- [x] 9 menu items across categories with realistic pricing.
- [x] 3 modifier groups: Sauce (multi-select, required), Size (single-select, required), Extras (multi-select, optional).
- [x] 11 modifier options with price deltas.
- [x] Menu item to modifier group links.
- [x] 5 wing flavours with heat levels.
- [x] Seed is idempotent (checks for existing LON01 location before creating).

**In simple terms:**
The database can now be populated with realistic test data for a single location, including a full menu, staff, and a customer. This enables all downstream feature development and testing.

**What was verified:**
TypeScript compilation passes (`tsc --noEmit`).

---

### 13. Authentication guard and JWT infrastructure

- [x] `common/utils/jwt.ts` â€” zero-dependency JWT sign/verify using Node.js crypto (HMAC-SHA256, timing-safe comparison, exp claim checking).
- [x] `common/guards/auth.guard.ts` â€” global AuthGuard that reads `access_token` cookie, verifies JWT, attaches `req.user` with userId, role, employeeRole, and sessionId. Respects `@Public()` decorator (still extracts user if token present on public routes). Stubs `X-Device-Token` path.
- [x] `common/guards/roles.guard.ts` â€” per-route RolesGuard driven by `@Roles()` decorator. ADMIN always passes. STAFF checked against employee roles when specified.
- [x] `common/decorators/roles.decorator.ts` â€” `@Roles()` decorator (accepts user roles and structured role specs) and `@Public()` decorator.
- [x] `common/decorators/current-user.decorator.ts` â€” `@CurrentUser()` param decorator to extract authenticated user from request.
- [x] `types/express.d.ts` updated with `req.user` type augmentation.
- [x] AuthGuard registered globally via `APP_GUARD` in AppModule.

**In simple terms:**
Every API endpoint is now protected by default. Public endpoints must be explicitly marked. Role-based access control is enforced at the guard level, with ADMIN bypassing all checks.

**What was verified:**
TypeScript compilation passes. No new dependencies added (JWT uses Node.js built-in crypto).

---

### 14. Auth service with OTP, sessions, and POS login

- [x] `modules/auth/auth.service.ts` â€” 5 methods: `requestOtp`, `verifyOtp`, `refresh`, `logout`, `posLogin`.
- [x] OTP flow: generates 6-digit code, stores SHA-256 hash in `auth_otp_codes`, 5-minute expiry, max 5 attempts.
- [x] Session management: creates `auth_sessions` with hashed refresh tokens, 30-day expiry, token rotation on refresh.
- [x] JWT access tokens: 15-minute expiry, payload includes userId, role, employeeRole, sessionId.
- [x] Cookie model: `access_token` (HttpOnly, 15 min), `refresh_token` (HttpOnly, scoped to refresh path, 30 days), `csrf_token` (not HttpOnly, readable by frontend).
- [x] POS login: validates employee PIN hash, checks client IP against location's trusted IP ranges (IPv4 CIDR matching), creates POS session.
- [x] `modules/auth/auth.controller.ts` â€” 5 endpoints: `POST auth/otp/request`, `POST auth/otp/verify`, `POST auth/refresh`, `POST auth/logout`, `POST auth/pos/login`. First three are `@Public()`.
- [x] `modules/auth/auth.module.ts` â€” exports AuthService for use by other modules.

**In simple terms:**
Customers can authenticate via phone OTP. Staff can authenticate via POS PIN with IP validation. Sessions are managed with rotating refresh tokens and short-lived access tokens.

**What was verified:**
TypeScript compilation passes.

---

### 15. Catalog service with real database reads

- [x] `modules/catalog/catalog.service.ts` â€” `getMenu()` fetches location + settings + active categories + items filtered by fulfillment type + modifier groups with active options in a single query. `getWingFlavours()` returns active flavours.
- [x] Response mapped to snake_case matching the API contract (categories, items, modifier groups, options, location metadata).
- [x] `modules/catalog/menu.controller.ts` â€” `GET menu` and `GET menu/wing-flavours`, both `@Public()` for guest browsing, with LocationScopeGuard.
- [x] `modules/catalog/catalog.module.ts` â€” exports CatalogService.

**In simple terms:**
The menu endpoint now returns real data from the database, including categories, items, modifiers, and location-specific settings like delivery fees and prep times.

**What was verified:**
TypeScript compilation passes.

---

### 16. Cart service with live pricing

- [x] `modules/cart/cart.service.ts` â€” `computeQuote()` validates items against live menu, calculates per-line totals (base price + modifier deltas Ã— quantity), applies delivery fee logic (waived above threshold, minimum subtotal check), computes tax using location settings.
- [x] Inline pricing computation matching the `@wings4u/pricing` engine logic (configurable taxable base, delivery fee taxability, tip taxability).
- [x] `modules/cart/cart.controller.ts` â€” `POST cart/quote` with `@Roles("CUSTOMER")`, full DTO validation with class-validator.
- [x] `modules/cart/cart.module.ts` â€” exports CartService.

**In simple terms:**
Customers can get a real-time price quote for their cart, including tax calculations based on the location's HST rate and delivery fee rules.

**What was verified:**
TypeScript compilation passes.

---

### 17. Checkout service with idempotency and order creation

- [x] `modules/checkout/checkout.service.ts` â€” `placeOrder()` runs inside a Prisma transaction: idempotency check via `checkout_idempotency_keys`, user/location validation, menu item validation, pricing computation, order creation with nested items and modifiers, initial status event (PLACED).
- [x] Idempotent replay: same idempotency key returns the existing order without creating a duplicate.
- [x] Order number generation: monotonic per-location (count + 1001).
- [x] Pricing snapshot stored on the order for audit trail.
- [x] `modules/checkout/checkout.controller.ts` â€” `POST checkout` with `@Roles("CUSTOMER")`, requires `Idempotency-Key` header, LocationScopeGuard.
- [x] `modules/checkout/checkout.module.ts` â€” exports CheckoutService.

**In simple terms:**
Customers can place orders through the checkout endpoint. The system prevents duplicate orders using idempotency keys and creates a complete audit trail of pricing at the time of order.

**What was verified:**
TypeScript compilation passes.

---

### 18. Orders service with pagination and cancellation

- [x] `modules/orders/orders.service.ts` â€” `listOrders()` with cursor-based pagination, `getOrderDetail()` with full items/modifiers/status events, `requestCancellation()` for customer-initiated cancel requests.
- [x] Ownership enforcement: customers see only their own orders, STAFF/ADMIN can view any.
- [x] Cancellation restricted to PLACED or ACCEPTED status only.
- [x] `modules/orders/orders.controller.ts` â€” `GET orders`, `GET orders/:id`, `POST orders/:id/cancel` with auth and LocationScopeGuard.
- [x] `modules/orders/orders.module.ts` â€” exports OrdersService.

**In simple terms:**
Customers can list their orders, view full order details, and request cancellations. The system enforces that only orders in early stages can be cancelled.

**What was verified:**
TypeScript compilation passes.

---

### 19. Payments service

- [x] `modules/payments/payments.service.ts` â€” `createPayment()` creates order payment records and recalculates the order's payment status summary (UNPAID â†’ AUTHORIZED â†’ PAID â†’ REFUNDED). `getPaymentsForOrder()` lists all payments.
- [x] Payment status recalculation aggregates AUTH, CAPTURE, and REFUND amounts to determine the correct summary.
- [x] `modules/payments/payments.controller.ts` â€” `POST orders/:orderId/payments` (STAFF/ADMIN), `GET orders/:orderId/payments` (order owner or STAFF/ADMIN).
- [x] `modules/payments/payments.module.ts` â€” exports PaymentsService.

**In simple terms:**
Staff can record payments against orders (card authorizations, captures, cash). The system automatically tracks whether an order is paid, partially paid, or refunded.

**What was verified:**
TypeScript compilation passes.

---

### 20. Wallets service

- [x] `modules/wallets/wallets.service.ts` â€” `getBalance()` (upserts wallet if missing), `credit()` (atomic increment + ledger entry), `debit()` (validates sufficient balance, atomic decrement + ledger entry), `getLedger()` (cursor-paginated).
- [x] `modules/wallets/wallets.controller.ts` â€” `GET wallets/me` and `GET wallets/me/ledger` for customers.
- [x] `modules/wallets/wallets.module.ts` â€” exports WalletsService.

**In simple terms:**
Customers have digital wallets that can receive credits (from refunds or admin actions) and be used toward future orders. All transactions are tracked in a ledger.

**What was verified:**
TypeScript compilation passes.

---

### 21. Refund service

- [x] `modules/refunds/refund.service.ts` â€” `createRefundRequest()` validates order is in a refundable state and amount doesn't exceed what's been paid. `approveAndIssue()` handles wallet credit or original payment refund. `rejectRefund()` marks request as rejected.
- [x] `modules/refunds/refund.controller.ts` â€” `POST orders/:orderId/refund-request` for customers and staff.
- [x] `modules/refunds/refund.module.ts` â€” imports WalletsModule and PaymentsModule for cross-module operations.
- [x] RefundModule registered in AppModule.

**In simple terms:**
Customers and staff can request refunds. Admins approve or reject them, with refunds going back to the original payment method or as store credit.

**What was verified:**
TypeScript compilation passes.

---

### 22. KDS (Kitchen Display System) service

- [x] `modules/kds/kds.service.ts` â€” 9 methods: `getKdsOrders` (filtered by status), `acceptOrder`, `updateOrderStatus` (with validated transitions), `handleCancelRequest`, `assignDriver`, `startDelivery`, `completeDelivery`, `updateEta`, `requestRefund`.
- [x] Status transition validation: PLACEDâ†’ACCEPTEDâ†’PREPARINGâ†’READYâ†’PICKED_UP/OUT_FOR_DELIVERYâ†’DELIVEREDâ†’COMPLETED, with CANCELLED from any non-terminal state.
- [x] Driver assignment updates driver profile (ON_DELIVERY status, lastAssignedAt).
- [x] Delivery completion resets driver to AVAILABLE and increments delivery count.
- [x] `modules/kds/kds.controller.ts` â€” 9 endpoints, all STAFF/ADMIN with LocationScopeGuard.
- [x] `modules/kds/kds.module.ts` â€” exports KdsService.

**In simple terms:**
Kitchen staff can view incoming orders, accept them, update their status through the preparation and delivery lifecycle, assign drivers, and handle cancellation and refund requests.

**What was verified:**
TypeScript compilation passes.

---

### 23. POS (Point of Sale) service

- [x] `modules/pos/pos.service.ts` â€” `createPosOrder()` resolves customer by phone or creates walk-in, validates menu items, computes pricing, creates order as POS source (auto-accepted), creates immediate CAPTURE payment for cash or AUTH for card terminal. `listPosOrders()` lists today's orders.
- [x] `modules/pos/pos.controller.ts` â€” `POST pos/orders` and `GET pos/orders`, restricted to CASHIER/MANAGER employee roles.
- [x] `modules/pos/pos.module.ts` â€” wired.

**In simple terms:**
Cashiers can create orders directly from the POS terminal, with automatic payment recording for cash and card transactions.

**What was verified:**
TypeScript compilation passes.

---

### 24. Chat service (order conversations)

- [x] `modules/chat/chat.service.ts` â€” `getConversation()` (find or create), `getMessages()` (cursor-paginated), `sendMessage()`, `markRead()` (upsert read state).
- [x] `modules/chat/chat.controller.ts` â€” `GET orders/:orderId/chat`, `POST orders/:orderId/chat`, `POST orders/:orderId/chat/read`. Verifies order access for customers.
- [x] `modules/chat/chat.module.ts` â€” exports ChatService.

**In simple terms:**
Customers and store staff can exchange messages about specific orders in real time.

**What was verified:**
TypeScript compilation passes.

---

### 25. Support tickets service

- [x] `modules/support/support.service.ts` â€” `createTicket()` with initial event, `getTicket()` with messages/events/resolutions, `listTickets()` (cursor-paginated, filterable), `addMessage()`, `updateStatus()`, `resolve()`.
- [x] `modules/support/support.controller.ts` â€” 6 endpoints. Customers create and view their own tickets; STAFF/ADMIN manage all tickets for the location.
- [x] `modules/support/support.module.ts` â€” wired.

**In simple terms:**
Customers can open support tickets for order issues, payment problems, or general feedback. Staff can manage, respond to, and resolve tickets.

**What was verified:**
TypeScript compilation passes.

---

### 26. Admin service

- [x] `modules/admin/admin.service.ts` â€” `decideCancellation()` (approve/deny with audit log), `decideRefund()` (delegates to RefundService), `cancelOrder()` (force-cancel any non-terminal order), `creditCustomer()` (wallet credit with audit log), `getDailyTaxReport()` (aggregates or returns cached summary), `getAuditLog()` (cursor-paginated).
- [x] `modules/admin/admin.controller.ts` â€” 6 endpoints, all ADMIN-only with LocationScopeGuard.
- [x] `modules/admin/admin.module.ts` â€” imports WalletsModule and RefundModule.

**In simple terms:**
Admins can approve or deny cancellations and refunds, force-cancel orders, credit customer wallets, view daily tax reports, and audit all administrative actions.

**What was verified:**
TypeScript compilation passes.

---

### 27. Drivers service

- [x] `modules/drivers/drivers.service.ts` â€” `getAvailableDrivers()` (AVAILABLE + active, ordered by lastAssignedAt for round-robin), `updateAvailability()`.
- [x] `modules/drivers/drivers.controller.ts` â€” `GET drivers/available` and `POST drivers/:id/availability`, STAFF/ADMIN.
- [x] `modules/drivers/drivers.module.ts` â€” wired.

**In simple terms:**
Staff can view which drivers are available for delivery assignments and update driver availability status.

**What was verified:**
TypeScript compilation passes.

---

### 28. Timeclock service

- [x] `modules/timeclock/timeclock.service.ts` â€” `clockIn()`, `clockOut()` (calculates total worked minutes), `startBreak()`, `endBreak()` (calculates break minutes), `getActiveShift()`, `getShiftHistory()` (cursor-paginated).
- [x] `modules/timeclock/timeclock.controller.ts` â€” 6 endpoints for clock-in, clock-out, break start/end, current shift, and history. All STAFF role.
- [x] `modules/timeclock/timeclock.module.ts` â€” wired.

**In simple terms:**
Employees can clock in and out, take breaks, and view their shift history. The system tracks total worked and break minutes.

**What was verified:**
TypeScript compilation passes.

---

### 29. Realtime gateway with WebSocket auth and channel subscriptions

- [x] `modules/realtime/realtime.gateway.ts` â€” full Socket.IO gateway with connection auth (JWT from cookie), channel subscription handling (subscribe/unsubscribe), and event emission methods.
- [x] Channel types: `orders:{locationId}` (STAFF/ADMIN), `order:{orderId}` (any authenticated), `chat:{orderId}` (any authenticated), `admin:{locationId}` (ADMIN only), `drivers:{locationId}` (STAFF/ADMIN).
- [x] Emission methods: `emitOrderEvent()` (fans out to location + order channels), `emitChatEvent()`, `emitAdminEvent()`, `emitDriverEvent()`.
- [x] `modules/realtime/realtime.module.ts` â€” `@Global()` so any service can inject the gateway to emit events.
- [x] Event types match the `@wings4u/contracts` realtime type definitions.

**In simple terms:**
The backend exposes a WebSocket gateway with auth and channel subscriptions. Business services now emit events after successful DB writes (see Progress Entry 36). Clients that subscribe receive pushes when those flows run.

**What was verified:**
TypeScript compilation passes. Event wiring verified at compile time; full runtime proof depends on green e2e / manual socket tests.

---

### 30. Expanded e2e test coverage

- [x] `apps/api/test/app.e2e-spec.ts` expanded from 1 test to a large suite across many groups (health, auth, menu, cart, checkout, orders, permissions, wallets, support, timeclock, chat, envelope contract, etc.).
- [x] Test infrastructure: helper functions for authenticated requests, dynamic seed data ID discovery via Prisma, JWT signing for test users.

**In simple terms:**
There is broad automated API coverage. A **reproducible green** run is recorded in Progress Entry 40 (deterministic global reset + seed + migrations). Remaining **money-path** verification still depends on [`issues.md`](./issues/issues.md) Issue 1.

**What was verified:**
See Progress Entry 40. TypeScript compilation passes.

---

### 31. Prisma drift check ran clean

**In simple terms:**
The real database and the Prisma schema were compared directly, and no unexpected differences were found. This confirms the current SQL baseline and the Prisma app model are still aligned.

- [x] The drift check was executed through `db/diffcheck.ps1`.
- [x] The comparison returned `No difference detected`.

**What was verified:**
- `powershell -ExecutionPolicy Bypass -File db/diffcheck.ps1`
- Result: `No difference detected`

---

## Open Work

All unfinished work and next priorities now live in [`todo.md`](./todo.md).

Use [`todo.md`](./todo.md) for:

- remaining open implementation work
- unfinished validation and rollout work
- current priority ordering
- next actions the team should take

---

## Recommended Current Position

**Best description of the project today:**

- **Backend foundation and most core modules are implemented** — the repo is beyond stub stage; TypeScript builds clean; many flows have real DB-backed code.
- **API e2e verification:** `npm run test:e2e` is **green** (65 tests) with deterministic bootstrap — see Progress Entry 40.
- **Money paths:** still **partially verified** until [`issues.md`](./issues/issues.md) Issue 1 (wallet/refund ledger entry types vs SQL) is closed.
- **Open work** for priorities and next steps: [`todo.md`](./todo.md).
- **Reporting:** **Implemented** is accurate; **production-ready** or **fully system-verified** is not while Issue 1 is open.

**For unfinished work:**
See [`todo.md`](./todo.md) and [`issues.md`](./issues/issues.md).

---

## Progress Entry - 2026-03-22

### 31. Customer cancellation flow — direct self-cancel within 2-minute window

- [x] `orders.service.ts` — replaced `requestCancellation()` (which created a `cancellation_requests` row with invalid `request_source = CUSTOMER`) with `customerCancel()` that directly cancels the order when `now <= cancel_allowed_until`.
- [x] After the 2-minute window expires, the endpoint returns a 409 Conflict telling the customer to use order chat/help instead.
- [x] On self-cancel: sets `orders.status = CANCELLED`, `cancellation_source = CUSTOMER_SELF`, `cancelled_at`, `cancelled_by_user_id`, and creates an `order_status_events` row.
- [x] No `cancellation_requests` row is created by this endpoint — that table is reserved for reviewed KDS/chat-driven requests.
- [x] `orders.controller.ts` — `reason` field on `POST /orders/:id/cancel` is now optional (customers shouldn't be blocked from cancelling in the first 2 minutes just because they didn't type a reason).
- [x] `checkout.service.ts` — now sets `cancel_allowed_until = placed_at + 2 minutes` on every new order.
- [x] All three order serializers (checkout response, order summary, order detail) now include `cancel_allowed_until` so the frontend can show/hide the cancel button.
- [x] No database or Prisma schema changes — `orders.cancellation_source` already supports `CUSTOMER_SELF`, and `orders.cancel_allowed_until` already exists.

**In simple terms:**
Customers can now cancel their own order within 2 minutes of placing it, without needing staff approval. After the window closes, they're directed to chat/help. This fixes the bug where the old code tried to write `request_source = CUSTOMER` to the `cancellation_requests` table, which isn't a valid value in the schema.

**What was verified:**
TypeScript compilation passes with zero errors. E2e tests updated to cover the new behavior (direct cancel succeeds in window, reason is optional, checkout response includes `cancel_allowed_until`).

---

## Progress Entry - 2026-03-22

### 32. Support ticket schema expansion and module alignment

- [x] Updated `db/sql/0001_wings4u_baseline_v1_4.sql` only — expanded `created_source` CHECK, `event_type` CHECK, added `priority` on `support_tickets`, `payload_json` on `support_ticket_events`; changelog header notes the 2026-03-22 support expansion (no separate patch SQL file).
- [x] Updated `packages/database/prisma/schema.prisma` — added `priority` field on `SupportTicket` model and `payloadJson` field on `SupportTicketEvent` model.
- [x] Regenerated Prisma client (`prisma generate`) — new fields are now available in the typed client.
- [x] Rewrote `apps/api/src/modules/support/support.service.ts` — `createTicket()` now accepts `ticketType`, `createdSource`, `orderId`, `priority`; writes `CREATED` event with `payloadJson`; `addMessage()` accepts `isInternalNote` and writes `MESSAGE_ADDED` event; `resolve()` writes `RESOLVED` event with `payloadJson`; `getTicket()` filters internal notes for customer callers.
- [x] Rewrote `apps/api/src/modules/support/support.controller.ts` — renamed DTO fields (`category` → `ticket_type`, `body` → `message_body`); added `order_id`, `priority`, `is_internal_note` fields; changed resolve endpoint from `POST :id/resolve` to `POST :id/resolutions`; removed `IN_PROGRESS` from allowed statuses; passes `user.role` to service for note filtering.
- [x] Updated `apps/api/test/app.e2e-spec.ts` — support tests now send `ticket_type` and `priority`, assert `priority`/`created_source` in responses, verify `CREATED` event exists, test internal note filtering (admin adds note, customer cannot see it), and use `message_body` field name.

**In simple terms:**
The support module's SQL schema was expanded to accept the richer event types and source values the service actually needs, plus a real `priority` column and structured `payload_json` for audit data. All service writes, controller DTOs, and serializers were aligned to the new schema. Internal notes are now properly hidden from customers. The old stale field names (`category`, `body`) were replaced with schema-matching names (`ticket_type`, `message_body`).

**What was verified:**
TypeScript compilation passes with zero errors. Prisma client regenerated successfully. No linter errors. Live Supabase DBs created before this baseline update need manual ALTERs to match `support_tickets` / `support_ticket_events` in `0001_wings4u_baseline_v1_4.sql`.

---

## Progress Entry - 2026-03-22

### 33. Timeclock schema expansion — rich shift state and stored totals

- [x] Created `db/sql/0003_timeclock_schema_expansion.sql` — migration patch that expands `employee_shifts.status` from `OPEN|CLOSED` to `CLOCKED_IN|ON_BREAK|CLOCKED_OUT`, adds `total_break_minutes` and `net_worked_minutes` columns, constrains `employee_breaks.break_type` to `UNPAID` only, and adds partial unique indexes for one-active-shift-per-employee and one-open-break-per-shift.
- [x] Updated `db/sql/0001_wings4u_baseline_v1_4.sql` baseline to include the expanded timeclock schema inline with changelog header.
- [x] Updated `packages/database/prisma/schema.prisma` — added `totalBreakMinutes` and `netWorkedMinutes` on `EmployeeShift` model.
- [x] Regenerated Prisma client.
- [x] Rewrote `apps/api/src/modules/timeclock/timeclock.service.ts` — `clockIn()` creates `CLOCKED_IN` shift with zero break minutes and sets driver availability to `AVAILABLE`; `startBreak()` creates `UNPAID` break and sets `ON_BREAK` + driver `UNAVAILABLE`; `endBreak()` closes break, recalculates `totalBreakMinutes`, restores `CLOCKED_IN` + driver `AVAILABLE`; `clockOut()` auto-closes open break if needed, computes and stores both totals, sets `CLOCKED_OUT` + driver `OFF_SHIFT`. All driver availability transitions respect `isOnDelivery`.
- [x] Controller unchanged — already delegates to service; enriched payloads flow through automatically.
- [x] Updated `apps/api/test/app.e2e-spec.ts` — added timeclock test block covering clock-in creates `CLOCKED_IN`, duplicate clock-in rejected, break start/end lifecycle, clock-out computes totals, clock-out from `ON_BREAK` auto-closes break, history returns shifts with totals.
- [x] Updated both API contract copies (`Docs/API_Spec/` and `Docs/`) — documented all six timeclock endpoints with rich shift status, stored totals, break lifecycle, and driver availability behavior.
- [x] Updated `Docs/Wings4U_schema_v1_4_postgres_FINAL.sql` and `Docs/schema.prisma` design-reference copies.
- [x] Removed timeclock issue from `issues.md`, renumbered remaining issues, updated summaries.
- [x] Added Fixed Issue 4 to `Fixed Issues.md`.

**In simple terms:**
The timeclock module's SQL schema was expanded so the database natively supports `CLOCKED_IN`, `ON_BREAK`, and `CLOCKED_OUT` shift states, stores break totals and net worked minutes per shift, and enforces one-active-shift and one-open-break constraints. The service now persists all totals on clock-out and manages driver availability transitions during the shift lifecycle.

**What was verified:**
TypeScript compilation passes with zero errors. Prisma client regenerated successfully. No linter errors. Existing Supabase databases need `db/sql/0003_timeclock_schema_expansion.sql` applied via SQL editor.

---

## Progress Entry - 2026-03-23

### 34. Chat module aligned to schema and contract — server-derived sender surface, side-based unread, visibility

- [x] Rewrote `apps/api/src/modules/chat/chat.service.ts` — server now derives `sender_surface` from authenticated caller (`CUSTOMER` → `CUSTOMER`, `KITCHEN` → `KDS`, `MANAGER` → `MANAGER`, `ADMIN` → `ADMIN`); `CASHIER` and `DRIVER` are rejected with 403. Visibility enforcement: customers can only send `BOTH`, staff/admin can send `BOTH` or `STAFF_ONLY`. Customer GET filters out `STAFF_ONLY` messages. Unread tracking now uses canonical `chat_side_read_states` (customer read → `CUSTOMER` side, any staff/admin read → `STAFF` side, shared across all staff). Per-user `chat_read_states` still updated as audit. Conversation closed check added to `sendMessage`.
- [x] Rewrote `apps/api/src/modules/chat/chat.controller.ts` — removed client-sent `sender_side` from DTO, added optional `visibility` field. `markRead` endpoint no longer requires a body; server infers side from auth. Controller calls `deriveSenderSurface()` before delegating to service.
- [x] Added KITCHEN employee user to `packages/database/prisma/seed.ts` for e2e test coverage.
- [x] Added kitchen, cashier, and driver tokens to `apps/api/test/app.e2e-spec.ts`. New "Chat" test block: customer → CUSTOMER, kitchen → KDS, manager → MANAGER, admin → ADMIN, cashier/driver rejected, STAFF_ONLY visibility enforcement, customer cannot see STAFF_ONLY messages, staff sees all, customer/staff read cursor updates.
- [x] Updated both API contract copies — expanded Section 5 with sender surface derivation table, unread contract, full response shapes, visibility filtering, and `POST /orders/:id/chat/read` endpoint.
- [x] Removed chat issue from `issues.md`, renumbered remaining issues (now 1–5), updated summaries.
- [x] Added Fixed Issue 5 to `Fixed Issues.md` with full detail.

**In simple terms:**
The chat module was rewritten so the server determines who is speaking (customer, kitchen, manager, or admin) from the auth token instead of trusting the client. Cashiers and drivers are blocked from posting. Staff can send internal-only messages that customers never see. Unread tracking now uses the correct shared side-based table so one staff member reading clears unread for all staff.

**What was verified:**
TypeScript compilation passes with zero errors. No SQL schema changes needed — existing `sender_surface` CHECK and `chat_side_read_states` table already support the correct behavior.

---

### 35. Order chat lifecycle — terminal status closes chat, support tickets take over

- [x] Added `closeConversation()` to `chat.service.ts` — sets `order_conversations.closed_at` on the conversation row. Idempotent (no-op if already closed or no conversation exists).
- [x] Added terminal order status check to `sendMessage()` — checks order status before allowing message creation. Returns 409 Conflict with guidance to open a support ticket if the order is in `CANCELLED`, `DELIVERED`, `PICKED_UP`, `NO_SHOW_PICKUP`, or `NO_SHOW_DELIVERY`.
- [x] Added `is_closed` field to `getMessages()` response — frontend can use this to decide whether to show the message input or a "Open support ticket" CTA.
- [x] Hooked `closeConversation` into `kds.service.ts` — called after any KDS status transition that lands on a terminal status (cancel, delivered, picked up, no-show variants).
- [x] Hooked `closeConversation` into `orders.service.ts` — called after customer self-cancel completes.
- [x] Imported `ChatModule` into `KdsModule` and `OrdersModule` to make `ChatService` injectable.
- [x] Added lifecycle e2e tests — `is_closed = false` on active order, chat works while active, KDS cancel closes conversation, new message rejected with 409 on terminal order, GET still returns full history with `is_closed = true`.
- [x] Updated both API contract copies — added "Lifecycle" section documenting when chat is open vs closed, terminal statuses, and the support ticket handoff. Added `is_closed` to GET response shape.

**In simple terms:**
Order chat now has a clear lifecycle: it stays open while the order is being processed and closes immediately when the order reaches a final status (delivered, cancelled, picked up, etc.). After that, the chat history is still readable but no new messages can be sent — customers are directed to support tickets for any follow-up issues.

**What was verified:**
TypeScript compilation passes with zero errors. No SQL schema changes needed — `order_conversations.closed_at` already exists in the baseline schema.

---

## Progress Entry - 2026-03-24

### 36. Realtime event emission wired into all business services

- [x] Injected `RealtimeGateway` into `checkout.service.ts` — emits `order.placed` after order creation transaction with order_id, order_number, status, fulfillment_type, estimated_ready_at.
- [x] Injected `RealtimeGateway` into `kds.service.ts` — 8 emit points: `order.accepted` after accept; `order.status_changed` / `order.cancelled` after status update; `cancellation.decided` + `order.cancelled` after cancel request handling; `order.driver_assigned` + `driver.availability_changed` after driver assignment; `order.delivery_started` after start delivery; `order.status_changed` + `driver.delivery_completed` + `driver.availability_changed` after complete delivery; `order.eta_updated` after ETA update; `refund.requested` after refund request.
- [x] Injected `RealtimeGateway` into `chat.service.ts` — emits `chat.message` after every send; `chat.read` only when side cursor actually advances (checks existing cursor before emit, avoids duplicate noise).
- [x] Injected `RealtimeGateway` into `admin.service.ts` — emits `cancellation.decided` after cancellation decisions (both approve and reject); `order.cancelled` on approval; `order.cancelled` after admin force-cancel.
- [x] Injected `RealtimeGateway` into `drivers.service.ts` — emits `driver.availability_changed` after manual availability updates.
- [x] All emits happen after successful DB transaction, never before. Payloads follow minimal shapes from the realtime contract.
- [x] Also added `chatService.closeConversation()` call to `kds.service.ts` `completeDelivery()` (was missing — DELIVERED is terminal but only the generic `updateOrderStatus` path had the close hook).
- [x] Removed realtime issue from `issues.md`, renumbered remaining issues (now 1–4).
- [x] Added Fixed Issues 6 (chat lifecycle) and 7 (realtime wiring) to `Fixed Issues.md`.

**In simple terms:**
Every business service that changes state now pushes a typed event to subscribed WebSocket clients. Order placement notifies the KDS, status changes notify both the store and the customer, chat messages appear instantly, driver assignments update the driver picker, and cancellation decisions reach the admin panel. The gateway module was already global so no module import changes were needed — just constructor injection and emit calls after each successful transaction.

**What was verified:**
TypeScript compilation passes with zero errors. No new dependencies or schema changes. The `RealtimeModule` is `@Global()`, so all services can inject `RealtimeGateway` without explicit module imports.

---

### 37. Device-token auth deferred — stub removed, CSRF bypass closed

- [x] Removed dead `X-Device-Token` branch from `apps/api/src/common/guards/auth.guard.ts` — guard now only evaluates cookie/JWT auth.
- [x] Removed `X-Device-Token` CSRF bypass from `apps/api/src/common/middleware/csrf.middleware.ts` — all browser mutating requests now require proper CSRF tokens.
- [x] Updated both API contract copies — "Device Auth" section now states the feature is deferred, explains MVP approach (staff browser auth for KDS/POS/timeclock), notes DB schema fields retained for future use.
- [x] Removed device-token issue from `issues.md`, renumbered remaining issues (now 1–3).
- [x] Added Fixed Issue 8 to `Fixed Issues.md`.

**In simple terms:**
Device-token auth was a half-built feature that created a real CSRF bypass vulnerability and misleading code. The stub was removed, the CSRF hole was closed, and the API contract now clearly states that KDS/POS/timeclock are browser apps using normal staff auth in the MVP. Device identity is a future feature.

**What was verified:**
TypeScript compilation passes with zero errors. No schema changes. The two code changes are purely subtractive — removing dead branches and a security bypass.

---

### 38. Procedure docs aligned to verified reality (tasks, todo, issues)

- [x] Rewrote [`Docs/procedures/tasks.md`](./tasks.md) — added “How to read this file” with status vocabulary (Implemented / Partially verified / Blocked / Verified), promotion rule (code + no open issue + no contradictory todo + real proof), updated Quick Decision Summary, replaced “feature-complete backend” and “Comprehensive e2e” with honest wording, retitled §30 to “Expanded e2e test coverage (not yet a green final proof)”, updated §29 realtime plain-English to match wired emits, rewrote “Recommended Current Position” to match [`issues.md`](./issues/issues.md) Issue 1–2.
- [x] Rewrote [`Docs/procedures/todo.md`](./todo.md) — removed stale items (chat alignment, partial realtime, device-token placeholder, duplicate schema-alignment bullets for already-fixed areas); kept only genuine open work aligned with Issue 1–2 plus optional platform/ops follow-ups.
- [x] Updated [`Docs/procedures/issues/issues.md`](./issues/issues.md) — removed resolved “project status documentation overstates completion” issue; refreshed plain-English summary and suggested fix order step 4.
- [x] Added Fixed Issue 9 to [`Fixed Issues.md`](./issues/Fixed%20Issues.md).

**What was verified:**
Documentation-only change; consistency checked by reading all three files together.

---

### 39. E2E harness — dedicated test database with automatic reset + seed

- [x] Created `apps/api/test/.env.test` — template for a dedicated e2e database connection string. Destructively reset on every run; never point at dev or production.
- [x] Rewrote `apps/api/test/setup-env.ts` — loads `.env.test` first (with override) then falls back to root `.env`, so every test worker uses the e2e DB.
- [x] Created `apps/api/test/global-setup.ts` — Jest `globalSetup` that connects via raw `pg`, truncates all application data tables (`CASCADE`), then runs the canonical seed (`packages/database/prisma/seed.ts`) via `tsx` subprocess. Seed creates `LON01`, all test users, employee profiles, menu categories/items/modifiers/flavours.
- [x] Updated `apps/api/test/jest-e2e.json` — added `globalSetup` pointing at `global-setup.ts`.
- [x] Added `.env.test` and `**/.env.test` to `.gitignore` (contains connection strings).
- [x] Removed e2e seed/bootstrap issue from `issues.md` (was Issue 1), renumbered remaining issues (now Issue 1 = wallet/refund ledger types).
- [x] Updated `todo.md` — e2e bootstrap is no longer blocking; first priority is now the wallet/refund fix, second is running e2e green.
- [x] Added Fixed Issue 10 to `Fixed Issues.md`.

**In simple terms:**
Running `npm run test:e2e` now automatically resets a dedicated test database and seeds it with the canonical baseline data before any test runs. Tests no longer depend on manual seeding or ambient shared state. The e2e suite is deterministic and isolated from the development database.

**What was verified:**
TypeScript compilation passes. The harness is structurally complete; **full runtime verification** requires the user to configure `.env.test` with a real test database connection string and run the suite.

---

### 40. E2e suite green — migrations, guards, and test alignment

- [x] `packages/database/prisma/migrations/20250320120001_uuid_pk_defaults` — `DEFAULT gen_random_uuid()` on UUID primary keys (init migration had `NOT NULL` ids without defaults).
- [x] `packages/database/prisma/migrations/20250320120002_prisma_schema_alignment` — timeclock totals + constraints (`db/sql/0003` parity) and support ticket `priority` / `support_ticket_events.payload_json` to match Prisma.
- [x] `apps/api/test/global-setup.ts` — optional `CREATE DATABASE`, `prisma migrate deploy`, then truncate + seed.
- [x] `apps/api/src/app.module.ts` — global `RolesGuard` so `@Roles()` is enforced (was previously inert).
- [x] `apps/api/src/modules/health/health.controller.ts` — `@Public()` so `GET /health` is not blocked by `AuthGuard`.
- [x] `apps/api/test/app.e2e-spec.ts` — menu envelope (`categories`), cart quote field names, Nest default **201** on POSTs, checkout payloads, chat order via `PICKUP`.

**In simple terms:**
The API e2e suite is a trustworthy regression check when run against a dedicated Postgres database: migrations apply, data resets to the seed baseline, and tests match current behavior (including role gates and health being public).

**What was verified:**
- `npm run test:e2e` — **65 passed** (two consecutive runs on the maintainer machine with local `wings4u_test`).
- Wallet balance/ledger endpoints are covered; **refund ledger correctness vs SQL** remains Issue 1.

---

### 41. Customer web — Menu → Cart → Checkout (local cart, live quote, fulfillment, idempotent checkout)

- [x] **`apps/web/src/lib/types.ts`** — TypeScript types aligned with API shapes for menu (`categories`, items, modifiers, flavours), cart quote (`lines`, `totals`, fulfillment), and checkout request/response.
- [x] **`apps/web/src/lib/api.ts`** — `apiFetch` / `apiJson` with CSRF cookie, optional `X-Location-Id`, `credentials: "include"` for cart quote and checkout.
- [x] **`apps/web/src/lib/format.ts`** — `cents()` for displaying money in menu/cart/checkout.
- [x] **`apps/web/src/lib/env.ts`** — `getPublicApiBase()`, realtime origin, `DEFAULT_LOCATION_ID` / `NEXT_PUBLIC_DEFAULT_LOCATION_ID`.
- [x] **`apps/web/src/lib/cart.ts`** — Client cart store: add/remove/update quantity, clear, stable line keys for modifier selections, `fulfillment_type` (`PICKUP` | `DELIVERY`), `location_id` from `DEFAULT_LOCATION_ID` (`apps/web/src/lib/env.ts` → `NEXT_PUBLIC_DEFAULT_LOCATION_ID`).
- [x] **`apps/web/src/components/cart-provider.tsx`** — React context wiring the cart store for the app shell.
- [x] **`apps/web/src/components/nav-bar.tsx`** — Primary navigation (home, menu, cart, checkout).
- [x] **`apps/web/src/app/layout.tsx`** — Wraps children with `CartProvider` and global nav; imports **`globals.css`** for shared layout/typography.
- [x] **`apps/web/src/app/globals.css`** — Styles for menu tabs/cards, cart table, checkout form, and state messaging (success/error).
- [x] **`apps/web/src/app/menu/menu-client.tsx`** + **`page.tsx`** — Category tabs, item grid, opens **`item-modal`** for modifiers/flavours/quantity; uses public menu fetch + cart add.
- [x] **`apps/web/src/components/item-modal.tsx`** — Modifier groups (required/min/max), flavour choice, quantity, add-to-cart.
- [x] **`apps/web/src/app/cart/cart-client.tsx`** + **`page.tsx`** — Line items with quantity controls, remove, fulfillment toggle, live **`POST /api/v1/cart/quote`** refresh (debounced), displays quote totals and validation errors from the API.
- [x] **`apps/web/src/app/checkout/checkout-client.tsx`** + **`page.tsx`** — Order review, customer details, **`POST /api/v1/checkout`** with **`Idempotency-Key`** header, loading/success/error states; success path surfaces order id/number for tracking (aligns with existing order pages where applicable).
- [x] **Removed** obsolete standalone **`cart-quote-client.tsx`** — quote is integrated into the cart page.
- [x] **TypeScript strictness** — `useRef` for debounce timers initialized so `ReturnType<typeof setTimeout>` and cleanup are type-safe.
- [x] **Dev wiring (unchanged contract)** — Next rewrites proxy **`/api/*`** to the API (`apps/web/next.config.ts`: `API_PROXY_TARGET`, default **`http://127.0.0.1:3001`**); web dev server typically **`http://localhost:3000`**. Run API (`npm run dev:api` or workspace equivalent) alongside **`npm run dev`** in `apps/web`. Set **`NEXT_PUBLIC_DEFAULT_LOCATION_ID`** to the seeded location UUID (e.g. `LON01` from seed) for correct cart/checkout routing.

**In simple terms:**  
Customers can browse the full menu with modifiers, build a cart locally, see server-calculated totals and fees from the real quote endpoint, choose pickup or delivery, and submit checkout once with idempotency — without relying on a throwaway “quote only” page.

**What was verified:**  
`npm run build:web` / `tsc` for the web app passes on the maintainer machine. **Browser E2E** for this flow was not recorded as automated; **cart quote and checkout** require an authenticated **CUSTOMER** session (see `apps/web` auth/OTP routes). Money-path trust still gated by [`issues.md`](./issues/issues.md) Issue 1 for wallet/refund ledger alignment.

---

### 42. Order tracking and My Orders — detail, list, cancel, realtime

- [x] **`apps/web/src/lib/types.ts`** — Added `OrderStatus` union, `TERMINAL_STATUSES` / `ACTIVE_STATUSES` sets, `OrderSummary`, `OrderDetail` (with nested `OrderItem`, `OrderItemModifier`, `OrderItemFlavour`, `OrderStatusEvent`, `OrderPayment`), `ChatMessage`, `ChatResponse`, `SupportTicketType`, `SUPPORT_TICKET_TYPES`.
- [x] **`apps/web/src/lib/format.ts`** — Added `shortTime`, `shortDate`, `relativeTime`, `statusLabel` helpers alongside existing `cents`.
- [x] **`apps/web/src/app/orders/[orderId]/order-detail-client.tsx`** (new) — Fetches order via `GET /api/v1/orders/:id`, renders items/modifiers/flavours, totals, status badge (active vs terminal), ETA, status timeline, cancel button (visible only while `cancel_allowed_until` is in the future and order is non-terminal), cancel via `POST /api/v1/orders/:id/cancel`. Subscribes to `order:{orderId}` realtime channel and refreshes on `order.accepted`, `order.status_changed`, `order.cancelled`, `order.driver_assigned`, `order.delivery_started`, `order.eta_updated`.
- [x] **`apps/web/src/app/orders/[orderId]/page.tsx`** — Replaced placeholder with `OrderDetailClient`, passes `orderId` from route params.
- [x] **`apps/web/src/app/account/orders/[orderId]/page.tsx`** — Reuses the same `OrderDetailClient` (single implementation, two routes).
- [x] **`apps/web/src/app/account/orders/orders-list-client.tsx`** (new) — Fetches `GET /api/v1/orders` with cursor pagination, splits into active/past tabs using `ACTIVE_STATUSES` / `TERMINAL_STATUSES`, renders order cards with number, status badge, fulfillment type, total, relative time, ETA on active orders. "Load more" for cursor pagination.
- [x] **`apps/web/src/app/account/orders/page.tsx`** — Replaced placeholder with `OrdersListClient`.
- [x] **`apps/web/src/components/nav-bar.tsx`** — Added "Orders" link to nav bar.
- [x] **`apps/web/src/app/globals.css`** — Added styles for order header/meta/ETA, status badges (active/terminal), cancel button (`.btn-danger`), timeline (left-border + dots), orders list cards, chat bubbles (own/other with sender label + timestamp), chat input row, responsive breakpoints.

**In simple terms:**  
Customers can now see all their orders split into active and past tabs, tap into any order for full detail (items, totals, timeline, ETA), cancel within the allowed window, and watch status updates arrive in real time via WebSocket — without polling.

**What was verified:**  
`tsc --noEmit` passes with zero errors. All API shapes match the backend serializers. Realtime channel names match the gateway subscription pattern. **Browser E2E** requires an authenticated CUSTOMER session.

---

### 43. Chat and support entry — live chat on active orders, support tickets on terminal

- [x] **`apps/web/src/components/order-chat.tsx`** (new) — Embedded in order detail. On active orders: fetches `GET /api/v1/orders/:id/chat`, renders messages (own = right-aligned accent, other = left-aligned grey, with sender surface label and relative timestamp), input + send via `POST /api/v1/orders/:id/chat`, subscribes to `chat:{orderId}` realtime channel for instant message arrival. On terminal orders: shows read-only message history with "closed" indicator, no input. Scrolls to bottom on new messages.
- [x] **`apps/web/src/components/support-ticket-form.tsx`** (new) — Shown on terminal-order detail as a "Need help?" button that expands into a form: issue type dropdown (all 8 `SUPPORT_TICKET_TYPES`), subject, description, submits via `POST /api/v1/support/tickets` with `order_id`. Shows success confirmation or error.
- [x] **Order detail integration** — Chat section always present below order items/totals. Support ticket section appears only on terminal orders, below chat.

**In simple terms:**  
Customers can message the store about their active order and see replies in real time. Once an order ends, the chat becomes read-only and a support ticket form appears so customers can report issues (wrong item, missing item, cold food, etc.) without leaving the order screen.

**What was verified:**  
`tsc --noEmit` passes with zero errors. Chat and support endpoints match the backend controller/service contracts. Realtime channel for chat matches the gateway pattern. **Browser E2E** requires an authenticated CUSTOMER session.

---

### 44. Real menu import — 14 categories, per-size wing/combo cards, 65 flavours, modifier slots

- [x] **`packages/database/prisma/seed.ts`** — Complete rewrite. Location address updated to real store (1544 Dundas Street East, London, ON N5W 3C1). 14 categories in menu order: Lunch Specials, Wings, Wing Combos, Burgers, Tenders, Wraps, Poutines & Sides, Specialty Fries, Appetizers, Breads, Specials, Drinks, Dessert, Dips.
- [x] **Wings** — 6 real size cards (1 lb through 5 lb) with correct docx pricing ($12.99–$58.99), each with `builder_type: "WINGS"`.
- [x] **Wing Combos** — 5 real size cards (1 lb through 5 lb) with correct docx pricing ($17.99–$79.99), descriptions matching the combo inclusions, each with `builder_type: "WING_COMBO"`.
- [x] **Removed** old `Sauce` (5-option multi-select), `Size` (6pc/12pc/24pc), and generic `Extras` modifier groups. No `Wing Weight` or `Wing Combo Weight` groups exist.
- [x] **Wing Type** — Required single-select group: House Breaded Bone-In, Non-Breaded Bone-In, Boneless. Attached to every wing and combo card.
- [x] **Flavour slots** — 3 groups (`Flavour 1`, `Flavour 2`, `Flavour 3`), each required single-select with 65 options (one per `wing_flavours` row, linked via `linkedFlavourId`). Attached per card: 1–2 lb get 1 slot, 3–4 lb get 2, 5 lb gets 3.
- [x] **Side slots** — 2 groups (`Side 1`, `Side 2`), each required single-select with Fries / Onion Rings / Wedges / Coleslaw. 1–2 lb combos get 1 side, 3–5 lb combos get 2.
- [x] **Extras** — Optional multi-select (0–5): Extra Sauce, Ranch Dip, Blue Cheese Dip, Chipotle Dip. Attached to wing and combo cards.
- [x] **65 wing flavours** imported from the real menu docx, categorized as MILD / MEDIUM / HOT / DRY_RUB, with unique slugs and `linkedFlavourId` wiring on modifier options.
- [x] **Appetizers** — Renamed from `appetizers-extras`; garlic breads moved to new **Breads** category.
- [x] **All other categories** populated with real items and docx pricing: lunch specials ($9.99 each), burgers ($7.99–$9.99), tenders ($6.99–$23.99), wraps ($9.99), poutines/sides (small/large), specialty fries, appetizers, breads (plain/cheese/cheese & bacon × 4pc/8pc), specials (Wings-4-U Special $43.99), drinks, dessert, dips.
- [x] **`apps/web/src/wingkings/components/menu-page.tsx`** — Removed `Wing Weight` modifier ladder rendering. Updated emoji map (`appetizers-extras` → `appetizers`, added `breads`, `poutines-and-sides`). Wing/combo cards with required modifiers now show "CUSTOMIZE" and open the shared `ItemModal` picker instead of direct-adding. Combo note displayed below wing combo grid.
- [x] **`apps/web/src/wingkings/components/global-style.tsx`** — Added `.wk-combo-note` style.
- [x] **`apps/api/test/app.e2e-spec.ts`** — Menu test assertion updated from "bone-in" to "pound" to match new wing item names.

**In simple terms:**  
The seed now creates the full real Wings 4 U menu with correct pricing from the store document. Wings and combos are individual cards per size (not a single card with a weight picker), each requiring the customer to choose wing type, the correct number of flavours, and sides for combos. The old 5-sauce placeholder is replaced by all 65 real flavours. Appetizers and breads are separate tabs.

**What was verified:**  
`tsc --noEmit` passes for both `apps/web` and the seed file. No schema or migration changes needed — all data fits existing Prisma models. The e2e test assertion was updated to match the new item naming. **Runtime verification** requires re-seeding a fresh database (`truncate + seed`) and confirming the API returns the new categories/items.
---

## Progress Entry - 2026-03-24

### 45. `/order` fulfillment type now stays aligned across the URL, menu API, and cart state

- [x] The `/order` page now keeps pickup / delivery synchronized between the URL query param and the cart state.
- [x] Changing fulfillment type on the order page now updates the real order state instead of only changing the menu fetch mode.
- [x] The order page now includes an in-page fulfillment control so the customer can change pickup vs delivery without going back to the landing page.

**In simple terms:**  
Pickup or delivery is now treated as one consistent choice in the order flow instead of one value for the menu API and a different hidden value for the cart.

**What was verified:**  
`npx tsc --noEmit` in `apps/web`.

---

### 46. Menu duplicate-size cards were collapsed and the live `LON01` catalog was normalized

- [x] The `/order` menu now shows one customer-facing card for size-based poutines, sides, and breads instead of duplicate small / large or 4pc / 8pc cards.
- [x] A detailed implementation note now exists at [`menu-size-normalization-and-grouped-cards.md`](./menu-size-normalization-and-grouped-cards.md).
- [x] `whatever-u-just-did.md` now links to that follow-up note for the later menu normalization pass.

**In simple terms:**  
The menu is cleaner now. Customers see one product card with size info instead of multiple near-duplicate cards, and the live London catalog was cleaned up to match that model.

**What was verified:**  
- `npx tsc --noEmit` in `apps/web`
- `npx tsc -p tsconfig.json --noEmit` in `packages/database`
- Live `LON01` menu data was re-checked after normalization and `/api/v1/menu` returned the normalized size-group shape

---

### 47. Pickup / delivery scheduling now persists across `/order`, cart, and checkout

- [x] The order flow now keeps the selected fulfillment date and time in shared client state instead of treating them as display-only labels on the menu page.
- [x] Cart quote and checkout now send `scheduled_for`, so backend validation and order creation use the same chosen schedule instead of always using the current time.
- [x] Pickup and delivery ETA windows now follow location settings values, with `LON01` aligned to pickup `15-20` minutes and delivery `~30` minutes.

**In simple terms:**  
Customers can now choose pickup or delivery date and time on `/order`, keep that choice across the app until checkout, and place the order with the same saved schedule instead of losing it between screens.

**What was verified:**  
- `npx tsc --noEmit` in `apps/web`
- `npx tsc --noEmit` in `apps/api`
- `npx tsc --noEmit -p packages/database/tsconfig.json`
- Live `LON01` location settings were updated to pickup `15-20` minutes and delivery `30` minutes

---

### 48. `/order` wide-screen layout and add-to-cart modal behavior were stabilized across different displays

- [x] The tan menu surface now expands more appropriately on large monitors instead of leaving excessive black side space.
- [x] The shared add-to-cart modal now stays above the navbar and sticky order/menu bars when the browser window changes screen size while the modal is already open.

**In simple terms:**  
The order page now looks more balanced on big screens, and the popup builder no longer slips behind the header when the browser window is moved between displays.

**What was verified:**  
`npx tsc --noEmit` in `apps/web`.

---

### 49. `/order` no longer shows `ASAP (~undefined min)` when the local menu payload is missing newer timing fields

- [x] The frontend scheduling layer now falls back safely to pickup `15-20` and delivery `30` minutes if the current `/menu` response does not include the new timing min/max fields.
- [x] The order page no longer depends on the locally running API process already being restarted to avoid broken ETA text.

**In simple terms:**  
Even if the local API is still serving the older menu response shape, the order page now shows a real pickup or delivery ETA instead of `undefined`.

**What was verified:**  
- `npx tsc --noEmit` in `apps/web`
- Direct inspection of the local `/api/v1/menu` response confirmed the running process was still missing the newer timing fields, and the frontend fallback was added for that runtime condition

---

## Progress Entry - 2026-04-06

### 50. Dedicated `/sauces` showcase page and home-page navigation

- [x] The home-page `SAUCES` button now routes to a dedicated `/sauces` page instead of only scrolling to the existing home-section sauces block.
- [x] A new `/sauces` route now exists in the web app with its own metadata and dedicated page component.
- [x] The `/sauces` page now includes the requested fixed hero navbar, orange dot-grid backdrop, large `70+ FLAVOURS` hero treatment, animated flavour counters, scrolling marquee, and live search bar UI.
- [x] The page now uses a curated 71-flavour showcase list grouped into Mild, Medium, Hot, and Dry Rub categories to match the requested counts and presentation.
- [x] The shared WingKings shell now bypasses the default site navbar / footer / ember frame on `/sauces` so the custom page layout can render cleanly without double headers.
- [x] The new page includes live client-side filtering so the flavour count updates as the user types.

**In simple terms:**  
The home page now sends users to a full dedicated sauces experience instead of jumping them down the landing page. That new page matches the requested visual direction much more closely and gives users a searchable showcase of the available flavour lineup.

**Important reality check:**  
This page is currently a **designed showcase**, not a live API-driven sauce catalog. The flavour list and category totals are curated in the frontend to match the requested design and counts. If you want this page tied directly to the seeded database / live menu payload next, that should be a follow-up task.

**What was verified:**  
`npm run build --workspace @wings4u/web`

---

## Progress Entry - 2026-04-07

### 51. Detailed implementation procedure added for the item customization, wings builder, and combo builder work

- [x] A new implementation procedure document now exists at [`WingsCardBuilder.md`](./WingsCardBuilder.md).
- [x] The new procedure records the full end-to-end work for the PRD-aligned builder implementation across database, API, frontend, downstream order display, and KDS-facing display.
- [x] The document includes a phase-by-phase explanation of:
  - data model and seed work
  - API changes
  - frontend type/cart/checkout work
  - builder UI implementation
  - downstream display updates
- [x] The document includes a file-by-file inventory of the major files that were added or changed.
- [x] The document also records the verification steps that were completed and the important remaining follow-through items, such as database migration / re-seed and final end-to-end runtime testing.

**In simple terms:**  
There is now one dedicated procedure note that explains the builder project in detail, instead of leaving the implementation knowledge scattered across code changes and chat history.

**Why this matters:**  
This makes the builder work much easier to review later. It gives you one place to understand what changed in the database, backend, frontend, cart flow, checkout flow, order detail, and KDS display.

**What was verified:**  
Documentation file created successfully at [`WingsCardBuilder.md`](./WingsCardBuilder.md). No build/test rerun was required because this was a documentation-only addition.

---

### 52. Builder UX follow-up verification note added for scroll containment, PRD alignment, and remaining gaps

- [x] A new verification note now exists at [`fixed issues2.md`](./issues/fixed%20issues2.md).
- [x] The note records a detailed code-vs-plan-vs-PRD review for the builder UX follow-up work.
- [x] It confirms that scroll containment, body scroll locking, the interim white/black builder shell, and tender overlay routing are implemented in code.
- [x] It also records the main remaining gaps:
  - wings builder now follows the newer requested UX, but not the literal PRD step order
  - boneless preparation now requires explicit confirmation instead of PRD-style auto-skip
  - combo builder still does not fully mirror the wings builder chrome
  - add-on behavior is broader than the strictly optional wording in PRD Section 4.6

**In simple terms:**  
There is now one place that clearly explains which parts of the builder follow-up are actually finished, which parts only match the newer requested UX, and which parts still need manual follow-through if strict PRD alignment is the goal.

**Why this matters:**  
This prevents the builder work from being treated as fully signed off when some of the current behavior now intentionally differs from the PRD and some smaller parity issues still remain.

**What was verified:**  
`npm run build --workspace @wings4u/web` and direct code inspection across the builder, overlay, routing, and shared styling files. See [`fixed issues2.md`](./issues/fixed%20issues2.md) for the archived detailed breakdown.

---

### 53. BuilderShell / compact progress refactor verified, with one remaining live legacy-modal caveat

- [x] The primary builder UX shell refactor has now been re-verified in code and documented in detail at [`fixed issues2.md`](./issues/fixed%20issues2.md).
- [x] The four main overlay consumers now use the shared `BuilderShell`:
  - wings builder
  - combo builder
  - item customization overlay
  - item modal
- [x] The duplicated progress-strip labels were replaced with a compact single-line progress indicator.
- [x] The builder footer is now pinned outside the scroll region, so add-to-cart stays visible.
- [x] The overlay z-index was raised so the builder sits above the `/order` sticky bars.
- [x] The latest web build passed after verification.
- [x] One caveat remains: the branded `/order` page still has a live [`legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx) path, so the claim that "everything now uses one shell" is not yet literally true.

**In simple terms:**  
The main builder-shell fix is working and the important UX problems were addressed, but there is still one older grouped-size modal path on `/order` that has not been migrated into the shared shell yet.

**Why this matters:**  
This keeps the documentation honest. The primary fix is real and verified, but the repo should not claim complete universal modal-shell unification until the legacy size-picker path is handled too.

**What was verified:**  
`npm run build --workspace @wings4u/web` plus direct code inspection of the shared shell, the main builder consumers, the global builder CSS, and the remaining `LegacySizePickerModal` usage. Archived detail: [`fixed issues2.md`](./issues/fixed%20issues2.md).

---

### 54. Final shell-unification follow-up completed and local API non-JSON error clarified

- [x] The last live grouped-size modal path on the branded `/order` flow was migrated onto the shared `BuilderShell`.
- [x] The old grouped-size modal shell in [`legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx) no longer uses `.modal-backdrop`, `.modal-panel`, or `.wk-modal-footer`.
- [x] The dead legacy modal CSS blocks were removed from [`globals.css`](../../apps/web/src/app/globals.css).
- [x] A new detailed note now exists at [`issues2.md`](./issues/issues2.md), and the previous builder verification note was archived to [`fixed issues2.md`](./issues/fixed%20issues2.md).
- [x] The web API client error handling was improved so the vague `API returned non-JSON (500 Internal Server Error): Internal Server Error` message now explains the likely local cause more clearly.
- [x] The latest web build passed after these changes.

**In simple terms:**  
The remaining shell caveat is now fixed: the live `/order` flow no longer has that older grouped-size popup using a separate modal shell. The local API error message is also clearer now, so when the API server is down the web app points you toward the real cause faster.

**Why this matters:**  
This closes the last real gap in the builder-shell unification work and reduces confusion during local development when the web app is up but the API process is not.

**What was verified:**  
`npm run build --workspace @wings4u/web`, direct code inspection of the legacy size-picker path and `BuilderShell` usage, and local endpoint probing that confirmed the current non-JSON 500 case was caused by the API on `127.0.0.1:3001` not being reachable. Full detail: [`issues2.md`](./issues/issues2.md).

---

### 55. Wings/combo drinks, sides, saucing, and API follow-up verified and issue notes reorganized

- [x] All issue-note markdown files were moved into the new [`issues`](./issues) folder under `Docs/procedures`.
- [x] Cross-links were updated so the main docs now point to the moved issue register and archived issue notes from their new location.
- [x] A new detailed verification note now exists at [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./issues/wing-combo-wings-drinks-sides-saucing-and-api-fix.md).
- [x] That note records the code-vs-plan verification for:
  - the `X-Location-Id` wing-flavour request fix
  - hidden step-progress scaffolding
  - improved combo-size copy
  - expanded drink options
  - combo size to side/drink slot rules
  - PRD-aligned saucing behavior
- [x] The note also records the two important caveats:
  - the combo drink/side changes require a reseed or data update before they show up in a live database
  - single-flavour orders still render a saucing section visually even though the logic already skips it
- [x] Verification passed with:
  - `npm run build --workspace @wings4u/web`
  - `npx tsc --noEmit -p packages/database/tsconfig.json`

**In simple terms:**  
The wings/combo follow-up fix is mostly real and verified, and the issue notes are now organized in their own folder instead of being mixed into the main procedures directory.

**Why this matters:**  
This keeps the docs easier to navigate and makes the verification honest. The implementation is strong, but the note clearly says what still depends on reseeding and what still differs slightly from the PRD.

**What was verified:**  
Direct code inspection of the shared builder code, wings builder, combo builder, shared types, and seed data, plus a passing web build and a passing package-level TypeScript check for the database package. Full detail: [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./issues/wing-combo-wings-drinks-sides-saucing-and-api-fix.md).

---

### 56. Remaining builder PRD gaps closed and documented

- [x] Single-flavour wings and combo orders no longer show a saucing step.
- [x] The non-wing customization overlay now uses a clearer ingredient-first removal layout instead of the older chip-first presentation.
- [x] Paid extras now render in a dedicated `Add extras (optional)` section below ingredient removal.
- [x] Seed data now attaches reusable add-on groups to burgers, wraps, poutines, and specialty fries.
- [x] A new runtime sync script now exists so the active database can be aligned with the latest builder configuration without relying only on a full reseed.
- [x] The new current issue note and fixed issue note were added in the usual detailed format.

**In simple terms:**  
This closes the builder follow-up that was still making the ordering flow feel slightly unfinished. The UI is now closer to the PRD, and the live database has a safer path to stay aligned with that UI.

**What was verified:**  
- `npm run build --workspace @wings4u/web`  
- `npm run build --workspace @wings4u/api`  
- `npx tsx packages/database/prisma/seed.ts`  
- `npx tsx packages/database/prisma/sync-builder-config.ts --location-code LON01`

**Where the full detail lives:**  
- Current issue note: [`issues2.md`](./issues/issues2.md)  
- Fixed implementation note: [`fixed issues2.md`](./issues/fixed%20issues2.md)

---

### 57. Cart quote auth-token failure documented

- [x] A new current issue note was added at [`cart-quote-auth-token_issue.md`](./issues/cart-quote-auth-token_issue.md).
- [x] The note explains that the cart page calls protected `POST /api/v1/cart/quote` and that the API requires a valid customer `access_token` cookie.
- [x] The note explains why the cart can still show a visible total while also showing `Missing or invalid authentication token`: the UI falls back to a local subtotal when the server quote fails.
- [x] The note records the likely session-level triggers honestly:
  - not logged in as a customer
  - expired 15-minute access token
  - host mismatch such as `localhost` versus `127.0.0.1`
  - or another missing/cleared cookie case
- [x] The note also states clearly that the backend cause was verified by code inspection, but the exact cookie state of the reported browser session was not fully runtime-proven.

**In simple terms:**  
The cart error is being caused by auth, not by pricing logic. The page still shows a total because it has a local fallback subtotal, but the real server quote is failing before it can return tax and final payable numbers.

**Why this matters:**  
This prevents the issue from being misdiagnosed as a cart-total bug and gives a clear starting point for the real fix: either session handling, login gating, token refresh, or guest-quote behavior.

**What was verified:**  
Direct code inspection of the cart page, shared API client, protected cart quote controller, auth guard, auth cookie issuance, and the existing e2e test that already expects `POST /cart/quote` without auth to return `401`. Full detail: [`cart-quote-auth-token_issue.md`](./issues/cart-quote-auth-token_issue.md).

---

### 58. Admin menu leftovers verified and documented

- [x] Shared admin-menu types were moved out of the client component so modal imports no longer depend on `admin-menu-client.tsx`.
- [x] The category sidebar row was restructured to avoid nesting an edit button inside another button.
- [x] A dedicated walkthrough was added at [`walkthrough.md`](./issues/walkthrough.md) for the admin menu leftovers pass.
- [x] The admin menu leftovers issue note now links to the walkthrough for manual verification.









