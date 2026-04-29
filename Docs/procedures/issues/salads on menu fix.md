# Salads on Menu + Wings-4-U Dynamic Salad Customization Verification

Last updated: 2026-04-07

## Quick Summary

### What this note is about

This note verifies the implementation described in:

- [`Salads on menu.md`](./Salads%20on%20menu.md)

That plan covered:

1. a first-class **Salads** category in the seeded catalog with five salad SKUs, sizes, removables, and add-ons (including size-scoped breaded chicken)
2. **navigation** to the menu and a deep link that scrolls to the salads section
3. **Wings-4-U Special** behavior: after the customer picks a salad type, ingredient removals and salad add-ons come from the **selected salad menu item**, not from the parent special row, with `salad_customization` on the wing builder payload
4. **API** validation and **cart quote** logic so removals and modifier option IDs are checked against the salad child item and priced consistently

### Short answer

The fix is **implemented successfully**.

The relevant web, seed, and API paths are present, and the current web build plus database-package typecheck pass.

### The important caveat

The new category and salad rows live in **seed data**. They will **not** appear in an already-seeded database (for example when the seed short-circuits because `LON01` already exists) until you reseed or run a one-off data update.

### Plain-English takeaway

If you reseed the database, the salads category, menu navigation, standalone salad customization, and Wings-4-U salad payload flow should behave as designed.

If you do **not** reseed, the code is ready but the live menu may still lack the new salads section and salad rows.

---

## Purpose

This note records:

1. what the plan asked for
2. what the code now does
3. what was verified directly
4. what still depends on database state
5. how Wings-4-U differs from ordering a salad à la carte

Related plan:

