# Builder UX Verification 2

Last updated: 2026-04-08

## Purpose

This note records the verification pass for the builder-shell follow-up work on the Wings 4 U web app.

It checks the new builder UX fix against:

- the requested implementation plan
- the claimed fix summary
- the current code in the repo
- the current web build status
- the relevant PRD context for the wings / combo builder flow

This document replaces the earlier partial assessment of the builder UX work. The current code has moved forward since that earlier note, so this file now reflects the latest verified state.

---

## Requested plan being verified

The plan being checked in this pass was:

- fix the wings/combo builder shell so there is one clear scroll story
- remove the duplicate / noisy progress labeling
- keep the sticky footer always visible
- keep the requested step order for the wings builder
- keep the shell visually consistent across builders and customization overlays
- ensure the overlay is actually above the sticky order/category bars on `/order`

The claimed fix summary being verified was:

1. add a shared `BuilderShell`
2. move all four overlay consumers onto that shell
3. replace the duplicated progress strip with a compact single-line progress indicator
4. keep the footer pinned outside the scroll region
5. clarify the wings-builder first step as pound size instead of ambiguous quantity
6. bump overlay stacking to sit safely above the `/order` sticky chrome
7. unify the shell across categories
8. keep type-check/build clean

---

## Files reviewed in this verification pass

- [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx)
- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/components/item-modal.tsx`](../../apps/web/src/components/item-modal.tsx)
- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)
- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`../Wings4U_PRD_v3_5_v24_FIXED.docx`](../Wings4U_PRD_v3_5_v24_FIXED.docx)

---

## Verification run

The current web app was compile-checked with:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
```

Result: passed on `2026-04-08`.

That means the builder shell refactor currently compiles cleanly with the rest of the app.

---

## Executive verdict

### Short answer

The builder shell fix is **mostly implemented correctly and is in much better shape now**.

The shared-shell, compact-progress, pinned-footer, and overlay-z-index work are all real and verifiable in code.

However, the fix did **not** happen perfectly in the broadest possible sense, because one claim in the summary is still too broad:

- the primary builders and overlays now use the shared shell
- but the branded `/order` flow still has a live [`legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx) path for grouped-size items

So the sentence "every category now flows through the same BuilderShell" is **not literally true for every live modal path yet**.

### Final status by area

| Area | Status | Verdict |
|---|---|---|
| Shared `BuilderShell` | Verified | Implemented correctly |
| Compact progress strip | Verified | Implemented correctly |
| Pinned footer | Verified | Implemented correctly |
| Wings step copy / pound-size clarification | Verified | Implemented correctly |
| Overlay stacking on `/order` | Verified in code | Implemented correctly |
| Primary builder/unified shell path | Verified | Implemented correctly for the main builders |
| "Everything uses one shell" claim | Not fully true | Legacy size-picker path still exists |

---

## Detailed verification

## 1. Shared component: `BuilderShell`

### Claimed fix

A new shared shell should exist in `builder-shared.tsx` and should own:

- backdrop
- panel
- header
- close button
- scrollable middle region
- sticky footer
- body scroll locking
- escape-to-close
- click-outside-to-close

### What is in code

This is present and verifiable in:

- [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx)

The `BuilderShell` component now:

- calls `useLockBodyScroll()`
- installs an `Escape` key handler with `useEffect`
- renders the shared `.item-customization-overlay`
- renders the shared `.builder-panel`
- renders the shared `.builder-panel-header`
- renders the body as `.builder-panel-body`
- renders `BuilderStickyFooter` outside the scrolling body
- closes on backdrop click
- stops propagation on panel click

### Verdict

Implemented correctly.

This part of the fix is real.

---

## 2. Phase A: layout shell and scroll story

### Claimed fix

The builder should have:

- header at the top
- one main scroll container in the middle
- footer pinned at the bottom
- no confusing split where the footer scrolls away

### What is in code

In [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css):

- `.builder-panel` is a column flex container
- `.builder-panel` has a viewport-bounded `max-height`
- `.builder-panel-body` has:
  - `flex: 1`
  - `min-height: 0`
  - `overflow-y: auto`
  - `overscroll-behavior: contain`
- `.builder-sticky-footer` has `flex-shrink: 0`

This is the correct shell structure for a pinned footer with a single main scroll region.

### What changed in component usage

The following components now render through `BuilderShell`:

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/components/item-modal.tsx`](../../apps/web/src/components/item-modal.tsx)

