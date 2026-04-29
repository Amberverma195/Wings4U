# Menu Size Normalization and Grouped Cards

**Purpose:** This document records the work that removed legacy duplicate size cards from the `/order` menu, added grouped customer-facing menu cards for size-based products, introduced a size-picker flow for legacy grouped items, and normalized the live `LON01` catalog so the database now matches the intended "single item + size modifier group" model.

**Scope:** This pass covered:

- frontend menu display shaping for `poutines-and-sides`, `breads`, and appetizer quantity cleanup
- live catalog normalization for `LON01`
- verification of API output after the data change

This pass did **not** introduce any database schema changes.

---

## 1. Problem statement

### Before

The `/order` menu was rendering raw API `menu_items` directly. That meant any product stored as separate legacy rows for each size showed up as multiple cards, even when the customer-facing intent was a single product with a size choice.

Concrete examples from the live `LON01` catalog before this fix:

- `Regular Poutine (Small)` and `Regular Poutine (Large)` rendered as two separate cards
- `Fries (Small)` and `Fries (Large)` rendered as two separate cards
- `Loaded Garlic Bread (4pc) – Plain` and `Loaded Garlic Bread (8pc) – Plain` rendered as two separate cards

This caused three problems:

1. The page became longer and noisier than necessary.
2. The customer saw duplicated products instead of one product with sizes.
3. The catalog shape in the live database was behind the intended repo model, where sizes were supposed to be represented with a real modifier group using `context_key = "size"`.

There was also a related display issue in appetizers:

- quantities like `8pc` and `6pc` were embedded in the title instead of being shown as supporting detail in the description area

### Intended behavior

The intended customer-facing behavior was:

- one card per product or product variant
- size information shown as description text on the card
- `Add to Cart` opens a size-choice flow when the item has multiple sizes
- appetizer quantity labels appear as supporting description text, not as part of the heading

---

## 2. What was discovered

### Frontend state

The current menu page in [menu-page.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/wingkings/components/menu-page.tsx) was rendering:

- one card per `category.items[]` entry from the API
- no display grouping layer between the API response and the menu grid

That meant whatever came from `/api/v1/menu` was shown as-is.

### Existing modal behavior

The existing [item-modal.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/components/item-modal.tsx) already supported real size modifier groups:

- it checks `modifier_groups` for `context_key === "size"`
- it renders size pills for those groups
- it keeps quantity and special instructions

So the repo already had the correct add-to-cart UX for properly normalized items.

### Live DB state before normalization

The live `LON01` database still had legacy split rows in:

- `poutines-and-sides`
- `breads`

Examples from the live DB before normalization:

- `Regular Poutine (Small)` / `Regular Poutine (Large)`
- `Bacon Poutine (Small)` / `Bacon Poutine (Large)`
- `Fries (Small)` / `Fries (Large)`
- `Loaded Garlic Bread (4pc) – Plain` / `Loaded Garlic Bread (8pc) – Plain`

The `LON01` location also had:

- `orderCount = 0`

That made destructive menu cleanup safe for this location.

### Repo intent vs live DB

The repo already modeled the desired structure in seed code:

- [seed.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts)

That file creates:

- one poutine/side item plus a real size modifier group
- one bread variant plus a real size modifier group

However, the checked-in generic import path in [import-menu.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/import-menu.ts) was not safe to use directly for this fix because its current source/input shape would also alter unrelated catalog behavior, including category layout and wing catalog structure. So the live cleanup needed a targeted normalizer, not a full import reset.

---

## 3. Frontend changes

### New display shaping layer

Added:

- [menu-display.ts](d:/Projects/Websites/Wings4U/Code/apps/web/src/wingkings/menu-display.ts)

This file introduces a customer-facing display model that sits between the raw API menu response and the rendered menu grid.

It handles three cases:

1. **Already-normalized size items**
   - If an item already has a real modifier group with `context_key === "size"`, it remains one card.
   - The card description is synthesized as:
     - `Sizes: Small, Large`
     - `Sizes: 4pc, 8pc`
   - The card price is shown as a starting price.

2. **Legacy split size items**
   - For categories that historically had duplicate size rows, the display model groups them before rendering.
   - Grouping rules:
     - `poutines-and-sides` / `poutines-sides`
       - strip terminal size suffixes like `(Small)` / `(Large)`
     - `breads`
       - strip the size token but preserve the flavor/variant suffix
       - example:
         - `Loaded Garlic Bread (4pc) – Plain`
         - `Loaded Garlic Bread (8pc) – Plain`
         - becomes one display card:
           - `Loaded Garlic Bread - Plain`

