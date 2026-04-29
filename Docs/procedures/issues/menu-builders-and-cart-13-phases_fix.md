# Menu, Builders, and Cart - 13 Phases Fix

Last updated: 2026-04-09

Menu, builders, and cart — implementation plan

This plan ties your requirements to concrete code locations and calls out where the PRD ([Docs/Wings4U_PRD_v3_5_v24_FIXED.docx](d:\Projects\Websites\Wings4U\Code\Docs\Wings4U_PRD_v3_5_v24_FIXED.docx)) should drive acceptance criteria—especially for cart, checkout, and line-item display. When implementing, open the PRD sections on cart summary, taxes, fees, and line modifiers (often under ordering/checkout chapters) and copy 3–5 bullets into the task so review stays traceable.



Current anchors (verified in repo)







Area



Primary files





Wings / combo shell + validation



[apps/web/src/components/builder-shared.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx), [wings-builder.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\wings-builder.tsx), [combo-builder.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\combo-builder.tsx)





Flavours API + seed



[useWingFlavours](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx), [packages/database/prisma/seed.ts](d:\Projects\Websites\Wings4U\Code\packages\database\prisma\seed.ts) (WING_FLAVOURS — currently one DRY_RUB: Cajun)





Menu grid + add to cart



[apps/web/src/Wings4u/components/menu-page.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\components\menu-page.tsx), [menu-display.ts](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\menu-display.ts)





Customization overlay



[item-customization-overlay.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\item-customization-overlay.tsx)





Routing (builder vs quick add)



[menu-item-customization.ts](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\menu-item-customization.ts)





Cart state



[cart.ts](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\cart.ts) (addItem, removeItem, updateQuantity — no updateLine / edit payload yet)





Cart UI (minimal today)



[apps/web/src/Wings4u/components/cart-page.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\components\cart-page.tsx)



Phase 1 — Mandatory fields: banner, scroll, and submit behavior

Goal: If the user activates Add to cart while validation fails, show a red banner at the top of the modal (e.g. “Please fill all required fields”) and scroll to the first invalid step (you already have scrollToStep / invalidStepId patterns in wings/combo).

Work:





Extend [BuilderShell](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx) with optional validationBanner / onSubmitAttempt props, or handle entirely inside each builder by wrapping onSubmit so the first failed validate sets banner state + scroll.



Ensure the primary button is not misleading: either keep it disabled until valid and onClick still runs a “attempt submit” path that shows the banner, or keep it enabled and treat click as “validate + scroll + banner” (product choice—document in PRD checklist).

PRD: Match whatever the PRD says about error surfacing and required fields for configurable items (often adjacent to wings §5).



Phase 2 — Dry rubs: why only one shows, and how to get ~18

Root cause in seed: [WING_FLAVOURS](d:\Projects\Websites\Wings4U\Code\packages\database\prisma\seed.ts) lists one entry with heat: "DRY_RUB" (Cajun). The UI groups by heat_level; all dry-rub SKUs must exist as separate WingFlavour rows with heatLevel: DRY_RUB.

Work:





Add the remaining dry rubs to WING_FLAVOURS (names/slugs from PRD or menu source of truth).



Reseed or migrate DB so [getWingFlavours](d:\Projects\Websites\Wings4U\Code\apps\api\src\modules\catalog\catalog.service.ts) returns the full set.



Confirm [FlavourPicker](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx) lists all under the Dry Rubs heat tab (no accidental filter).

PRD / menu: Use the same list as the official menu doc so counts match “70+ sauces and dry rubs.”



Phase 3 — Flavours: no implicit “Plain”; saucing copy

Problems:





[FlavourPicker](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx) uses internal activeHeat defaulting toward first group; users can perceive Plain as pre-selected.



Saucing step can show meaningful labels only when flavour names exist; empty slots should read “Please select a flavour” instead of implying a default.

Work:





Do not auto-select the first flavour pill; keep selectedFlavourId === "" until user taps a flavour (adjust activeHeat / default tab logic so it does not imply a selection).



For saucing [SaucingMethodPicker](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\builder-shared.tsx), pass display names that show placeholder text when a slot is empty (e.g. “Flavour 1 — not selected”).



