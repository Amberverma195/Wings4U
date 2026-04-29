## Split Wings Into Real Size Cards, Add Breads Category, and Update WingKings Order Flow

### Summary
Restructure the real menu so `Wings` and `Wing Combos` become multiple real catalog items in Supabase instead of single weight-builder cards, and split `Appetizers & Extras` into `Appetizers` plus a new `Breads` tab. Re-import the menu, keep the existing API contract, and update `/order` so wing/combo cards open a modifier picker instead of adding directly.

### Key Changes
#### Menu data and import pipeline
- Keep the current docx extraction as the source for wing pricing and combo pricing, but change the curated category model to:
  1. `Lunch Specials`
  2. `Wings`
  3. `Wing Combos`
  4. `Burgers`
  5. `Tenders`
  6. `Wraps`
  7. `Poutines & Sides`
  8. `Specialty Fries`
  9. `Appetizers`
  10. `Breads`
  11. `Dips`
  12. `Drinks`
  13. `Dessert`
  14. `Specials`
- Rename category display/slug from `appetizers-extras` to `appetizers`.
- Add new category `Breads` with slug `breads`, immediately after `Appetizers`.
- Move all loaded garlic bread items out of `Appetizers` and into `Breads`.
- Continue using real extracted pricing for wings/combos, but materialize them in the importer as real `menu_items`:
  - `Wings` cards:
    - `1 Pound - 1 Flavour` `$12.99`
    - `1.5 Pound - 1 Flavour` `$18.99`
    - `2 Pound - 1 Flavour` `$24.99`
    - `3 Pound - 2 Flavours` `$35.99`
    - `4 Pound - 2 Flavours` `$46.99`
    - `5 Pound - 3 Flavours` `$58.99`
  - `Wing Combos` cards:
    - `1 Pound Combo` `$17.99` desc `1 small side + 1 pop`
    - `1.5 Pound Combo` `$23.99` desc `1 large side + 1 pop`
    - `2 Pound Combo` `$29.99` desc `1 large side + 2 pop`
    - `3 Pound Combo` `$49.99` desc `2 large sides + 3 pop`
    - `5 Pound Combo` `$79.99` desc `2 large sides + 5 pop`
- Stop creating `Wing Weight` and `Wing Combo Weight` modifier groups entirely.
- Keep `builder_type` on the imported cards:
  - wing size cards use `WINGS`
  - combo size cards use `WING_COMBO`

#### Modifier model for the new real cards
- Keep `Wing Type` as a required single-select modifier on every wing and combo card.
- Replace the old shared multi-select flavour group with exact required flavour slot groups:
  - `Flavour 1`
  - `Flavour 2`
  - `Flavour 3`
- Attach only as many required flavour groups as each card needs:
  - 1 lb / 1.5 lb / 2 lb cards: `Flavour 1`
  - 3 lb / 4 lb cards: `Flavour 1`, `Flavour 2`
  - 5 lb cards: `Flavour 1`, `Flavour 2`, `Flavour 3`
  - Wing combo cards follow the same flavour-count rule by weight
- Each flavour slot group is required, single-select, and contains one option per imported `wing_flavours` row.
- Defer the old `Extra Flavour +$1.00` add-on in this pass; do not attach it to the new cards.
- Keep combo side choice as required modifiers:
  - 1 lb / 1.5 lb / 2 lb combo cards get one required group: `Side 1`
  - 3 lb / 5 lb combo cards get two required groups: `Side 1` and `Side 2`
- Each side group offers exactly: `Fries`, `Onion Rings`, `Wedges`, `Coleslaw`.

#### API and web behavior
- No new endpoint is needed. Keep `/api/v1/menu` shape the same, but its data changes:
  - `wings` now returns 6 real items
  - `wing-combos` now returns 5 real items
  - `appetizers` replaces `appetizers-extras`
  - `breads` is added as a new category
- Keep curated menu ordering through the existing `createdAt`-based API ordering.
- Update WingKings menu rendering so it no longer shows weight ladders inside a single wing card.
- Render each imported wing/combo as its own card.
- In the `Wing Combos` tab, show the note below the card grid:
  - `Side option for combos - Fries or Onion Rings or Wedges or Coleslaw`
- Update emoji/category mapping for:
  - `appetizers`
  - `breads`
- Change `/order` interaction for wing/combo cards from direct add to picker-based add:
  - clicking a wing/combo card opens a modifier picker
  - reuse the existing shared item-picker/cart flow instead of inventing a second modifier form
  - WingKings cart/context should be aligned to the shared cart item shape so selected modifiers and instructions persist through cart and checkout

### Important Interface Changes
- `MenuCategory.slug` values change:
  - `appetizers-extras` → `appetizers`
  - new `breads`
- `/api/v1/menu` response still returns the same top-level shape, but these category/item contents change materially:
  - multiple real wing items instead of one weight-builder card
  - multiple real wing-combo items instead of one weight-builder card
  - exact flavour-slot groups instead of `Wing Weight` / `Wing Combo Weight`
- WingKings `/order` should stop assuming `onAddToCart(MenuItem)` with no modifiers for configurable items.

### Test Plan
- Run menu extraction and confirm:
  - `Appetizers` exists
  - `Breads` exists directly after `Appetizers`
  - all garlic breads moved to `Breads`
  - wing pricing and wing combo pricing remain correct
- Run menu import and confirm in Supabase:
  - `Wings` has 6 real items
  - `Wing Combos` has 5 real items
  - no `Wing Weight` or `Wing Combo Weight` groups are created
  - 3 lb and 5 lb combo items each have two required side groups
- API check:
  - `/api/v1/menu` returns the new category slugs and curated order
  - wings/cards appear in the exact requested sequence
  - combo cards show the exact requested prices and descriptions
- Web check on `/order`:
  - separate wing and combo cards render
  - `Breads` tab appears
  - garlic breads are gone from `Appetizers`
  - clicking a wing/combo card opens the picker
  - picker enforces the exact flavour count for that card
  - combo picker enforces one or two side selections based on combo size
  - note below combo cards is visible
- Cart/checkout check:
  - selected modifiers are preserved in cart
  - checkout payload includes selected flavour and side modifiers correctly

### Assumptions
- `3 Pound Combo` price is locked to `$49.99`, matching the current extracted real-menu JSON.
- Wings keep all 6 size cards, including `4 Pound - 2 Flavours`.
- Wing combos keep exactly 5 cards: `1`, `1.5`, `2`, `3`, and `5` lb.
- `Breads` sits immediately after `Appetizers`.
- No SQL or Prisma schema change is required; this is a menu-import, API-data, and web-flow change.
- `Extra Flavour +$1.00` is intentionally deferred from this pass.
