# Collapse Legacy Size-Split Cards Into One Customer-Facing Item

## Summary
- Fix the `/order` page so duplicate size SKUs do not bloat the menu.
- On the web menu, collapse legacy split items in `poutines-and-sides` and `breads` into one card per product/variant, show sizes in the description, and ask for size after `Add to Cart`.
- In `appetizers`, move embedded piece counts like `8pc` / `6pc` out of the title and into the description.
- Also normalize the live `LON01` catalog using the existing import pipeline, because the database currently still has legacy split SKUs and `orderCount = 0`, so destructive catalog cleanup is safe.

## Key Changes
- **Web menu presentation**
  - Add a customer-facing display model in the menu page instead of rendering raw `MenuItem` rows directly.
  - For real size-modifier items (`modifier_groups` with `context_key === "size"`), keep one card, synthesize a description like `Sizes: Small, Large` or `Sizes: 4pc, 8pc`, and show a starting price.
  - For legacy split SKUs with no size modifier group, group them in the UI before rendering:
    - `poutines-and-sides`: strip terminal size suffixes like `(Small)` / `(Large)` and group by base name.
      Example: `Regular Poutine (Small)` + `Regular Poutine (Large)` -> one card titled `Regular Poutine`.
    - `breads`: strip the size token but preserve the flavour/variant suffix.
      Example: `Loaded Garlic Bread (4pc) – Plain` + `Loaded Garlic Bread (8pc) – Plain` -> one card titled `Loaded Garlic Bread – Plain`.
  - Grouped cards show `From $X.XX` using the lowest price in the family.

- **Add-to-cart flow**
  - For grouped legacy items, `Add to Cart` must open a size-selection modal instead of adding immediately.
  - That modal must preserve the current non-wing flow expectations:
    - choose size first
    - keep quantity control
    - keep special instructions
  - On confirm, add the real selected SKU to cart using its real `menu_item_id` and price.
  - Do not invent fake size modifier IDs for legacy grouped items; cart/quote/checkout must continue receiving valid real SKU data.
  - For already-normalized items with real size modifier groups, continue using the existing `ItemModal`.

- **Appetizer title cleanup**
  - In `appetizers`, strip trailing quantity tokens from the title when they are embedded in the item name.
    - Example: `Mac n Cheese Bites (8pc)` -> title `Mac n Cheese Bites`, description `8pc`
  - If a real description exists later from normalized data, compose them together.
    - Example: `8pc · Served with ranch`

- **Live catalog cleanup**
  - Do not re-run seed; `seed.ts` will skip because `LON01` already exists.
  - Use the canonical import/normalization path instead, since the repo already models these items correctly in JSON/import logic.
  - Normalize live `LON01` so:
    - `poutines-and-sides` use one base item + size modifier groups
    - `breads` use one base item per flavour variant + size modifier groups
    - `appetizers` regain canonical descriptions / quantity naming from the import source
  - Keep the UI grouping fallback even after cleanup, so stale legacy imports do not reintroduce page bloat.

## Public Interfaces / Types
- No external API contract change is required for the customer-facing fix.
- No cart or checkout payload shape change.
- Add an internal web-only grouped-card model for:
  - normalized size-group items
  - legacy grouped variant families
  - appetizer display title/description cleanup

## Test Plan
- **Data checks**
  - Confirm `LON01` still has `0` orders before destructive catalog import.
  - After import, verify live `poutines-and-sides` and `breads` are no longer stored as separate `(Small)` / `(Large)` or `(4pc)` / `(8pc)` menu items.
  - Verify normalized items have real size groups where expected.

- **UI behavior**
  - `Regular Poutine`, `Bacon Poutine`, `Buffalo Chicken Poutine`, `Butter Chicken Poutine`, `Fries`, `Onion Rings`, `Wedges`, `Coleslaw`, and `Gravy` each render once, not twice.
  - Garlic bread renders once per flavour variant, not once per size.
  - Grouped cards show size info in the description and `From $X.XX`.
  - Clicking `Add to Cart` on a grouped poutine/side/bread opens a size picker.
  - Selecting `Large` adds the correct real SKU and correct price to cart.
  - `appetizers` titles no longer include `8pc` / `6pc` in the heading; that quantity appears in the description.
  - Existing already-normalized size-group items still work with the existing `ItemModal`.

- **Verification**
  - `npx tsc --noEmit` in `apps/web`
  - Any existing relevant API/web checks after the import path is run

## Assumptions
- Price display for grouped cards is `From $X.XX`, not a range and not blank.
- Scope is limited to `poutines-and-sides`, `breads`, and appetizer quantity cleanup; wings and wing combos remain intentionally separate size cards.
- The size prompt for legacy grouped items should happen inside a modal flow that still includes quantity and special instructions.
- If future live data already arrives normalized, the UI should prefer real size modifier groups and only fall back to legacy name parsing when no size group exists.
