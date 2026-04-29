# PRD §26 — Admin Dashboard & Business Operations — Fix Note

Last updated: 2026-04-13

---

## Quick Summary

PRD section 26 backend foundations are now implemented: admin widgets, sales reporting, product performance queries, policy-based role gating, audit module plumbing, location settings configuration endpoints with audit capture, and global admin search.

This pass makes the API ready for the admin frontend to consume unified dashboard/reporting endpoints. It does **not** yet implement the admin web UI itself (the admin home page in `apps/web` is still a placeholder).

---

## Purpose

Record what was implemented for PRD section 26, what files were added/changed, and what proof exists (typecheck/build/test), in the repository’s standard fixed-note format.

---

## How To Read This Note

- Read `What changed` for the functional deliverables by PRD subsection.
- Read `Files reviewed / files changed` to see the concrete implementation locations.
- Read `Verification run` to see what was actually proven in this pass.
- Read `Remaining caveats` for what is still missing or partially implemented.

---

## What the issue was

PRD section 26 requires an admin “command centre” that shows operational KPIs at a glance (dashboard widgets), supports sales and product performance reporting with date range filters, enforces role-based permissions server-side, and guarantees critical action auditing.

Before this pass, the admin frontend home screen was a placeholder and the backend lacked report endpoints needed to power a real admin dashboard.

---

## Why it mattered

Without these admin endpoints and permission/audit structure:

- staff and managers cannot access real-time operational states quickly (active orders, driver states, shifts)
- the business cannot produce reliable sales/product insights without ad hoc scripts
- sensitive operations risk being under-audited or inconsistently gated

---

## What changed

### Admin Home Widgets (§26.1)

Implemented a single report query surface that returns the 8 widget values required by §26.1, computed directly from canonical operational tables at query time.

- **Service**: `ReportsService.getAdminWidgets(locationId)`
- **Endpoint**: `GET /api/v1/reports/widgets` (location comes from `X-Location-Id` via `LocationScopeGuard`)
- **Returned fields**:
  - `active_orders`
  - `sales_today_cents`
  - `employees_clocked_in`
  - `drivers_on_delivery`
  - `low_stock_items`
  - `open_support_tickets`
  - `pending_catering_inquiries`
  - `open_registers`

Implementation note:

- Widgets are computed from `orders`, `employee_shifts`, `driver_profiles`, `support_tickets`, `catering_inquiries`, `register_sessions`, and a raw query for low-stock inventory items.

### Sales Dashboard (§26.2)

Implemented a sales dashboard query surface with time range scoping and hourly bucketing.

- **Service**: `ReportsService.getSalesDashboard(locationId, startDate, endDate)`
- **Endpoint**: `GET /api/v1/reports/sales?start_date=...&end_date=...`
- **Key outputs implemented**:
  - `timeline` (hourly buckets)
  - `source_breakdown`
  - `fulfillment_breakdown`
  - plus: `average_order_value_cents`, `payment_method_breakdown`, `total_refunds_cents`, `total_discounts_cents`

### Product Performance (§26.3)

Implemented product performance queries using canonical `order_items` and `order_item_modifiers` snapshots.

- **Service**: `ReportsService.getProductPerformance(locationId, startDate, endDate)`
- **Endpoint**: `GET /api/v1/reports/products?start_date=...&end_date=...`
- **Key outputs implemented**:
  - `top_items` (quantity + revenue)
  - `least_items` (quantity)
  - `top_modifiers` (quantity + revenue via raw SQL \(SUM(quantity * price_delta_cents)\))
  - `sold_out_frequency` (currently approximated via `inventory_adjustments.reason_text ILIKE '%sold out%'`)

### Permissions and Gatekeeping (§26.4)

Introduced policy-style role specs used by controllers to enforce server-side access rules consistently.

- **Policies**: `POLICIES` in `apps/api/src/common/policies/permission-matrix.ts`
  - `ADMIN_ONLY`
  - `MANAGER_OR_ADMIN`
  - and related staff policies

Applied to:

- reports endpoints (`MANAGER_OR_ADMIN`)
- locations settings write endpoint (`ADMIN_ONLY`)

### Audit Log / Governance completeness (§26.5)

Added an injectable audit module with helpers for consistent append-only audit writes.

- **Module**: `AdminAuditModule`
- **Service**: `AdminAuditService` (`logAction`, `logActionTx`, `getRecentLogs`)

Note: existing admin flows already write audit logs directly inside `AdminService.createAuditLog()`. The new audit module provides a clean injected abstraction for future modules (register, inventory, promos) to use.

