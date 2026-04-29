# Duplicate Cart Page Cleanup Fix

Last updated: 2026-04-19

## Quick Summary

The duplicate App Router cart UI file was removed:

- [`../../apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx)

The live `/cart` route was already using the legacy cart page:

- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)
- [`../../apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)

So this fix did not require a route rewrite. The cleanup was mainly about removing duplicate UI code and making the codebase easier to reason about.

The shared cart state file:

- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

was not part of this cleanup and remains the real cart state engine.

The current result is:

- one live cart route
- one live cart UI implementation
- one shared cart state layer

That is the correct shape for the app.

## Purpose

This note explains what the duplicate cart-page issue was, what changed to fix it, what was verified, and what small caveats still remain.

The goal of this note is to make the cleanup understandable even for a junior developer who did not work on the cart before.

## How To Read This Note

Read this note in this order:

1. understand what the duplication problem actually was
2. understand why deleting one file was safe
3. see exactly which files were kept and which were removed
4. review the verification proof
5. review the remaining caveat so the fix is not overstated

## What the Issue Was

The repo had two different cart UI implementations:

- [`../../apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`../../apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx)

That looked harmless at first, but it created a real maintenance problem.

The reason is simple:

- developers could edit the newer-looking `cart-client.tsx`
- but the real `/cart` route was still rendering `CartPage`
- so a cart change could be made in the wrong file and never reach users

This was not a duplicate state-management problem.

The actual cart state already had one source of truth in:

- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

So the duplication was at the UI layer, not the cart-engine layer.

## Why It Mattered

This mattered for both development speed and correctness.

### 1. It made cart work harder to understand

A new developer could open `app/cart/cart-client.tsx`, see a full cart page, and reasonably assume that was the live page.

But the actual route file:

- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)

was still importing and rendering:

- [`../../apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)

That kind of mismatch is exactly how teams waste time patching code that is not actually serving traffic.

### 2. It increased drift risk

When two files solve the same UI problem, they usually stop matching over time.

That had already started to happen here.

The legacy `cart-page.tsx` had richer behavior, including:

- cart-edit handoff back to menu through `CART_EDIT_STORAGE_KEY`
- `CartOrderSettings`
- promo-code input
- delivery-block handling
- lunch-schedule conflict handling
- branded checkout CTA with disabled-state guardrails

The deleted `cart-client.tsx` was a simpler duplicate implementation, not the true source of cart behavior.

### 3. It made debugging ambiguous

When a cart bug showed up, the first debugging question became:

- “Which cart page is actually live?”

That question should not exist in a healthy codebase.

## What Changed

The cleanup itself was intentionally small and safe.

### 1. The duplicate cart UI file was removed

Deleted:

- `apps/web/src/app/cart/cart-client.tsx`

This was the unused App Router cart client implementation.

### 2. The live `/cart` route stayed on the existing canonical cart page

No route change was needed because this was already true:

- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx) imports `CartPage`
- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx) renders that `CartPage`

That means the app was already using the legacy cart page as the real `/cart` screen.

In other words, the cleanup did not change the chosen cart UI.

It removed the extra one.

### 3. The shared cart engine stayed untouched by design

No cart-state rewrite was part of this fix.

The following file remains the shared cart engine:

- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

That file still owns:

- cart items
- fulfillment state
- scheduling state
- tip state
- saved-cart hydration
- debounced persistence

This is important for junior developers to understand:

`cart.ts` is not the page.

It is the shared state layer that the cart page uses.

### 4. The menu edit handoff still works structurally

The legacy cart page still exports:

- `CART_EDIT_STORAGE_KEY`

And that is still consumed by:

- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)

This matters because it proves `cart-page.tsx` is still the correct retained page. It is not just a visual component. Other live behavior depends on it.

## Why Deleting `cart-client.tsx` Was Safe

This was the most important thing to verify before calling the cleanup complete.

### 1. `/cart` was not using it

Verified directly in:

- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)

The route already renders `CartPage`, not `CartClient`.

### 2. The kept page is behaviorally richer

The surviving `cart-page.tsx` includes real cart behavior that mattered to retain:

- richer order settings UI through `CartOrderSettings`
- promo-code apply UI
- tip selection UI
- item-edit handoff back to the menu builder
- delivery blocked messaging
- lunch schedule conflict messaging
- guarded checkout button behavior
- estimated subtotal fallback when quote data is not ready yet

That means keeping the legacy cart page was not just safe.

It was the stronger implementation to keep.

### 3. The one obvious feature that disappeared was minor

The removed `cart-client.tsx` had a top-of-page “Clear cart” button.

That control is not present in the retained legacy cart page.

However:

- per-item remove actions are still present
- the route already used the legacy page anyway
- the project plan for this cleanup did not require preserving that button

So this is not a regression introduced by switching the route.

It is simply a difference between the unused duplicate page and the already-live page.

## Files Reviewed / Files Changed

### Files reviewed

- [`../../apps/web/src/app/cart/page.tsx`](../../apps/web/src/app/cart/page.tsx)
- [`../../apps/web/src/Wings4u/components/cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)
- [`./removing_cartpage_duplicate_issue.md`](./removing_cartpage_duplicate_issue.md)

