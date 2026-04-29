# Wings / Card Builder Implementation

Last updated: 2026-04-07

## Purpose

This document explains the full implementation work for the PRD-aligned item customization flow, wings builder, and wing combo builder.

It is meant to answer:

1. What was built.
2. Which files were changed.
3. What each file now does.
4. What was verified.
5. What still needs environment-level follow-through.

---

## Scope that was implemented

This work covered the PRD areas that correspond to:

- Section 4: item customization
- Section 5: wings builder
- Section 6: wing combo builder

The final goal was:

- replace the generic item modal for customizable items with a proper customization overlay
- expose removable ingredients for applicable menu items
- collapse wings and wing combos into synthetic single-entry builder cards
- persist customization and builder state through cart, checkout, order detail, and KDS-facing display

---

## High-level outcome

The implementation is now in place in code across backend and frontend.

What now exists:

- removable ingredient support in the data model
- menu API support for removable ingredients
- synthetic menu cards for:
  - Wings (By the Pound)
  - Wing Combo
- full-screen item customization overlay
- guided wings builder
- guided combo builder
- removed-ingredient validation during cart/checkout flow
- removed ingredients persisted as `REMOVE_INGREDIENT` order modifiers
- cart, checkout, order detail, and KDS display that separates removals from normal add-ons

What was verified:

- Prisma client generation
- API build
- web build

What was not fully completed at environment level:

- migration/re-seed has not been applied by this document itself to a live or local DB instance
- end-to-end browser ordering against a migrated database still needs to be run as a final business verification step

---

## Implementation by phase

## Phase 1: Data Model and Seed Foundation

### Objective

Create the data foundation required for ingredient removal and ensure the menu data model can support the builders.

### What was in place / what was completed

The following database foundation files were part of the completed setup:

- [`../../packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma)
- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)
- [`../../packages/database/prisma/migrations/20260406110000_removable_ingredients/migration.sql`](../../packages/database/prisma/migrations/20260406110000_removable_ingredients/migration.sql)

### Database model change

The implementation uses a `RemovableIngredient` model related to `MenuItem`.

This enables:

- zero-cost ingredient removals
- per-item ingredient lists
- backend validation that a removed ingredient really belongs to the selected menu item

### Seed responsibilities

The seed layer now supports:

- removable ingredients for applicable items such as burgers, wraps, poutines, and similar customizable items
- modifier-group `context_key` usage needed for frontend grouping logic

The `context_key` values matter because the frontend builder logic uses them to separate:

- `size`
- `addon`
- `side`
- `drink`

### Migration added

The migration file added in this implementation creates:

- `removable_ingredients` table
- index for item/ordering lookup
- foreign key to `menu_items`

### Important note

The codebase is ready for this data model, but the database still needs the migration and seed to be applied in your environment.

---

## Phase 2: API Layer Changes

### Objective

Extend the menu, cart, and checkout backend so the new customization and builder flows are first-class API features instead of frontend-only behavior.

### Files changed

- [`../../apps/api/src/modules/catalog/catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts)
- [`../../apps/api/src/modules/cart/cart.controller.ts`](../../apps/api/src/modules/cart/cart.controller.ts)
- [`../../apps/api/src/modules/cart/cart.service.ts`](../../apps/api/src/modules/cart/cart.service.ts)
- [`../../apps/api/src/modules/checkout/checkout.controller.ts`](../../apps/api/src/modules/checkout/checkout.controller.ts)
- [`../../apps/api/src/modules/checkout/checkout.service.ts`](../../apps/api/src/modules/checkout/checkout.service.ts)

### Catalog changes

`catalog.service.ts` was extended so the menu response now includes:

- `removable_ingredients`
- synthetic wings builder item
- synthetic combo builder item

#### Synthetic wings card behavior

Instead of exposing all wing weight SKUs directly as separate customer-facing cards, the API now emits one synthetic builder entry for the `wings` category.

That synthetic entry includes:

- `builder_type: "WINGS"`
- `weight_options`
- `builder_sku_map`

Each `weight_option` carries enough information for the frontend to:

- show weight choices
- know price
- know flavour slot count
- resolve the final selected weight back to the real `menu_item_id`

#### Synthetic combo card behavior

The same pattern is used for wing combos:

- one synthetic `Wing Combo` card
- `builder_type: "WING_COMBO"`
- `combo_options`
- `builder_sku_map`

Each combo option carries:

- real SKU id
- price
- flavour slot count
- side slot count
- drink slot count
- modifier groups