That means the main builder/customization flows now share one consistent scroll and footer layout instead of each maintaining separate overlay markup.

### Verdict

Implemented correctly.

---

## 3. Phase B: progress UI no longer looks like a second menu

### Claimed fix

The old duplicated-label progress UI should be replaced with a compact single-line progress indicator.

### What is in code

In [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx):

- the old split-label `ProgressIndicator` is gone from active usage
- `CompactStepProgress` now exists
- it renders:
  - `Step N of M`
  - current active label
  - completion meta like `5/8 done`

In the same file, `BuilderShell` renders:

```tsx
{steps && steps.length > 0 ? <CompactStepProgress steps={steps} /> : null}
```

inside `.builder-panel-body`, before the step content.

In [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css):

- `.builder-step-progress*` styles exist
- the progress element is `position: sticky`
- it stays visible inside the scrollable body without occupying the entire modal shell like the old larger strip

### Result relative to the reported original problem

The repeated label pattern like:

- `PREPARATION`
- `Preparation`

has been removed from the main builders.

That directly addresses the UX complaint that the top region looked like a second "category menu" instead of clean progress.

### Verdict

Implemented correctly.

---

## 4. Phase C: wings step order and copy

### Claimed fix

The wings builder should keep the requested order, but the first step should be clarified as pound size rather than ambiguous quantity.

### What is in code

In [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx), the step list is now:

1. `Pound size`
2. `Wing type`
3. `Preparation`
4. `Flavours`
5. `Saucing`
6. `Extra flavour`
7. `Suggested add-ons`
8. `Instructions`

The first step container now uses:

- title: `Pound size`
- subtitle that explicitly explains:
  - this controls flavour slots
  - the footer `+/-` is for multiple copies of the same build

That is the correct fix for the earlier "quantity" ambiguity between:

- product size / pound choice
- line-item quantity in cart

### PRD note

Relative to the original PRD, this still represents the newer preferred UX, not the literal earlier PRD order.

That is not a bug in this fix.

It simply means:

- the current implementation follows the newer builder UX preference
- not the old PRD order of wing type -> preparation -> quantity

### Verdict

Implemented correctly relative to the requested new UX.

---

## 5. Phase D: stacking and `/order` sticky bars

### Claimed fix

The overlay should sit safely above the `/order` sticky bars.

### What is in code

In [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css):

- `.item-customization-overlay` now uses `z-index: 3000`

This is comfortably above the `wk-order-sticky-stack` values that were previously discussed.

### Verdict

Implemented correctly in code.

No stacking-context bug was found in the shared overlay shell itself during this review.

---

## 6. Shared shell / category unification

### Claimed fix

The summary claimed that every category now flows through the same `BuilderShell`.

### What is true

It is true for the main builder/customization components:

- wings builder
- combo builder
- item customization overlay
- item modal

The custom banner behavior for the item customization overlay also now lives as content inside the shared shell, not as a separate shell implementation.

### What is not fully true

The live `/order` page still includes:

- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)

and it is still rendered in:

- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)

That component still uses:

- `.modal-backdrop`
- `.modal-panel`
- `.wk-modal-footer`

instead of `BuilderShell`.

So the broad claim that **every category / every path / every item-driven modal now uses the same shell** is not fully accurate yet.

### Why this matters

This is not a blocker for the builder-shell refactor itself.

But it does mean there is still one live modal path on the branded order page that has not been migrated to the shared shell system.

### Verdict

Primary unification: implemented.

Universal unification across every live modal path: not fully complete.

---

## 7. What was removed or reduced

The fix summary also implied cleanup of duplicated local overlay logic.

That claim is supported by the current component structure:

