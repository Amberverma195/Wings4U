# Admin support ticket improvements

Implemented October 16, 2026.

## Root causes

- Ticket list/detail serializers returned relationship IDs without customer or order context. The admin UI had no readable names, contact information, or order numbers to display.
- The UI tied its order button to `order_id` alone. Null IDs hid all order context, while inconsistent legacy associations could still offer a button that the secured order endpoint rejected.
- Message authors appeared as shortened UUIDs despite an existing author relationship.
- Ticket creation always wrote the linked customer as the CREATED event actor, including system-generated overdue-delivery tickets.

The customer form already submits its selected order ID. Ticket creation already validates order ownership and location before persisting the association; that validation remains. Existing null associations are not inferred or backfilled.

## Backend

- Added authorized admin queue/detail endpoints at `GET /api/v1/admin/support-tickets` and `GET /api/v1/admin/support-tickets/:id`.
- Added explicit Prisma selections and structured customer, order, creator, assigned-admin, message-author, and audit-actor serializers. Existing response fields remain available.
- Reused a shared deterministic identity preference: primary first, verified first, earliest creation, then identity ID. Phone and email are chosen independently from that ordered list.
- Current account contacts and historical order contact snapshots remain separate. Archived/missing customer accounts have an explicit availability state.
- Creator labels come from the first actual CREATED event, independently of customer ownership. New customer-created events record the authenticated actor explicitly; system-created events no longer attribute creation to the customer. Historical audit records are preserved, including any previously incorrect attribution.
- Expanded account/contact details are selected only for admin responses. Customer endpoints retain ownership checks and exclude internal messages, associated private MESSAGE_ADDED events, and the new private ORDER_LINKED events.
- Linked order context is returned only when both location and customer ownership match the ticket. The existing secured order-details endpoint retains its response shape and explicitly selects the required item, modifier, flavour, payment, and pricing fields.
- Admin queue filters and pagination inputs are validated. Ticket and eligible-order pagination anchors are checked against their scope.

## Frontend and unlinked tickets

- Queue entries show customer name, subject, readable category, order number, priority, status, date/time, and description preview. Existing filters, pagination, and detail navigation remain.
- Detail pages have responsive ticket, current customer, and related order panels using existing admin cards and warm colors. Complaint descriptions preserve line breaks; account email/phone links use `mailto:`/`tel:`.
- Conversation and audit labels use account names and roles, with clear internal-note labels and missing-account fallbacks.
- Linked orders retain the existing Order Details modal and `/admin/orders?orderId=...` navigation. The modal also exposes the existing discount, delivery fee, tip, unit-price, modifier, and flavour metadata.
- Unlinked tickets show “No order linked to this ticket.” Customer information remains visible, and no order-details button is rendered.
- Admins can explicitly load eligible orders, select one, and confirm it belongs to the complaint. Discovery uses `GET /api/v1/admin/support-tickets/:id/eligible-orders`; linking uses `POST /api/v1/admin/support-tickets/:id/link-order` with `order_id`.
- Backend linking checks the ticket's location, requires a known customer, queries only that customer's orders at the same restaurant, and rejects any existing association. A transaction conditionally updates only a still-unlinked ticket and records an ORDER_LINKED audit event. Customer ownership cannot be changed by this action. Concurrent attempts cannot overwrite the winning association.

## Exact files changed or added by this task

