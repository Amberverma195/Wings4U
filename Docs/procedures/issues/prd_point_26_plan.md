# PRD §26 Implementation Plan

This plan is scoped to your full §26 (dashboard, reporting, permissions, audit, settings, UX standards), and aligned to current repo state where admin/reporting surfaces are mostly scaffolded.

## Phase 0 — Baseline and Contracts (1 pass)
* Freeze canonical data sources: all widgets/reports read from operational/event tables (orders, order_status_events, order_payments, customer_credit_ledger, inventory_adjustments, etc.); no report-shaped tables.
* Define API contract first for:
  * admin home widgets
  * sales dashboard
  * product performance
  * settings read/write
  * global admin search
  * CSV exports
* **Files to update:**
  * `apps/api/src/modules/reports/reports.module.ts`
  * `apps/api/src/app.module.ts`
  * `Docs/Wings4U_API_Contract_v1_0.md`
  * `Docs/API_Spec/*` (if mirrored spec is used)

## Phase 1 — Admin Home Widgets (§26.1)
* Build one backend endpoint (or small endpoint set) returning all 8 widget values:
  * active orders
  * sales today
  * employees clocked in
  * drivers on delivery
  * low-stock items
  * open support tickets
  * pending catering inquiries
  * register status
* Implement admin home UI cards with live refresh and loading/empty/error states.
* **Backend files:**
  * `apps/api/src/modules/reports/*` (new controller/service)
  * `apps/api/src/modules/support/support.service.ts` (reuse count logic where possible)
  * `apps/api/src/modules/timeclock/timeclock.service.ts` (active shift count)
  * `apps/api/src/modules/kds/kds.service.ts` (live order/driver states)
* **Frontend files:**
  * `apps/web/src/app/admin/page.tsx`
  * `apps/web/src/lib/api.ts`
  * `apps/web/src/lib/types.ts`

## Phase 2 — Sales Dashboard (§26.2)
* Add date-range report endpoints (today/week/month/custom):
  * gross sales, order count, AOV
  * payment split (cash/card/credit)
  * fulfillment split (pickup/delivery)
  * source split (online/pos/phone/admin)
  * top-selling items
  * refunds/store-credit totals
  * discount totals
* Add admin sales dashboard page with filters, cards, and tables/charts.
* **Backend files:**
  * `apps/api/src/modules/reports/*` (new sales queries)
  * `apps/api/src/modules/admin/admin.controller.ts` (if keeping report routes under admin)
* **Frontend files:**
  * `apps/web/src/app/admin/*` (new sales route/client)
  * `apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts`

## Phase 3 — Product Performance Reporting (§26.3)
* Add report endpoints for:
  * best sellers by quantity + revenue
  * least ordered items
  * modifier popularity
  * sold-out frequency
* Build product performance page with range filters and sortable tables.
* **Backend files:**
  * `apps/api/src/modules/reports/*`
  * `apps/api/src/modules/catalog/*` (reuse menu/modifier metadata)
* **Frontend files:**
  * `apps/web/src/app/admin/*` (new product-performance route/client)

## Phase 4 — Role and Permission Enforcement (§26.4)
* Convert role rules from docs into enforceable backend policy matrix.
* Ensure server-side permission checks for each sensitive action (not just UI hiding).
* Extend existing roles guard/policy usage for Manager/Kitchen/Cashier/Admin boundaries.
* **Backend files:**
  * `apps/api/src/common/guards/roles.guard.ts`
  * `apps/api/src/common/decorators/roles.decorator.ts`
  * `apps/api/src/common/policies/permission-matrix.ts`
  * Relevant controllers (kds, pos, admin, timeclock, orders, refunds)

## Phase 5 — Audit Log Completeness (§26.5)
* Verify every critical action writes `admin_audit_logs`:
  * order status changes, refunds, credits, promos, punch edits, drawer opens, inventory adjustments, restock exports, manual discounts, prepayment overrides.
* Add missing writes + standard payload fields (actor, reason, entity, metadata).
* Add read-only admin audit viewer endpoint if needed.
* **Backend files:**
  * `apps/api/src/modules/admin/admin.service.ts`
  * `apps/api/src/modules/admin-audit/admin-audit.module.ts` (+ new controller/service if needed)
  * Action modules that currently miss audit writes (register, inventory, promotions once implemented)