- local `useLockBodyScroll()` calls were removed from the main consumers and centralized in `BuilderShell`
- local `Escape` handlers were removed from the main consumers and centralized in `BuilderShell`
- manual shared shell markup was removed from the four primary overlay consumers

This part of the cleanup appears correct.

---

## 8. Remaining caveats

## Caveat 1: `LegacySizePickerModal` still exists in a live path

This is the biggest caveat.

If you want the statement "the whole order flow now uses one shell" to become fully true, then:

- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)

still needs to be migrated to `BuilderShell` or removed from the live flow.

## Caveat 2: older CSS still remains in the file

The old modal-related CSS is still present in [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css), because the legacy size-picker modal still depends on it.

That is consistent with Caveat 1.

## Caveat 3: source text still shows some mojibake in terminal output

During file inspection, some separator characters and comments displayed as mojibake in terminal output, for example:

- `Â·`
- `â€”`

This did **not** break the build, so it is not a structural blocker for the builder-shell fix.

But it is still worth cleaning up later if those characters are visible in the browser or if you want source text normalized.

---

## Final conclusion

## What is verified as done properly

- shared `BuilderShell`
- pinned footer outside the scroll region
- compact single-line progress indicator
- builder body as the main scroll container
- shared shell used by the four primary overlay components
- clearer wings-builder first step (`Pound size`)
- overlay z-index increased to sit above sticky `/order` chrome
- clean web build after the refactor

## What is not fully perfect yet

The fix is not perfect in the absolute sense because:

1. the live `LegacySizePickerModal` path still uses the older modal shell
2. old modal CSS remains because of that path
3. there are still some text-encoding/polish artifacts in source output

## Plain-English summary

The builder-shell fix itself worked.

The important UX problems you described:

- duplicated progress labels
- buried scroll content
- footer disappearing into the scroll
- inconsistent builder chrome

have been addressed in the main builders.

The only reason I am not calling it "perfect everywhere" is that one older grouped-size modal path on `/order` still has not been migrated to the shared shell.

So the honest outcome is:

- **yes**, the main fix is working correctly
- **no**, the "everything now uses one shell" claim is not completely true yet

That is the exact status that should be recorded in `tasks.md` and `issues.md`.

---

## Follow-Up Note - 2026-04-08

# Wings4U: What Is Left, How To Finish It, and How To Follow The PRD

## Quick Summary

### What this note is about

This note records the next follow-up after the earlier builder-shell verification.

It focuses on:

1. what is already in good shape
2. what is still not fully finished
3. how to follow the PRD without getting lost
4. the safest order to finish the remaining work

### Where the project stands right now

At this point, the wings / combo / API / saucing work is in much better shape than the ingredient-builder side.

In plain English:

- wings builder logic is mostly there
- combo builder logic is mostly there
- API/location handling for wing flavours is mostly there
- seed-driven drink and side rules are mostly there
- ingredient customization for burgers, wraps, poutines, and similar items is only partly aligned with the earlier plan

### The two recurring caveats

Two caveats keep coming back and they are still the right ones to watch:

1. **Database state**
   - much of the combo drink / side behavior depends on seeded data
   - if the DB is stale, the UI can look unfinished even when the code is correct
2. **PRD-perfect parity**
   - some flows behave correctly in logic but do not yet match the PRD literally in UI presentation

### Plain-English takeaway

The remaining work is not "start over" work.

It is mainly:

- align runtime data with the seed
- polish the last wings/combo PRD gaps
- then refactor the ingredient customization flow to match the intended layout and product rules more closely

---

## Purpose

This note explains:

1. what the repo already proves
2. what the PRD still expects
3. what should be done next
4. how to avoid confusing "implemented in code" with "finished in runtime"

This is meant to be a plain-English roadmap, not just a code inventory.

---

## How To Read This Note

If you want the shortest version, read:

- `Quick Summary`
- `Remaining work (prioritized)`
- `What done looks like`

If you want the detailed version, read from `Where things stand` through `How to finish it`.

---

## Where Things Stand