1. `apps/api/src/common/utils/primary-identity.ts` — shared identity preference and contact selection (new).
2. `apps/api/src/modules/admin/admin-customers.service.ts` — reuse shared identity selection.
3. `apps/api/src/modules/admin/admin.controller.ts` — admin support routes and validated input.
4. `apps/api/src/modules/support/support.controller.ts` — explicit authenticated creation actor.
5. `apps/api/src/modules/support/support.service.ts` — context, serialization, privacy, scoped pagination, creator attribution, audited linking, and explicit order-details selections.
6. `apps/api/src/modules/support/support.selects.ts` — explicit selections and context serializers (new).
7. `apps/api/src/modules/support/support.service.spec.ts` — service regression/security tests (new).
8. `apps/api/src/modules/support/support.http.spec.ts` — isolated HTTP guard/validation tests (new).
9. `apps/web/src/app/admin/support/support-list-client.tsx` — enriched queue.
10. `apps/web/src/app/admin/support/[id]/support-detail-client.tsx` — detail panels, named authors, and retained modal/navigation.
11. `apps/web/src/app/admin/support/link-order.tsx` — explicit order selection and confirmation (new).
12. `apps/web/src/app/admin/support/support-types.ts` — shared admin context types and readable labels (new).
13. `apps/web/src/app/admin/support/support.module.css` — responsive support styles (new).
14. `apps/web/tests/admin-support.test.cjs` — queue/detail/linking/workflow regression tests (new).
15. `apps/web/tests/admin-order-links.test.cjs` — updated support fixture and CSS mock; existing navigation test retained.
16. `SUPPORT_TICKETS_IMPLEMENTATION.md` — this report (new).

Pre-existing changes in the application screen, migration files/directories, and stamp-email plan were left intact.

## Verification actually run

- Relevant API tests: **5 suites, 60 tests passed**. Command from repository root: `node node_modules/jest/bin/jest.js --config apps/api/jest-unit.json --runInBand --testPathPattern 'support|admin-customers|overdue-delivery'`.
- All existing and new frontend tests: **4 suites, 61 tests passed**. Command: `node node_modules/jest/bin/jest.js --config apps/web/jest.config.cjs --runInBand --silent`.
- API and web TypeScript checks passed using `npx tsc -p apps/api/tsconfig.json --noEmit` and `npx tsc -p apps/web/tsconfig.json --noEmit --incremental false`. Final API build also checked the subsequent API changes; the successful web build validated the final frontend.
- Final API production build passed: `node ../../node_modules/@nestjs/cli/bin/nest.js build` from `apps/api`.
- Final web production build passed: `node ../../node_modules/next/dist/bin/next build` from `apps/web`; all 51 static pages generated. It also completed Next's type-validation phase.
- Initial build attempts encountered sandbox filesystem restrictions. The successful production builds were rerun with normal filesystem access. The web build was invoked directly to avoid the package script's removal of existing build directories.
- `git diff --check` passed.
- Standalone linting is unavailable: the repository has no ESLint configuration, installed ESLint binary, or API/web lint script. No standalone lint pass is claimed.
- Browser verification was attempted through the Browser skill but failed before connecting because the browser tool rejected the environment metadata (`sandboxPolicy` missing). No browser visual/responsive check or screenshot is claimed.
- Database-backed end-to-end tests were **not run**: their global setup deploys migrations, truncates data tables, and seeds the database. The new HTTP tests use real Nest guards/controllers with a mocked data layer and do not connect to a database.

Coverage includes readable admin metadata; account/order snapshot separation; creator identity; null/missing relationships; linked-order details; customer ownership and cross-location restrictions; private-note/audit exclusion; replies; status and refund/replacement/credit resolution records; existing order navigation; explicit link confirmation; unrelated-order rejection; existing-link preservation; and concurrent-link rejection.

## Migration and deployment

No schema change, database migration, backfill, environment-variable change, deployment, or production ticket-data mutation was performed or is required for this feature.

Deploy the API before or together with the web app: the updated admin pages depend on the new admin endpoints. Historical incorrect CREATED actors remain visible as recorded; correcting historical data would require a separate, evidence-based data repair. Unlinked tickets remain unlinked until an admin explicitly confirms an eligible order.

Remaining verification limits are the unrun database-backed end-to-end suite and unavailable browser visual check described above. Resolution actions retain their existing record-keeping behavior; this change does not introduce new refund/payment execution.