This lets the frontend builder resolve combo size to the real menu item only at submit time.

### Cart API changes

`cart.controller.ts` and `cart.service.ts` were updated so the cart quote flow understands:

- `removed_ingredients`
- builder payloads
- extra flavour pricing

Key behavior:

- removed ingredients are accepted but do not change price
- removed ingredient IDs are validated against the selected menu item
- extra flavour pricing is applied in the quote path

### Checkout API changes

`checkout.controller.ts` and `checkout.service.ts` now support full persistence of the new flows.

The checkout flow now:

- accepts `removed_ingredients`
- accepts `builder_payload`
- validates ingredient removals
- stores the builder payload snapshot
- creates `OrderItemModifier` records with `modifier_kind = "REMOVE_INGREDIENT"`

The `REMOVE_INGREDIENT` rows are persisted using:

- no modifier group id
- no modifier option id
- `modifierGroupNameSnapshot = "Ingredient removal"`
- `modifierNameSnapshot = ingredient name`
- `priceDeltaCents = 0`

This is what makes the removals visible later in order detail and KDS output.

### Files reviewed but not changed

These backend files were checked during implementation because they were already compatible:

- `orders.service.ts`
- `kds.service.ts`

They already serialize `modifier_kind`, so they did not require structural changes for the removal-display path.

---

## Phase 3: Frontend Types, Cart, and Checkout State

### Objective

Make the frontend type system and cart logic understand the new menu contract and carry the customization state correctly all the way through checkout.

### Files changed

- [`../../apps/web/src/lib/types.ts`](../../apps/web/src/lib/types.ts)
- [`../../apps/web/src/lib/cart-item-utils.ts`](../../apps/web/src/lib/cart-item-utils.ts)
- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)
- [`../../apps/web/src/app/cart/cart-client.tsx`](../../apps/web/src/app/cart/cart-client.tsx)
- [`../../apps/web/src/app/checkout/checkout-client.tsx`](../../apps/web/src/app/checkout/checkout-client.tsx)
- [`../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx`](../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)

### Type updates

`types.ts` was extended to support:

- `removable_ingredients` on `MenuItem`
- `weight_options`
- `combo_options`
- `builder_sku_map`
- `RemovedIngredientSelection`
- `ItemCustomizationPayload`
- `CartBuilderPayload`

This made the frontend aware of the richer menu contract from the API.

### Cart keying changes

`cart.ts` was updated so cart item uniqueness now accounts for removed ingredients.

That means:

- the same burger with no removals and the same burger with `No Tomato` are treated as different cart lines

Without this change, cart lines would incorrectly merge.

### Shared cart price helpers

`cart-item-utils.ts` was added to centralize:

- extra flavour price constant
- extraction of removed ingredients from payloads
- cart unit price calculation
- builder price delta calculation

This avoided price logic being copied into multiple screens.

### Cart display changes

`cart-client.tsx` now:

- sends `removed_ingredients` in quote requests
- sends `builder_payload`
- shows removed ingredients separately from add-ons

Displayed format now becomes:

- `No Tomato, No Onion`
- `Add-ons: Extra Cheese, Bacon`

instead of mixing everything into one modifier line.

### Checkout display and payload changes

`checkout-client.tsx` now:

- passes `removed_ingredients`
- passes `builder_payload`
- shows removals separately in the summary

### Order detail changes

`order-detail-client.tsx` now separates modifiers by `modifier_kind`.

That allows order history/detail pages to render:

- removals as `No X`
- normal add-ons separately

This is the downstream customer-facing half of the persistence work.

---

## Phase 4: Frontend Builders and Core Menu UI

### Objective

Build the actual user-facing builder experience and connect it to the main ordering surfaces.

### Files changed