### 1. Wings / combo / API / saucing work

The repo already has a dedicated verification note for that:

- [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./wing-combo-wings-drinks-sides-saucing-and-api-fix.md)

That note already concluded that this area is **mostly implemented successfully**.

The biggest confirmed points from that verification are:

- wing flavour requests now send a valid location header
- step scaffolding is hidden by default
- combo copy is customer-facing
- drink/side/slot rules are encoded in the seed/catalog model
- saucing logic for 2-flavour and 3-flavour flows is largely PRD-aligned

### 2. Ingredient-builder work

This area is not in the same finished state.

The current customization flow works, but it does not yet match the stricter "ingredient-first vertical builder" direction word-for-word.

Right now:

- removals work
- modifiers work
- instructions work
- overlay routing works

But the exact presentation still differs from the earlier plan.

### 3. Why this distinction matters

This is the main thing that can confuse future review:

- the wings/combo builder is now mostly a **polish and parity** problem
- the ingredient builder is still partly a **layout and data-coverage** problem

That means both are "in progress," but not in the same way.

---

## What The PRD Still Expects

The authority is still:

- [`../Wings4U_PRD_v3_5_v24_FIXED.docx`](../Wings4U_PRD_v3_5_v24_FIXED.docx)

The most relevant sections for this follow-up are:

- `§4.2` ingredient removal
- `§4.6` add-ons
- `§5` wings builder
- `§5.2` saucing
- `§6` combo builder

### The practical way to follow the PRD

The best way to follow it without turning the repo into duplicate documentation is:

1. name the PRD section in the task or commit
2. copy only a few acceptance bullets into the issue note or task
3. verify code against those bullets, not just against memory

That is better than rewriting the full docx into markdown.

---

## Remaining Work (Prioritized)

## P0 - Align runtime data with the seed

### What is left

The combo drink/side behavior still depends on the database actually matching:

- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)

That includes:

- flat drink choices
- pop list expansion
- side-slot shape
- drink-slot counts
- combo lineup without a 4 lb combo

### Why this is first

If this is not done, developers and testers can easily think the builders are broken when the real problem is that the runtime data is old.

### What to do

Pick one:

1. wipe and reseed the database
2. or write a targeted data-migration/update script for existing combo rows and modifier attachments

### Plain-English takeaway

Before polishing more UI, make sure the live database is actually showing the catalog shape the UI was built against.

---

## P1 - Wings / combo PRD polish

These are smaller than the ingredient-builder work, but they still matter.

### Gap 1: saucing step for one flavour

Current reality:

- single-flavour orders do not require saucing input logically
- but the saucing section can still appear visually

PRD expectation:

- if the step does not apply, it should be hidden or skipped

### Suggested finish

In:

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)

hide or collapse the saucing `StepContainer` when `requiredFlavourCount <= 1`.

### Gap 2: 3+ flavours branching

Current reality:

- the shared saucing helper uses one branch for all counts `>= 3`

Potential PRD question:

- if the PRD distinguishes 4-flavour vs 5-flavour behavior in any future/related flow, that is not modeled separately yet

### Suggested finish

Only change this if the PRD explicitly requires separate UX/copy for those cases.

Do not add speculative branches unless the PRD actually calls for them.

### Gap 3: combo flavour count vs marketing expectations

Current reality:

- combo flavour slot counts are driven by seeded `comboMods(...)`

That is good structurally, but it still needs one product check:

- does the chosen flavour count per combo weight exactly match the PRD/business decision?

### Plain-English takeaway

This stage is mostly about making the existing wings/combo implementation match the written product rules more literally.

---

## P2 - Ingredient builder refactor

This is the largest remaining UX gap.

### What exists now

The current item customization flow already uses:

- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)

It supports:

- removable ingredients
- modifier groups
- special instructions
- shared shell

### What is still different from the earlier planned direction

The current UI is still closer to:

- removable ingredient chips
- checkbox/radio modifier groups

than to:

- one vertical ingredient list
- explicit remove controls per line
- clearer ingredient-first ordering
- a stronger distinction between removals and paid extras

