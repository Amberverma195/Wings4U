# Saved Carts Backend & Frontend Integration

**Last updated**: 2026-04-17

## Quick Summary

Database schema for SavedCart/SavedCartItem exists (enum SavedCartStatus { ACTIVE CONVERTED ABANDONED }, models with userId/guestToken constraints). API module (`apps/api/src/modules/saved-cart/`), endpoints (`/api/v1/cart/me`, merge, etc.), guest cookie logic, and frontend integration (`apps/web/src/lib/cart.ts` hydration/PUT/clear/merge) are all implemented. Phases 1–4 complete.

## Purpose

Document current state of "saved carts across login" feature per PRD. Track implementation across DB, API, FE, and checkout integration phases.

## How To Read This Note

1. **Plain English problem** (original user pain)
2. **Technical path/files** (what exists)
3. **Verification** (code inspection, schema check)
4. **Status & Next**

## Problem in Plain English

Users used to lose carts on page refresh/logout/browser close. No persistence for guests or across login. Solution: DB-backed saved carts with auto-save, hydrate on mount, guest token cookie, login merge (sum quantities by lineKey for same location).

## Technical Path / Files Involved

**Phase 1 — Database (complete)**:
- `packages/database/prisma/schema.prisma`: SavedCart/SavedCartItem models.
  - SavedCart: id(Uuid), userId?(Uuid), guestToken?(String unique), locationId(Uuid), fulfillmentType, locationTimezone, scheduledFor, driverTipPercent, status(SavedCartStatus), expiresAt, timestamps.
  - SavedCartItem: id, cartId, menuItemId/slug/nameSnapshot/image/basePrice/quantity/specialInstructions/JSONs (modifiers/removed/builder), lineKey(unique per cart), sortOrder.
  - Constraints: @@unique([userId/guestToken, locationId, status]).

**Phase 2 — API (complete)**:
- `apps/api/src/modules/saved-cart/`: types, CartStore interface, DbCartStore impl, service/controller, guest-cart-cookie.ts, module registered in app.module.ts.
- Endpoints: GET/PUT/DELETE `/api/v1/cart/me`, POST `/api/v1/cart/merge`.

**Phase 3 — Frontend (complete)**:
- `apps/web/src/lib/cart.ts`: useCartState with hydration (fetchSavedCart on session load), debounced PUT on mutations (~400ms), merge on login (authenticated false→true via mergeSavedCartOnLogin), logout wipe (true→false → local clear + guest fetch). Returns cartExpiresAt, isGuestCart, isCartHydrated satisfying CartContextValue.
- `apps/web/src/lib/saved-cart-api.ts`: fetchSavedCart, putSavedCart, deleteSavedCart, mergeSavedCartOnLogin client helpers.
- `apps/web/src/components/guest-cart-expiry-banner.tsx`: dismissible banner when guest cart expires within 24h.
- `apps/web/src/components/wingkings-shell.tsx`: mounts GuestCartExpiryBanner.
- Merge centralised in useCartState (no merge calls in customer-auth.tsx — single code path). Logout handled by useCartState effect (navbar only calls session.clear).

**Phase 4 — Checkout (complete)**:
- `apps/web/src/app/checkout/checkout-client.tsx`: on successful checkout, calls deleteSavedCart(locationId) + cart.clear().

## Why This Mattered

Carts lost → high abandonment. Guest persistence + login merge = seamless UX.

## What Was Found

- All phases implemented and verified.

## Fix Implemented

- [x] Phase 1: DB schema.
- [x] Phase 2: Full API module/endpoints.
- [x] Phase 3: FE hooks (hydration, debounced PUT, merge on login, logout wipe, expiry banner).
- [x] Phase 4: Checkout integration (DELETE /me → CONVERTED status).

## Files Changed

- `packages/database/prisma/schema.prisma`
- `apps/api/src/modules/saved-cart/*`
- `apps/api/src/app.module.ts`
- `apps/web/src/lib/cart.ts`
- `apps/web/src/lib/saved-cart-api.ts`
- `apps/web/src/components/guest-cart-expiry-banner.tsx`
- `apps/web/src/components/wingkings-shell.tsx`
- `apps/web/src/app/checkout/checkout-client.tsx`

## Verification

- Code inspection: all phases implemented.
- TypeScript: `npx tsc --noEmit` passes in apps/web.
- Flow: guest add item → refresh → cart restores; login → merge; logout → local empty + guest GET; checkout → deleteSavedCart + clear.

## Status

**COMPLETE** — All phases implemented and verified.

## Plain-English Takeaway

Guests and logged-in users now have persistent saved carts that survive page refreshes, logins (with smart merges), and across devices via cookies/DB. Checkouts convert to history. No impact on pricing/checkout flow.

**Links**:
- Schema: [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma)
- Fix doc: [Docs/procedures/issues/cart_saving_in_db_fix.md](issues/cart_saving_in_db_fix.md)