3. **Appetizer quantity cleanup**
   - Quantities embedded in titles like `(8pc)` are extracted and moved into the display description.
   - example:
     - `Mac n Cheese Bites (8pc)` becomes:
       - title: `Mac n Cheese Bites`
       - description: `8pc · Served with ranch`

### Menu page integration

Updated:

- [menu-page.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/wingkings/components/menu-page.tsx)

Changes made:

- menu categories are now passed through `buildDisplayMenuCategories(...)`
- cards render from `DisplayMenuItem` rather than raw `MenuItem`
- per-card cart count now sums across all real SKU IDs behind a grouped display card
- prices can render as:
  - `$9.99`
  - `From $6.49`

### Legacy size selection modal

Added:

- [legacy-size-picker-modal.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/components/legacy-size-picker-modal.tsx)

This modal was added specifically for grouped legacy items.

Behavior:

- opens when a grouped legacy card is clicked
- shows size options as pills
- shows the price beside each size option
- preserves:
  - quantity
  - special instructions
- on confirm, adds the **real selected SKU** to cart using the real `menu_item_id`

This was important because cart, quote, and checkout all expect real DB item IDs. The implementation does **not** invent fake size modifiers or fake grouped item IDs.

### CSS update

Updated:

- [globals.css](d:/Projects/Websites/Wings4U/Code/apps/web/src/app/globals.css)

Added:

- `.wk-pill-price-inline`

This styles the inline price label shown inside the legacy size picker pills.

---

## 4. Live DB normalization

### Why a targeted DB script was used

A full import reset through [import-menu.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/import-menu.ts) was intentionally **not** used here.

Reason:

- the current import source path would have also changed unrelated catalog structure
- that included category layout differences and broader menu reshaping beyond the requested size-card fix
- this task required a surgical correction, not a full catalog rewrite

### New DB normalization script

Added:

- [normalize-menu-legacy-sizes.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/normalize-menu-legacy-sizes.ts)

This script performs a targeted normalization against live `LON01`.

### Safety guard

The script first checks:

- `location code = LON01`
- `orderCount = 0`

If the location had existing orders, the script would refuse to proceed.

### What the script does

For `poutines-and-sides`, `poutines-sides`, and `breads`:

1. finds legacy split size rows
2. groups them by customer-facing product name
3. creates one normalized `menu_items` row
4. creates a real `modifier_groups` row with:
   - `context_key = "size"`
   - `selection_mode = "SINGLE"`
   - `min_select = 1`
   - `max_select = 1`
5. creates `modifier_options` for each size
6. links the new size group through `menu_item_modifier_groups`
7. deletes the old split legacy rows

### Exact live groups normalized

The live script normalized these 12 legacy size groups:

- `breads: Loaded Garlic Bread - Cheese`
- `breads: Loaded Garlic Bread - Cheese & Bacon`
- `breads: Loaded Garlic Bread - Plain`
- `poutines-and-sides: Bacon Poutine`
- `poutines-and-sides: Buffalo Chicken Poutine`
- `poutines-and-sides: Butter Chicken Poutine`
- `poutines-and-sides: Coleslaw`
- `poutines-and-sides: Fries`
- `poutines-and-sides: Gravy`
- `poutines-and-sides: Onion Rings`
- `poutines-and-sides: Regular Poutine`
- `poutines-and-sides: Wedges`

### Appetizer backfill

The same script also backfilled missing appetizer descriptions from:

- [wings4u-menu.v1.json](d:/Projects/Websites/Wings4U/Code/Docs/menu/wings4u-menu.v1.json)

This was used to improve display output for appetizer quantity cleanup.

It specifically helped produce final customer-facing descriptions like:

- `Mac n Cheese Bites` -> `8pc · Served with ranch`
- `Mozzarella Sticks` -> `8pc · Served with salsa`
- `Jalapeño Poppers` -> `6pc · Served with ranch`

One detail had to be handled carefully:

- accented names like `Jalapeño` needed normalized matching so the source copy could be applied correctly

That was addressed by normalizing Unicode and stripping accents when generating the matching key.

---

## 5. What the live DB looks like after the fix

### Poutines & sides

After normalization, `poutines-and-sides` no longer stores separate small/large rows for the affected products.

Examples after the fix:

- `Regular Poutine`
  - size options:
    - `Small`
    - `Large`
