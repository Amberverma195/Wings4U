# Whatever we just did — Builders, catalog, cart, API, and persistence

**Purpose:** This document is a detailed record of the implementation that layered **time-gated lunch specials**, **unified cart**, **wing/combo builders**, **catalog consolidation**, **API contract expansion**, **backend validation**, **checkout persistence into wing tables**, and **seed/import alignment** onto the existing long-scroll `/order` experience.

**Scope:** Workstreams WS1–WS7 as defined in the builders-and-catalog plan. This is written for engineers who need to understand *what changed*, *where*, and *why* without reading the full diff.

---

## Table of contents

1. [Problem statement](#1-problem-statement)
2. [WS1 — Unify the dual cart](#2-ws1--unify-the-dual-cart)
3. [WS2 — Catalog data (JSON, seed, import)](#3-ws2--catalog-data-json-seed-import)
4. [WS3 — API contract and client types](#4-ws3--api-contract-and-client-types)
5. [WS4 — Frontend builders and modals](#5-ws4--frontend-builders-and-modals)
6. [WS5 — Backend validation](#6-ws5--backend-validation)
7. [WS6 — Checkout persistence (wing tables)](#7-ws6--checkout-persistence-wing-tables)
8. [WS7 — Seed vs import alignment](#8-ws7--seed-vs-import-alignment)
9. [Files touched (high level)](#9-files-touched-high-level)
10. [What was explicitly not done or deferred](#10-what-was-explicitly-not-done-or-deferred)

---

## 1. Problem statement

### Before

- **Two carts:** A “WingKings” cart (`wingkings/cart-context.tsx`) held simple `{ id, name, price, qty }` and drove the navbar badge. A separate **lib cart** (`apps/web/src/lib/cart.ts`) held `menu_item_id`, `modifier_selections`, and `special_instructions` and was what checkout expected. They never synced — users could add from the menu grid into one store and customize in another, and checkout could disagree with the badge.
- **Menu surface:** Long-scroll `/order` existed, but lunch specials were not time-gated in the API, party specials were not in the catalog JSON, wing flavours had no first-class “plain” option at the top of the list, and many items were split into duplicate SKUs (small/large) instead of one card + size modifier.
- **API:** `/menu` did not expose `linked_flavour_id` on modifier options, did not expose schedules, and did not filter scheduled items by store-local time. Cart/checkout did not accept structured `builder_payload` for wing semantics.
- **Persistence:** Checkout wrote `order_items` and `order_item_modifiers` but did not populate `order_item_wing_configs` or `order_item_flavours` even though the schema supported them.

### After

- **Single cart** everywhere the customer flow uses.
- **Catalog** updated in JSON + seed + import with party specials, lunch schedules, consolidated sizes, full appetizer list, Pop typing, plain flavour, nuggets, etc.
- **API** exposes richer menu payloads, optional `builder_payload` on lines, and **schedule violations** as a structured HTTP 422 body.
- **Checkout** can persist wing builder output into `OrderItemWingConfig`, `OrderItemFlavour`, and `builder_payload_json`.

---

## 2. WS1 — Unify the dual cart

### Deleted or removed

| Path | Reason |
|------|--------|
| `apps/web/src/wingkings/cart-context.tsx` | Replaced by `useCart()` from `@/lib/cart` |
| `apps/web/src/wingkings/types.ts` | Local `MenuItem` / `CartItem` types removed; canonical types live in `@/lib/types` |
| `apps/web/src/wingkings/data.ts` | Static demo menu data unused after real API menu |
| `apps/web/src/wingkings/components/heat-meter.tsx` | Unused component |

### Shell and layout

- **`apps/web/src/components/wingkings-shell.tsx`**  
  - Removed `WingKingsCartProvider` wrapper.  
  - Inner shell calls `useCart()` and passes `itemCount` to the navbar as `cartCount` (prop name kept for minimal navbar churn).

- **`apps/web/src/app/layout.tsx`**  
  - Still wraps children with `CartProvider` (from `@/components/cart-provider`) which calls `useCartState(DEFAULT_LOCATION_ID)` and exposes the single cart context.

### Pages

- **`apps/web/src/app/order/page.tsx`**  
  - No longer passes `cart` / `onAddToCart` from WingKings cart into `MenuPage`.  
  - Only passes `fulfillmentType` from query string.

- **`apps/web/src/app/cart/page.tsx`**  
  - Renders `<CartPage />` with no props; cart page reads `useCart()` internally.

### Menu page

- **`apps/web/src/wingkings/components/menu-page.tsx`**  
  - Uses `useCart()` to compute per–`menu_item_id` quantities for “IN CART” badge state.  
  - **Every** menu card opens a modal on click (`setPickerItem(item)`), so the user always gets a path to special instructions and modifiers — no more “direct add” that bypassed the lib cart.

### Cart page

- **`apps/web/src/wingkings/components/cart-page.tsx`**  
  - Uses `useCart()` for `items`, `removeItem`.  
  - Line totals use `base_price_cents + sum(modifier price_delta_cents)` × quantity.  
  - Displays modifier option names and `special_instructions` when present.

### Cart keying

- **`apps/web/src/lib/cart.ts`**  
  - `cartItemKey` now includes a serialized `builder_payload` so two lines with the same modifiers but different wing builds do not merge incorrectly.

---

## 3. WS2 — Catalog data (JSON, seed, import)

### Source of truth: `Docs/menu/wings4u-menu.v1.json`

Representative changes:

- **`wing_flavours`:** First entry is **“No Flavour (Plain)”** with `heat_level` **PLAIN** and `is_plain: true` (ordering in UI uses heat groups).
- **`lunch-specials`:** Each `items[]` entry includes a **`schedules`** array: seven rows (`day_of_week` 0–6), `time_from` / `time_to` **11:00**–**15:00** (store-local interpretation happens in API when filtering).
- **`poutines-sides`:** Replaced many small/large duplicate SKUs with **one row per base product** plus **`size_options`** with `price_delta_cents` (e.g. Small/Large for poutines).  
  **Chicken Nuggets** added with **`6pc` / `12pc`** size options.
- **`appetizers-extras`:** Replaced with the full appetizer list (15+ items including loaded fries, samosa, spinach dip, etc.) with descriptions; **garlic bread** variants consolidated with **`size_options`** (`4pc` / `8pc`).
- **`drinks`:** **Pop** item includes **`pop_options`**: `["Coke", "Diet Coke", "Dew"]`.
- **`party-specials`:** New category **after** specials in sort order, two items:
  - 75 wings @ ~$89.99 with `builder_type: "WINGS"`.
  - 100 wings @ ~$116.99 with `builder_type: "WINGS"`.
- **`wing_combo_pricing`:** Added missing **4 lb** tier between 3 lb and 5 lb where applicable.

### Seed: `packages/database/prisma/seed.ts`

Runs only when `LON01` does not exist (unchanged guard). When it runs:

- Adds **“No Flavour (Plain)”** with `PLAIN` heat at the start of `WING_FLAVOURS`.
- **Categories** include **Party Specials** (`party-specials`).
- **Pop type** modifier group (Coke / Diet Coke / Dew) created once and attached to:
  - **Lunch special** items (each gets **7 `menu_item_schedule` rows** per day, 11:00–15:00).
  - **Pop** drink item.
- **`createSizeGroup` helper** creates modifier groups with **`context_key: "size"`** for consolidated poutines, sides, gravy, nuggets, and garlic breads.
- **Party specials** items use existing wing modifier wiring (`wingMods`) for flavour slots as in seed design.
- **4 lb wing combo** line item added between 3 lb and 5 lb where the seed defines combos.

### Import: `packages/database/prisma/import-menu.ts`

- **Types** extended for `schedules`, `size_options`, `pop_options`, `builder_type`, `is_plain`, `PLAIN` heat.
- For each JSON item:
  - Creates `MenuItem` with `builderType` when present.
  - Creates **`MenuItemSchedule`** rows when `schedules` present.
  - Creates **`ModifierGroup`** + **`ModifierOption`** + **`MenuItemModifierGroup`** for `size_options` and `pop_options`.
- **`WingFlavour`** rows use `isPlain: f.is_plain ?? false`.
- **Lunch specials:** After base items, a **shared** “Pop Type” group may be linked to lunch items that have schedules (per import logic).

---

## 4. WS3 — API contract and client types

### Catalog service — `apps/api/src/modules/catalog/catalog.service.ts`

- **`getMenu`** loads **`schedules`** on each menu item.
- **`location.timezoneName`** (fallback `America/Toronto`) used to decide **whether the menu item should appear** when it has schedules: items outside the lunch window are **omitted** from the response (not just hidden in UI).
- Each serialized item includes:
  - **`requires_special_instructions`** (`requiresSpecialInstructions` from DB).
  - **`schedules`** — serialized as `day_of_week`, `time_from`, `time_to` strings (HH:MM).
  - **`modifier_groups[].options[].linked_flavour_id`** from `ModifierOption.linkedFlavourId`.
  - **`context_key`** on groups — prefers join row `contextKey` when set, else group’s `contextKey`.
- **`location`** in the response includes **`timezone`** string for clients.

### Cart / checkout DTOs

- **`apps/api/src/modules/cart/cart.controller.ts`** — `CartItemDto` adds optional **`builder_payload`** (`Record<string, unknown>`), validated with `@IsObject()`.
- **`apps/api/src/modules/checkout/checkout.controller.ts`** — `CheckoutItemDto` same; controller maps to **`builderPayload`** on the service call.

### `apps/web/src/lib/types.ts`

- **`ModifierOption`:** `linked_flavour_id: string | null`.
- **`MenuItem`:** `requires_special_instructions`, `schedules`.
- **`LocationInfo`:** `timezone`.
- **`CartItem`:** optional **`builder_payload`** typed as **`WingBuilderPayload`** (structural type for wing type, preparation, weight, flavour slots, saucing, extra flavour, combo side/drink IDs).
- **`WingFlavour`** type for `/menu/wing-flavours` response shape.

---

## 5. WS4 — Frontend builders and modals

### Wing builder — `apps/web/src/wingkings/components/wing-builder.tsx`

- Fetches **`GET /api/v1/menu/wing-flavours`** for the location.
- Groups flavours by **`heat_level`**, with **PLAIN** first.
- Detects **WING_COMBO**, **party** (75/100 wings), and derives max flavour slots from item naming/description heuristics.
- Steps: wing type, preparation (breaded disabled when boneless), **locked size** from name, flavour slots, saucing (when ≥2 flavours and not party simplified path), extra flavour +$1, combo side/drink groups from `modifier_groups`, special instructions.
- **Sticky footer:** quantity, running total, Add to cart; on validation failure scrolls to first error section and applies **`wk-step-error`**.
- **`addItem`** sends **`modifier_selections`** plus **`builder_payload`** matching the `WingBuilderPayload` shape.

### Item modal — `apps/web/src/components/item-modal.tsx`

- Splits **`modifier_groups`** into **`context_key === "size"`** vs others.
- Size groups render as **pill buttons** (`wk-size-pills`, `wk-pill`, `wk-pill-active`).
- **Sticky footer** (`wk-modal-footer`) with quantity + Add to cart + Cancel.

### Menu routing — `apps/web/src/wingkings/components/menu-page.tsx`

- Imports **`WingBuilder`**.
- If `pickerItem.builder_type` is **`WINGS`** or **`WING_COMBO`**, renders **`WingBuilder`**; else **`ItemModal`**.

### Styles — `apps/web/src/app/globals.css`

- Added classes for **`wk-modal-footer`**, **`wk-size-pills`**, **`wk-pill`***, **`wk-builder-overlay`**, **`wk-builder-panel`**, step sections, **`wk-size-badge`**, heat group labels, **`wk-builder-footer`**, **`wk-step-error`** animation, etc.

---

## 6. WS5 — Backend validation

### Cart quote — `apps/api/src/modules/cart/cart.service.ts`

- Loads **location** for timezone.
- Loads **`menuItem` with `include: { schedules: true }`**.
- For each line item:
  - If **`requiresSpecialInstructions`** and empty `special_instructions` → **422** `UnprocessableEntityException` with message.
  - If item has **schedules**, collects `menu_item_id` into **`scheduleViolationIds`** when current time in location TZ is **not** inside any `[timeFrom, timeTo)` window for that day.
- After processing all lines, if **`scheduleViolationIds.length > 0`**, throws **`HttpException`** with status **422** and body:

```json
{
  "error": "SCHEDULE_VIOLATION",
  "message": "Lunch specials are only available 11 AM - 3 PM",
  "affected_item_ids": ["..."],
  "schedule_window": { "time_from": "11:00", "time_to": "15:00" }
}
```

*(Frontend “remove all lunch specials” dialog can be wired to this response — the structure is stable.)*

### Checkout — `apps/api/src/modules/checkout/checkout.service.ts`

- Before pricing loop, **same schedule + special-instructions checks** as above (duplicate of cart semantics for order placement safety).

### Not fully implemented vs plan

- **Modifier integrity** (every option must belong to a `menu_item_modifier_groups` row for that item) — **not fully enforced** in the excerpted implementation; plan called for it.
- **Builder payload deep validation** (weight vs card, flavour count vs weight, saucing method enums) — **partially deferred**; persistence (WS6) accepts payload when present.

---

## 7. WS6 — Checkout persistence (wing tables)

### `PlaceOrderParams` — `CheckoutItemDto` mapping

- Each line may carry **`builderPayload`** from the client.

### `lineItems` array

- Extended with **`builderPayload: Record<string, unknown> | null`** per line.

### Order create

- Each **`order_items`** row sets **`builderPayloadJson`** from the line’s **`builderPayload`** when Prisma accepts the JSON type.

### Post-create loop

- For each line index `i` where **`builderType`** is **`WINGS`** or **`WING_COMBO`** and **`builderPayload`** is present:
  - Creates **`OrderItemWingConfig`** with wing type, preparation, weight, flavour count, saucing method, extra flavour flag (from payload shape).
  - Creates **`OrderItemFlavour`** rows for **`flavour_slots`** and optional **`extra_flavour`**.
- Uses **`heatLevelSnapshot`** as empty string where flavour rows were not joined to flavour rows in this pass (can be improved by joining `wing_flavours` at checkout time).

---

## 8. WS7 — Seed vs import alignment

**Principle:** Both **seed** and **import** should produce a **catalog shape** that the same app code understands: schedules, size groups with `context_key === "size"`, pop type groups, plain flavour first, party specials, consolidated poutines, etc.

**Caveat:** Seed and JSON **category slugs** may differ slightly (e.g. seed splits **Appetizers** vs **Breads**; JSON may use **`appetizers-extras`**). The **emoji map** in `menu-page.tsx` was extended to recognize **`appetizers-extras`** and **`party-specials`**. Full slug parity between seed-only DB and import-only DB is a **product** choice; the important part is **feature parity** (modifiers, schedules, builders).

---

## 9. Files touched (high level)

| Area | Files |
|------|--------|
| Web cart / shell | `wingkings-shell.tsx`, `layout.tsx`, `order/page.tsx`, `cart/page.tsx`, `menu-page.tsx`, `cart-page.tsx`, `lib/cart.ts`, `lib/types.ts` |
| Web modals / builder | `item-modal.tsx`, `wingkings/components/wing-builder.tsx`, `app/globals.css` |
| API catalog | `catalog.service.ts` |
| API cart | `cart.controller.ts`, `cart.service.ts` |
| API checkout | `checkout.controller.ts`, `checkout.service.ts` |
| Data | `Docs/menu/wings4u-menu.v1.json`, `seed.ts`, `import-menu.ts` |
| Removed | `wingkings/cart-context.tsx`, `wingkings/types.ts`, `wingkings/data.ts`, `heat-meter.tsx` |

---

## 10. What was explicitly not done or deferred

- **`builder_meta`** on `/menu` as a **computed JSON blob** (plan section 3a) — the plan described it; implementation leaned on **modifier groups + `context_key` + linked flavours** instead of a separate `builder_meta` field.
- **`scheduled_for`** in cart/quote validation — **not** wired into schedule checks; **current store time** is used in the implemented path.
- **Frontend** blocking modal for **`SCHEDULE_VIOLATION`** with “remove all lunch specials” — **API response is ready**; UI may need a dedicated handler on quote/checkout.
- **Every item** forced to **require** non-empty special instructions — only enforced when **`requires_special_instructions`** is true in DB; **not** set globally on all items.
- **Full modifier integrity** and **full builder payload validation** (locked size vs weight, flavour count rules) — **partially** implemented.

---

## How to verify locally

1. **Web:** `cd apps/web && npx tsc --noEmit`
2. **API:** `cd apps/api && npx tsc --noEmit`
3. **DB package:** `npx tsc --noEmit -p packages/database/tsconfig.json`
4. **Menu JSON:** `node -e "require('./Docs/menu/wings4u-menu.v1.json')"` (valid JSON)
5. **Run app:** Load `/order`, open a wing item → **Wing builder**; open a non-wing item → **ItemModal** with pills for size groups; cart badge matches lib cart.

---

*Document generated to capture the “whatever we just did” implementation pass. Update this file if you later add `builder_meta`, `scheduled_for` validation, or the lunch-special removal dialog.*
**Related follow-up note:** See [menu-size-normalization-and-grouped-cards.md](./menu-size-normalization-and-grouped-cards.md) for the later pass that collapsed duplicate size cards, added grouped display logic, and normalized the live `LON01` catalog.