Align validation so “flavours incomplete” blocks submit with the Phase 1 banner.

PRD: §5 / §5.2 (explicit flavour choice before saucing).



Phase 4 — Copy tweak: special instructions (wings builder)

Goal: Remove the subtitle like “Optional notes for the kitchen” from the instructions StepContainer in [wings-builder.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\wings-builder.tsx) (or replace with minimal neutral text per PRD).



Phase 5 — Party specials / “Wings for you” / wrong card metadata

Symptoms:





Party specials (e.g. 75 / 100 rings) show wrong pound/flavour summary — likely display logic in [menu-display.ts](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\menu-display.ts) (summarizeSizeGroup, descriptions) or catalog modifier_groups / builder_type on those items.



“Wings for you special” quick-adds without builder — because [canQuickAddMenuItem](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\menu-item-customization.ts) is true when there are no modifiers / no requires_special_instructions.

Work:





For each affected MenuItem in seed/API: set builder_type: "WINGS" (or open customization) and ensure weight / flavour modifier groups match the product.



Adjust display strings for party-special rows so description lines match the real SKU (fix summarizeSizeGroup or item naming in seed).



Optionally add shouldAlwaysOpenOverlay rules by slug for specials that must never quick-add.

PRD: §5 and any party / catering section that defines those SKUs.



Phase 6 — Ingredient removal: checkbox only

Goal: Replace chip toggle UX with a checkbox per removable ingredient (checked = on the item, unchecked = removed), with strikethrough on removed—per your spec.

Work: Refactor the “Ingredient removal” block in [item-customization-overlay.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\item-customization-overlay.tsx) to <label><input type="checkbox" /> …</label>; map checked state to not in removedIngredientIds (invert logic clearly to avoid bugs).

PRD: §4.2 (removals) if that is where removals are defined.



Phase 7 — “Add extras” scoped to this item’s ingredients

Goal: For poutines, wraps, etc., extras should only list ingredients that belong to that dish (e.g. curds, gravy, bacon for a poutine), not the entire global add-on catalog.

Work:





Data model: Either tag modifier options with linked_ingredient_id / context_key: "extra_for_ingredient" + metadata, or maintain separate modifier groups per menu item in seed that only list allowed extras.



UI: Filter addonGroups (or new group) so options are a subset of removable_ingredients + priced extras defined for that SKU.

PRD: §4.6 (add-on rules) — use it to define min/max and grouping.



Phase 8 — Wraps: “Add side & pop…” as category notice, not a card

Goal: Move the upsell item currently appearing as a normal card into copy under the Wraps category title (reuse pattern [categoryNoteForSlug](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\components\menu-page.tsx) for wraps, or hide that SKU from the grid and show the note only).

Work: Identify the menu item slug (e.g. wrap-side-add) in seed; in [buildDisplayMenuCategories](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\menu-display.ts) or menu-page, exclude it from cards and inject a categoryNoteForSlug("wraps") string.



Phase 9 — Tenders: force drink / side / dip selection

Goal: Add-to-cart must open a builder when the item includes dip/side/drink modifiers—extend [shouldAlwaysOpenOverlay](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\menu-item-customization.ts) / catalog flags so tenders combos are never canQuickAddMenuItem.

Work: Seed requires_special_instructions and full modifier_groups for tender combos; verify [ItemCustomizationOverlay](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\item-customization-overlay.tsx) shows all groups.



Phase 10 — Pop: drill-down + 6-pack + brand groupings

Goal:





Clicking Pop opens a second step (nested modal or route) listing PepsiCo / Coke / Dew (or similar) with checkboxes and per-SKU quantity (+/-).



Add 6-pack line at $7.00 (placeholder price; adjust later).

Work:





Model: either a parent drink item that opens [ItemModal](d:\Projects\Websites\Wings4U\Code\apps\web\src\components\item-modal.tsx) variant, or dedicated DrinkBuilder component.



Cart line: may need multiple sub-lines or one line with modifier_selections encoding counts—may require cart line schema extension if you need multiple of same pop SKU on one card.

PRD: Drinks section + any multi-select beverage rules.



Phase 11 — Menu cards: +/- and quantity in cart on the card