- `Fries`
  - size options:
    - `Small`
    - `Large`
- `Gravy`
  - size options:
    - `Small`
    - `Large`

### Breads

After normalization, `breads` now contains one row per flavor variant.

Examples after the fix:

- `Loaded Garlic Bread - Plain`
  - size options:
    - `4pc`
    - `8pc`
- `Loaded Garlic Bread - Cheese`
  - size options:
    - `4pc`
    - `8pc`
- `Loaded Garlic Bread - Cheese & Bacon`
  - size options:
    - `4pc`
    - `8pc`

### Appetizers

Appetizer titles are still stored in the DB in their real row form, but the frontend display layer now presents quantity information more cleanly. Where source descriptions were missing and available from the checked-in menu source, they were backfilled.

---

## 6. Verification performed

### TypeScript

Ran:

- `npx tsc --noEmit` in `apps/web`
- `npx tsc -p tsconfig.json --noEmit` in `packages/database`

Both passed.

### Live DB checks

Verified before normalization:

- `LON01` existed
- `orderCount = 0`
- legacy split rows existed in `poutines-and-sides` and `breads`

Verified after normalization:

- `poutines-and-sides` returns single items with real `size` modifier groups
- `breads` returns single items with real `size` modifier groups
- appetizer descriptions were backfilled where source text existed

### API verification

Verified:

- `GET /api/v1/menu?location_id=987c0642-3591-4ae1-badc-40836469744c&fulfillment_type=PICKUP`
- with header:
  - `X-Location-Id: 987c0642-3591-4ae1-badc-40836469744c`

Result:

- returned `200`
- returned normalized size-group data for `poutines-and-sides` and `breads`

### Display-model verification

Verified the actual frontend shaping layer output after the live DB change.

Observed final display results:

- `Regular Poutine`
  - `Sizes: Small, Large`
  - `From $6.49`
- `Fries`
  - `Sizes: Small, Large`
  - `From $4.49`
- `Loaded Garlic Bread - Plain`
  - `Sizes: 4pc, 8pc`
  - `From $4.49`
- `Mac n Cheese Bites`
  - `8pc · Served with ranch`
- `Mozzarella Sticks`
  - `8pc · Served with salsa`
- `Jalapeño Poppers`
  - `6pc · Served with ranch`

---

## 7. Files added or changed

### Frontend

- [menu-display.ts](d:/Projects/Websites/Wings4U/Code/apps/web/src/wingkings/menu-display.ts)
- [menu-page.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/wingkings/components/menu-page.tsx)
- [legacy-size-picker-modal.tsx](d:/Projects/Websites/Wings4U/Code/apps/web/src/components/legacy-size-picker-modal.tsx)
- [globals.css](d:/Projects/Websites/Wings4U/Code/apps/web/src/app/globals.css)

### Database tooling

- [normalize-menu-legacy-sizes.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/normalize-menu-legacy-sizes.ts)

### Source data referenced

- [wings4u-menu.v1.json](d:/Projects/Websites/Wings4U/Code/Docs/menu/wings4u-menu.v1.json)
- [seed.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts)
- [import-menu.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/import-menu.ts)

---

## 8. Important non-changes

### No schema change

This work did **not** change the DB schema.

That means:

- no new tables
- no new columns
- no constraint changes
- no `FINAL.sql` update required for this pass

This was a **data normalization + frontend behavior** pass, not a schema migration.

### No full catalog reimport

This work did **not** run the generic destructive menu import path.

That was deliberate because the current generic import path would have introduced unrelated menu regressions.

---

## 9. Final outcome

After this pass:

- duplicate size cards no longer bloat the customer-facing menu
- size-based products are represented as one card with size info in the description
- `Add to Cart` supports size selection without breaking cart/checkout expectations
- appetizer quantity labels are shown in supporting text instead of cluttering titles
- the live `LON01` DB now matches the intended size-group model for the affected categories

---

## 10. Recommended follow-up

If this normalization should become the standard operational path for future live environments, the next step should be to decide whether to:

1. keep [normalize-menu-legacy-sizes.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/normalize-menu-legacy-sizes.ts) as the official targeted repair script for stale catalogs, or
2. bring [import-menu.ts](d:/Projects/Websites/Wings4U/Code/packages/database/prisma/import-menu.ts) fully into alignment with the current production menu/category expectations so it can safely replace the targeted script

At the moment, the targeted normalizer is the safer production path for this exact fix.
