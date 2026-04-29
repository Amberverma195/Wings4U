# Wing Combo + Wings: Drinks, Sides, Saucing, and API Fix Verification

Last updated: 2026-04-08

## Quick Summary

### What this note is about

This note verifies the follow-up work for the wings and wing combo builder plan that covered:

1. the `X-Location-Id` header bug on wing flavour loading
2. hiding the customer-facing step-progress scaffolding
3. better combo-size copy
4. expanded drink options
5. combo side-slot and drink-slot business rules
6. PRD-aligned saucing behavior for 2-flavour and 3-flavour orders

### Short answer

The fix is **mostly implemented successfully**.

The core web code changes are present and the current web build passes.

### The two important caveats

1. The drink / side / combo-slot changes live in the seed data, so they will **not** appear in an already-seeded database until you reseed or run a one-off data update script.
2. The saucing logic is functionally skipped for single-flavour orders, but the saucing step is still rendered in the builder UI instead of being fully hidden. That means the behavior is close to PRD intent, but not literal PRD parity for that one detail.

### Plain-English takeaway

If you reseed the database, most of this plan should behave the way you expect.

If you do **not** reseed, the code is ready but the live combo drink / side options in your local database may still look old.

---

## Purpose

This note records:

1. what the plan asked for
2. what the code now does
3. what was verified directly
4. what still depends on database state
5. what still differs slightly from the PRD

Related tracker file:

- [`tasks.md`](../tasks.md)

Related current issue notes:

- [`issues.md`](./issues.md)
- [`issues2.md`](./issues2.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `Verification result`
- `What still matters`

If you want the detailed version, read each section from `A` through `G`.

---

## Brief Plan Summary

The requested plan had seven parts:

### A. Fix wing flavour loading

The wing flavour request needed to send a valid `X-Location-Id` header, not just a `location_id` query param.

### B. Remove visible step scaffolding

Customers should not see `Step 1 of 8` / `3/8 done` in the combo and wings builders unless that chrome is intentionally enabled.

### C. Improve combo copy

The first combo step needed customer-facing language instead of developer wording.

### D. Expand drinks

Combos needed a real flat drink list that includes water, energy drink, and named pop options.

### E. Match combo business rules

Combo size needed to control:

- side size
- number of side slots
- number of drink slots
- available combo lineup

### F. Match PRD saucing behavior

The builders needed PRD-style saucing rules for:

- 2 flavours
- 3 flavours
- extra flavour placement
- side-flavour selection

### G. Keep the implementation aligned to the PRD

The plan explicitly pointed back to the PRD wings sections, especially Section `5`, Section `5.2`, and the combo builder Section `6`.

---

## Verification Result

### Overall status

**Implemented in code:** yes  
**Build-verified:** yes  
**Type-checked at package level:** yes  
**Runtime-ready without reseed:** only partly  
**Literal PRD-perfect:** not fully

### What passed

- `npm run build --workspace @wings4u/web`
- `npx tsc --noEmit -p packages/database/tsconfig.json`

### Important verification note

The claimed proof:

- `tsc --noEmit on prisma/seed.ts`

is **not the right standalone verification command** for this repo if it is run directly against the file without the package tsconfig.

The valid package-level check is:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npx tsc --noEmit -p packages/database/tsconfig.json
```

That package-level check passed.

### Plain-English takeaway

The implementation is real. The web app compiles, the seed compiles in the database package context, and the claimed fixes are present in code.

The remaining uncertainty is mostly about **live seeded data**, not missing web code.

---

## A. Wing flavour request header fix

### What the plan expected

The wing flavour request needed to send `X-Location-Id` because the API guard requires a valid header, and the query string alone is not enough for that route.

### What the code now does

In:

- [`../../../apps/web/src/components/builder-shared.tsx`](../../../apps/web/src/components/builder-shared.tsx)

`useWingFlavours()` now:

1. reads `locationId` from `useCart()`
2. falls back to `DEFAULT_LOCATION_ID`
3. passes that value into `apiJson(..., { locationId: effectiveLocationId })`

This means the web API helper can now attach the `X-Location-Id` header properly.

### Why this matters

Without that header, wing flavours can fail to load even when the menu location UUID is correct.

That failure then breaks both:

- the wings builder
- the combo builder

because both rely on the shared flavour-loading hook.

### Verification result

Verified in code.

This part of the fix is present and correctly wired.

### Plain-English takeaway

This bug is actually fixed.

The flavour request now sends the location the way the API expects.

---

## B. Step-progress scaffolding hidden by default

### What the plan expected

Customers should not see developer-ish progress copy like:

- `Step 1 of 8`
- `3/8 done`

unless a builder explicitly chooses to show it.

### What the code now does

In:

- [`../../../apps/web/src/components/builder-shared.tsx`](../../../apps/web/src/components/builder-shared.tsx)

`BuilderShell` now has:

- `showStepProgress?: boolean`

and the default is:

- `false`

The compact progress UI only renders when `showStepProgress` is explicitly enabled.

### Why this matters

This removes a layer of scaffolding that customers do not really need.

It also makes the builder look less like a debugging or onboarding tool and more like a focused ordering flow.

### Verification result

Verified in code.

This part of the fix is present and matches the plan.

### Plain-English takeaway

The builders no longer show the step-counter strip by default.

That part is done.

---

## C. Combo size copy

### What the plan expected

The first combo-builder step needed customer-facing language instead of internal developer wording.

### What the code now does

In:

- [`../../../apps/web/src/components/combo-builder.tsx`](../../../apps/web/src/components/combo-builder.tsx)

the first-step subtitle now says:

- `Choose your combo size (pounds).`

### Why this matters

This is clearer for customers and matches how the combo flow is actually being used.

The old wording sounded like internal implementation language.

### Verification result

Verified in code.

This part of the fix is present.

### Plain-English takeaway

This is a small change, but it is correct and done.

---

## D. Drinks: water, energy drink, and named pop options

### What the plan expected

Combo drink selection needed to support a proper list of actual choices, not just a generic placeholder like `Pop`.

The requested direction was:

- Water
- Energy
- named pop options like Pepsi, Diet Pepsi, Coke, Coke Zero, Mountain Dew, and similar

### What the code now does

In:

- [`../../../packages/database/prisma/seed.ts`](../../../packages/database/prisma/seed.ts)

the seed now defines:

- `POP_OPTIONS`
- `COMBO_DRINK_OPTIONS`

The combined combo drink list includes:

- Water
- Energy Drink
- Pepsi
- Diet Pepsi
- Pepsi Zero
- Coke
- Diet Coke
- Coke Zero
- Mountain Dew
- Diet Mountain Dew

The seed also creates multiple drink groups:

- `Drink 1`
- `Drink 2`
- `Drink 3`
- `Drink 4`
- `Drink 5`

That structure matters because the existing `menu_item_modifier_groups` join model does not let the same modifier group be attached multiple times to one menu item.

### Why this matters

This means the combo builder can stay data-driven.

The UI does not need a hacky hard-coded second drink screen if the database already provides the right number of drink slots.

### Verification result

Verified in seed/code.

The data model change is present.

### Important caveat

This part of the fix only takes effect after a reseed or equivalent data update.

The seed still has the existing guard:

- if `LON01` already exists, seeding is skipped

So if your current database already has `LON01`, the new drink groups will not appear until you either:

1. wipe and reseed
2. or write a one-off migration/data script

### Plain-English takeaway

The drink expansion is implemented correctly, but it is a **data change**, not just a UI change.

If the DB is not refreshed, the old drink setup will still be what you see at runtime.

---

## E. Combo weight → side size and drink-slot counts

### What the plan expected

The combo builder needed to follow the requested size rules:

| Combo size | Side shape | Drink count |
|---|---|---|
| 1 lb | 1 small side | 1 drink |
| 1.5 lb | 1 large side | 1 drink |
| 2 lb | 1 large side | 2 drinks |
| 3 lb | 2 large sides | 3 drinks |
| 5 lb | 2 large sides | 5 drinks |

And `4 lb` needed to stay out of combos.

### What the code now does

In:

- [`../../../packages/database/prisma/seed.ts`](../../../packages/database/prisma/seed.ts)

the seed now creates:

- `Small Side`
- `Large Side 1`
- `Large Side 2`

and the combo lineup is now seeded as:

- `1 Pound Combo` → `1 small side + 1 pop`
- `1.5 Pound Combo` → `1 large side + 1 pop`
- `2 Pound Combo` → `1 large side + 2 pops`
- `3 Pound Combo` → `2 large sides + 3 pops`
- `5 Pound Combo` → `2 large sides + 5 pops`

There is no `4 Pound Combo` in that combo lineup.

### How the builder uses this

The combo builder continues to drive the UI from the catalog:

- side groups come from `context_key === "side"`
- drink groups come from `context_key === "drink"`

So once the seeded combo SKUs expose the correct modifier-group shape, the builder already knows how many side and drink selections are required.

### Verification result

Verified in seed/code.

The business rules are represented in the seeded combo catalog shape.

### Important caveat

This is another reseed-dependent change.

If your local or remote database still has the older combo modifier-group layout, the builder UI will continue to reflect the old data until the DB is refreshed.

### Plain-English takeaway

The combo slot rules are implemented the right way: in the data model, not just in frontend guessing.

But that also means the DB has to be updated before you see the new behavior live.

---

## F. Saucing behavior vs PRD Section 5 / 5.2

### What the PRD says

From the PRD:

- Section `5` defines the wings builder flow
- Section `5.2` defines the saucing rules
- Section `6` says the combo builder should reuse the same flavour and saucing logic where applicable

The PRD specifically calls for:

#### For 2 flavours

- `Half & Half` as the default
- `Mixed Together`
- `Sauce on the Side`
- a sub-question for which flavour is on the side

#### For 3 flavours

- `Two Mixed + One on the Side` as the default
- `Split Evenly`
- `All Mixed Together`
- a sub-question for which flavour is on the side when needed

#### For extra flavour

- `+$1.00`
- same flavour-picking pattern
- placement choice: on wings or on the side

### What the code now does

In:

- [`../../../apps/web/src/components/builder-shared.tsx`](../../../apps/web/src/components/builder-shared.tsx)
- [`../../../apps/web/src/components/wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)
- [`../../../apps/web/src/components/combo-builder.tsx`](../../../apps/web/src/components/combo-builder.tsx)
- [`../../../apps/web/src/lib/types.ts`](../../../apps/web/src/lib/types.ts)

