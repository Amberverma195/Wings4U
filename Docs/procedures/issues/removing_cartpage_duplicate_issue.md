# Removing Duplicate Cart Page and Choosing One `/cart` Source of Truth

Last updated: 2026-04-19

## Quick Summary

The repo currently has two different cart UI implementations:

- [`apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx)

But the live `/cart` route is still using the older legacy cart page through:

- [`apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)

This means the codebase has duplicate cart UI logic, even though the app should only have one real cart screen. The cart state itself is not duplicated. That part still lives in:

- [`apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

This note documents what is happening, why it matters, and what should be cleaned up first before touching the separate cart persistence / hard-reload issue.

## Purpose

This note exists to explain the duplicate cart-page situation clearly before implementation starts.

The goal is to make it obvious:

- which cart UI is currently live
- which file is the shared state layer
- why there are two cart screens in the repo
- what should be kept
- what should be removed later

## How To Read This Note

Read this note in this order:

1. understand the problem in plain English
2. see which files are involved
3. understand why the duplicate UI is a maintenance problem
4. see what was actually verified in code
5. see what still needs to be fixed

This note is about cart UI duplication only.

It is not the fix note for cart persistence or hydration behavior.

## Problem in Plain English

Right now, the repo contains two cart pages that do almost the same job.

That is confusing for development because:

- one file looks like the newer cart page
- another file is still the one actually shown to users
- it is easy to patch one cart UI while the route still renders the other one

From the outside, this makes the project feel like it has one cart.

From the code side, it really has:

- one shared cart state system
- two separate cart screen implementations

That is why the code feels duplicated and why it is easy to make changes in the wrong place.

## Technical Path / Files Involved

### 1. Shared cart state layer

The real cart data logic lives in:

- [`apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

This file is responsible for:

- cart items
- quantity updates
- fulfillment type
- scheduled time
- tip state
- saved-cart hydration from the backend
- debounced persistence back to the backend

This is not a page.

This is the cart state engine used by whichever UI renders the cart.

### 2. Live `/cart` route entry

The route file is:

- [`apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)

It currently imports and renders:

- [`CartPage` from `apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)

So today, the live `/cart` screen is still the legacy cart page.

### 3. Legacy cart UI

The older cart screen lives in:

- [`apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)

This file is still feature-complete and currently active. It includes behavior such as:

- order settings rendering
- promo code input
- quote fetching
- tip selector
- lunch schedule conflict handling
- delivery blocked handling
- cart edit handoff to menu

It also exports:

- `CART_EDIT_STORAGE_KEY`

That key is still used by:

- [`apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)

So this file is not just dead code right now.

### 4. Newer cart UI

The newer cart screen lives in:

- [`apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx)

This is a second cart UI implementation under the App Router structure.

It also reads from `useCart()` and also fetches quote data, but it is not the route currently used by `/cart`.

It is therefore an alternate UI implementation, not the current source of truth.

## Why This Mattered

This duplication matters for two reasons.

First, it creates maintenance drift.

A developer can change the new cart client and assume the cart page changed, while the route still points to the old cart page.

Second, it makes debugging slower.

When a cart bug is reported, the first question becomes:

- which cart UI is actually live right now?

That uncertainty is unnecessary and should be removed.

## What Was Found

The following facts were verified by code inspection:

- [`apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx) still renders the legacy `CartPage`
- [`apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx) exists but is not the active `/cart` route
- [`apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts) is the shared cart state layer and should remain regardless of which cart UI is kept
- [`apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx) still imports `CART_EDIT_STORAGE_KEY` from the legacy cart page

This means the app does not have two different cart states.

It has one shared cart state and two different cart UIs.

## What Still Needs To Be Fixed

The first cleanup step should be to choose one cart UI as the only `/cart` implementation.

The recommended choice is to keep:

- [`apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)

for the first cleanup pass, because it is already live and currently contains more behavior than the newer cart client.

That means the next implementation step should be:

1. keep `cart.ts` as the shared cart state engine
2. keep `page.tsx` routing `/cart` to the legacy `CartPage`
3. remove the duplicate `cart-client.tsx` implementation after one final feature comparison
4. leave persistence and hydration fixes for the next task

This note does not claim that the hard-reload cart-clearing issue is caused by the duplicate page files.

That appears to be a separate persistence / hydration timing problem and should be fixed as a separate follow-up.

## Files Changed

Documentation only in this pass:

- [`Docs/procedures/issues/removing_cartpage_duplicate.md`](./removing_cartpage_duplicate.md)
- [`Docs/procedures/issues/map.md`](./map.md)

No application code was changed.

## Verification

Verified in this documentation pass:

- code inspection
- route inspection
- dependency inspection

Specifically verified:

- `/cart` route wiring in `app/cart/page.tsx`
- duplicate cart UI presence in `cart-page.tsx` and `cart-client.tsx`
- shared cart state ownership in `lib/cart.ts`
- `CART_EDIT_STORAGE_KEY` dependency from `menu-page.tsx`

Not verified in this pass:

- runtime behavior in browser
- build verification
- persistence bug fix
- hydration-loading UX fix

## Status

Open.

The duplicate cart UI situation is understood and documented, but the cleanup has not been implemented yet.

## Plain-English Takeaway

The app should only have one cart screen, but right now the repo still has two cart UIs.

The live one is the legacy `cart-page.tsx`.

The shared cart logic is `cart.ts`, and that file should stay.

The duplicate UI should be cleaned up first, and the cart persistence bug should be handled separately after that.

## Final Plain-English Summary

This is not a cart-state duplication problem.

It is a cart-UI duplication problem.

`cart.ts` is the shared cart engine.

`page.tsx` currently routes `/cart` to the old `cart-page.tsx`.

`cart-client.tsx` is the extra cart UI that should likely be removed in the first cleanup pass, while persistence and hydration fixes happen afterward as a separate piece of work.