- [`../../apps/web/src/lib/menu-item-customization.ts`](../../apps/web/src/lib/menu-item-customization.ts)
- [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-modal.tsx`](../../apps/web/src/components/item-modal.tsx)
- [`../../apps/web/src/app/menu/menu-client.tsx`](../../apps/web/src/app/menu/menu-client.tsx)
- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

### Menu routing helper

`menu-item-customization.ts` was added to centralize menu-item behavior decisions:

- is this a wings builder item?
- is this a combo builder item?
- should this item open the customization overlay?
- can this item quick-add directly?

This file exists to stop menu click logic from being duplicated across multiple menu surfaces.

### Shared builder utilities

`builder-shared.tsx` now provides reusable UI and logic for both wings and combos:

- progress indicator
- step container
- sticky footer
- flavour picker
- saucing method picker
- wing flavour loading hook

This is the shared foundation both builders depend on.

### Item customization overlay

`item-customization-overlay.tsx` replaced the old generic modal behavior for customizable standard items.

It now provides:

- image banner or branded fallback
- item name and description
- ingredient removal chip list
- grouped modifiers by context
- special instructions
- quantity
- live total
- validation + auto-scroll to invalid section

This is the PRD Section 4 implementation.

### Wings builder

`wings-builder.tsx` implements the guided single-card wings flow.

It now supports:

- wing type
- preparation
- weight selection
- flavour-slot count based on selected weight
- sauce/flavour selection
- saucing method selection
- optional extra flavour
- special instructions
- quantity
- live price

Important behavior:

- the builder resolves the selected synthetic option back to the real menu SKU before adding to cart
- boneless auto-forces non-breaded
- flavour placement data is stored in the builder payload

### Combo builder

`combo-builder.tsx` implements the guided combo flow.

It supports:

- combo size
- wing type
- preparation
- flavours
- saucing
- required side selections
- required drink selections
- instructions
- live price

Important behavior:

- side/drink requirements come from combo option modifier groups using `context_key`
- selected synthetic combo option resolves back to the real combo SKU at add-to-cart time

### Fallback modal

`item-modal.tsx` was kept as the fallback path for simple items that do not require the new overlay.

It was also adjusted to remain type-safe after the modifier-group model updates.

### Main menu route integration

Two menu surfaces were updated:

- `app/menu/menu-client.tsx`
- `Wings4u/components/menu-page.tsx`

This was important because the app had more than one customer-facing menu flow.

Both menu flows now correctly route item clicks by item type:

- simple item -> quick add
- customizable standard item -> customization overlay
- synthetic wings card -> wings builder
- synthetic combo card -> combo builder

This is what makes the new system actually usable in the real ordering UI, not just present in isolated components.

### Global styling

`globals.css` was extended with the full styling layer required by the new overlays and builders:

- overlay layout
- builder panel layout
- progress states
- ingredient chip states
- option pills
- flavour tabs
- step card states
- sticky footer
- removal line styling

Without these additions, the new builder components would compile but not render correctly.

---

## Phase 5: Downstream Display and KDS-facing Behavior

### Objective

Ensure the new customization data is visible after checkout in all major downstream views.

### Files changed

- [`../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx`](../../apps/web/src/app/orders/[orderId]/order-detail-client.tsx)
- [`../../apps/web/src/app/kds/kds-client.tsx`](../../apps/web/src/app/kds/kds-client.tsx)
- [`../../apps/web/src/app/kds/page.tsx`](../../apps/web/src/app/kds/page.tsx)

### Order detail result

Order detail now renders:

- ingredient removals as `No X`
- normal modifiers separately

This makes the order summary consistent with what was actually submitted.

### KDS result

The repo originally only had a placeholder KDS page.

Because of that, Phase 5 could not be completed by merely tweaking an existing KDS card component. A minimal real KDS page was created instead.

`kds-client.tsx` now:

- reads `/api/v1/kds/orders`
- lists active tickets
- renders item flavours
- renders removed ingredients separately from add-ons
- shows kitchen notes and customer notes

`kds/page.tsx` now renders this real KDS client instead of the placeholder shell.

This means the removal/add-on distinction is now visible on the KDS surface too.

---

## File-by-file inventory

The list below records the main files involved in the implementation.

| File | Status | Purpose |
|---|---|---|
| `packages/database/prisma/schema.prisma` | foundation / verified | Holds the `RemovableIngredient` model and relation to `MenuItem`. |
| `packages/database/prisma/seed.ts` | foundation / verified | Seeds removable ingredients and the modifier-group context keys used by builders. |
| `packages/database/prisma/migrations/20260406110000_removable_ingredients/migration.sql` | new | Creates the removable ingredient table and constraints. |
| `apps/api/src/modules/catalog/catalog.service.ts` | modified | Adds `removable_ingredients` and synthetic wings/combo cards to the menu API. |
| `apps/api/src/modules/cart/cart.controller.ts` | modified | Accepts `removed_ingredients` in cart requests. |
| `apps/api/src/modules/cart/cart.service.ts` | modified | Validates removed ingredients and applies builder-related pricing behavior. |
| `apps/api/src/modules/checkout/checkout.controller.ts` | modified | Accepts removed ingredients and builder payload in checkout requests. |
| `apps/api/src/modules/checkout/checkout.service.ts` | modified | Validates, snapshots, and persists removed ingredients into order modifiers. |
| `apps/web/src/lib/types.ts` | modified | Adds the menu/cart/builder types required by the new contract. |
| `apps/web/src/lib/cart-item-utils.ts` | new | Shared helper for cart pricing and removed-ingredient extraction. |
| `apps/web/src/lib/cart.ts` | modified | Makes cart keying and cart state aware of removals and builder payloads. |
| `apps/web/src/lib/menu-item-customization.ts` | new | Centralized frontend item routing rules for quick-add vs builder vs overlay. |
| `apps/web/src/components/builder-shared.tsx` | new | Shared step/progress/flavour/footer logic for the builder flows. |
| `apps/web/src/components/item-customization-overlay.tsx` | new | PRD-style customization overlay for standard customizable menu items. |
| `apps/web/src/components/wings-builder.tsx` | new | Guided single-card wings builder. |
| `apps/web/src/components/combo-builder.tsx` | new | Guided single-card combo builder. |
| `apps/web/src/components/item-modal.tsx` | modified | Preserved as fallback for simple items; updated for compatibility. |
| `apps/web/src/app/menu/menu-client.tsx` | modified | Routes items into quick-add, customization overlay, wings builder, or combo builder. |
| `apps/web/src/Wings4u/components/menu-page.tsx` | modified | Wires the real branded ordering page into the new builder system. |
| `apps/web/src/app/cart/cart-client.tsx` | modified | Displays removals separately and sends new payload fields to quote flow. |
| `apps/web/src/app/checkout/checkout-client.tsx` | modified | Persists/remits builder payload and removals through checkout. |
| `apps/web/src/app/orders/[orderId]/order-detail-client.tsx` | modified | Shows `REMOVE_INGREDIENT` lines separately from add-ons. |
| `apps/web/src/app/kds/kds-client.tsx` | new | Minimal live KDS board that displays removals separately from add-ons. |
| `apps/web/src/app/kds/page.tsx` | modified | Replaces the placeholder KDS page with the new client. |
| `apps/web/src/app/globals.css` | modified | Adds the styling system required by the new overlays and builders. |

---

## Verification performed

The following verification steps were completed:

### Prisma client generation

`npm run db:generate`

Purpose:

- confirm that the schema and Prisma client still generate correctly after the data-model additions

### API build

`npm run build --workspace @wings4u/api`

Purpose:

- confirm the backend compiles with the new menu/cart/checkout changes

### Web build

`npm run build --workspace @wings4u/web`

Purpose:

- confirm the frontend compiles with the new overlay/builder/menu/KDS changes

### Result

All three of the above passed.

---

## Important implementation assumptions

### Extra flavour pricing

An extra flavour price was required by the builder logic, but the final business rule was not yet locked in the PRD discussion.

Current implementation assumption:

- extra flavour = `$1.00`

This is implemented in:

- [`../../apps/web/src/lib/cart-item-utils.ts`](../../apps/web/src/lib/cart-item-utils.ts)
- backend pricing path in cart/checkout services

If the business rule changes, this is one of the first things that should be updated.

### Image banners

The PRD mentions item image banners, but not all items currently have image URLs populated.

Current behavior:

- if `image_url` exists, the overlay uses it
- if not, the overlay shows a branded fallback banner

### Synthetic cards

The real database SKUs for wings and combos were not deleted.

Current design:

- synthetic cards are customer-facing entry points
- real menu items remain the pricing/source-of-truth records

This is intentional and required so the builder can resolve to real menu items during add-to-cart and checkout.

---

## Remaining follow-through after code completion

Even though the implementation is done in code, the following follow-through still matters:

1. Apply the migration to the actual database.
2. Re-seed or run the necessary data update path.
3. Run a real browser flow:
   - customizable burger or wrap
   - wings builder
   - combo builder
   - cart
   - checkout
   - order detail
   - KDS page
4. Confirm the final business rule for extra flavour pricing.
5. If needed later, replace the minimal KDS view with a more operationally complete KDS workflow UI.

---

## Plain-English summary

This implementation changed the system from:

- static menu items
- basic modal selection
- no ingredient-removal persistence
- no true wings/combo guided builder

into:

- proper customizable menu items
- a real builder-based ordering flow for wings and combos
- backend-validated removal logic
- persistence all the way from menu selection to kitchen-facing display

In short:

the builder system is now a real end-to-end feature in the codebase, not just a UI concept.
