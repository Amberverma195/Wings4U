# Fixed Issues

![1774263641092](image/FixedIssues/1774263641092.png)![1774263647965](image/FixedIssues/1774263647965.png)Last updated: 2026-03-24

## Fixed On 2026-03-20

### Fixed Issue 14. `/order` long-scroll menu broke on very narrow viewports — collapsed tan surface, clipped section titles, grid overflow

#### Area

Web — Wings4U customer menu (`apps/web/src/Wings4U/`), inline layout styles + global CSS

#### Issue

On extremely narrow viewports (mobile minimized or very small widths), the `/order` page layout looked broken:

- The beige **menu surface** (`menuSurface`) shrank to a **thin vertical strip** instead of matching the full content column.
- **Section headings** (e.g. “LUNCH SPECIALS”) **overflowed** or wrapped one letter per line; text could clip at the edge of the strip.
- **Menu cards** appeared **wider than** the tan background, as if they were not sharing the same width constraint.

Root cause: [`apps/web/src/wingkings/styles.ts`](../../apps/web/src/wingkings/styles.ts) set:

- `maxWidth: "min(1240px, calc(100vw - 360px))"` on `menuSurface`.

For `100vw < 360px`, `calc(100vw - 360px)` is **negative**. Using that as `max-width` makes the container effectively **collapse**, so the heading and grid no longer had a sane width. The `360px` subtraction was appropriate only for a wide layout assumption, not for small screens.

Secondary: the **category pill row** (`.wk-cat-row`) had **asymmetric vertical padding** (`8px` top / `14px` bottom), so pills sat high with extra gap below. The **menu grid** used `minmax(220px, 300px)` without capping the minimum to the container, so a narrow parent could still **overflow** horizontally.

#### Impact

- The order menu was unusable or misleading on the smallest phones and extreme narrow windows.
- Debugging could point at “responsive CSS” generally when the real bug was a **single bad `max-width` expression**.

#### Fix

1. **`menuSurface`** — Replaced the broken cap with `maxWidth: "min(1240px, 100%)"`, plus `width: "100%"` and `boxSizing: "border-box"` so the surface always fills the padded page column.
2. **`menuPage`** — Eased horizontal padding on small screens: `clamp(0.75rem, 4vw, 5.25rem)` so content has room when the viewport is tight.
3. **`menuGrid`** — `gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))"` and `minWidth: 0` so columns shrink with the container instead of forcing overflow.
4. **`.wk-section-heading`** ([`global-style.tsx`](../../apps/web/src/wingkings/components/global-style.tsx)) — `font-size` / `letter-spacing` via `clamp()`, `overflow-wrap: anywhere`, `max-width: 100%` so long category names behave on narrow widths.
5. **`.wk-cat-row`** — Symmetric vertical padding (`14px` top and bottom) so category pills are vertically balanced in the dark bar.

Related UX tweaks in the same pass (documented here for context): centered section titles (`text-align: center`), increased vertical spacing between category sections (`.wk-menu-section` padding / adjacent-section rules).

#### Status

**Fixed** — Menu surface width is valid at all viewport sizes; grid and headings follow the same column without collapse or clipping on narrow screens.

---

## Fixed On 2026-03-24

### Fixed Issue 16. `/order` fulfillment type drifted between the URL-driven menu API and the cart / checkout state

#### Area

Web customer order flow (`apps/web/src/app/order/page.tsx`, `apps/web/src/wingkings/components/menu-page.tsx`, `apps/web/src/lib/cart.ts`)

#### Issue

The customer order flow was not treating fulfillment type as one shared piece of state.

The landing page already routed correctly to:

- `/order?fulfillment_type=PICKUP`
- `/order?fulfillment_type=DELIVERY`

And the `/order` page already read that query param and passed it into:

- [`apps/web/src/wingkings/components/menu-page.tsx`](../../apps/web/src/wingkings/components/menu-page.tsx)

That meant the menu API request was using the selected fulfillment mode:

- `GET /api/v1/menu?...&fulfillment_type=PICKUP`
- `GET /api/v1/menu?...&fulfillment_type=DELIVERY`

But the rest of the ordering flow was not using that same source of truth.

The cart store in:

- [`apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts)

kept its own separate in-memory `fulfillmentType`, and that state defaulted to:

- `PICKUP`

Quote and checkout behavior use the cart state, not the `/order` query string. So the system could get into a split-state condition:

1. the URL said `DELIVERY`
2. the menu API loaded delivery-mode menu data
3. the cart context still thought the order was `PICKUP`
4. downstream cart / quote / checkout logic still followed pickup state unless another screen changed it later

That was the core bug: the app visually looked like it had one fulfillment mode selected, while the actual ordering state underneath could still be something different.

There was also no in-page control on `/order` to re-confirm or switch fulfillment mode after landing on the menu. The user could choose pickup vs delivery on the landing page, but once they arrived on `/order`, that choice was not exposed as a first-class control inside the real ordering surface itself.

#### Impact

- A customer could browse a menu loaded in **delivery mode** while the cart and later checkout flow still behaved as **pickup**.
- This created a hidden contract mismatch between:
  - the URL
  - the menu API request
  - the cart state used by quote / checkout
- Delivery-sensitive behavior could become misleading:
  - fulfillment-specific menu filtering
  - delivery fee expectations
  - delivery minimum logic
  - later checkout assumptions
- Debugging was confusing because the URL could look correct while the cart state was silently wrong underneath.
- The issue was especially risky because it looked like a simple UI-selection problem, but the real defect was a **state synchronization bug** across the order flow.

In plain terms: the customer could think they were ordering delivery because the menu said so, while the application was still preparing the order as pickup in the state that matters for pricing and checkout.

#### Fix

The fix was to make fulfillment type behave as one synchronized state across the order page instead of two unrelated values.

1. **Synced `/order` fulfillment into the cart store**

- [`apps/web/src/wingkings/components/menu-page.tsx`](../../apps/web/src/wingkings/components/menu-page.tsx) now pushes the active `fulfillmentType` prop into the cart context using:
  - `setFulfillmentType(fulfillmentType)`

That means when `/order` is opened with a URL mode, the cart store is immediately aligned to that same mode instead of silently staying on its old default.

2. **Added a shared fulfillment update path inside the order page**

- `MenuPage` now owns a single fulfillment-change path that:
  - updates the cart context
  - updates the current URL query param

This removed the earlier split where one part of the page updated the menu API mode while another part of the ordering flow kept using unrelated cart state.

3. **Updated the `/order` URL in-place when fulfillment changes**

- The order page now uses the current route and search params to replace the URL with the selected fulfillment type.
- Because `/app/order/page.tsx` derives its `fulfillmentType` from the URL search param, changing the query string now re-drives the menu fetch through the same existing path instead of creating a second custom state machine.

That keeps the architecture simple:

1. URL remains the visible/shareable fulfillment state for `/order`
2. `/order` reads that state
3. the menu API uses that state
4. the cart store is synchronized to that same state

4. **Added an in-page fulfillment control on `/order`**

- The `/order` surface now exposes fulfillment selection inside the menu page itself, so the customer can switch between pickup and delivery without going back to the landing page.
- This closes the product gap where the choice existed at entry but not on the actual ordering screen.

5. **Verification**

- Ran:
  - `npx tsc --noEmit`
  - in `apps/web`

#### Status

**Fixed** - Fulfillment type is no longer just a menu-query value in the URL. The `/order` page now keeps the URL, menu API mode, and cart state aligned so pickup vs delivery behaves as one real ordering state.

---

### Fixed Issue 15. `/order` menu returned generic "Internal server error" because the live database was missing `modifier_groups.context_key`

#### Area

API catalog query (`apps/api/src/modules/catalog/`), live Supabase schema alignment, Prisma query shape, and SQL copy consistency

#### Issue

After the menu-builder/catalog work was merged, the customer `/order` page showed the generic failure state:

- `Internal server error`

with the follow-up hint:

- `Check that the API is running and NEXT_PUBLIC_DEFAULT_LOCATION_ID is set to the Supabase LON01 location UUID.`

At first glance this looked similar to the earlier stale-location-ID problem, but this time the location wiring was already correct:

- [`apps/web/.env.local`](../../apps/web/.env.local) already contained:
  - `NEXT_PUBLIC_DEFAULT_LOCATION_ID=987c0642-3591-4ae1-badc-40836469744c`
- `GET /api/v1/menu/wing-flavours` for that same location returned **200 OK**
- `GET /api/v1/menu` for that same location returned **500 Internal Server Error**

That meant the failure was no longer in the frontend env or the location lookup. The crash was inside the richer menu-loading path itself.

The narrowed backend failure was:

- [`apps/api/src/modules/catalog/catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts)

`CatalogService.getMenu()` now loads modifier-group metadata and serializes:

- join-row `contextKey` from `menu_item_modifier_groups`
- fallback group-level `contextKey` from `modifier_groups`
- `linked_flavour_id` from `modifier_options`
- schedules from `menu_item_schedules`

Replaying the Prisma query outside Nest showed the exact runtime error:

