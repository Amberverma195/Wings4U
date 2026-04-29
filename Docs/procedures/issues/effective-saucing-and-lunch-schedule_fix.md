# Effective Saucing And Lunch Schedule Fix

Last updated: 2026-04-11

## Quick Summary

This fix closes two related ordering gaps:

1. wing saucing now follows the number of real sauces selected, not just the number of flavour slots on the menu item
2. lunch specials are now blocked when the customer schedules pickup or delivery outside the lunch window

In plain English:

- `Plain + one real sauce` on a two-slot wing item now behaves like a one-sauce order, so the customer sees `Tossed on wings` / `On the side` instead of multi-sauce options like `Half and half`
- lunch-special lines can no longer slip through to checkout when the scheduled time is outside `11 AM - 3 PM`

The web and API builds both passed after these changes.

---

## Purpose

This note records:

1. what each problem was
2. what changed in the builders, cart, checkout, and API
3. why the behavior is now correct
4. what was verified directly

Related plan file:

- [`effective-saucing-and-lunch-schedule.plan.md`](../../../.cursor/plans/effective-saucing-and-lunch-schedule.plan.md#L1)

Related map file:

- [`map.md`](./map.md#L1)

---

## Initiative A: Effective Saucing Flavour Count

## What the original problem was

The old saucing flow used the raw required flavour-slot count from the menu item.

That meant a two-slot wings item still looked like a two-sauce order even when the actual picks were:

- `Plain`
- one real sauce

In that case the customer was incorrectly shown multi-sauce vocabulary such as:

- `Half and half`
- `Mixed together`
- `Sauce on the side`

That was wrong because only one slot actually contained a tossable sauce.

## What changed

The shared saucing logic in:

- [`builder-shared.tsx`](../../../apps/web/src/components/builder-shared.tsx)

now counts only non-plain flavours with:

- `countEffectiveSaucedFlavours(...)`

The shared saucing option / validation helpers now use that effective count:

- `getSaucingOptions(...)`
- `defaultSaucingMethodForCount(...)`
- `isSaucingMethodValidForCount(...)`
- `methodRequiresSideFlavourPick(...)`

The placement resolver was also updated:

- `resolveSaucingPlacements(...)`

That resolver now treats plain slots as neutral and only applies `ON_WINGS`, `ON_SIDE`, or `MIXED` to the actual sauced slots.

The builders using that shared logic were aligned in:

- [`wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](../../../apps/web/src/components/combo-builder.tsx)

Those builders now:

- derive `effectiveSaucedCount` from the current flavour picks
- default the saucing method from the effective count
- invalidate old multi-sauce choices when the customer drops back to one real sauce
- require side-flavour selection only when the active multi-sauce method truly needs it
- use the single-sauce subtitle copy when the effective sauce count is `<= 1`

## What improved

The customer now sees saucing choices that match the real order state:

- `Plain + BBQ` behaves like a one-sauce order
- `BBQ + Honey Garlic` still behaves like a two-sauce order
- party packs still keep their multi-sauce options when there are multiple real sauces
- all-plain orders still skip the saucing step entirely

This also fixes downstream placement resolution, so a case like `Plain + BBQ` with `On the side` no longer falls through to an incorrect all-`ON_WINGS` result.

---

## Initiative B: Lunch Specials Vs Scheduled Time

## What the original problem was

A customer could build a cart with lunch specials, then move pickup or delivery to a non-lunch time such as `5:00 PM`.

That created a product mismatch:

- the cart still contained lunch-priced items
- the scheduled time no longer matched lunch availability
- checkout did not clearly block the conflict soon enough in the customer flow

There was already some schedule enforcement on the backend, but the customer-facing behavior was incomplete:

- the cart did not have a clean shared lunch conflict check
- checkout did not block before submit from the web side
- server error messages were not reliably surfaced by the frontend because some API failures returned plain Nest exception bodies instead of envelope-style `errors[]`

## What changed on the web

### Shared lunch-hours helper

Added:

- [`lunch-hours.ts`](../../../apps/web/src/lib/lunch-hours.ts)

This file is now the small web-side source of truth for:

- lunch window `11 AM - 3 PM`
- identifying lunch-special cart lines
- checking whether the active scheduled time falls inside the lunch window
- returning a consistent customer-facing conflict message

### Durable cart metadata for lunch detection

Updated:

- [`types.ts`](../../../apps/web/src/lib/types.ts)

`CartItem` now supports `menu_item_slug`.

That slug is now written into cart lines by the add-to-cart paths in:

- [`menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`item-modal.tsx`](../../../apps/web/src/components/item-modal.tsx)
- [`item-customization-overlay.tsx`](../../../apps/web/src/components/item-customization-overlay.tsx)
- [`wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](../../../apps/web/src/components/combo-builder.tsx)
- [`lunch-special-builder.tsx`](../../../apps/web/src/components/lunch-special-builder.tsx)
- [`legacy-size-picker-modal.tsx`](../../../apps/web/src/components/legacy-size-picker-modal.tsx)

This matters because lunch detection can no longer depend on whether the current menu response still contains the item.

### Persisted location timezone for schedule checks

Updated:

- [`cart.ts`](../../../apps/web/src/lib/cart.ts)

The cart order-context state now persists `locationTimezone`.

That timezone is populated when live menu data is loaded in:

- [`menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

This keeps the lunch-window check tied to store-local time instead of relying on the browser clock alone.

### Cart-page warning and checkout CTA block

Updated:

- [`cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

The cart page now computes a lunch conflict from:

- cart items
- current `scheduledFor`
- location timezone

When the cart contains lunch specials outside the lunch window:

- the summary shows a clear inline error
- the `CHECKOUT` button is disabled
- the button click no longer routes forward

This gives the customer feedback before they reach the final checkout screen.

### Checkout block before submit

Updated:

- [`checkout-client.tsx`](../../../apps/web/src/app/checkout/checkout-client.tsx)

Checkout now runs the same lunch conflict helper before submission.

If the schedule conflicts with lunch items:

- the customer sees the same lunch-specific error message
- `Place order` is disabled
- `submit()` still hard-blocks the action if triggered programmatically

The checkout header also now formats the selected date/time using the stored location timezone.

### Better frontend API error parsing

Updated:

- [`api.ts`](../../../apps/web/src/lib/api.ts)

`apiJson(...)` now extracts useful error text from both:

- envelope responses with `errors[]`
- plain Nest exception bodies with `message` / `error`

This matters because lunch schedule failures from quote / checkout can now surface the real message instead of a generic `Unprocessable Entity`.

## What changed on the API

Updated:

- [`cart.service.ts`](../../../apps/api/src/modules/cart/cart.service.ts)
- [`checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)

Both services already had schedule validation, but now they return a cleaner lunch-specific conflict payload when the violating items are lunch specials:

- stable code: `LUNCH_SPECIAL_SCHEDULE_CONFLICT`
- clear message: `Lunch specials are available 11 AM - 3 PM. Change your scheduled time or remove lunch items from your cart.`

The backend still keeps the more general `SCHEDULE_VIOLATION` path for non-lunch schedule conflicts.

This means:

- the web app can show a proper lunch-specific message
- bad clients still cannot bypass the rule
- quote and checkout now speak the same business rule more clearly

---

## Why This Fix Is Correct

## Saucing

The saucing vocabulary is now tied to what the kitchen actually has to sauce, not just how many flavour slots exist on the menu item.

That matches the product rule:

- plain slots do not create a second sauce-distribution problem
- only real sauce selections should expand the saucing method choices

## Lunch scheduling

The lunch validation now works from cart data plus store-local schedule context, which is the right place to evaluate it.

That is safer than checking only the currently visible menu because the menu may already be filtered by the newly selected time while the cart still contains older lunch lines.

The rule is also enforced in both places that matter:

- early in the web flow for customer clarity
- again on the backend for integrity

---

## Verification Run

Direct verification completed:

- `npm run build:web`
- `npm run build:api`

What those checks proved:

- the new shared lunch helper compiles and is consumed correctly
- the added cart-state timezone field and cart-line slug metadata type-check end to end
- the cart and checkout UI changes compile with the updated validation logic
- the API schedule-validation response changes compile successfully

## Verification caveat

I did not add or run a dedicated automated unit suite for the new lunch helper in this pass.

The highest-confidence verification in this environment was the successful web/API production builds plus direct code-path review.

---

## Final Outcome

After this fix:

- effective wing saucing is based on real sauces, not raw slot count
- `Plain + one sauce` now behaves like a one-sauce order
- lunch-special cart lines are identified reliably from cart metadata
- cart warns and blocks forward checkout when lunch items fall outside `11 AM - 3 PM`
- checkout blocks submit with the same message
- API quote and checkout both enforce the same lunch rule with a stable conflict code

The paired plan is now represented by:

- the existing builder saucing alignment in the shared wing builder flow
- the new lunch schedule validation across cart, checkout, and API