## Phase 6 — Store Settings Panel (§26.6)
* Implement settings APIs mapped to canonical tables:
  * `location_settings` (thresholds/flags)
  * `location_hours` (store + delivery windows)
  * `promo_codes` defaults where applicable
* Build admin settings page with immediate-effect updates and validation.
* **Backend files:**
  * `apps/api/src/modules/locations/locations.module.ts` (+ controller/service)
  * `apps/api/src/modules/promotions/promotions.module.ts` (+ controller/service)
* **Frontend files:**
  * `apps/web/src/app/admin/*` (new settings route/client)

## Phase 7 — Admin UX Standards (§26.7)
* Implement cross-cutting UX in admin pages:
  * archive/soft-delete only
  * confirm modals for destructive/financial actions
  * global admin search
  * CSV exports on list pages
  * consistent status badges
  * empty states with primary actions
  * POS keyboard shortcuts:
    * new order, mark ready, print receipt, cash payment, drawer open (with approval), item search
* **Frontend files:**
  * `apps/web/src/app/admin/*`
  * `apps/web/src/app/pos/page.tsx`
  * shared components/utilities for badges/modals/empty-state/export/search

## Phase 8 — Testing and Acceptance Closure
* **Backend tests**
  * Add/extend E2E in `apps/api/test/*` for:
    * widget counts accuracy
    * permission boundaries per role
    * audit writes for each critical action
    * settings updates + immediate effect
    * CSV export endpoints
* **Frontend checks**
  * integration tests for widget rendering/filtering/export interactions
* **Acceptance matrix doc**
  * map each §26 acceptance criterion to test case IDs and endpoint/page references in docs under `Docs/procedures/issues/`.

## Recommended Build Order
1. Permissions + audit plumbing (Phases 4–5)
2. Dashboard + reports APIs (Phases 1–3 backend)
3. Admin web pages (Phases 1–3 frontend)
4. Settings panel (Phase 6)
5. UX standards + exports/search (Phase 7)
6. Full acceptance test pass (Phase 8)

Status: In Progress

---

# PRD §26 — Admin Dashboard & Business Operations (Plan Note)

Last updated: 2026-04-13

## Quick Summary

PRD section 26 requires a real admin command-centre: dashboard widgets, sales + product reporting, settings, exports, search, strict role-based permissions, and audit completeness.

Current repo state: the admin web home is a placeholder, most business-ops modules are scaffold-only, and reporting exists only as a single daily-tax report endpoint. This plan describes how to implement section 26 without adding report-shaped tables that drift from canonical operational data.

## Purpose

This note turns PRD section 26 into a file-and-endpoint grounded implementation plan that:

- builds widgets/reports from canonical tables and immutable event tables
- enforces permissions server-side
- ensures audit coverage for all critical operations
- delivers an admin UX that is usable day-to-day

## How To Read This Note

- Read `Problem in plain English` to understand what is missing today.
- Read `What was found` to see the current repo baseline.
- Read `What still needs to be fixed` for the phased implementation path and file targets.

## Problem in plain English

The admin panel is currently not a functional “command centre.” It does not show the 8 required widgets, does not provide the sales/product dashboards, does not provide store settings management, and does not yet provide the CSV export and global search surfaces described in section 26.

Even where operational features exist (KDS, support tickets, POS, timeclock), section 26 requires:

- consistent admin aggregation/reporting views
- strict permissions per role (admin/manager/kitchen/cashier/driver)
- complete audit logging for critical actions

## Technical path / files involved

Backend primary surfaces:

- `apps/api/src/modules/admin/admin.controller.ts`
- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/modules/reports/reports.module.ts` (currently scaffold-only)
- `apps/api/src/modules/inventory/inventory.module.ts` (scaffold-only)
- `apps/api/src/modules/register/register.module.ts` (scaffold-only)
- `apps/api/src/modules/catering/catering.module.ts` (scaffold-only)
- `apps/api/src/modules/locations/locations.module.ts` (scaffold-only)
- `apps/api/src/common/guards/roles.guard.ts`
- `apps/api/src/common/decorators/roles.decorator.ts`
- `apps/api/src/common/policies/permission-matrix.ts`
- `packages/database/prisma/schema.prisma`

Frontend primary surfaces:

- `apps/web/src/app/admin/page.tsx` (placeholder today)
- `apps/web/src/app/admin/order-changes/order-changes-client.tsx` (working)
- `apps/web/src/app/admin/reviews/reviews-client.tsx` (working)
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/types.ts`