Goal: On each menu card row, add − / + and show quantity already in cart for that configuration; widen the CTA row.

Work: In [menu-page.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\components\menu-page.tsx) card renderer, call updateQuantity / addItem with dedupe logic (same as existing cartCountForDisplayItem but per line key if multiple configs). May require increment without reopening builder for simple items only.

PRD: If silent on inline qty, treat as UX standard; align spacing with global design tokens.



Phase 12 — Full cart page (industry-standard layout)

Goal: Replace the minimal [cart-page.tsx](d:\Projects\Websites\Wings4U\Code\apps\web\src\Wings4u\components\cart-page.tsx) with:





Line list: image (right or left per design), title, short description / modifier summary, unit price, line total, Edit (reopen builder with same payload—needs store full CartItem or fetch menu item by id).



Quantity controls per line (wire to [updateQuantity](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\cart.ts)).



Subtotal, taxes (placeholder % or fixed for now—label as estimate), delivery fee $5.00 when fulfillment is delivery (read [useCart](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\cart.ts) fulfillmentType).



Checkout CTA.

Data gaps:





Images: use MenuItem.image_url if you add it to cart at add time, or resolve by menu_item_id from a small client cache of last menu load.

PRD: This is the main place to quote PRD verbatim for cart/checkout: line item detail, tax disclosure, fees, editability. If PRD has a cart wireframe section, mirror section order (items → fees → taxes → total).



Phase 13 — Cross-cutting: edit line in cart

Goal: “Edit” reopens the correct builder with pre-filled state.

Work: Persist enough in [CartItem](d:\Projects\Websites\Wings4U\Code\apps\web\src\lib\types.ts) (already has modifier_selections, builder_payload, removed_ingredients) and plumb initial state into WingsBuilder / ComboBuilder / overlays (new props or dedicated “edit mode”). This is non-trivial; schedule after cart list UI.



Dependency order (recommended)

flowchart LR
  P1[Phase1_validation_banner]
  P2[Phase2_dry_rub_seed]
  P3[Phase3_flavour_defaults]
  P5[Phase5_specials_routing]
  P6[Phase6_checkbox_removal]
  P12[Phase12_cart_page]
  P1 --> P12
  P2 --> P3
  P6 --> P12
  P12 --> P13[Phase13_edit_line]





Phases 2–3 (data + picker) unblock flavour/saucing complaints.



1 + 4 quick UX wins on builders.



5 fixes specials routing/display.



6–9 customization and category chrome.



10–11 drinks and menu cards.



12 cart (large); 13 edit depends on 12.



Risks





Cart edit and multi-pop quantities may require schema or line identity changes beyond current CartItem.



Taxes should be labeled estimate until a real tax engine exists.


The exact completion wording provided for this plan is preserved below.

---

## Exact Fix Wording

```text
these are the phases that were done - 'All three builders accept the prop. Phase 13 — and with it all 13 phases — is complete.

All 13 phases done:

Validation feedback (banner + scroll-into-view on submit)
Dry rub seed data
Flavour picker default cleanup + saucing copy
Removed special-instructions subtitle
Party specials routing + display fix
Checkbox-only ingredient removal
Scoped per-item extras
Wraps/burgers category notice instead of cards (menu-display.ts + categoryNoteForSlug)
Tenders force builder open (free dip slot in seed.ts)
Pop drill-down + 6-pack (seed.ts — 6 slot groups + new menu item)
Menu card inline +/- controls (menu-page.tsx renderCard + findLatestCartLineForDisplayItem)
Full cart page (cart-page.tsx — quote fetching, summaries, qty/remove)
Edit line in cart — round trip:
cart-page.tsx:91 exports CART_EDIT_STORAGE_KEY; Edit button stashes line key + routes back to /order
cart.ts replaceItem merges/repositions
All three builders (wings-builder.tsx, combo-builder.tsx, item-customization-overlay.tsx) accept editingLine, hydrate state from it, and call replaceItem instead of addItem when editing
menu-page.tsx:963-992 reads sessionStorage on menu mount, opens the matching builder pre-filled, passes editingLine to each builder branch, and clears editingLine on close'
```