### What the PRD pushes toward

For burgers, wraps, poutines, salads, and similar items, the PRD direction is:

1. default ingredients should be easy to scan line-by-line
2. removals should be obvious and visually clear
3. paid extras should be separated from removals
4. add-ons should follow `§4.6`

### Data side of the same problem

This is not just a layout issue.

Some items also still need better seed coverage for:

- extra cheese
- extra protein
- extra gravy
- extra cheese curds
- bacon / avocado / jalapeños / sauce extras

depending on the item and the actual menu intent

### Payload side

Right now, `ItemCustomizationPayload` still centers on removed ingredients, while paid extras are expected to flow through normal modifier groups.

That is acceptable unless the PRD requires a more structured payload than the current modifier model can express.

### Plain-English takeaway

The ingredient builder is not broken.

It is just not yet the cleaner, more explicit, more PRD-like customization experience that was originally described.

---

## P3 - Regression safety and proof

Once P0 through P2 are done, the work still needs proof.

### What should happen

At minimum, rerun:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
npm run build --workspace @wings4u/api
```

If possible, also run the wider CI path.

### Manual checks that should exist

One happy-path manual script should be written down for each:

1. wings builder
2. combo builder
3. ingredient customization overlay

The existing note:

- [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./wing-combo-wings-drinks-sides-saucing-and-api-fix.md)

already gives a strong starting point for the wings/combo side.

### Plain-English takeaway

Do not stop at "the code looks right."

The remaining builder work should end with at least one reproducible runtime path per surface.

---

## How To Finish It In The Safest Order

The safest order is:

1. **P0** - fix the runtime data mismatch first
2. **P1** - close the small wings/combo PRD gaps
3. **P2** - refactor the ingredient builder layout and seed coverage
4. **P3** - run proof and regression checks

### Why this order is the safest

Because if you start with the ingredient-builder refactor before fixing seed/runtime data, you can end up debugging two different classes of problems at once:

- stale catalog data
- unfinished UI logic

That is wasted effort and makes review harder.

---

## What "Done" Looks Like

This follow-up should only be called truly done when all of these are true:

### Data

- runtime DB matches the intended combo side/drink shape
- combo drink options actually appear as expected
- combo lineup matches the intended allowed weights

### Wings / combo UX

- no dead saucing step for single flavour unless the PRD explicitly wants it visible
- 2-flavour and 3-flavour saucing matches PRD wording and branching
- combo flavour-count behavior is product-confirmed

### Ingredient customization

- ingredient list reads clearly and predictably
- removals are visually obvious
- add-ons are clearly separated from removals
- relevant items have the add-on data they need

### Traceability

- the change set names the PRD sections it is implementing
- verification notes say what was actually tested

---

## Final Plain-English Summary

The repo is now beyond the stage where the main question is "does the builder system exist?"

It does.

The better question now is:

- does the runtime data match the new builder expectations?
- and does the UI match the PRD closely enough to call it complete?

The remaining work is very finishable.

The most important thing is not to mix up:

- data alignment
- PRD polish
- ingredient-builder refactor

Treat them as separate layers, finish them in order, and the rest of the builder work becomes much easier to verify honestly.

---

## Wings / Combo PRD polish and ingredient-builder alignment follow-up

Last updated: 2026-04-08

## Quick Summary

### What happened

The builders were already mostly implemented, but a final PRD-alignment pass was still missing in three places:

1. single-flavour wing and combo orders still showed a saucing step
2. the item customization overlay still presented ingredient removal as chips instead of a clearer ingredient-first list
3. burgers, wraps, poutines, and specialty fries still needed better add-on data coverage and a safer way to align already-seeded databases

### What got fixed

- the wings and combo builders now hide the saucing step unless `2+` flavours are required
- the item customization overlay now uses a clearer ingredient-row layout with visible included/removed states
- the add-on section is now explicitly rendered as `Add extras (optional)` below ingredient removal
- seed data now attaches reusable add-on groups to burgers, wraps, poutines, and specialty fries
- a new runtime sync script now exists so an already-seeded database can be aligned without needing to guess which rows are stale

### What was verified

- web build passed
- API build passed
- the seed file still parses and skips cleanly when `LON01` already exists
- the new builder sync script ran successfully against the active `LON01` database
- live DB inspection confirmed combo slot groups and new add-on groups were present after sync

---

## Purpose

This note records the follow-up pass that closed the remaining builder gaps identified after the earlier wings/combo/drinks/sides work.

The goal of this pass was not to redesign the whole ordering system again.

The goal was to:

1. close the obvious PRD mismatch for single-flavour saucing
2. make the customization overlay read more like the intended ingredient-first UX
3. align the seeded / live builder data so the UI changes could actually show up against a real database

Related tracker file:

- [`tasks.md`](../tasks.md)

Related current issue note:

- [`issues2.md`](./issues2.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `Plain-English takeaway`
- `What still matters`

If you want the implementation detail, read each section below in order.

---

## Problem that was being fixed

The earlier builder work had already solved most of the large structural problems.

But there were still three real follow-up problems left:

### 1. The saucing step still appeared when it should not

In both the wings builder and combo builder, the underlying logic already treated one-flavour orders as not needing a saucing choice.

But the UI still rendered a saucing `StepContainer`, which meant the customer could still see a step that the PRD says should be hidden and skipped.

### 2. The customization overlay still looked too generic

The existing overlay was functional, but the removal experience still looked like:

- chips for ingredients
- checkbox/radio lists for modifiers

instead of a more direct ingredient-first layout where the customer reads each ingredient line and removes it clearly.

That made the feature work, but not feel finished.

### 3. Add-on behavior still depended on database state

Even when the UI code supported add-ons properly, the live menu would not show the right add-on sections unless the database actually had the right `addon` modifier groups attached to those items.

So this was partly a UI problem and partly a runtime data-alignment problem.

---

## PRD sections used in this pass

This pass was aligned mainly against:

- `4.2` Ingredient Removal
- `4.6` Add-Ons for Wraps, Burgers, Poutines & Salads
- `5.2` Wings Builder step-by-step flow
- `6` Wing Combos Builder

### PRD details that mattered most

From the PRD:

- single-flavour wing orders should hide/skip saucing
- ingredient removal should show ingredients in a clear included/removed state
- removed ingredients should be visually greyed/struck through
- add-ons should live in a separate section below removals
- add-ons should remain optional and priced through modifier groups

This pass was designed to match those points without inventing a new checkout structure.

---

## Fix 1. Hide the dead saucing step for single-flavour orders

### Files changed

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)

### What changed

Both builders now compute:

- `showsSaucingStep = requiredFlavourCount > 1`

That value is used in two places:

1. step list generation
2. actual rendering of the `Saucing method` `StepContainer`

So now:

- `1 flavour` -> no saucing step shown
- `2+ flavours` -> saucing step shown normally

### Why this was the right fix

This is the safest possible correction because it does not change the existing multi-flavour payload logic.

It only removes a UI step that was already logically non-applicable.

### Plain-English takeaway

Customers ordering a single-flavour wings or combo item no longer see a fake extra step they do not need.

---

## Fix 2. Refactor the customization overlay into a clearer ingredient-first flow

### Files changed

- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

### What changed in the React component

The ingredient-removal section was rewritten from a chip grid into a vertical ingredient-row list.

Each ingredient row now shows:

- ingredient name
- current state text
- action text on the right

State behavior:

- included -> shows as included by default, action says `Remove`
- removed -> shows muted/struck through, action says `Add back`

This keeps the underlying `removed_ingredients` payload exactly the same while making the UI much clearer.

### What changed in CSS

The old chip-only removal styling is no longer used for the main ingredient-removal section.

New styles were added for:

- `.ingredient-toggle-list`
- `.ingredient-row`
- `.ingredient-row-copy`
- `.ingredient-row-name`
- `.ingredient-row-state`
- `.ingredient-row-toggle`
- `.ingredient-row-removed`
- `.ingredient-row-toggle-removed`

This gives the removal flow a more explicit on/off reading model without changing the backend contract.

### Why this was the right fix

It matches the PRD intent better, but stays compatible with:

- existing checkout payload shape
- existing removed-ingredient persistence
- existing KDS / order display work

### Plain-English takeaway

The customization flow now reads much more clearly to a customer. Ingredients feel like real removable parts of the item, not just decorative chips.

---

## Fix 3. Separate and strengthen the add-ons section

### Files changed

- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

### What changed

Add-on groups are now rendered in a dedicated section labelled:

- `Add extras (optional)`

This section sits below ingredient removal and above special instructions.

It uses the existing modifier-group path, so there was no need to invent a new payload type.

If multiple add-on groups exist, each group now renders its own small internal heading and rule text.

### Why this was the right fix

The PRD explicitly says add-ons should be separate from ingredient removal.

Using the current `modifier_groups / modifier_options` model keeps everything aligned with:

- pricing
- checkout
- kitchen snapshots
- KDS display

### Plain-English takeaway

Removed ingredients and paid extras are now visually separate, which is exactly how a customer expects them to work.

---

## Fix 4. Extend the seed data for burgers, wraps, poutines, and specialty fries

### File changed

- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)

### What changed

Reusable add-on groups were added for:

- `Burger Extras`
- `Wrap Extras`
- `Poutine Extras`
- `Specialty Fry Extras`

Then those groups were attached to the relevant seeded menu items.

Examples:

- burgers now get `Burger Extras`
- wraps now get `Wrap Extras`
- poutines now get `Poutine Extras`
- specialty fries now get `Specialty Fry Extras`

### Why this mattered

Before this, the UI could support add-ons, but many live items simply did not have the data attached.

This change makes the intended add-on UX exist in the seeded catalog itself.

### Plain-English takeaway

The add-on section is no longer just a UI shell. The seed now gives the matching menu items real optional extras to show.

---

## Fix 5. Add a safe runtime sync path for already-seeded databases

### Files changed

- [`../../packages/database/prisma/sync-builder-config.ts`](../../packages/database/prisma/sync-builder-config.ts)
- [`../../package.json`](../../package.json)

### What changed

A new sync script now exists:

```powershell
npm run db:builder:sync
```

That script aligns the current location data for `LON01` by:

- ensuring the expected combo side/drink group structure exists
- ensuring drink slot groups are present
- ensuring reusable add-on groups exist
- attaching those add-on groups to the relevant menu items
- updating combo rows to the intended modifier-group shape
- archiving any old `combo-4lb` row if present

### Why this mattered

The earlier issue notes already called out that seed-driven builder behavior can drift from a live database if the DB was created before the newest seed logic existed.

This script gives a deterministic way to align the current database without pretending a clean wipe is the only option.

### Plain-English takeaway

This pass did not only fix code. It also fixed the "my DB is old so the UI still looks wrong" problem.

---

## Verification

### Build verification

Ran successfully:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
npm run build --workspace @wings4u/api
```