### Store Settings Panel backend mapping (§26.6)

Added a location settings service + controller endpoints for admin-configurable business rules stored in canonical `location_settings`.

- **Service**: `LocationSettingsService`
  - `getSettings(locationId)`
  - `updateSettings(locationId, data, actorUserId)` (writes an audit entry)
- **Controller**: `LocationsController`
  - `GET /api/v1/locations/:locationId/settings` (MANAGER_OR_ADMIN)
  - `PATCH /api/v1/locations/:locationId/settings` (ADMIN_ONLY)

### Global Admin Search (§26.7)

Added global search endpoint under admin, backed by a multi-entity query fanout.

- **Endpoint**: `GET /api/v1/admin/search?q=...`
- **Service**: `AdminService.globalSearch(locationId, query)` returning:
  - orders (by number/name/phone/email snapshot)
  - support tickets (subject/description)
  - customers (user identities email/phone match)

### Fixing system health

TypeScript compilation of the API workspace passes cleanly after the changes (no TS syntax/type errors found in this pass).

---

## Files reviewed / files changed

### New or expanded backend feature surface (reports)

- `apps/api/src/modules/reports/reports.service.ts`
- `apps/api/src/modules/reports/reports.controller.ts`
- `apps/api/src/modules/reports/reports.module.ts`

### Policies / permissions

- `apps/api/src/common/policies/permission-matrix.ts`

### Audit module

- `apps/api/src/modules/admin-audit/admin-audit.service.ts`
- `apps/api/src/modules/admin-audit/admin-audit.module.ts`

### Location settings

- `apps/api/src/modules/locations/location-settings.service.ts`
- `apps/api/src/modules/locations/locations.controller.ts`
- `apps/api/src/modules/locations/locations.module.ts`

### Admin search

- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/modules/admin/admin.controller.ts`

### Wiring

- `apps/api/src/app.module.ts` (module import wiring)

### Documentation

- `Docs/procedures/issues/prd_point_26_plan.md`
- `Docs/procedures/issues/prd_point_26_fix.md` (this file)

---

## Verification run

Verified in this pass:

- Code inspection of the above files to confirm endpoints and query shapes exist.
- API typecheck:
  - `npx tsc --noEmit --project apps/api/tsconfig.json` (passes)
- Unit tests:
  - `npx jest --config apps/api/jest.config.json --passWithNoTests` (passes; 63 tests)

Not verified in this pass:

- HTTP+DB E2E runtime verification of the new `/reports/*` endpoints.
- Admin web UI rendering (admin home is still placeholder in `apps/web`).

---

## Remaining caveats

1. **Admin frontend not implemented**
   - `apps/web/src/app/admin/page.tsx` still needs the dashboard widget UI and report pages.

2. **Widgets depend on existing operational modules**
   - `low_stock_items`, `pending_catering_inquiries`, and `open_registers` require those domains to be fully implemented and populated. If inventory/catering/register are still scaffold-only in runtime DB, widgets can return 0 even if queries are correct.

3. **Location scoping consistency**
   - Reports endpoints are correctly scoped via `LocationScopeGuard` + `X-Location-Id` in the current controller implementation.

4. **Sold-out frequency is an approximation**
   - Current implementation uses a `reason_text` contains “sold out” heuristic. If the product needs a stricter sold-out event model, this should be upgraded to canonical sold-out events rather than string matching.

---

## Follow-up Verification — Fixes After Initial Review

Last updated: 2026-04-13

### Quick Summary

This follow-up records the verification of targeted fixes that were applied after the initial section 26 audit: (1) correct “Employees clocked in” counting, (2) remove location-id bypass patterns in controllers, (3) flesh out sales and product dashboards to match the PRD acceptance bullets more closely, and (4) clarify audit completeness boundaries.

### What was verified in code

1. **Employees Clocked In widget now matches timeclock model**
   - `ReportsService.getAdminWidgets()` now counts shifts where:
     - `clockOutAt` is null
     - `status` is in `["CLOCKED_IN", "ON_BREAK"]`

2. **Location scoping bypass removed**
   - `ReportsController` no longer accepts `location_id` from query params; it derives `req.locationId` set by `LocationScopeGuard`.
   - `LocationsController` no longer accepts `:locationId` path param; it uses `req.locationId` from `LocationScopeGuard`.
   - Both controllers use `BadRequestException` instead of `throw new Error(...)` for missing scope inputs.

3. **Sales dashboard expanded**
   - `ReportsService.getSalesDashboard()` now additionally computes:
     - `average_order_value_cents`
     - `payment_method_breakdown` using `order_payments` grouped by `paymentMethod` with `transactionStatus = "SUCCESS"`
     - `total_refunds_cents` using issued refunds in range
     - `total_discounts_cents` using order aggregates of `itemDiscountTotalCents + orderDiscountTotalCents`

4. **Product performance expanded**
   - `ReportsService.getProductPerformance()` now includes:
     - `least_items` (bottom 20 by quantity)
     - `sold_out_frequency` via raw query on `inventory_adjustments` (heuristic string match on reason text)

5. **Audit completeness boundaries clarified**
   - Audit module exists (`AdminAuditModule` / `AdminAuditService`) and is ready to be injected.
   - Register/inventory/promo mutation audit coverage remains dependent on those mutation endpoints being implemented (still a pending domain-completeness item, not a compile-time issue).

### Files verified for this follow-up

- `apps/api/src/modules/reports/reports.service.ts`
- `apps/api/src/modules/reports/reports.controller.ts`
- `apps/api/src/modules/locations/locations.controller.ts`

### Verification run

- `npx tsc --noEmit --project apps/api/tsconfig.json` (passes)
- `npx jest --config apps/api/jest.config.json --passWithNoTests` (passes; 63 tests)

### Status

Status for this follow-up: **Verified by code inspection + API typecheck + unit tests**.

---

## Final conclusion

PRD section 26 backend foundations are implemented and compile clean. The API now exposes a unified reports surface for widgets/sales/products and provides policy-based gating plus audit helpers to support business operations work.

To call section 26 fully complete, the remaining work is primarily:

- implement the admin frontend dashboard + report pages
- add HTTP+DB E2E coverage for the new report endpoints
- finish the operational domains (register/inventory/catering) so widgets reflect real-world states

---

## Plain-English summary

The backend can now answer the admin dashboard questions (what’s happening right now, what did we sell, what products are performing) with endpoints that compute results from the real operational tables.

Permissions and auditing are set up so sensitive business operations can be safely expanded without rewriting the same gatekeeping and audit logic in every module.

---

## Verbatim provided “fix summary” (preserved)

Admin Home Widgets (§26.1): Created the getAdminWidgets() queries representing the global states: Active Orders, Sales Today, Employees clocked in, Drivers on delivery, Low-stock items, Open Support tickets, Pending catering requests, and open sessions in a newly scaffolded ReportsService.
Sales Dashboard (§26.2): Implemented getSalesDashboard() logic with time range scoping (with an easy hours fallback pattern), bucketing metrics by hourly_timeline, source_breakdown (source mapping on ONLINE/POS/etc), and fulfillment_breakdown.
Product Performance (§26.3): Created queries to slice the order history from order_items and order_item_modifiers capturing productName, quantitySold, and approximating the relative financial breakdown delta by using native $queryRaw() on your Prisma configurations for modifier margins.
Permissions and Gatekeeping (§26.4): Bound it all to your newly made POLICIES (MANAGER_OR_ADMIN, ADMIN_ONLY) through NestJS decoraters linked cleanly to AuthGuard and RolesGuard.
Auditing/Governance completeness (§26.5): We ensured services interact nicely. Although PRD requires Phase 5 (Audit completion on new actions like Register, inventory), if/when these newly scaffolded modules create mutation writes, you have an independent, properly tested admin-audit.module available to be injected.
Location Settings Configuration (Phase 8): We scaffolded global/store-scoped configuration API points under location-settings.service.ts allowing ADMIN_ONLY writes to the Location parameters (taxRateBps, deliveryFeeCents, etc), with full inline-audit captures enabled.
Global Admin Search (Phase 7): Created globalSearch(query) in admin.service.ts that cascades simultaneously into Orders (number, customer, phone), Customers (Identity email/phone matching), and Support Tickets.
Fixing System Health: Fixed up previous syntax typos from admin.service compilation, ensuring that full API builds with zero typing or Prisma errors (npx tsc cleanly passing!).
The §26 Dashboard architecture is now ready for your frontend interfaces to ingest the unified dashboard! Let me know which direction we should start on next.

12
prd_point_26_plan.md
permission-matrix.ts
admin-audit.service.ts
admin-audit.module.ts
reports.service.ts
reports.controller.ts
reports.module.ts
location-settings.service.ts
locations.controller.ts
locations.module.ts
admin.service.ts
admin.controller.ts

