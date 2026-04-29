## Split Burgers vs Tenders + Add Tender Combo Section (Supabase Menu)

### Summary
Update the menu import pipeline and menu UI so:
- **Burgers** and **Tenders** are separate categories (tabs).
- Burgers show the note **“All buns are toasted with butter.”**
- Tenders show items in the requested order, with an in-page **“CHICKEN TENDER COMBO”** section header.
- Menu items render in the **curated menu order** (not alphabetical) across the API and web.

---

### Key Changes

#### 1) Menu Ordering (API)
Update API menu item ordering to preserve the curated menu sequence:
- In `apps/api/src/modules/catalog/catalog.service.ts`, change menu item `orderBy` from:
  - `[{ isPopular: "desc" }, { name: "asc" }]`
  to:
  - `[{ isPopular: "desc" }, { createdAt: "asc" }]`
  - Optional stabilizer: add `{ name: "asc" }` as a final tie-breaker.

This is required to make:
- Burgers show as: Veggie → Chicken → Buffalo
- Tenders show as: 3pc → 5pc → 10pc → combos

#### 2) Docx → JSON Extractor (Split Categories + Burger Note + Tender Combo Naming)
In `packages/database/prisma/extract-menu-docx.ts`:

**A. Replace the single category**
- Remove: `Burgers & Tenders` (`slug: burgers-tenders`)
- Add:
  - `Burgers` (`slug: burgers`, `sort_order: 4`)
  - `Tenders` (`slug: tenders`, `sort_order: 5`)
- Shift subsequent category `sort_order` values by +1 (Wraps becomes 6, etc) to preserve tab order.

**B. Parse the “Burgers & Tenders” doc section into two categories**
When iterating the parsed lines:
- Classify items:
  - If name contains `Burger` → push into `burgers`
  - Otherwise → push into `tenders`

**C. Burger toasted-bun note**
For each burger item description, prepend:
- `All buns are toasted with butter. `
(If the burger had no description, set it to exactly that sentence.)

**D. “Make it a combo (+$4.99)” should be an upgrade option, not a standalone menu item**
- Keep extracting `combo_upgrade_price_cents` into `notes` (already done)
- Skip creating a menu item for the “Add fries/onion rings/wedges/coleslaw & 1 pop” line (do not include it in `categories[].items`).

**E. Tenders naming + combo details**
Ensure tenders items become exactly:
- `3 pc Tenders + 1 Dip (2 oz.)`
- `5 pc Tenders + 1 Dip (2 oz.)`
- `10 pc Tenders + 1 Dip (4 oz.)`

And tender combo items become:
- Name: `Chicken Tender Combo (3 pc)`
  - Description: `3 pc tenders + small side + 1 dip (2 oz.) + 1 pop`
  - Price: `$10.99`
- Name: `Chicken Tender Combo (5 pc)`
  - Description: `5 pc tenders + large side + 1 dip (4 oz.) + 1 pop`
  - Price: `$17.99`

**F. Force final item order inside each new category**
After parsing, reorder arrays explicitly to match:
- Burgers: Veggie → Chicken → Buffalo
- Tenders: 3pc → 5pc → 10pc → combo(3pc) → combo(5pc)

Then regenerate:
- `Docs/menu/wings4u-menu.v1.json` via `npm run db:menu:extract`

#### 3) JSON → Supabase Importer (Combo Upgrade Option)
`packages/database/prisma/import-menu.ts` is already aligned with your decision:
- It creates a **Combo Upgrade** modifier group priced from `notes.combo_upgrade_price_cents` (defaults to 499).
- It links that upgrade to burger items (and wraps). Keep this as-is unless you want wraps excluded.

Then re-import into Supabase (destructive, gated):
- `$env:WINGS4U_CONFIRM_MENU_RESET="YES"; npm run db:menu:import`

#### 4) Web UI: Insert “Chicken Tender Combo” Section Title (Inside Tenders)
In `apps/web/src/wingkings/components/menu-page.tsx`:
- When `activeCategory.slug === "tenders"`:
  - Split items into:
    - base tenders (name does NOT start with `Chicken Tender Combo`)
    - combo tenders (name starts with `Chicken Tender Combo`)
  - Render:
    - Base grid
    - A styled heading: `CHICKEN TENDER COMBO`
    - Combo grid

Add minimal heading styles in `apps/web/src/wingkings/components/global-style.tsx` (new class, matching your theme).

Also update emoji mapping to include:
- `burgers` → burger emoji
- `tenders` → chicken/tenders emoji

---

### Test Plan / Acceptance
1. `npm run db:menu:extract`
   - JSON contains categories `burgers` and `tenders`
   - No standalone “Add fries… & 1 pop” item exists
2. `npm run db:menu:import` with confirm
   - Succeeds only when `LON01` has 0 orders
3. API check:
   - `GET /api/v1/menu?location_id=<LON01>&fulfillment_type=PICKUP`
   - Burgers appear in the requested order and include the toasted-bun note
   - Tenders appear in requested order, combo items have correct names/descriptions/prices
4. Web check (`/order`):
   - Separate tabs for Burgers and Tenders
   - In Tenders tab, “CHICKEN TENDER COMBO” heading appears above combo items
5. (Optional) `npm run test:e2e` to ensure the menu ordering change didn’t break any assumptions.

---

### Assumptions (Locked From Your Answers)
- Menu item order should match your numbered list (not alphabetical).
- Burger combo is an **upgrade option** (+$4.99), not a standalone cart item.
- Tender combos should appear under a **heading inside the Tenders tab**, not as a separate tab.
