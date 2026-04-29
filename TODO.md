# Saved Carts Implementation - TODO

CWD: `d:/Projects/Websites/Wings4U/Code`

## Issue Doc Status
- [x] Created `Docs/procedures/cart_saving_in_db_issue.md` (current issue note per format.md).
- [x] Updated `Docs/procedures/issues/map.md` entry.

**Current State**: Phase 1 (DB schema) already exists exactly as spec. No migration needed.

## Approved Plan (Phases 2-4)
1. **Phase 2**: API module `apps/api/src/modules/saved-cart/` (types, CartStore/DB impl, service/controller, guest cookie, app.module.ts). Endpoints: GET/PUT/DELETE `/api/v1/cart/me`, POST `/merge`.
2. **Phase 3**: FE `apps/web/src/lib/cart.ts` (hydrate/PUT/clear/merge hooks), login merge, expiry banner.
3. **Phase 4**: Checkout DELETE /me → CONVERTED status.

**Next**: Create API types/DTOs → controller/service → etc. Ask before DB mutation.