## Why this mattered

Section 26 is not “nice to have UI.” It’s operational safety and speed:

- staff need real-time counts and actionable lists at a glance
- managers need reporting for sales, refunds, discounts, and product performance
- the business needs strong permissions and auditability for sensitive actions
- export/search reduce admin time and improve support resolution

## What was found (current repo baseline)

### Admin dashboard / widgets (26.1)

- Admin home page is placeholder only:
  - `apps/web/src/app/admin/page.tsx` renders a placeholder surface (no widgets).
- No backend “dashboard widget” endpoint exists yet.

### Reports / analytics / exports (26.2, 26.3, 26.7)

- Only one report-like endpoint exists:
  - `GET /admin/reports/daily-tax` in `apps/api/src/modules/admin/admin.controller.ts`.
- `ReportsModule` exists but is scaffold-only:
  - `apps/api/src/modules/reports/reports.module.ts`.
- No CSV export endpoints found.
- No global admin search endpoint found.

### Operations modules (inventory, catering, register, store settings)

- Scaffold-only modules:
  - `apps/api/src/modules/inventory/inventory.module.ts`
  - `apps/api/src/modules/catering/catering.module.ts`
  - `apps/api/src/modules/register/register.module.ts`
  - `apps/api/src/modules/locations/locations.module.ts`

### Existing operational systems to build from

- KDS lifecycle + staff operations exist:
  - `apps/api/src/modules/kds/*` and `apps/web/src/app/kds/kds-client.tsx`.
- POS and timeclock exist:
  - `apps/api/src/modules/pos/*`
  - `apps/api/src/modules/timeclock/*`
- Support tickets exist:
  - `apps/api/src/modules/support/*`

### Permissions and audit

- Role guard/decorator framework exists, but section 26 needs expanded action-level enforcement per employee role:
  - `apps/api/src/common/guards/roles.guard.ts`
  - `apps/api/src/common/decorators/roles.decorator.ts`
  - `apps/api/src/common/policies/permission-matrix.ts`
- Audit model and read endpoints exist, but section 26 requires coverage confirmation across all critical actions:
  - `admin_audit_logs` in `packages/database/prisma/schema.prisma`
  - audit reads/writes in `apps/api/src/modules/admin/admin.service.ts`

## What still needs to be fixed (implementation plan)

### Phase 1 — Admin home widgets (26.1)

- Backend: add a widgets endpoint that returns all 8 widget values for a location, computed from canonical tables at query time.
- Frontend: implement widget cards on `apps/web/src/app/admin/page.tsx` with empty states and actionable links.

### Phase 2 — Sales dashboard (26.2)

- Backend: add reporting endpoints with date range filters; compute splits and top items from order/payments/order-items snapshots.
- Frontend: build sales dashboard page with filters and tables.

### Phase 3 — Product performance reporting (26.3)

- Backend: implement product performance queries (best/least sellers, modifier popularity, sold-out frequency).
- Frontend: build product performance page.

### Phase 4 — Role-based permissions (26.4)

- Implement server-side permission rules for every sensitive admin/manager action listed in 26.4.
- Add regression tests to ensure cashier/kitchen roles cannot reach financial/settings endpoints.

### Phase 5 — Audit log completeness (26.5)

- Add/confirm audit writes for all critical actions listed in 26.5.
- Ensure audit log remains read-only in API and UI surfaces.

### Phase 6 — Store settings panel (26.6)

- Backend: add admin APIs that read/write `location_settings` and `location_hours` (no “settings table”).
- Frontend: implement settings page with immediate effect and validation UI.

### Phase 7 — Admin UX standards (26.7)

- Add global admin search (server + UI).
- Add CSV export endpoints + UI affordances on list pages.
- Ensure archive/soft delete patterns for entities (no hard deletes).
- Add confirmation modals for destructive/financial actions.
- Standardize badges and empty states across admin pages.

### Phase 8 — Verification + acceptance matrix

- Add E2E coverage for:
  - widget count correctness
  - permissions enforcement server-side
  - audit writes for critical actions
  - settings updates take effect
  - CSV exports produce correct data

## Verification

Verified in this plan pass:

- code inspection of current admin web placeholder and existing admin pages
- code inspection of backend module scaffolds vs implemented modules (KDS/POS/timeclock/support)

Not verified in this plan pass:

- runtime admin dashboards/reports (not implemented yet)
- E2E acceptance criteria coverage (to be added in Phase 8)

## Status

Status: **Planned / In progress**.

## Plain-English takeaway

Section 26 will be delivered by building a real admin UI on top of canonical operational data, backed by strict server-side permissions and complete audit logging, without adding report-shaped tables that drift over time.

## Final plain-English summary

Today: admin home is a placeholder and most business-ops reporting/settings surfaces are missing.

Next: implement widgets, sales/product dashboards, permissions/audit completeness, store settings UI, and export/search UX, then close with E2E acceptance proof.

---

## Appended Verification Findings (Post-Implementation Audit)

Last updated: 2026-04-13

### Quick Summary

Section 26 backend work is substantially implemented (reports endpoints, settings endpoints, policies, and admin search). The API typecheck and unit tests pass. The remaining gap is **runtime proof** (HTTP+DB E2E for the new reports/settings endpoints) and **frontend admin UI**.

### Purpose

Record what is now implemented vs what is still missing, so the plan stays honest and reviewable.

### What was verified

- **Code inspection** confirmed these implementations exist:
  - Reports:
    - `apps/api/src/modules/reports/reports.service.ts`
    - `apps/api/src/modules/reports/reports.controller.ts`
    - `apps/api/src/modules/reports/reports.module.ts`
  - Policies:
    - `apps/api/src/common/policies/permission-matrix.ts` (`POLICIES.ADMIN_ONLY`, `POLICIES.MANAGER_OR_ADMIN`)
  - Location settings endpoints + audit capture:
    - `apps/api/src/modules/locations/location-settings.service.ts`
    - `apps/api/src/modules/locations/locations.controller.ts`
    - `apps/api/src/modules/locations/locations.module.ts`
  - Admin search:
    - `apps/api/src/modules/admin/admin.controller.ts`
    - `apps/api/src/modules/admin/admin.service.ts`
  - Wiring:
    - `apps/api/src/app.module.ts` imports `ReportsModule`, `LocationsModule`, and `AdminAuditModule`.
- **Build proof (API)**:
  - `npx tsc --noEmit --project apps/api/tsconfig.json` passes.
  - `npx jest --config apps/api/jest.config.json --passWithNoTests` passes (63 tests).

### What was found (important details)

1. **Admin widgets endpoint exists and is permission-gated**
   - `GET /api/v1/reports/widgets` uses `@Roles(POLICIES.MANAGER_OR_ADMIN)` and is scoped by `LocationScopeGuard` reading `X-Location-Id`.

2. **Employees-clocked-in widget logic now matches timeclock status model**
   - Widget counts shifts with status in `CLOCKED_IN` or `ON_BREAK` (not a placeholder “ACTIVE” string).

3. **Sales dashboard coverage is broader than the original summary**
   - In addition to timeline/source/fulfillment breakdown, the service computes:
     - `average_order_value_cents`
     - `payment_method_breakdown`
     - `total_refunds_cents`
     - `total_discounts_cents`
   - Note: these fields should be validated against canonical table names/columns and payment-status semantics in runtime E2E before calling the dashboard complete.

4. **Product performance includes raw-SQL modifier revenue and additional slices**
   - `top_modifiers` revenue is calculated via raw SQL \(quantity * price_delta_cents\).
   - Least-ordered items and a sold-out frequency approximation are included, but sold-out frequency depends on inventory adjustment semantics (string match on reason text).

5. **Admin settings writes are audited**
   - `LocationSettingsService.updateSettings()` writes an `admin_audit_logs` entry with `actionKey = location_settings.update`.

### Not verified yet (still required)

- **HTTP+DB E2E** for:
  - `GET /reports/widgets`
  - `GET /reports/sales`
  - `GET /reports/products`
  - `PATCH /locations/:id/settings` (permissions + audit row presence)
- **Frontend admin dashboard UI** (admin home widgets + sales/product pages).

### Status

Status of this verification section: **Partially verified** (code + unit build proof only).

### Plain-English takeaway

The backend is now in place and building cleanly, but section 26 should not be marked fully done until the new report/settings endpoints have real runtime E2E proof and the admin UI consumes them.