### Script verification

Ran successfully:

```powershell
npx tsx packages/database/prisma/seed.ts
npx tsx packages/database/prisma/sync-builder-config.ts --location-code LON01
```

Seed behavior:

- the seed still parses
- if `LON01` already exists, it safely skips instead of trying to duplicate data

### Live DB verification

After the sync script ran, direct database inspection confirmed:

- combo items now carry the expected side and drink slot groups
- burgers now carry `Burger Extras`
- wraps now carry `Wrap Extras`
- poutines now carry `Poutine Extras`
- specialty fries now carry `Specialty Fry Extras`

### Source-level verification

Confirmed in code:

- one-flavour saucing step is hidden in both builders
- ingredient removal now renders as vertical ingredient rows
- add-ons render as a dedicated `Add extras (optional)` section

---

## Files Changed In This Pass

### Application code

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

### Data / runtime config

- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)
- [`../../packages/database/prisma/sync-builder-config.ts`](../../packages/database/prisma/sync-builder-config.ts)
- [`../../package.json`](../../package.json)

### Documentation updated after this pass

- [`./issues2.md`](./issues2.md)
- [`../tasks.md`](../tasks.md)
- [`./map.md`](./map.md)

---

## What Still Matters

This pass fixed the remaining gaps from that specific follow-up list.