---

## Plain-English Summary

This fix note means the full 13-phase plan was marked as completed.

The completion statement covers:

- menu behavior
- wings and combo builders
- item customization behavior
- ingredient removal behavior
- category notice behavior
- drink / pop builder behavior
- cart-page behavior
- edit-line round-trip behavior

---

## What This File Is For

Use this file when you want the exact completion wording for this plan without mixing it into older issue-note chains.

This file is the dedicated fix-side record for this plan.

---

## Final Follow-Up That Closed The Remaining Leftovers

After the main 13-phase note was marked complete, there was still one final cleanup pass to land.

This follow-up did not reopen the full 13-phase plan.

Instead, it closed the last smaller items that were still left over:

- cart line images
- single-flavour saucing PRD verification
- safer item-scoped extras
- removal of the dead `Suggested add-ons` placeholder in the Wings builder
- live database alignment without forcing a destructive reseed

### What Was Implemented

#### Cart Line Images

Cart rows now show a thumbnail when the line has an image URL, and a consistent placeholder when it does not.

The main rendering change was made in:

- [`cart-page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/cart-page.tsx)

Supporting cart-row thumbnail styles were added in:

- [`styles.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/styles.ts)

To make that work reliably, `image_url` is now preserved on cart lines through the relevant add-to-cart flows in:

- [`types.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/lib/types.ts)
- [`wings-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/combo-builder.tsx)
- [`item-customization-overlay.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/item-customization-overlay.tsx)
- [`item-modal.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/item-modal.tsx)
- [`legacy-size-picker-modal.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/legacy-size-picker-modal.tsx)
- [`menu-client.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/menu/menu-client.tsx)
- [`menu-page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/menu-page.tsx)
- [`wing-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/wing-builder.tsx)

In plain English: the cart no longer drops the visual identity of an item after it is added.

#### Single-Flavour Saucing

This item was checked against the PRD before changing any builder logic.

Result:

- no new single-flavour saucing step was added

Reason:

- the PRD says single-flavour orders should hide and skip the saucing step

So the existing logic in:

- [`wings-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/combo-builder.tsx)

was already the correct behavior for this case.

This is important because the follow-up was resolved by PRD verification, not by adding more UI.

#### Scoped Extras Hardening

The customization overlay no longer relies on token matching to guess which addon options belong to an item.

The filtering logic was simplified in:

- [`item-customization-overlay.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/item-customization-overlay.tsx)

Now the overlay trusts item-level addon groups directly from the catalog data.

To support that properly:

- fresh seed setup was updated in [`seed.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts)
- the live database sync path was updated in [`sync-builder-config.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/sync-builder-config.ts)

That means burgers, wraps, poutines, and specialty fries can now carry their own explicit addon groups instead of inheriting a broad category-level group and then being filtered by string heuristics.

#### Wings Builder Placeholder Cleanup

The non-functional `Suggested add-ons` step was removed from:

- [`wings-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-builder.tsx)

This matters because the step looked like a real builder stage but did not actually let the customer do anything useful.

So the builder now avoids suggesting a feature that is not really wired.

#### Live Database Alignment

The correct runtime action for the current database was not a full reseed.

Why:

- [`seed.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts) intentionally skips when `LON01` already exists

So for the existing database, the correct action was:

- run [`sync-builder-config.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/sync-builder-config.ts)

That sync was executed through:

- [`package.json`](/d:/Projects/Websites/Wings4U/Code/package.json)

using:

```powershell
npm run db:builder:sync
```

This aligned the current `LON01` builder configuration without wiping the database.

### Verification

The follow-up was verified with:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
npm run db:builder:sync
```

Result:

- web build passed
- builder sync passed for `LON01`

### Plain-English Summary

This final follow-up closed the smaller leftovers after the 13-phase pass.

What actually changed in plain English:

- the cart now shows images properly
- the team now has a PRD-confirmed answer on single-flavour saucing
- extras are now scoped in a safer, more maintainable way
- the fake Wings add-on placeholder is gone
- the current Postgres data was aligned using the safe sync path instead of a destructive reseed

So this section is the real "final polish and data-alignment" closeout for the 13-phase work.