- Prisma `P2022`
- missing column in the current database when including `modifierGroup`

The live schema check then confirmed the actual drift:

- `menu_items.requires_special_instructions` existed
- `modifier_options.linked_flavour_id` existed
- `menu_item_modifier_groups.context_key` existed
- `menu_item_schedules` existed
- **`modifier_groups.context_key` did not exist**

That single missing nullable column was enough to make the full `/menu` query fail and bubble up as the generic internal-error envelope.

There was a second repo-consistency problem wrapped into the same issue:

- Prisma schema already had `ModifierGroup.contextKey`
- the application was already reading `modifier_groups.context_key`
- but both SQL copies were missing that column:
  - [`db/sql/0001_wings4u_baseline_v1_4.sql`](../../db/sql/0001_wings4u_baseline_v1_4.sql)
  - [`Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`](../../Wings4U_schema_v1_4_postgres_FINAL.sql)

So the repo had a real live-DB drift problem in Supabase and an internal SQL-reference drift problem at the same time.

#### Impact

- The customer menu could not load at `/order` even though the API process was up and the configured location UUID was valid.
- The UI error message was misleading because it suggested either API downtime or a bad location ID, while the true failure was a backend schema mismatch.
- Any code path depending on the full catalog modifier-group include would stay fragile until the live database matched the schema the API had already been coded against.
- The SQL reference copies could mislead future debugging by implying that `modifier_groups.context_key` was never supposed to exist.

#### Why is it bad?

- This is a classic **code/schema contract failure**. The API and Prisma client were compiled against a shape the live database did not actually provide.
- The symptom presented at the UX layer as a generic 500, which wastes debugging time because the user-visible error points engineers toward env/proxy problems first.
- It breaks an important production path: the primary customer ordering surface.
- Leaving the SQL copies stale after fixing the live DB would keep the same confusion alive for the next engineer who compares SQL, Prisma, and runtime behavior.

#### Fix

Resolved the issue by treating it as **live schema alignment**, not an API rewrite.

1. **Confirmed this was not the old stale-location problem**

- Checked [`apps/web/.env.local`](../../apps/web/.env.local)
- Verified the active location UUID already matched `LON01`:
  - `987c0642-3591-4ae1-badc-40836469744c`
- Hit the menu endpoints directly with:
  - query `location_id=987c0642-3591-4ae1-badc-40836469744c&fulfillment_type=PICKUP`
  - header `X-Location-Id: 987c0642-3591-4ae1-badc-40836469744c`
- Verified:
  - `/api/v1/menu/wing-flavours` returned **200**
  - `/api/v1/menu` returned **500**

2. **Reproduced the exact backend failure outside the HTTP wrapper**

- Replayed the Prisma include shape used by [`catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts)
- Confirmed the query succeeds until `modifierGroup` is included
- Confirmed the failing shape throws Prisma **`P2022`**

3. **Inspected the actual live Supabase schema**

- Queried `information_schema.columns` for:
  - `menu_items`
  - `modifier_groups`
  - `modifier_options`
  - `menu_item_modifier_groups`
  - `menu_item_schedules`
- Confirmed the only missing column relevant to this failure was:
  - `modifier_groups.context_key`

4. **Added a one-time manual SQL patch to the repo**

- Created:
  - [`db/sql/0004_modifier_groups_context_key_patch.sql`](../../db/sql/0004_modifier_groups_context_key_patch.sql)
- Patch contents:

```sql
ALTER TABLE modifier_groups
  ADD COLUMN IF NOT EXISTS context_key text;
```

5. **Applied the same SQL once to the active Supabase database**

- Executed:

```sql
ALTER TABLE modifier_groups
  ADD COLUMN IF NOT EXISTS context_key text;
```

- No backfill was performed in this pass.
- No destructive seed/import was re-run.
- No API code, controller DTOs, or Prisma schema were changed for this fix.

6. **Aligned the SQL copies in the repo**

- Updated [`db/sql/0001_wings4u_baseline_v1_4.sql`](../../db/sql/0001_wings4u_baseline_v1_4.sql)
- Updated [`Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`](../../Wings4U_schema_v1_4_postgres_FINAL.sql)
- Added the missing `context_key text` column to `modifier_groups` in both copies
- Added a change note so the SQL copies now document the one-time patch requirement for older already-created databases

#### Solution

The menu path now lines up across all layers:

1. Frontend sends the correct `LON01` UUID
2. API executes the full catalog query including modifier groups
3. Live Supabase schema now contains `modifier_groups.context_key`
4. Prisma no longer throws `P2022`
5. `/api/v1/menu` returns menu JSON instead of a generic 500
6. `/order` can render the real menu again

Verified after the fix:

- `information_schema.columns` shows `modifier_groups.context_key`
- direct API call to `/api/v1/menu` returns **200**
- Next proxy path on port `3000` also returns **200**
- menu payload includes both:
  - `lunch-specials`
  - `wings`
- Prisma reproduction that previously failed on modifier-group include now succeeds for a wing item with linked modifier groups and options

#### Status

**Fixed** - The `/order` 500 was caused by live schema drift on `modifier_groups.context_key`. The live database was patched, the manual SQL patch was checked in, and the repo SQL copies were brought back into sync with the application's expected schema.

---

### Fixed Issue 13. Web menu failed with "Location not found or inactive" because `NEXT_PUBLIC_DEFAULT_LOCATION_ID` was stale after the real menu reset

#### Area

Web environment configuration + Supabase catalog routing + location bootstrap

#### Issue

After the real menu work was implemented and the `LON01` catalog was reseeded / re-imported, the customer web app still pointed to an older location UUID in:

- [`apps/web/.env.local`](../../apps/web/.env.local)

The menu page reads the location ID from:

- [`apps/web/src/lib/env.ts`](../../apps/web/src/lib/env.ts)

and sends that ID to the API when loading the menu.

The stale value was:

- `245d493e-eb18-4134-99a5-7257085d7764`

But the real current `LON01` row in Supabase was:

- `987c0642-3591-4ae1-badc-40836469744c`

Because the frontend was asking for the wrong location, the API correctly returned:

- `Location not found or inactive`

That made the `/order` page look broken even though the API was running and the real location existed.

#### Impact

- The customer menu surface could not load the real catalog.
- `/order` showed an error instead of menu categories and items.
- The main order flow looked broken immediately after clicking `ORDER NOW` or `PICK UP`.
- This also created confusion while debugging navigation because the click technically worked, but the destination page failed due to the invalid location ID.

#### Why is it bad?

- This is a configuration-to-data contract failure. The frontend, API, and database were all individually working, but they were no longer pointing at the same location record.
- It produces a misleading symptom. Users and developers can think the buttons or routing are broken, when the real failure is the menu request being sent with an obsolete UUID.
- The issue is easy to reintroduce whenever a destructive reset, reseed, or re-import recreates `LON01` with a different generated UUID.

#### Fix

Resolved the mismatch by querying the live database for the actual current `LON01` row and updating the web env to that UUID.

1. **Confirmed the frontend source of truth**

- Checked [`apps/web/.env.local`](../../apps/web/.env.local)
- Verified that `NEXT_PUBLIC_DEFAULT_LOCATION_ID` was still set to the old UUID:
  - `245d493e-eb18-4134-99a5-7257085d7764`

2. **Confirmed how the web app uses that value**

- Checked [`apps/web/src/lib/env.ts`](../../apps/web/src/lib/env.ts)
- Verified the menu flow reads:
  - `process.env.NEXT_PUBLIC_DEFAULT_LOCATION_ID`
- That value becomes `DEFAULT_LOCATION_ID`, which is then used by the menu page API request.

3. **Queried the real Supabase database**

- Connected through the configured Postgres URL in [`/.env`](../../.env)
- Queried `locations` by:
  - `code = 'LON01'`
- Verified the real active row existed and its actual ID was:
  - `987c0642-3591-4ae1-badc-40836469744c`

4. **Updated the web env**

- Edited [`apps/web/.env.local`](../../apps/web/.env.local)
- Replaced:
  - `245d493e-eb18-4134-99a5-7257085d7764`
- With:
  - `987c0642-3591-4ae1-badc-40836469744c`

#### Solution

The web app and Supabase are now aligned on the same `LON01` location again.

That restores the menu request path:

1. Frontend reads `NEXT_PUBLIC_DEFAULT_LOCATION_ID`
2. `/order` sends the correct location UUID to the API
3. API resolves the real active `LON01` location
4. Menu categories and items load normally

Operationally, this fix also documents the root cause:

- the app is currently coupled to a concrete location UUID in `apps/web/.env.local`
- while seed/import logic resolves the store by `code = 'LON01'`
- so if `LON01` is recreated with a new generated UUID, the frontend env must be updated or the menu will fail again

#### Status

**Fixed** - The menu failure was caused by a stale frontend location UUID, and the web app now points at the real active `LON01` row in Supabase.

---

### Fixed Issue 12. Real menu curation aligned across extractor, Supabase import, API ordering, and web menu display

#### Area

Catalog extraction/import + API menu ordering + Web menu presentation

#### Issue

After the real menu import was added, the catalog still did not fully match the intended store presentation:

- `Burgers & Tenders` remained flattened into one combined category.
- The burger combo upsell line was being treated like a sellable menu item instead of an upgrade option.
- Tender items and tender combos were not named or grouped the way the store menu needs them.
- Display order could drift because the API was not preserving curated insertion order.
- The wings card did not clearly show the full weight/flavour price ladder the customer needs to pick from.

#### Impact

- The customer menu in Supabase and on the web surface did not reflect the real store structure.
- Burgers, tenders, and wing pricing choices were harder to understand at a glance.
- Even with the real menu imported, the UX still looked partially like placeholder/catalog-dev data instead of a production menu.

#### Why is it bad?

- Menu clarity is product behavior, not polish. If the category structure or option order is wrong, customers order more slowly and staff end up correcting assumptions manually.
- Curated restaurant menus are intentional. Losing that order in the API or UI makes a real catalog feel random.
- A combo-upgrade line being imported as a standalone product is a contract bug between menu meaning and database representation.

#### Fix

Aligned the full pipeline so the extracted menu, imported Supabase catalog, API response order, and web presentation all match the curated store menu more closely.

1. **Docx extractor updated**

- [`packages/database/prisma/extract-menu-docx.ts`](../../packages/database/prisma/extract-menu-docx.ts)
- Split `Burgers & Tenders` into two categories:
  - `Burgers`
  - `Tenders`
- Prepended the burger note:
  - `All buns are toasted with butter.`
- Stopped importing the `Add fries/onion rings/wedges/coleslaw & 1 pop` line as a standalone item.
- Renamed and reordered tender items to the requested sequence:
  - `3 pc Tenders + 1 Dip (2 oz.)`
  - `5 pc Tenders + 1 Dip (2 oz.)`
  - `10 pc Tenders + 1 Dip (4 oz.)`
  - `Chicken Tender Combo (3 pc)`
  - `Chicken Tender Combo (5 pc)`
- Kept combo upgrade pricing in `notes` so the importer can still build the modifier group correctly.

2. **Curated JSON regenerated**

- Regenerated [`Docs/menu/wings4u-menu.v1.json`](../menu/wings4u-menu.v1.json)
- Verified the JSON now carries separate `burgers` and `tenders` categories and the corrected tender naming/order.

3. **API ordering aligned to curated import order**

- [`apps/api/src/modules/catalog/catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts)
- Changed menu item ordering to preserve imported sequence:
  - `isPopular desc`
  - `createdAt asc`
  - `name asc` as tie-breaker