But one older intentional UX divergence still remains:

- boneless preparation still asks for an explicit confirmation instead of doing a pure PRD-style silent auto-skip

That was left alone on purpose because it came from a separate later product request.

So the current state is:

- this follow-up issue is resolved
- the broader builder system is more aligned than before
- one earlier intentional boneless UX choice still exists outside this exact fix scope

---

## Status

Resolved.

---

## Plain-English takeaway

This pass cleaned up the last obvious builder polish problems that were still making the ordering flow feel less finished than it should.

It fixed both sides of the problem:

- the customer-facing UI
- and the database/config shape behind it

So now the builders are not only more correct in code, they are also much more likely to behave correctly against the real local catalog.

---

## Final Plain-English Summary

The main result of this pass is simple:

the wings/combo/customization flows now look and behave much closer to the PRD without introducing a new backend model or breaking the existing checkout path.

Single-flavour orders no longer show a useless saucing step.

Ingredient removal is now clearer.

Paid extras are now clearly separated.

And the database now has a real sync path so the UI does not depend on "maybe the seed ran recently" luck.

---

## Follow-up UX hardening: saucing, cart merge, scoped extras (fix)

Last updated: 2026-04-09

### Summary

This section documents the completed **Follow-up UX hardening** batch that supersedes the older single-flavour saucing wording elsewhere in this file: saucing is now a **real step** for one flavour (tossed vs on the side), cart merges preserve/backfill `image_url`, and add-on options can be scoped with `addon_match_normalized` while keeping a permissive fallback when the field is null.