the builder flow now includes:

- `defaultSaucingMethodFor(...)`
- `methodRequiresSideFlavourPick(...)`
- PRD vocabulary inside the shared saucing options
- a real side-flavour sub-question using the actual chosen flavour names
- `side_flavour_slot_no` in the builder payload for kitchen clarity

For `2` flavours, the shared saucing options are now:

- `Half and half`
- `Mixed together`
- `Sauce on the side`

For `3` flavours, the shared saucing options are now:

- `Two mixed + one on the side`
- `Split evenly (1/3 + 1/3 + 1/3)`
- `All mixed together`

Both builders now:

1. default the saucing method when the required flavour count changes
2. require a side-flavour choice when the chosen method needs one
3. clear stale side-flavour choices if the method changes
4. persist `side_flavour_slot_no` in the payload

### What is correct here

This is the strongest part of the fix.

The shared saucing logic is clearly aligned to the PRD vocabulary and branching model for:

- 2 flavours
- 3 flavours
- extra flavour placement

### One real caveat

The PRD says saucing should be:

- `Hidden and skipped for single-flavour orders`

The current builders do the **skip** part in logic:

- if only 1 flavour is required, completion is treated as satisfied
- no saucing method is required
- the default method is cleared to `null`

But the current step container is still rendered in the UI.

So the current behavior is:

- functionally skipped
- not visually hidden

That is close, but not literal PRD parity.

### Verification result

Verified in code with one caveat.

The new saucing logic is implemented and largely PRD-aligned, but the single-flavour visual step-hiding detail is still incomplete.

### Plain-English takeaway

The hard part of the saucing work is done.

The one remaining mismatch is mostly presentation:

single-flavour orders still show a saucing section even though the builder logic no longer requires it.

---

## G. PRD alignment summary

### What matches well

These areas now match the PRD direction well:

- 2-flavour saucing choices
- 3-flavour saucing choices
- side-flavour sub-question
- extra flavour placement
- combo step wording
- combo side/drink slot modeling through the catalog

### What matches in spirit but not perfectly

These areas are close, but not perfect:

1. Single-flavour saucing is skipped logically, but not hidden visually.
2. The combo-side and drink behavior depends on fresh seeded data, so a stale DB can make the feature look unfinished even when the code is correct.

### Plain-English takeaway

The implementation is genuinely aligned to the PRD in the important places.

The remaining gaps are not major architecture failures. They are:

- one UI-visibility detail
- one reseed dependency

---

## Files Verified In This Pass

### Web builder code

- [`../../../apps/web/src/components/builder-shared.tsx`](../../../apps/web/src/components/builder-shared.tsx)
- [`../../../apps/web/src/components/wings-builder.tsx`](../../../apps/web/src/components/wings-builder.tsx)
- [`../../../apps/web/src/components/combo-builder.tsx`](../../../apps/web/src/components/combo-builder.tsx)
- [`../../../apps/web/src/lib/types.ts`](../../../apps/web/src/lib/types.ts)

### Seed / catalog data

- [`../../../packages/database/prisma/seed.ts`](../../../packages/database/prisma/seed.ts)

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

### Runtime follow-through still required

To actually see the new drink groups and combo slot counts in a running environment, you still need one of these:

1. wipe and reseed the database
2. or run a one-off script that updates existing combo modifier-group attachments and drink groups

### One optional follow-up for stricter PRD parity

If you want exact PRD behavior, the next small follow-up should be:

- hide the saucing step entirely when only one flavour is required

That is not a blocker for the underlying logic, but it would make the UI match the PRD text more literally.

---

## Final Plain-English Summary

This plan was implemented well overall.

The API-header fix is real, the builder scaffolding is hidden, the combo copy is improved, the new saucing logic is in place, and the combo drink / side rules have been encoded into the seed/catalog model.

The only two things you should keep in mind are:

1. the new combo drink / side behavior depends on reseeding or updating the DB
2. single-flavour orders still show a saucing section even though the builder logic already treats saucing as skipped

Link back to tracker:

- [`tasks.md`](../tasks.md)