### Files changed

- `apps/web/src/app/cart/cart-client.tsx` deleted
- [`./removing_cartpage_duplicate_fix.md`](./removing_cartpage_duplicate_fix.md) added
- [`./map.md`](./map.md) updated

## Verification Run

### 1. Route and dependency verification

Verified by code inspection:

- `/cart` still routes through `app/cart/page.tsx`
- `page.tsx` renders `CartPage`
- `menu-page.tsx` still imports `CART_EDIT_STORAGE_KEY` from `cart-page.tsx`
- `cart.ts` remains the shared cart state layer

### 2. Duplicate source-reference verification

Source search run:

```powershell
rg -n "CartClient|cart-client" apps
```

Result:

- no live source imports remained in `apps/web/src`
- the only remaining hit under `apps/` was `apps/web/tsconfig.tsbuildinfo`

That confirms the deleted cart page is no longer referenced by live app source.

### 3. Build verification

Build command:

```powershell
npm run build:web
```

First attempt:

- failed during cleanup because `.next-wings4u` had a local file-lock / unlink permission issue

Second attempt:

- rerun with elevated permissions
- build passed

Verified build result on 2026-04-19:

- all 28 routes generated
- `/cart` still listed as a static route
- `/cart` build output: `266 B / 132 kB`

This is strong proof that the cart cleanup did not break the web app build.

## Remaining Caveats

This fix is functionally good, but one small cleanup item still remains.

The deleted `cart-client.tsx` used a few helper selectors in:

- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

The following selectors now appear unused in source:

- `.cart-tip-section`
- `.cart-tip-label`
- `.cart-tip-segment-row`
- `.cart-schedule-summary`
- `.cart-schedule-summary a`

So the statement “no style cleanup was needed at all” is a little too strong.

The cart-page duplication problem is fixed, but there is still minor leftover CSS debt from the deleted duplicate page.

That is a small follow-up cleanup, not a blocker.

## Final Conclusion

The duplicate-cart-page cleanup is effectively complete.

The app now has:

- one live `/cart` route
- one live cart UI implementation
- one shared cart state engine

The removed `cart-client.tsx` was truly duplicate UI, not active route code, and deleting it did not break the route wiring or the web build.

The only remaining caveat is a small set of now-unused global CSS helper selectors that can be removed in a later pass.

## Plain-English Summary

Before this fix, the repo had two cart screens even though users only saw one of them.

That was confusing for developers and risky for maintenance.

Now the extra cart page is gone, `/cart` still points to the correct legacy cart page, and the shared cart logic in `cart.ts` stays exactly where it should be.

So the real problem is fixed: the app now has one actual cart page instead of two competing cart UIs, with only a tiny CSS cleanup left for later.