### What was implemented

**1. Single-flavour saucing (wings + combo)**  
- [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx): `defaultSaucingMethodForCount`, `isSaucingMethodValidForCount`, `getSaucingOptions` validation surface.  
- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx) and [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx): `showsSaucingStep = requiredFlavourCount >= 1`, saucing init effect, validation, `resolvedSaucingMethod` in payload, distinct subtitles for 1 vs multi flavour.

**2. Cart `image_url` merge**  
- [`../../apps/web/src/lib/cart.ts`](../../apps/web/src/lib/cart.ts): `addItem` duplicate-key merge and `replaceItem` collision merge both use `image_url: item.image_url ?? incoming.image_url ?? null`.

**3. Scoped extras**  
- [`../../packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma): `ModifierOption.addonMatchNormalized` → `addon_match_normalized`.  
- Migration: [`../../packages/database/prisma/migrations/20260409143000_modifier_option_addon_match_normalized/migration.sql`](../../packages/database/prisma/migrations/20260409143000_modifier_option_addon_match_normalized/migration.sql).  
- [`../../apps/api/src/modules/catalog/catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts): serialize `addon_match_normalized` on menu modifier options.  
- [`../../apps/web/src/lib/types.ts`](../../apps/web/src/lib/types.ts): `addon_match_normalized` on `ModifierOption`.  
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx): `shouldRenderAddonOption` prefers explicit normalized match; otherwise existing heuristic.  
- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts) and [`../../packages/database/prisma/sync-builder-config.ts`](../../packages/database/prisma/sync-builder-config.ts): `scopeIngredientName` → stored normalized match for add-on options.

### Verification (reported)

- `npx prisma format --schema packages/database/prisma/schema.prisma`  
- `npx prisma generate --schema packages/database/prisma/schema.prisma`  
- `npx prisma validate --schema packages/database/prisma/schema.prisma`  
- `npm run build --workspace @wings4u/web`  
- `npm run build --workspace @wings4u/api`  
- `npm run build --workspace @wings4u/database`

### Related issue / plan note

- Requirements and plan scope: [`issues2.md`](./issues2.md) section **Follow-up UX hardening: saucing, cart merge, scoped extras** — line anchor in [`map.md`](./map.md).
