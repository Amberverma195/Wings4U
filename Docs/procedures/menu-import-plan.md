# Plan: Import store menu from Word into the database

**Goal:** Load items from `Docs/This menu for Wings 4 U contains a wide variety of wings.docx` (or any export) into Postgres so `GET /api/v1/menu` and the web app show the real menu.

**Rules:** Schema is canonical ([`rules.md`](./rules.md)). Use existing tables/columns only; no new columns without SQL + Prisma migration.

---

## Phase 0 — Prerequisites

- [ ] Know your **location** row: `locations.id` for the store (e.g. `code = 'LON01'`). All menu rows use this `location_id`.
- [ ] Know how the web app sets **`X-Location-Id`** (must match that UUID).
- [ ] Confirm DB connection: local or Supabase; `DATABASE_URL` / `DIRECT_URL` work for Prisma or SQL tools.

---

## Phase 1 — Extract data from Word

- [ ] Open the `.docx` in Word; copy content into **Excel or Google Sheets**.
- [ ] Build a **normalized sheet** (recommended columns):

  | Column | Notes |
  |--------|--------|
  | `category_name` | Section heading (e.g. Wings, Sides) |
  | `item_name` | Product title |
  | `description` | Optional |
  | `price_cad` | e.g. 12.99 — you will convert to **cents** |
  | `fulfillment` | Map to `BOTH`, `PICKUP`, or `DELIVERY` per item if the doc specifies |
  | `modifier_notes` | Free text for now; you will turn into groups/options in Phase 3 |

- [ ] Add a **slug** column: URL-safe, unique per category and per item within the location (e.g. `classic-bone-in`, `wings`). Lowercase, hyphens, no spaces.

- [ ] **Convert prices:** `base_price_cents = round(price_cad * 100)` (integer).

**Deliverable:** One spreadsheet (or CSV) with every sellable line item and every category.

---

## Phase 2 — Map spreadsheet → database tables

Insert **in this order** (foreign keys):

1. **`menu_categories`** — `location_id`, `name`, `slug`, `sort_order`, `is_active`
2. **`menu_items`** — `location_id`, `category_id`, `name`, `slug`, `description`, `base_price_cents`, `is_available`, `allowed_fulfillment_type` (default `BOTH` if unsure)
3. **`modifier_groups`** — `location_id`, `name`, `display_label`, `selection_mode` (`SINGLE` / `MULTI`), `min_select`, `max_select`, `is_required`, `sort_order`
4. **`modifier_options`** — `modifier_group_id`, `name`, `price_delta_cents`, `is_default`, `is_active`, `sort_order`
5. **`wing_flavours`** (optional) — if you model wing sauces as flavours: `location_id`, `name`, `slug`, `heat_level`, `is_plain`, `sort_order`; link options via `modifier_options.linked_flavour_id` if needed
6. **`menu_item_modifier_groups`** — for each item, rows linking `menu_item_id` + `modifier_group_id` + `sort_order`

**Uniqueness:** `@@unique([locationId, slug])` on categories and on items — no duplicate slugs.

**Deliverable:** A mapping doc or second sheet listing: category slug → category UUID (after insert); item slug → item UUID; group name → group UUID.

---

## Phase 3 — Choose import mechanism

Pick **one** path:

| Path | Best for | Steps |
|------|----------|--------|
| **A. Prisma script** | Repeatable, version-controlled | Add or extend `packages/database/prisma/seed.ts` *or* a new script (e.g. `prisma/import-menu.ts`) using `PrismaClient` + same adapter pattern as `seed.ts`. Run with `npx tsx` or npm script. |
| **B. Raw SQL** | One-off bulk load in Supabase | Write `INSERT` statements in Supabase SQL Editor; use subqueries for `location_id` from `locations.code`. |
| **C. Mixed** | Large menu | Export CSV → small Node script reads CSV and calls Prisma `createMany` / transactions. |

**Note:** Current seed may **skip** if `LON01` already exists — do not rely on re-running full seed alone; use a **dedicated import** or SQL.

---

## Phase 4 — Execute import

- [ ] **Staging first:** Run against a dev DB or duplicate location row if you need a dry run.
- [ ] Insert categories → items → groups → options → `menu_item_modifier_groups`.
- [ ] Fix any unique constraint errors (duplicate `slug`) before repeating.

---

## Phase 5 — Verify API and website

- [ ] `GET /api/v1/menu?fulfillment_type=PICKUP` (or `DELIVERY`) with header **`X-Location-Id: <your-location-uuid>`**
- [ ] Response: `data.categories[].items[]` includes new names and prices.
- [ ] Open web app menu route with same location config → hard refresh.

---

## Phase 6 — Ongoing changes

- **Small edits:** Supabase Table Editor or Prisma Studio (`npx prisma studio` from `packages/database` with env loaded).
- **Bulk updates:** Prefer SQL or a versioned script so prod stays reproducible.

---

## Quick reference — money and enums

- **Money:** Integer **cents** only (`base_price_cents`, `price_delta_cents`).
- **Fulfillment:** String on `menu_items.allowed_fulfillment_type`: typically `BOTH`, `PICKUP`, or `DELIVERY` (match existing seed/API).
- **Modifier selection:** `selection_mode` `SINGLE` vs `MULTI`; set `min_select` / `max_select` to match “choose 1 sauce” vs “up to 3 dips.”

---

## Append to `tasks.md`

When the import is done, add a short entry under the latest date in [`tasks.md`](./tasks.md) (plain English + what was verified), per project rules.