4. **Supabase re-import executed**

- Re-ran the destructive gated import for `LON01` using the regenerated JSON.
- Result: Supabase catalog now reflects the curated split/order instead of the older flattened version.

5. **Web menu updated**

- [`apps/web/src/wingkings/components/menu-page.tsx`](../../apps/web/src/wingkings/components/menu-page.tsx)
- Added separate emoji/category handling for:
  - `burgers`
  - `tenders`
- Added in-page tender combo grouping:
  - base tender items first
  - `CHICKEN TENDER COMBO` heading
  - combo tender items after that
- Added visible wing weight/price lines on the Wings card so the menu now shows the requested ladder:
  - `1 pound - 1 flavour`
  - `1.5 pound - 1 flavour`
  - `2 pound - 1 flavour`
  - `3 pound - 2 flavours`
  - `4 pound - 2 flavours`
  - `5 pound - 3 flavours`

#### Solution

The recent menu work is now consistent across all four layers:

- extraction source of truth
- JSON artifact
- imported Supabase catalog
- customer-facing web menu

This resolved the gap between “real menu data exists in the DB” and “the customer menu actually reads like the real restaurant menu.”

#### Status

**Fixed** - The real menu is now curated end-to-end instead of merely imported.

---

### Fixed Issue 11. Seeded menu replaced with the real Wings4U menu in Supabase (Docx -> JSON -> Prisma import)

#### Area

Database / Catalog data (Supabase) + Database tooling (`packages/database`) + Web menu surface (`apps/web`)

#### Issue

The repo originally relied on a minimal seeded catalog (for local dev / e2e), but the real Supabase database did not contain the full Wings4U menu from:

- `Docs/This menu for Wings 4 U contains a wide variety of wings.docx`

That meant the “real” environment could not show the store’s actual menu, wing flavours, and builder structures.

#### Impact

- Frontend menus showed placeholder data instead of the real store catalog.
- Wing builder structures (weights + required flavour counts + real flavour list) could not be validated in a production-like DB.
- Risk of future breakage: building UI around seed data hides edge cases and causes drift when real menu data finally lands.

#### Why is it bad?

- Product validation is impossible without real catalog data.
- Seeded menus hide real-world complexity (duplicate names, sizes, tables, combo patterns, large flavour lists).
- A doc-based menu changes over time; without a repeatable import pipeline the database will always lag behind the real menu.

#### Fix

Built a repeatable pipeline and used it to replace the seeded menu rows in Supabase for location `code=LON01`.

1) Docx -> JSON (reviewable artifact)

- Added extractor script: [`packages/database/prisma/extract-menu-docx.ts`](../../packages/database/prisma/extract-menu-docx.ts)
- Implementation detail: reads the `.docx` via PowerShell/.NET (no new zip/xml deps), extracts `word/document.xml` paragraph text, then parses sections/tables into structured data.
- Normalization: dollars -> integer cents, deterministic slugs, stable category ordering, wing pricing rows, and flavour heat-level mapping.
- Output artifact: [`Docs/menu/wings4u-menu.v1.json`](../menu/wings4u-menu.v1.json)

2) JSON -> Supabase (Prisma importer with safety gates)

- Added importer script: [`packages/database/prisma/import-menu.ts`](../../packages/database/prisma/import-menu.ts)
- Connection behavior: uses `DIRECT_URL` first, falls back to `DATABASE_URL` (loaded from root `.env`).
- Safety gates:
  - Requires `WINGS4U_CONFIRM_MENU_RESET=YES` or `--confirm-reset`.
  - Refuses to hard-delete if any `orders` exist for `LON01`.
- Import behavior (all inside a transaction):
  - Update `locations` contact fields from the doc (address + phone).
  - Hard-delete existing catalog rows for that location (only allowed because orders must be 0).
  - Insert categories and items from the JSON.
  - Insert all wing flavours.
  - Create builder items (`Wings`, `Wing Combo`) and their modifier groups/options:
    - Wing Type, Wing Weight, Wing Combo Weight, Flavours (+ Extra Flavour), Combo Side
  - Add a “Combo Upgrade” modifier group (applies to burgers/wraps).

3) One-command scripts wired at repo root

- Added scripts in [`package.json`](../../package.json):
  - `db:menu:extract`
  - `db:menu:import`

4) Supabase connectivity fix (DNS constraint in this environment)

This environment could not resolve `db.<project>.supabase.co`, so `.env` was updated so Prisma connects via the Supabase pooler host instead.

- Updated: [`/.env`](../../.env) (both `DATABASE_URL` and `DIRECT_URL` point at `aws-1-us-east-1.pooler.supabase.com`)

#### Solution (how to run it now)

1. Generate the JSON:
   - `npm run db:menu:extract`
2. Import into Supabase (destructive reset for `LON01`, only when 0 orders exist):
   - `$env:WINGS4U_CONFIRM_MENU_RESET=\"YES\"; npm run db:menu:import`
   - or `npm run db:menu:import -- --confirm-reset`
3. Point the web app at the Supabase location UUID:
   - [`apps/web/.env.local`](../../apps/web/.env.local) sets `NEXT_PUBLIC_DEFAULT_LOCATION_ID` to the Supabase `LON01` UUID.