- [`Salads on menu.md`](./Salads%20on%20menu.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `Verification result`
- `What still matters`

If you want the detailed version, read each section from `A` through `F`.

---

## Brief Plan Summary

The requested plan had six main parts:

### A. Catalog / seed

Add a **salads** category with five items (Caesar, Garden, Greek, Horiatiki, Buffalo Chicken), Small/Large pricing where applicable, removables and add-ons from the menu copy, and breaded chicken options priced by size.

Expand the **Wings-4-U** salad type picker to include Horiatiki and Buffalo Chicken alongside the original three.

### B. Navigation

Add **Menu** and optionally **Salads** in the global bar; support `?cat=salads` on the menu page to scroll to that category.

### C. Types and mapping

Extend `WingBuilderPayload` with `salad_customization` (salad menu item id, removals, modifier selections).

Provide a stable mapping from salad picker option names to salad slugs (for example [`salad-catalog.ts`](../../../apps/web/src/lib/salad-catalog.ts)).

### D. Wings builder

For `wings-4u-special`, resolve the salad `MenuItem` from the customer’s salad type choice; show removals and add-ons from that item; put salad-specific data in `builder_payload.salad_customization` and keep parent `removed_ingredients` empty for salad-only removals.

### E. Menu page

Pass salad items from the menu response into the wings builder; scroll to salads when `cat=salads`.

### F. API / cart

Validate `salad_customization` against the salad `menu_item_id`; ensure salad modifier options are present on the cart line for pricing; quote totals include those options.

---

## Verification Result

### Overall status

**Implemented in code:** yes  
**Build-verified:** yes  
**Type-checked at package level:** yes  
**Runtime-ready without reseed:** only partly  
**Plan-complete:** yes

### What passed

- `npm run build --workspace @wings4u/web`
- `npx tsc --noEmit -p packages/database/tsconfig.json`

### Plain-English takeaway

The implementation is real. The web app compiles, the seed typechecks in the database package context, and the salad flow is wired end-to-end in code.

The remaining uncertainty is mostly about **live seeded data**, not missing application code.

---

## A. Seed: salads category and five SKUs

### What the plan expected

A **salads** category with five salads, correct base prices and Large deltas, removables aligned to descriptions, add-on groups, and breaded chicken options that depend on Small vs Large.

### What the code now does

In:

- [`../../../packages/database/prisma/seed.ts`](../../../packages/database/prisma/seed.ts)

the seed defines:

- category slug `salads` in `categoryDefs`
- **Caesar, Garden, Greek** at `699` cents with a shared Small/Large size group (`Large` +400 cents → $10.99 large)
- **Horiatiki** at `899` cents with the same size deltas ($12.99 large)
- **Buffalo Chicken** at `1599` cents without a size group (single SKU)
- `breadedChickenBySize` options (+299 / +399 cents) on the sized salads
- expanded **salad type** options for Wings-4-U: Garden, Caesar, Greek, Horiatiki, Buffalo Chicken Salad

### Why this matters

The menu and builders stay data-driven. Prices and option lists come from the catalog instead of hard-coded UI lists.

### Verification result

Verified in code.

### Important caveat

Reseed or a data migration is required for existing databases. The seed’s usual “already have LON01” guard can skip creation of new rows.

### Plain-English takeaway

The catalog shape matches the plan. Refresh the DB to see it in a running app.

---

## B. Navigation and menu deep link

### What the plan expected

Global **Menu** and **Salads** links; `?cat=salads` scrolls to the salads category after load.

### What the code now does

In:

- [`../../../apps/web/src/Wings4u/components/navbar.tsx`](../../../apps/web/src/Wings4u/components/navbar.tsx)

**Menu** goes to `/menu` and **Salads** goes to `/menu?cat=salads`.

In:

- [`../../../apps/web/src/Wings4u/components/menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)

a `useEffect` reads `cat` from the query string, resolves the category by **slug**, and calls `scrollToCategory` once. Category emoji and a short salads note are present.

### Why this matters

Customers can jump straight to salads without hunting through the full menu.

### Verification result

Verified in code.

### Plain-English takeaway

Navigation and deep-link scrolling are implemented as specified.

---

## C. Types, catalog mapping, and menu wiring

### What the plan expected

`WingBuilderPayload.salad_customization` with salad id, display fields, removals, and modifier selections; a single place to map picker names to salad slugs; menu passes salad items into the builder.

### What the code now does

In:

- [`../../../apps/web/src/lib/types.ts`](../../../apps/web/src/lib/types.ts)

`salad_customization` includes `salad_menu_item_id`, `salad_name`, `salad_slug`, `removed_ingredients`, and `modifier_selections`.

In:

- [`../../../apps/web/src/lib/salad-catalog.ts`](../../../apps/web/src/lib/salad-catalog.ts)

`findSaladMenuItemForSelection` maps normalized salad names to slugs and finds the matching `MenuItem`. `WINGS_SPECIAL_SALAD_SIZE_LABEL` is `"Small"` so add-on filtering matches the kitchen rule that the special includes a **small** salad.

In:

- [`../../../apps/web/src/Wings4u/components/menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)

`saladMenuItems` is derived from `menu.categories` where `slug === "salads"` and passed into `WingsBuilder`.

### Why this matters

The parent Wings-4-U line does not carry every salad’s ingredient list; the child salad item is the source of truth for validation.

### Verification result

Verified in code.

### Plain-English takeaway

Types and mapping are in place; Wings-4-U uses the same salad rows as the menu.

---

## D. Wings builder: dynamic salad UX and payload

### What the plan expected

For `wings-4u-special`, after salad type selection, show removals and add-ons from the resolved salad item; submit `salad_customization`; keep parent salad removals out of `removed_ingredients` when using child customization.

### What the code now does

In:

- [`../../../apps/web/src/components/wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)

- `usesChildSaladCustomization` is true when `item.slug === "wings-4u-special"`.
- `resolvedSaladItem` comes from `findSaladMenuItemForSelection` or from edit payload.
- Removals use `resolvedSaladItem.removable_ingredients` for the salad UI.
- Salad add-on groups are filtered with the same `shouldRenderAddonOption` pattern as the overlay, with size label fixed to **Small** for the special.
- On submit, `salad_customization` is filled when `resolvedSaladItem` exists; salad add-on options are appended to **both** `builder_payload.salad_customization.modifier_selections` and the line’s `modifier_selections` so the API can price and validate them.
- `removed_ingredients` on the line is empty for salad-only removals when `usesChildSaladCustomization` is true.

### Why this matters

Checkout validates removals and options against the salad SKU. Duplicating a union list on the parent would be ambiguous and insecure.

### Verification result

Verified in code.

### Plain-English takeaway

Wings-4-U now follows the “child salad item” model end-to-end on the client.

---

## E. Cart display

### What the code now does

In:

- [`../../../apps/web/src/Wings4u/components/cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

cart copy includes salad customization lines when `salad_customization` is present on a wing payload.

### Verification result

Verified in code.

---

## F. API: checkout and cart quote

### What the plan expected

Parse `salad_customization` on wing payloads; validate removal ids and modifier option ids against the **salad** `MenuItem`; require salad options to appear on the line’s modifier selections for integrity.

### What the code now does

In:

- [`../../../apps/api/src/modules/checkout/checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)
- [`../../../apps/api/src/modules/cart/cart.service.ts`](../../../apps/api/src/modules/cart/cart.service.ts)

- `getSaladCustomization` extracts `salad_menu_item_id`, removals, and modifier option ids from the builder payload.
- Menu item loading includes both parent ids and referenced salad ids.
- Removals are validated against `saladMenuItem.removableIngredients`.
- Each salad modifier option id must belong to a modifier group on the salad item and must also appear in the line’s `modifier_selections` / `modifierSelections`.

### Why this matters

Prevents forged removals or free add-ons that were never selected on the parent line.

### Verification result

Verified in code.

### Plain-English takeaway

Server-side validation matches the plan.

---

## G. Standalone salads: overlay and chicken by size

### What the plan expected

For salads ordered from the menu, size selection should control which breaded-chicken add-on is valid (Small vs Large pricing).

### What the code now does

In:

- [`../../../apps/web/src/components/item-customization-overlay.tsx`](../../../apps/web/src/components/item-customization-overlay.tsx)

add-on visibility and auto-clearing use `shouldRenderAddonOption`, `inferOptionSizeScope`, and `selectedSizeNames` so size-scoped options stay consistent when the customer changes size.

### Verification result

Verified in code.

### Plain-English takeaway

À la carte salads get size-dependent chicken options; Wings-4-U keeps the special fixed to the small-salad rule via `WINGS_SPECIAL_SALAD_SIZE_LABEL`.

---

## Files Verified In This Pass

### Web

- [`../../../apps/web/src/lib/types.ts`](../../../apps/web/src/lib/types.ts)
- [`../../../apps/web/src/lib/salad-catalog.ts`](../../../apps/web/src/lib/salad-catalog.ts)
- [`../../../apps/web/src/components/wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)
- [`../../../apps/web/src/components/item-customization-overlay.tsx`](../../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../../apps/web/src/Wings4u/components/navbar.tsx`](../../../apps/web/src/Wings4u/components/navbar.tsx)
- [`../../../apps/web/src/Wings4u/components/menu-page.tsx`](../../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`../../../apps/web/src/Wings4u/components/cart-page.tsx`](../../../apps/web/src/Wings4u/components/cart-page.tsx)

### Seed

- [`../../../packages/database/prisma/seed.ts`](../../../packages/database/prisma/seed.ts)

### API

- [`../../../apps/api/src/modules/checkout/checkout.service.ts`](../../../apps/api/src/modules/checkout/checkout.service.ts)
- [`../../../apps/api/src/modules/cart/cart.service.ts`](../../../apps/api/src/modules/cart/cart.service.ts)

---

## Verification Commands Used

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
npx tsc --noEmit -p packages/database/tsconfig.json
```

Both passed during this verification pass.

---

## What Still Matters

### Database refresh

To see the new salads category and items in a running environment, you still need one of these:

1. wipe and reseed the database
2. or run a one-off script that inserts or updates menu data to match the new seed

### Optional follow-ups (not required for “plan done”)

- If you want the documentation map to list this note, add an entry to [`map.md`](./map.md) per [`documentation format.md`](../documentation%20format.md).

---

## Final Plain-English Summary

The salads-on-menu plan is implemented in code: seeded catalog, navbar and deep link, `salad_customization` on wing payloads, dynamic Wings-4-U salad UI, cart display, and checkout/cart validation against the salad menu item.

The one operational dependency is the same as other seed-driven features: **refresh menu data** in environments that were seeded before this work.

Related plan:

- [`Salads on menu.md`](./Salads%20on%20menu.md)