Note: the local/e2e seed remains intentionally separate:
- [`packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)

#### Status

**Fixed** — Supabase now has the real Wings4U menu for `LON01`, imported through a repeatable (Docx -> JSON -> Prisma) pipeline with explicit destructive-confirmation and “no orders exist” safety gating.

---

### Fixed Issue 10. E2E harness — dedicated test database with automatic reset + seed

#### Area

Testing / e2e infrastructure

#### Issue

The e2e suite expected seeded records (`LON01`, test users, menu data) but the test harness did not create them. Tests ran against the normal dev database and depended on manual seeding. A clean or CI-like database would fail immediately at the `beforeAll` lookups.

#### Fix

- Created `apps/api/test/.env.test` — template for a dedicated e2e database connection string.
- Rewrote `apps/api/test/setup-env.ts` — loads `.env.test` first (override), then root `.env`.
- Created `apps/api/test/global-setup.ts` — Jest `globalSetup` that truncates all application data tables via raw `pg` (`TRUNCATE ... CASCADE`), then runs the canonical seed via `tsx` subprocess.
- Updated `apps/api/test/jest-e2e.json` — added `globalSetup`.
- Added `.env.test` to `.gitignore`.

#### Status

**Fixed** — `npm run test:e2e` now resets and seeds a dedicated test database before any test runs. User must configure `.env.test` with a real connection string.

---

### Fixed Issue 9. Procedure docs aligned — tasks / todo / issues consistent; no overstated “feature-complete” or green-e2e claims

#### Area

Procedures / project reporting

#### Issue

`tasks.md` used strong language (“feature-complete backend,” “Comprehensive e2e test suite”) while `issues.md` still listed blocking e2e seed and wallet/refund schema problems. `todo.md` listed stale open items (chat, realtime wiring, device token) that were already fixed or removed from the issue register.

#### Fix

- **`tasks.md`:** Added reporting rules (Implemented vs Verified, promotion criteria), rewrote the headline summary, retitled and reframed the e2e section, softened early “What was verified” for e2e, updated realtime subsection to reflect wired emits without claiming full proof.
- **`todo.md`:** Rewritten to match only genuine open work (Issue 1–2) plus optional platform/ops items; removed stale bullets.
- **`issues.md`:** Removed the meta “documentation overstates completion” issue once fixed; updated summaries and suggested fix order.

#### Status

**Fixed** — Reporting matches [`issues.md`](./issues.md) as the open-issue source of truth.

---

### Fixed Issue 8. Device-token auth deferred — stub removed, CSRF bypass closed, KDS uses staff browser auth

#### Area

Authentication / device access / CSRF

#### Issue

The auth guard contained a dead `X-Device-Token` branch that checked for the header, found no implementation, and silently returned `null` (unauthenticated). The CSRF middleware granted a blanket bypass to any request carrying `X-Device-Token`, meaning any client could skip CSRF validation by sending that header. The API contract documented device auth as if it were active. No device auth service, registration endpoints, or token rotation logic existed.

#### Impact

The CSRF bypass was a real security gap — any browser request could skip CSRF protection by adding the `X-Device-Token` header. The dead auth guard branch was misleading, implying device auth was partially implemented when it was not.

#### Fix

- Removed the `X-Device-Token` branch from `auth.guard.ts` — the guard now only evaluates cookie/JWT auth.
- Removed the `X-Device-Token` CSRF bypass from `csrf.middleware.ts` — all browser mutating requests now require proper CSRF tokens with no exceptions beyond OTP and POS login.
- Updated both API contract copies — "Device Auth" section now states the feature is deferred, explains the MVP approach (staff browser auth for KDS/POS/timeclock), and notes that DB schema fields are retained for future use.
- DB schema unchanged — `devices.api_token_hash` and related fields remain for future kiosk/device rollout.

#### Status

**Fixed** — Device-token auth explicitly deferred. No half-enabled paths remain.

---

### Fixed Issue 7. Realtime event emission wired into all business services

#### Area

Realtime / WebSocket integration / all business flows

#### Issue

The WebSocket gateway (`realtime.gateway.ts`) existed with correct channel subscription logic and typed emit helpers (`emitOrderEvent`, `emitChatEvent`, `emitAdminEvent`, `emitDriverEvent`), but no business service called those methods after successful DB mutations. Connected clients received no real-time updates for any operation — order placement, status changes, chat messages, driver assignments, cancellations, or refunds.

#### Impact

The real-time feature appeared implemented but produced zero push notifications. Frontends relying on WebSocket subscriptions for live order tracking, KDS updates, chat messages, and driver state would show stale data indefinitely until the user manually refreshed.

#### Why is it bad?

Real-time updates are essential for operational features: KDS needs instant order notifications, customers expect live delivery tracking, chat needs immediate message delivery, and the driver picker needs current availability. Without the emit calls, the entire WebSocket layer was dead infrastructure.

#### Fix

Injected `RealtimeGateway` into all five services that own state-changing mutations and added emit calls after every successful DB write:

- **Checkout** (`order.placed`): emitted after order creation transaction with order_id, order_number, status, fulfillment_type, estimated_ready_at.
- **KDS** (8 emit points): `order.accepted` after accept; `order.status_changed` or `order.cancelled` after status update; `cancellation.decided` + optional `order.cancelled` after cancel request handling; `order.driver_assigned` + `driver.availability_changed` after driver assignment; `order.delivery_started` after start delivery; `order.status_changed` + `driver.delivery_completed` + `driver.availability_changed` after complete delivery; `order.eta_updated` after ETA update; `refund.requested` after refund request creation.
- **Chat** (`chat.message`, `chat.read`): message emit after every successful send; read emit only when the side cursor actually advanced (avoids duplicate noise on repeated fetches).
- **Admin** (`cancellation.decided`, `order.cancelled`): emitted after cancellation decisions and force-cancel operations.
- **Drivers** (`driver.availability_changed`): emitted after manual availability status updates.

All emits happen **after** the DB transaction succeeds, never before. Payloads follow the minimal shapes specified in the plan.

#### Verification

TypeScript compilation passes with zero errors. No SQL schema changes needed — the gateway module is `@Global()` so no module import changes were required for injection.

#### Status

**Fixed** — All business flows now push typed events to subscribed WebSocket clients after successful mutations.

---

### Fixed Issue 6. Order chat lifecycle — terminal status closes chat, support tickets take over

#### Area

Chat / order lifecycle / support ticket handoff

#### Issue

Order chat had no lifecycle awareness. Messages could be sent on terminal orders, conversations were never closed, and there was no signal to the frontend about whether chat was active or read-only.

#### Fix

Added `closeConversation()` to `ChatService`, hooked it into KDS and orders terminal transitions, added terminal order status check to `sendMessage()` (returns 409), and added `is_closed` to the GET response. Documented in API contract.

#### Status

**Fixed** — see tasks.md entry 35 for full details.

---

## Fixed On 2026-03-23

### Fixed Issue 5. Chat module aligned to schema and contract — server-derived sender surface, side-based unread, visibility filtering

#### Area

Chat / order conversations / unread tracking

#### Issue

The chat controller and service accepted `CUSTOMER` and `STORE` as client-sent `sender_side` values, but the database schema (`order_messages.sender_surface`) only allows `CUSTOMER`, `KDS`, `MANAGER`, and `ADMIN`. The service wrote whatever the client sent directly to the `sender_surface` column, meaning invalid values like `STORE` could be persisted. Unread tracking only updated the per-user `chat_read_states` table and ignored the canonical `chat_side_read_states` table entirely. The `visibility` field on messages was never exposed or enforced — all messages were treated as `BOTH`, so staff-only internal notes were not possible. The `POST /orders/:id/chat/read` endpoint required the client to send a `side` field, which the server should derive.

#### Impact

- Message writes with `sender_surface = STORE` violate the SQL CHECK constraint and fail at the database level.
- Unread state is unreliable because the canonical side-based table is never updated, so any UI relying on `chat_side_read_states` for unread badges shows stale data.
- Staff cannot send internal notes because visibility is not enforced.
- Customers can see messages they should not see if staff-only messages are ever written.
- The client has to know its own "side" to mark messages as read, which is error-prone and redundant with the auth token.

#### Why is it bad?

Chat is a live operational feature used during active orders. If sender identity is wrong, the database rejects writes and messages are lost. If unread tracking is wrong, staff miss customer messages or customers see phantom unread indicators. If visibility is not enforced, there is no way to have private staff-side discussion about an order without the customer seeing it.

#### Fix

Rewrote both `chat.service.ts` and `chat.controller.ts` to align with the schema and API contract:

**Sender surface derivation (server-side):**
- `CUSTOMER` user → `sender_surface = CUSTOMER`
- `STAFF` with `employeeRole = KITCHEN` → `sender_surface = KDS`
- `STAFF` with `employeeRole = MANAGER` → `sender_surface = MANAGER`
- `ADMIN` user → `sender_surface = ADMIN`
- `STAFF` with `employeeRole = CASHIER` or `DRIVER` → **rejected with 403** (not allowed to post order chat messages)

The client no longer sends `sender_side` — the `SendMessageDto` now only accepts `message_body` and an optional `visibility` field.

**Visibility enforcement:**
- Customers can only send `visibility = BOTH` (the default). Attempting `STAFF_ONLY` returns 403.
- Staff and admin can send `BOTH` or `STAFF_ONLY`.
- On `GET /orders/:id/chat`, customers only see messages where `visibility = BOTH`. Staff/admin see all messages.

**Side-based unread (canonical `chat_side_read_states`):**
- `markRead()` and `getMessages()` both advance the `chat_side_read_states` cursor based on the caller's role: `CUSTOMER` → `reader_side = CUSTOMER`, any staff/admin → `reader_side = STAFF`.
- When one staff member reads, the STAFF-side cursor advances for all staff views (shared unread).
- Per-user `chat_read_states` is still updated as an audit/helper record, but the service treats `chat_side_read_states` as the source of truth.

**`POST /orders/:id/chat/read` simplified:**
- No request body required. The server infers the reader side from the authenticated caller.
- Returns the updated side cursor with `last_read_message_id` and `last_read_at`.

**Conversation closed check:**
- `sendMessage()` now checks `conversation.closedAt` and returns 409 Conflict if the conversation is closed.

#### Solution (implementation detail)

- **`chat.controller.ts`**: Removed `sender_side` from `SendMessageDto`, added optional `visibility` field. Removed `MarkReadDto` entirely — `markRead` endpoint takes no body. `sendMessage` calls `chatService.deriveSenderSurface()` from auth context. `getMessages` passes `user.role` and `user.userId` so the service can filter by visibility and advance the read cursor.
- **`chat.service.ts`**: Added `deriveSenderSurface()` and `deriveReaderSide()` methods. `getMessages()` filters `STAFF_ONLY` messages for customer callers and auto-advances the side read cursor on the latest visible message. `sendMessage()` validates visibility permission, checks conversation closed state, and writes the server-derived `senderSurface`. `markRead()` and private `advanceReadCursor()` upsert both `chat_side_read_states` (canonical) and `chat_read_states` (audit). Serializer now includes `order_id`, `sender_surface`, `message_body`, `is_system_message`, and `visibility`.
- **`seed.ts`**: Added a `KITCHEN` employee user so e2e tests can verify the `KDS` sender surface.
- **`app.e2e-spec.ts`**: Added kitchen, cashier, and driver tokens. New "Chat" test block covers: customer → `CUSTOMER`, kitchen → `KDS`, manager → `MANAGER`, admin → `ADMIN`, cashier/driver rejected, customer cannot send `STAFF_ONLY`, staff can send `STAFF_ONLY`, customer GET hides `STAFF_ONLY` messages, staff GET shows all, customer read updates `CUSTOMER` side, staff read updates `STAFF` side.
- **API contract** (both copies): Expanded Section 5 with sender surface derivation table, unread contract rules, full response shapes for all three endpoints, visibility filtering behavior, and the new `POST /orders/:id/chat/read` endpoint.

#### Verification

- TypeScript build passes with zero errors (`tsc --noEmit`).
- No SQL schema changes required — the existing `sender_surface` CHECK (`CUSTOMER`, `KDS`, `MANAGER`, `ADMIN`) and `chat_side_read_states` table already support the correct behavior.

#### Status

**Fixed** — Chat now writes only schema-valid sender surfaces, enforces visibility rules, and uses the canonical side-based unread table.

---

## Fixed On 2026-03-22

### Fixed Issue 4. Timeclock schema expanded for rich shift state and stored totals

#### Area

**Backend — Timeclock module (`apps/api/src/modules/timeclock/`), canonical SQL baseline (`db/sql/`), Prisma schema (`packages/database/prisma/schema.prisma`), driver availability integration, and timeclock e2e tests.**

#### Issue (what was wrong)

The timeclock service wrote shift statuses `CLOCKED_IN`, `ON_BREAK`, and `CLOCKED_OUT`, but the SQL schema only allowed `OPEN` and `CLOSED`. It also wrote break type `STANDARD`, but the schema only allowed `PAID` and `UNPAID`. There were no stored totals for break minutes or net worked time — those were computed in memory and returned transiently.

#### Impact

- **Runtime failures**: Any shift creation or status update would be rejected by PostgreSQL CHECK constraints on a live database.
- **No stored totals**: Break minutes and net worked time were computed on the fly and not persisted, making payroll queries and shift reporting unreliable.
- **No integrity constraints**: Nothing prevented an employee from having two active shifts simultaneously, or a shift from having two open breaks at once.

#### Why that was bad

- **Schema authority violation**: The project rule is that SQL is canonical. Writing values the database rejects means the feature is broken on any real deployment.
- **Data integrity gap**: Without partial unique indexes, concurrent clock-in requests could create duplicate active shifts.
- **Audit gap**: Without stored totals, completed shift records didn't contain the information needed for payroll or time tracking.

#### Fix

**Schema expansion (SQL + Prisma):**

1. `employee_shifts.status` — expanded from `OPEN|CLOSED` to `CLOCKED_IN|ON_BREAK|CLOCKED_OUT`.
2. `employee_shifts.total_break_minutes` — new `int NOT NULL DEFAULT 0` column.
3. `employee_shifts.net_worked_minutes` — new nullable `int` column (null for active shifts, computed on clock-out).
4. `employee_breaks.break_type` — constrained to `UNPAID` only (every break is unpaid).
5. Partial unique index `uq_one_active_shift_per_employee` — one active shift per employee.
6. Partial unique index `uq_one_open_break_per_shift` — one open break per shift.

**Service rewrite (`timeclock.service.ts`):**

- `clockIn()` — creates shift with `CLOCKED_IN`, `totalBreakMinutes = 0`; sets driver availability to `AVAILABLE` if employee has a driver profile.
- `startBreak()` — creates `UNPAID` break row, sets shift to `ON_BREAK`; sets driver to `UNAVAILABLE` if not on delivery.
- `endBreak()` — closes open break, recalculates `totalBreakMinutes`, restores `CLOCKED_IN`; sets driver to `AVAILABLE` if not on delivery.
- `clockOut()` — auto-closes open break if `ON_BREAK`; computes and stores `totalBreakMinutes` and `netWorkedMinutes`; sets driver to `OFF_SHIFT`.
- All serializers now return `total_break_minutes`, `net_worked_minutes`, and `breaks[]` with `started_at` / `ended_at`.

**Driver availability integration:** Clock-in, break start/end, and clock-out now update `driver_profiles.availability_status` when the employee has a driver profile (respecting `isOnDelivery` — no override during active delivery except `OFF_SHIFT` on clock-out).

#### Verification

- TypeScript compilation passes with zero errors.
- No linter errors on edited files.
- SQL patch file `db/sql/0003_timeclock_schema_expansion.sql` ready for manual application to existing databases.
- Prisma client regenerated successfully.

#### Status

**Fixed** — Resolved by expanding the canonical SQL for rich shift state and stored totals, adding integrity constraints, rewriting the service with driver availability integration, and updating API contract docs.

---

### Fixed Issue 3. Support ticket schema expanded and module fully aligned

#### Area

**Backend — Support module (`apps/api/src/modules/support/`), canonical SQL baseline (`db/sql/`), Prisma schema (`packages/database/prisma/schema.prisma`), and support-related e2e tests.**

This spans the database schema (CHECK constraints on `support_tickets.created_source` and `support_ticket_events.event_type`, plus two new columns), the Prisma model layer, the HTTP controller DTOs, the service write logic, and the automated test coverage for the support ticket lifecycle.

#### Issue (what was wrong)

The support service wrote values that the SQL schema did not allow:

- **`support_tickets.created_source`**: the service wrote `CUSTOMER_APP`, but the baseline CHECK only accepted `CUSTOMER`, `STAFF`, and `AUTO_OVERDUE`.
- **`support_ticket_events.event_type`**: the service wrote `CREATED`, `MESSAGE_ADDED`, `STATUS_CHANGED`, and `RESOLVED`, but the baseline CHECK only accepted `STATUS_CHANGE`, `PRIORITY_CHANGE`, `RESOLUTION_SET`, `REOPENED`, and `NOTE_ADDED`.

Additionally, the support module lacked schema support for:

- **Ticket priority** — no column existed, so priority was smuggled into the event `note` field as a string like `priority=HIGH`.
- **Structured event payloads** — audit-relevant context (like whether a message was an internal note) had no dedicated storage and was either lost or overloaded into `note`.

The controller DTOs also used stale field names (`category` instead of `ticket_type`, `body` instead of `message_body`) and exposed `IN_PROGRESS` as a valid ticket status even though the schema only defines `OPEN`, `IN_REVIEW`, `WAITING_ON_CUSTOMER`, `RESOLVED`, and `CLOSED`.

#### Impact

- **Runtime failures**: Any `INSERT` into `support_tickets` or `support_ticket_events` with the old values would be rejected by PostgreSQL CHECK constraints on a live database, making the entire support workflow non-functional.
- **Lost audit data**: Without `payload_json`, structured context about events (priority at creation, internal note flags, resolution metadata) was either discarded or crammed into a free-text `note` field that is not queryable.
- **Missing priority workflow**: Admins had no way to filter or sort tickets by urgency because the concept did not exist in the schema.
- **API contract drift**: Clients sending `category` and `body` would get validation errors once the DTOs were corrected, but the old DTOs also didn't expose `order_id`, `created_source`, `priority`, or `is_internal_note` — all of which are needed for a functional support UI.

#### Why that was bad

- **Schema authority violation**: The project rule is that SQL is canonical. Writing values the database rejects means the feature is broken on any real deployment, even if TypeScript compiles.
- **Audit gap**: Support events are the ticket's lifecycle log. If event types don't match the schema, the audit trail is either empty (inserts fail) or meaningless (wrong values slip through without constraints).
- **Product gap**: Priority and internal notes are basic helpdesk primitives. Without schema-level support, the admin panel cannot implement triage, SLA tracking, or private staff discussions on tickets.
- **False completion signal**: The module appeared implemented and passing compilation, but would fail on first real use against the canonical database.

#### Fix (schema expansion + code alignment)

This was resolved with a **lean schema expansion** — adding only the vocabulary and columns needed for the current support workflow — followed by a full code alignment pass:

**Schema changes (SQL + Prisma):**

1. **`support_tickets.created_source`** — expanded to accept `CUSTOMER_APP`, `STAFF_PANEL`, and `ADMIN_PANEL` alongside the original `CUSTOMER`, `STAFF`, and `AUTO_OVERDUE`. This preserves backward compatibility while giving the service meaningful source values.
2. **`support_ticket_events.event_type`** — expanded to accept `CREATED`, `MESSAGE_ADDED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `RESOLVED`, and `ASSIGNED` alongside the original values. Both old and new naming conventions are accepted (e.g. `STATUS_CHANGE` and `STATUS_CHANGED`) to avoid breaking any existing data.
3. **`support_tickets.priority`** — new `text NOT NULL DEFAULT 'NORMAL'` column with CHECK constraint allowing `LOW`, `NORMAL`, `HIGH`, `URGENT`.
4. **`support_ticket_events.payload_json`** — new `jsonb NOT NULL DEFAULT '{}'::jsonb` column for structured event metadata.

**Implementation:**

- Updated the single canonical baseline `db/sql/0001_wings4u_baseline_v1_4.sql` so fresh databases include the expanded support schema (header documents the 2026-03-22 support changes); no separate patch file.
- Updated `packages/database/prisma/schema.prisma` with `priority` on `SupportTicket` and `payloadJson` on `SupportTicketEvent`.
- Regenerated Prisma client.

**Service changes (`support.service.ts`):**

- `createTicket()` — now accepts `ticketType`, `createdSource`, `orderId`, and `priority`; writes `priority` to the ticket row; creates a `CREATED` event with `payloadJson` containing priority and source.
- `addMessage()` — accepts `isInternalNote` flag; writes `isInternalNote` on the message row; creates `MESSAGE_ADDED` event with `payloadJson` noting the internal-note flag.
- `updateStatus()` — writes `STATUS_CHANGED` event type (now schema-valid).
- `resolve()` — writes `RESOLVED` event type (now schema-valid); puts resolution note into `payloadJson`.
- `getTicket()` — accepts `viewerRole`; filters out internal notes for `CUSTOMER` callers.
- All serializers now expose `order_id`, `priority`, `created_source`, `resolution_type`, `is_internal_note`, and `payload_json`.

**Controller changes (`support.controller.ts`):**

- `CreateTicketDto` — renamed `category` to `ticket_type`; added `order_id` and `priority` fields.
- `AddMessageDto` — renamed `body` to `message_body`; added `is_internal_note`.
- `UpdateStatusDto` — removed `IN_PROGRESS` from allowed values; kept `OPEN`, `IN_REVIEW`, `WAITING_ON_CUSTOMER`, `RESOLVED`, `CLOSED`.
- Resolve endpoint — changed from `POST :id/resolve` to `POST :id/resolutions` to match REST convention.
- `getOne` — now passes `user.role` to the service so internal notes are filtered for customers.
- `addMessage` — customers cannot set `is_internal_note = true` (silently ignored by controller).

**Test changes (`app.e2e-spec.ts`):**

- Create ticket test sends `ticket_type` and `priority`, asserts `priority`, `created_source`, and `status` in response.
- List tickets test asserts `priority` and `created_source` are present on summaries.
- Get ticket test asserts `events` array contains a `CREATED` event.
- Add message test sends `message_body`, asserts `is_internal_note = false`.
- New test: admin adds an internal note, then customer fetches the ticket and sees zero internal notes.
- Unauthenticated create test updated to send `ticket_type` instead of `category`.

#### Verification

- TypeScript compilation passes with zero errors (`tsc --noEmit`).
- No linter errors on edited files.
- For an already-deployed database built from an older baseline, apply equivalent `ALTER TABLE` / `DROP CONSTRAINT` / `ADD CONSTRAINT` changes by hand (see the `support_tickets` and `support_ticket_events` definitions in `0001_wings4u_baseline_v1_4.sql`); do not re-run the full baseline on production.
- Prisma client regenerated successfully against the updated schema.

#### Status

**Fixed** — Resolved by expanding the canonical SQL vocabulary for support tickets, adding `priority` and `payload_json` columns, aligning all service writes and controller DTOs to schema-valid values, filtering internal notes by viewer role, and updating e2e test coverage.

---

### Fixed Issue 17. Pickup / delivery date-time was display-only, not shared across the order flow, and not applied to backend scheduling

#### Issue

The customer ordering flow already had a visible pickup / delivery summary bar on `/order`, but the date and time inside that bar were not real order state. They were only display text generated in the page component. The customer could see a date and ETA-like time label, but could not actually edit either value, and the application did not carry a committed schedule across the rest of the ordering flow.

That created several separate problems at once:

1. **The menu page showed timing, but it was not a real schedule.**  
   The `/order` page rendered labels like `Today, Mar 24` and `ASAP (~30 min)` or `ASAP (~20 min)` as plain UI text. Those values did not come from a persisted order schedule object, and there was no input path to change them.

2. **The chosen timing was not shared across the app.**  
   The cart state only stored:
   - cart items
   - fulfillment type
   - location id

   It did **not** store:
   - a selected pickup / delivery date
   - a selected pickup / delivery time
   - timing windows coming from backend location settings

   So even after a customer conceptually chose pickup vs delivery on the landing page and then viewed a time label on `/order`, there was still no single shared order schedule context following them into cart and checkout.

3. **Checkout already supported `scheduled_for`, but the web app never used it.**  
   The backend checkout path already accepted an optional `scheduled_for` field and already persisted that value onto `orders.scheduled_for`. But the web checkout client never sent it. That meant every order effectively fell back to backend ASAP behavior even when the UI suggested there was a time concept in the flow.

4. **Schedule validation used “now,” not the selected future time.**  
   Cart quote and checkout schedule checks were validating scheduled menu items such as lunch specials against the current server-local time rather than the customer’s intended order time. If a customer eventually selected a future time in the product vision, those validations would still be wrong until the selected schedule actually flowed through the API.

5. **Pickup / delivery ETA messaging was inconsistent with operational settings.**  
   The UI hardcoded delivery to roughly 30 minutes in some places, while the live `LON01` location settings still had:
   - pickup min/max = `30 / 40`
   - delivery min/max = `40 / 60`

   So there was a mismatch between what the customer was being shown and what the backend considered the real pickup / delivery timing window for created orders.

6. **The app had no real bridge to admin / KDS timing configuration.**  
   The schema already had `location_settings` timing windows and `location_hours`, but the customer flow was not reading those values in a meaningful way for order scheduling. As a result, the UI could not honestly claim that date/time behavior was synchronized with store timing configuration.

#### Impact

This was not just a missing convenience control. It created a real product integrity problem across the entire order flow.

- **Customer trust problem:** The interface implied that date and time were part of the order, but the system was not actually saving or placing the order with that schedule.
- **State inconsistency:** A customer could browse the menu with one timing assumption, move into cart with no persisted schedule, and then check out without the backend ever receiving the intended date/time.
- **Validation mismatch:** Schedule-restricted items like lunch specials were evaluated against the current time instead of the intended pickup / delivery time, which would cause false failures or false availability as soon as scheduled ordering became a real path.
- **Operational mismatch:** The backend order object already had `scheduled_for`, `estimated_window_min_minutes`, and `estimated_window_max_minutes`, but the web flow was leaving those capabilities unused while still presenting timing UI to the customer.
- **Timing drift across systems:** The frontend timing labels, the location settings values, and the actual checkout-created order timing windows could all disagree. That is especially dangerous in pickup / delivery flows because store staff, KDS, and customers can end up working from different assumptions about when the order should be ready.
- **PRD gap:** The desired behavior was that pickup / delivery date and time should be shared across the app until order placement and should follow store timing rules. The implemented product had not reached that bar.

In practical terms, the customer saw something that looked like a scheduling feature, but the application was still behaving like an ASAP-only flow with fragmented state.

#### Fix

This was fixed by wiring one real scheduling path from `/order` through cart and checkout, and by aligning the timing source with existing backend location settings.

**1. Shared client-side scheduling state was added to the cart context**

`apps/web/src/lib/cart.ts` was expanded so the shared client order context now stores:

- `fulfillmentType`
- `scheduledFor`
- `schedulingConfig`

That state is persisted in session storage, which means the selected pickup / delivery timing now survives navigation across the customer flow instead of disappearing when the user moves between `/order`, `/cart`, and `/checkout`.

This made scheduling part of the same committed order context as fulfillment type, rather than a page-local label.

**2. A dedicated scheduling utility layer was added**

`apps/web/src/lib/order-scheduling.ts` was added as the shared scheduling logic layer for the web app. It now handles:

- pickup / delivery timing windows
- fallback hours
- date option generation
- time slot generation
- formatting of date/time display labels
- consistent ASAP label generation

This removed the old pattern where each surface improvised its own timing text.

**3. `/order` now exposes real editable date/time controls**

`apps/web/src/wingkings/components/menu-page.tsx` was updated so the order settings panel no longer shows fake date/time display blocks. It now supports:

- editing fulfillment type
- editing date
- editing time
- carrying draft order settings inside the expanded panel
- committing those settings into shared state when the user clicks `Done`

The top summary bar continues to show the committed order context, while the expanded panel is the editing surface. That keeps the UX consistent with the existing fulfillment commit model.

**4. Cart and checkout now use the same committed schedule**

The cart and checkout clients were updated so they both read the same scheduling state from the shared cart context:

- `apps/web/src/app/cart/cart-client.tsx`
- `apps/web/src/app/checkout/checkout-client.tsx`

Cart quote requests now send `scheduled_for`, and checkout payloads now send `scheduled_for` as well. The checkout summary also shows the committed date/time so the customer can see the actual order schedule that will be placed.

On successful order placement, the temporary order context is reset so the schedule does not incorrectly leak into the next unrelated order.

**5. The menu API now accepts and uses `scheduled_for`**

The menu API path was extended so `/menu` accepts `scheduled_for`:

- `apps/api/src/modules/catalog/menu.controller.ts`
- `apps/api/src/modules/catalog/catalog.service.ts`

The catalog service now evaluates scheduled item availability against the selected scheduled time, not only the current time. That means time-gated items such as lunch specials are filtered against the customer’s intended pickup / delivery moment when that schedule exists.

The same catalog response was also expanded to include:

- pickup timing window min/max
- delivery timing window min/max
- pickup hours
- delivery hours

This gives the frontend a real backend timing source instead of forcing it to guess.

**6. Cart quote and checkout validation now honor the selected schedule**

Both quote and checkout validation paths were updated so schedule-restricted item validation uses the selected scheduled time when present:

- `apps/api/src/modules/cart/cart.controller.ts`
- `apps/api/src/modules/cart/cart.service.ts`
- `apps/api/src/modules/checkout/checkout.service.ts`

That closes the important consistency gap where the UI could theoretically choose a future schedule while the backend still validated items against “right now.”

**7. Pickup and delivery timing windows were aligned to the requested operational values**

The live `LON01` location settings were updated so the real backend timing windows now match the requested behavior:

- pickup min/max = `15 / 20`
- delivery min/max = `30 / 30`

The seed defaults were also updated in `packages/database/prisma/seed.ts` so fresh environments do not reintroduce the old `30-40` pickup and `40-60` delivery values.

This means the frontend labels and the backend order timing windows now point at the same source-of-truth values.

**8. Existing backend operational fields are now actually used by the customer flow**

This fix deliberately reused the backend’s existing operational scheduling model instead of inventing a parallel frontend-only one:

- `orders.scheduled_for`
- `location_settings.defaultPickupMinMinutes`
- `location_settings.defaultPickupMaxMinutes`
- `location_settings.defaultDeliveryMinMinutes`
- `location_settings.defaultDeliveryMaxMinutes`
- `location_hours` when present

That is the correct direction for PRD alignment because it lets the customer flow consume store timing configuration rather than hardcoded UI strings.

#### Status

**Fixed** - Pickup / delivery date-time is now a real shared order context across `/order`, cart, and checkout, the backend receives and validates `scheduled_for`, and the live `LON01` timing windows are aligned to pickup `15-20` minutes and delivery `~30` minutes. The customer flow now uses backend scheduling fields instead of pretending that date/time is only a visual label.

---

### Fixed Issue 18. `/order` layout drifted across very different screen sizes, and the add-to-cart modal could slide under the navbar after moving the browser between displays

#### Issue

The `/order` page was still behaving inconsistently across very different monitor sizes even after the earlier responsive fixes.

Two related presentation failures were reported together:

1. **The menu surface stayed too narrow on a 32-inch display.**  
   On a large external monitor, the tan ordering surface stopped expanding much earlier than the actual viewport width. That left a visibly oversized amount of black patterned background on both sides of the menu. On a smaller laptop screen, the same page looked proportionally fine. In practice, the same `/order` layout felt like it was using two different visual systems depending on which screen the browser was on.

2. **The add-to-cart modal could end up under the navbar / sticky order bars after the browser window changed screens while the modal was already open.**  
   A customer could open a lunch-special add-to-cart modal on a larger display, then drag that Chrome window to a smaller screen. Once the viewport height changed, the modal no longer remained safely centered inside the visible area. The top of the modal could rise behind the sticky navbar and order-settings stack, which made the builder feel partially clipped and less trustworthy.

This was not a backend issue. It was a pure layout and overlay behavior bug in the web layer.

The root causes were different but related to viewport assumptions:

- [`apps/web/src/wingkings/styles.ts`](../../apps/web/src/wingkings/styles.ts) still constrained the main tan `menuSurface` too aggressively for wide desktop displays. The page no longer collapsed, but it still visually capped too early, so ultra-wide or large-monitor users saw much more empty black side space than intended.
- [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css) still treated the generic modal overlay like a normal centered popup instead of a viewport-aware overlay that respects the measured navbar offset. When the browser height changed while the modal was already mounted, the old centering model was no longer reliable.

#### Impact

- The ordering page looked unfinished or incorrectly scaled on large monitors because the content column did not use the available horizontal space in a balanced way.
- Visual consistency broke between laptop and desktop experiences. The same page felt compact and intentional on one screen, but too boxed-in on another.
- The lunch-special and non-wing add-to-cart flows looked fragile when the open modal moved behind the sticky navbar after a display/viewport change.
- This was especially bad during real ordering because the modal is part of the money path. If the customer cannot fully see the builder panel, quantity controls, or confirmation button, trust in the ordering flow drops immediately.

In plain terms: large-screen users saw too much wasted side space, and moving the browser between monitors could make an open add-to-cart popup look broken.

#### Fix

The fix was split between the page-width constraint and the modal overlay behavior.

**1. Widened the tan menu surface for large monitors**

In [`apps/web/src/wingkings/styles.ts`](../../apps/web/src/wingkings/styles.ts):

- `menuPage` horizontal padding was reduced from the more conservative clamp to:
  - `clamp(0.75rem, 2.8vw, 3rem)`
- `menuSurface.maxWidth` was increased from:
  - `min(1240px, 100%)`
  to:
  - `min(1680px, 100%)`

That lets the ordering surface grow much more naturally on large desktop screens instead of stopping too early and leaving excessive black background space on the sides.

**2. Made the generic modal overlay viewport-aware and navbar-safe**

In [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css):

- `.modal-backdrop` was raised above the navbar and sticky order/menu bars with a higher `z-index`
- The overlay alignment was changed from vertical centering to a top-anchored layout
- Top padding now uses the measured navbar offset variable:
  - `var(--wk-nav-offset, 88px)`
- The overlay was given `overflow-y: auto` and `overscroll-behavior: contain`
- `.modal-panel` now uses a viewport-aware `max-height` based on the available space below the navbar and gains centered auto margins

This means that even if the modal is already open and the viewport changes abruptly because the browser window is moved to another display, the panel stays inside a usable visible region and scrolls if needed instead of disappearing behind the sticky header stack.

#### Status

**Fixed** - The `/order` surface now uses large desktop width more effectively, and the add-to-cart modal no longer depends on fragile center-only positioning that can slide under the navbar when the browser window changes screens.

---

### Fixed Issue 19. `/order` showed `ASAP (~undefined min)` when the frontend received an older `/menu` payload without scheduling timing fields

#### Issue

After the shared scheduling pass was implemented, the `/order` page began depending on timing values from the menu response:

- `pickup_min_minutes`
- `pickup_max_minutes`
- `delivery_min_minutes`
- `delivery_max_minutes`

The web app expected those values in:

- [`apps/web/src/lib/types.ts`](../../apps/web/src/lib/types.ts)

and used them to build the client scheduling config and the visible summary label in:

- [`apps/web/src/lib/order-scheduling.ts`](../../apps/web/src/lib/order-scheduling.ts)
- [`apps/web/src/wingkings/components/menu-page.tsx`](../../apps/web/src/wingkings/components/menu-page.tsx)

The problem was that the locally running API process on port `3000` was still serving an **older `/api/v1/menu` payload shape** that did **not** include those timing fields inside `location`.

Direct inspection of the live local response showed `location` only contained older fields such as:

- `id`
- `name`
- `timezone`
- `is_open`
- `busy_mode`
- `estimated_prep_minutes`
- delivery fee / threshold values

but **did not contain** the new pickup / delivery min/max timing fields.

Because the frontend trusted the response shape too directly, it built a scheduling config object from missing values. That let `undefined` leak into the ETA formatter, which then rendered broken labels such as:

- `ASAP (~undefined min)`

This was a subtle but important contract problem:

- the source code and types said the timing fields exist
- the current browser-facing local API response did not yet provide them
- the frontend needed to remain safe while that local process was stale

#### Impact

- The order-settings bar showed obviously broken customer-facing text:
  - `ASAP (~undefined min)`
- The time dropdown could also surface the same broken label because it reused the same formatting path.
- This damaged confidence in the scheduling UI right after the system had been upgraded to support real shared pickup / delivery timing.
- The failure was especially confusing because the actual intended defaults were already known:
  - pickup `15-20`
  - delivery `30`

So the bug was not a lack of business rules. It was a missing defensive fallback when the web app encountered an older menu payload.

#### Fix

The fix was to make the frontend scheduling layer resilient when timing fields are absent or malformed.

**1. Hardened timing-window fallback logic**

In [`apps/web/src/lib/order-scheduling.ts`](../../apps/web/src/lib/order-scheduling.ts):

- Added a guarded default timing-window helper
- Updated `getTimingWindow()` so it no longer blindly returns the raw `pickup` / `delivery` object from config
- If the current timing window is missing or invalid, it now falls back to the known defaults:
  - pickup `15-20`
  - delivery `30-30`

This prevents `undefined` from reaching `formatEtaLabel()` even if the config source is incomplete.

**2. Normalized menu-driven scheduling config before storing it**

In [`apps/web/src/wingkings/components/menu-page.tsx`](../../apps/web/src/wingkings/components/menu-page.tsx):

- The menu response timing fields are now passed through `normalizeSchedulingConfig(...)` before being committed into shared cart state

That means if the current `/menu` response is missing the newer fields, the app stores a safe normalized config instead of writing partially undefined timing values into state.

**3. Confirmed the real local mismatch**

The local `/api/v1/menu` response from the running stack was inspected directly and confirmed to be missing:

- `pickup_min_minutes`
- `pickup_max_minutes`
- `delivery_min_minutes`
- `delivery_max_minutes`

So this fix explicitly covers the real runtime condition that produced the broken label, not just a hypothetical type mismatch.

#### Status

**Fixed** - The frontend now safely falls back to the correct pickup and delivery timing defaults when a stale local `/menu` response omits the newer scheduling fields, so `ASAP (~undefined min)` no longer appears in the order settings UI.

## Fixed On 2026-03-21

### Fixed Issue 1. End-to-end tests now boot correctly

- **Area:** Testing / Prisma bootstrap
- **Issue:** The e2e suite did not start because `PrismaService` was constructed with invalid options when `DATABASE_URL` was missing in the test process.
- **Impact:** All 37 e2e tests failed before the application even booted.
- **Why is it bad?:** The repo claimed the backend was feature-complete and comprehensively tested, but the main automated proof could not even initialize.
- **Fix:** Updated `apps/api/src/database/prisma.service.ts` so it loads the repo root `.env`, prefers `DIRECT_URL` with fallback to `DATABASE_URL`, and always constructs Prisma 7 with a real adapter connection string.
- **Solution:** The bootstrap dependency on `main.ts` env loading was removed from the Prisma runtime path, so tests and other non-CLI contexts can initialize Prisma correctly.
- **Status:** Fixed

---

## Fixed On 2026-03-21

### Fixed Issue 2. Customer cancellation flow aligned with schema and product rules (no invalid `cancellation_requests` writes)

#### Area

**Backend — Orders module (`apps/api`), Checkout module (`apps/api`), and related API contract behavior for customer-initiated cancellation.**

This spans the HTTP surface (`POST /api/v1/orders/:id/cancel`), the orders service layer, order serialization in checkout and order list/detail responses, and how those interact with the canonical SQL baseline for `orders` and `cancellation_requests`.

#### Issue (what was wrong)

The implementation treated “customer wants to cancel” as “insert a row into `cancellation_requests` with `request_source = 'CUSTOMER'` (or an application-level equivalent mapped to that intent). That does **not** match the frozen database design.

In `db/sql/0001_wings4u_baseline_v1_4.sql`, `cancellation_requests.request_source` is constrained to values that represent **reviewed, operational** cancellation flows (for example KDS- or chat-driven requests), not a free-form “customer app enum” that was never added to the CHECK constraint. The application was therefore attempting to persist a value the database was never meant to accept for that column, or was conceptually mixing two different product behaviors:

1. **Immediate self-service cancel** — customer cancels their own order within a short window without staff approval.
2. **Reviewed cancellation** — staff or a formal workflow (KDS, chat escalation) creates or approves a `cancellation_requests` record.

Treating both as “always create `cancellation_requests`” forced the wrong data model and caused a direct **code versus schema** mismatch.

#### Impact

- **Runtime / database:** Inserts or updates to `cancellation_requests` with an invalid `request_source` can fail at commit time against PostgreSQL, depending on the exact CHECK constraint and how Prisma maps enums. Even when errors were masked, the data model was wrong.
- **Product semantics:** Customers who only need a quick “undo” within two minutes were pushed into the same table as **pending staff review**, which is a different lifecycle (notifications, KDS queue, approve/deny).
- **Operations and reporting:** Cancellation analytics and dashboards that distinguish “customer self-cancel” vs “chat-requested cancellation” would be polluted or impossible to derive cleanly if the only path wrote the wrong source or mixed flows.
- **API consumers:** Mobile and web clients could not reliably drive UI: e.g. show “Cancel” vs “Contact support” if the backend did not expose a clear **time boundary** for self-cancel.

#### Why that was bad (beyond “it errors”)

- **Contract mismatch is worse than a missing feature:** Code that “looks done” but writes illegal or ambiguous values erodes trust in the whole backend. Fixes at one layer (Prisma only, or service only) without aligning product rules tend to recur.
- **Money and trust:** Cancellations touch order state, potential refunds, and kitchen workload. The wrong table or source conflates **instant customer intent** with **staff-mediated decisions**, which is how you get double-processing, confused staff UI, or incorrect audit trails.
- **Schema authority:** This project’s rules say SQL is canonical. Expanding the enum in the database just to accept `CUSTOMER` on `cancellation_requests` would have **locked in** the wrong model (every customer tap becomes a “request” row) unless product explicitly wanted that — which it did not for the chosen behavior.

#### Fix (product decision encoded in code)

The fix follows an explicit product rule **without** changing the baseline SQL or Prisma schema:

1. **`POST /orders/:id/cancel` is a direct self-cancel endpoint** for customers **only while** `now <= orders.cancel_allowed_until` (a **2-minute** window from placement).
2. **Inside that window:** update the **`orders`** row: set `status = CANCELLED`, set `cancelled_at`, `cancelled_by_user_id` to the customer, set `cancellation_source = 'CUSTOMER_SELF'` (this value is already allowed on `orders.cancellation_source` per the baseline CHECK), optionally set `cancellation_reason` from the body, and append an **`order_status_events`** row documenting the transition. **Do not** insert into `cancellation_requests` from this endpoint.
3. **After the window:** the same endpoint returns a **409 Conflict** (or equivalent conflict-style error) with a message directing the customer to **order chat / help**. Staff-driven or chat-escalated flows continue to create **`cancellation_requests`** with sources such as **`KDS_CHAT_REQUEST`** where the schema already allows them — unchanged by this fix.
4. **`reason` on the cancel body is optional** so a frictionless one-tap cancel in the first two minutes is not blocked by validation.

This separates **self-cancel** (order row + `CUSTOMER_SELF`) from **reviewed cancel** (`cancellation_requests` + operational sources), which matches both the schema intent and the API contract direction.

#### Solution (implementation detail)

Concrete changes applied in the codebase:

- **`packages/database`:** No migration and no `schema.prisma` edits for this issue — `orders.cancel_allowed_until` and `orders.cancellation_source` including `CUSTOMER_SELF` already exist in the baseline.
- **`checkout.service.ts`:** On successful order creation, set **`cancel_allowed_until`** to **placed time + 2 minutes** (same transaction as the order insert). Include **`cancel_allowed_until`** in the serialized checkout response so clients can show a countdown or disable “Cancel” when expired.
- **`orders.service.ts`:** Replaced the previous “create `cancellation_requests` row” path with **`customerCancel()`** that:
  - Verifies ownership and non-terminal order state.
  - Compares **`now`** to **`cancel_allowed_until`**; if expired, throws conflict with guidance to use chat/help.
  - Otherwise performs a **transaction**: update `orders` for cancellation fields and **`CUSTOMER_SELF`**, create **`order_status_events`** with appropriate `from_status` / `to_status` and actor.
- **`orders.controller.ts`:** Cancel DTO: **`reason`** is **optional** (`@IsOptional()` + `@IsString()`).
- **Serializers:** **`cancel_allowed_until`** is included on **order list summaries**, **order detail**, and **checkout** payloads so the frontend can implement “Cancel vs Help” without guessing.
- **Tests:** E2e expectations updated so a successful cancel returns **cancelled order data** and **`cancellation_source: CUSTOMER_SELF`**, and checkout responses assert **`cancel_allowed_until`** is present and in the future at creation time.

#### Verification

- TypeScript build for `apps/api` passes (`tsc --noEmit`).
- Behavior is documented in **`Docs/procedures/tasks.md`** under the dated entry for customer cancellation (Progress Entry - 2026-03-22).

#### Status

**Fixed** — Resolved by aligning application behavior with the existing schema and explicit product rules, not by widening `cancellation_requests` for ad-hoc customer enum values.
