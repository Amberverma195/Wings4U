# Legacy Shell Follow-Up and Local API Error Clarification

Last updated: 2026-04-09

## Quick Summary

### What happened

Two separate local-development issues were active at the same time:

1. one last popup on the branded `/order` flow was still using the old modal shell instead of the shared `BuilderShell`
2. the web app was showing a vague local API error:
   - `API returned non-JSON (500 Internal Server Error): Internal Server Error`

### What got fixed

- the last live grouped-size popup on `/order` was moved onto `BuilderShell`
- the dead CSS for the old popup shell was removed
- the API client error message was improved so it explains the likely local cause more clearly

### What still matters at runtime

Even with the message fix, the web app still needs the API process to be running.

If `npm run dev:api` is not running, the web app cannot load live menu/order data.

---

## Purpose

This note explains:

1. what the actual problems were
2. why they mattered
3. what was changed
4. what was verified
5. what still depends on your local environment

This is the current detailed note for this round of work.

Related tracker file:

- [`tasks.md`](../tasks.md)

Archived previous verification note:

- [`fixed issues2.md`](./fixed%20issues2.md)

---

## How To Read This Note

If you want the short version, read:

- `Quick Summary`
- `Plain-English takeaway` under each issue
- `What you still need to do`

If you want the detailed version, read each issue top to bottom.

---

## Issue 1. The branded `/order` flow still had one live modal path outside `BuilderShell`

### Problem in plain English

Most of the new ordering popups were already using the shared builder shell.

But one popup on the branded `/order` page was still using the old modal system.

So the app was almost fully unified, but not completely.

### The exact technical path

The remaining old path was:

- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)

It was still triggered from:

- [`../../apps/web/src/Wings4u/components/menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)

through the `legacyPickerGroup` state path for grouped-size items.

### Why this mattered

This meant the sentence:

- "everything now uses one shell"

was not literally true yet.

The app still had:

- the shared `BuilderShell` for the main builders
- one remaining older modal shell for grouped-size items

That caused inconsistency in:

- overlay appearance
- future styling changes
- shell-level behavior maintenance
- documentation accuracy

### Fix implemented

Changed file:

- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)

The grouped-size modal now renders through `BuilderShell`.

### What changed

1. the old custom backdrop/panel/footer markup was removed
2. size selection now renders as a normal `builder-step-card`
3. special instructions now render as a normal `builder-step-card`
4. quantity and submit controls now come from the shared sticky footer
5. the grouped-size path now gets the same shared shell behavior as the other live builders:
   - close button
   - escape-to-close
   - click-outside-to-close
   - body scroll locking
   - pinned footer
   - shared panel styling

### CSS cleanup after the migration

Because the old grouped-size shell is no longer live, the dead legacy modal-only CSS was removed from:

- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

Removed blocks:

- `.modal-backdrop`
- `.modal-panel`
- `.modifier-group`
- `.modifier-option`
- `.wk-modal-footer`

### Result

The live modal/customization flows now use `BuilderShell` for:

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/components/item-modal.tsx`](../../apps/web/src/components/item-modal.tsx)
- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)

### Verification

Verified by code inspection and with:

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
```

Result: passed.

### Status

Resolved.

### Plain-English takeaway

The last old popup in the live order flow is gone.

The branded `/order` page now follows the same shared shell system as the rest of the builder/customization flow.

---

## Issue 2. `API returned non-JSON (500 Internal Server Error): Internal Server Error`

### Problem in plain English

The web app was showing a technically correct error, but not a useful one.

It told you:

- the response was not JSON
- and the proxy returned `Internal Server Error`

But it did not tell you the most likely local reason.

### Relevant code path

- [`../../apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)

Previously this produced a message like:

- `API returned non-JSON (500 Internal Server Error): Internal Server Error`

### What the actual reason was here

During this verification pass:

- the web app on `127.0.0.1:3000` was reachable
- the API on `127.0.0.1:3001` was not reachable

That means the Next dev proxy returned an internal error page instead of valid API JSON.

### How that was confirmed

Local probing showed:

- `http://127.0.0.1:3001/api/v1/health` -> unreachable
- `http://127.0.0.1:3001/api/v1/menu?...` -> unreachable
- `http://127.0.0.1:3000/api/v1/menu?...` -> `Internal Server Error`

### Important clarification

This current failure is **not** the old wrong-location-id issue.

Your current [`../../apps/web/.env.local`](../../apps/web/.env.local) already contains the correct active `LON01` UUID:

- `96bbec89-750a-4e22-84a9-93b8dc94a335`

So the actual reason for the current error is most likely:

- the API process is not running
- or the web app is still using an old runtime after local environment changes

### Fix implemented in code

Changed file:

- [`../../apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)

The client now gives clearer messages in two cases:

1. when the request fails before any response comes back
2. when the app gets a plain `Internal Server Error` body instead of JSON through the Next proxy

### What the new message now tells the developer

The improved message now points toward the real likely local causes:

- local API process not running
- Next dev server needs restart after `apps/web/.env.local` changes
- `NEXT_PUBLIC_DEFAULT_LOCATION_ID` should still be checked against active `LON01`

### What this does not change

This improves the message.

It does **not** remove the need to actually run the API.

If the API process is down, the menu/order pages still cannot work until you start it.

### What you still need to do

From:

- `d:\Projects\Websites\Wings4U\Code`

run:

```powershell
npm run dev:api
```

and if you changed `apps/web/.env.local`, restart:

```powershell
npm run dev:web
```

### Status

Reason identified and error message improved in code.

### Plain-English takeaway

The message is better now, but the real fix in day-to-day development is still:

- keep the API running
- restart Next when public env values change

---

## Files Changed In This Pass

- [`../../apps/web/src/components/legacy-size-picker-modal.tsx`](../../apps/web/src/components/legacy-size-picker-modal.tsx)
- [`../../apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

Documentation updated in this pass:

- [`../tasks.md`](../tasks.md)
- [`./issues.md`](./issues.md)
- [`./fixed issues2.md`](./fixed%20issues2.md)

---

## Verification Summary

### Code verification

- the last live grouped-size modal path now uses `BuilderShell`
- the old grouped-size shell markup is gone
- the dead legacy modal CSS blocks were removed
- the API client now throws clearer local-dev diagnostics for unreachable/non-JSON API failures

### Build verification

```powershell
cd d:\Projects\Websites\Wings4U\Code
npm run build --workspace @wings4u/web
```

Result: passed on `2026-04-08`.

---

## What You Should Remember

If you only remember three things from this note, they should be these:

1. the remaining live shell inconsistency on `/order` is now fixed
2. the non-JSON 500 error was mainly a local API availability problem, not a bad location UUID
3. better error text helps, but it does not replace running `npm run dev:api`

---

## Link Back To Tracker

For the matching tracker entry, see:

- [`tasks.md`](../tasks.md)

---

## Final Plain-English Summary

This pass fixed two annoying local problems:

1. one last popup on `/order` was still using the old modal shell, and that has now been moved onto the shared builder shell
2. the vague local API error message has now been rewritten so it points you toward the real likely cause faster

So the overall result is:

- the order flow shell is more consistent now
- the local error is easier to understand now

But the runtime rule is still simple:

if the API is not running, the web app cannot load live order/menu data.

---

## Issue 3. Wings / combo PRD follow-up and ingredient-builder alignment gaps

### Problem in plain English

After the earlier wings/combo/drinks/sides work, the builder system was in a much better place, but it still had three visible gaps:

1. single-flavour wing and combo orders still showed a saucing step even though the logic already treated saucing as not applicable
2. the item customization overlay still looked more like a generic chip-and-checkbox modal than the clearer ingredient-first flow described in the PRD
3. some of the add-on behavior depended on seed data that was not actually attached to the live items yet, so the UI could only show the PRD add-on section if the database happened to match the latest seed assumptions

So the system was mostly working, but not yet fully aligned with the intended customer flow.

### Where this was visible

The main code paths were:

- [`../../apps/web/src/components/wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`../../apps/web/src/components/combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`../../apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css)

The runtime data dependency was mainly here:

- [`../../packages/database/prisma/seed.ts`](../../packages/database/prisma/seed.ts)

### Why this mattered

This mattered for two different reasons.

#### 1. PRD accuracy

The PRD says:

- single-flavour saucing should be hidden and skipped
- ingredient removal should be shown as a clearer ingredient-first flow
- paid extras should sit in a separate add-on section below ingredient removal

So even though the code already worked functionally in many places, the customer-facing builder experience was still not a literal match.

#### 2. Runtime trust

Even when UI code is correct, the customer experience can still be wrong if the live seeded data does not provide the expected groups.

That meant developers could end up in this confusing state:

- code looks implemented
- build passes
- but the live menu does not actually show the expected extras / sides / drinks because the DB rows are old

### PRD sections that mattered here

This follow-up was tied mainly to:

- `4.2` Ingredient Removal
- `4.6` Add-Ons for Wraps, Burgers, Poutines & Salads
- `5.2` Wings Builder step-by-step flow
- `6` Wing Combos Builder

### What the concrete gaps were

#### Gap A. Saucing step still rendered for one-flavour orders

In both builders, the validation logic already treated one-flavour orders as not needing a saucing choice.

But the actual `StepContainer` for saucing still rendered, which created a dead step in the UI.

That made the customer experience feel unfinished:

- the step appeared
- but it was not really needed
- and the PRD explicitly says it should be hidden/skipped

#### Gap B. Ingredient removal UI was still chip-first

The customization overlay supported removals, but the visual model was still:

- removable ingredient chips
- then separate modifier lists

instead of a more obvious ingredient-first list where every ingredient reads as a line item the customer can remove.

So the logic worked, but the layout was not yet the clearer, more readable pattern described in the PRD.

#### Gap C. Add-ons were structurally supported, but not broadly attached

The system already supported modifier groups with `context_key = "addon"`.

That part was good.

But many of the real burger / wrap / poutine / specialty-fry items still only had removable ingredients and no attached paid add-on group in the actual seeded catalog.

So the add-on section could only be shown consistently after the data layer was aligned.

### What needed to happen

The safe fix list was:

1. hide saucing entirely when only one flavour is required
2. refactor the customization overlay so ingredient removal reads as a vertical ingredient-first list
3. keep add-ons on the existing modifier-group system instead of inventing a new payload type
4. extend the seed data so burgers, wraps, poutines, and specialty fries actually receive reusable add-on groups
5. provide a runtime-safe way to align an already-seeded database with the new builder data shape

### Plain-English takeaway

This was not a case where the builders were broken.

It was a case where the builders were mostly implemented, but still had a few obvious PRD and runtime-data gaps that needed one careful cleanup pass.

### Status

Resolved in the follow-up implementation documented in:

- [`fixed issues2.md`](./fixed%20issues2.md)

---

## Sauces Page Brand and Loading Follow-Up

### What changed

The `/sauces` route got one final UX polish pass so it feels like the same app as the homepage and no longer appears to freeze when the user clicks the `SAUCES` button.

This follow-up had two goals:

- make the sauces-page logo and wordmark match the rest of the app
- make the route transition feel faster and safer

### What was happening before

Before this change, the sauces page had its own custom brand treatment.

That meant the customer could move from the homepage into `/sauces` and see a page that looked related, but not fully consistent with the rest of the app shell.

There was also a separate UX complaint:

- when the customer clicked `SAUCES` from the homepage, the homepage appeared to sit there for a moment before the sauces page showed up

That kind of delay makes users feel like the click did not work, even if the route eventually loads correctly.

### What was changed in code

#### 1. Shared brand lockup

A shared Wings4U brand component was introduced so the sauces page no longer keeps its own custom logo block.

This change was wired through:

- [`wings-brand-lockup.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-brand-lockup.tsx)
- [`navbar.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/navbar.tsx)
- [`sauces-page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-page.tsx)

The result is that the sauces page now uses the same logo asset and stylized `WINGS 4 U` wordmark pattern that the homepage/shared navbar already uses.

#### 2. Route prefetch for `/sauces`

The homepage route now proactively warms the sauces route before the customer clicks it.

That change lives in:

- [`page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/page.tsx)

Specifically, the homepage now calls:

- `router.prefetch("/sauces")`

on mount.

### What was done to make it load faster

The main performance change was not a redesign of the sauces page itself.

The main speed-up came from prefetching the route in advance.

In plain English:

- while the customer is still on the homepage, Next.js quietly starts preparing the `/sauces` route
- then when the customer clicks `SAUCES`, much of the work is already warm
- so the app can switch routes much faster and the user no longer feels like the homepage is stuck

This is why the sauces page now often feels instant.

#### 3. Dedicated loading skeleton

A route-level loading UI was also added for `/sauces`:

- [`loading.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/sauces/loading.tsx)
- [`sauces-skeleton.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-skeleton.tsx)
- [`sauces-skeleton.module.css`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-skeleton.module.css)

This skeleton mirrors the structure of the real sauces page:

- navbar
- hero copy
- sauce counts
- search shell
- filter pills
- sauce-card grid placeholders

### Why the skeleton may not be visible now

After the prefetch change, the route often loads so quickly that the loading state is too short to notice.

So if the customer says:

- "the sauces page loads instantly now"
- "I cannot see the skeleton"

that is expected.

It does **not** mean the skeleton is broken.

It means:

- the route was already prefetched
- the page is mostly local/static UI work
- there is no long enough pending state for the skeleton to stay on screen visibly

### Plain-English takeaway

The sauces page feels faster now mainly because the app starts loading it before the customer clicks it.

The skeleton still exists as a fallback safety net for slower or cold route transitions, but under normal local conditions the page is now fast enough that the user may never notice it.

---

## Follow-up UX hardening: saucing, cart merge, scoped extras

Last updated: 2026-04-09

### Plan reference

This section records the **Follow-up UX hardening** plan: single-flavour saucing in both wing builders, cart line-merge preservation of `image_url`, and scoped add-on filtering using an explicit normalized match on modifier options (with heuristic fallback).

### Scope (requirements)

1. **Single-flavour saucing (wings + combos)**  
   - Show saucing whenever there is at least one flavour slot: `showsSaucingStep` uses `requiredFlavourCount >= 1` (not only 2+).  
   - Saucing init: default one flavour to `ON_WINGS` when switching counts or when legacy payload omits `saucing_method`; preserve `ON_SIDE` from edit payload when valid.  
   - For `requiredFlavourCount >= 2`, keep PRD-style defaults via shared helpers.  
   - For `requiredFlavourCount === 0`, saucing clears to `null`.  
   - Validation: require a saucing method compatible with the flavour count (`isSaucingMethodValidForCount`).  
   - Persist `saucing_method` on single-flavour builder payloads.  
   - Subtitle copy differs for one flavour (how sauce is served) vs multi-flavour (how flavours are distributed).  
   - Shared helpers live in [`../../apps/web/src/components/builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx) (`defaultSaucingMethodForCount`, `isSaucingMethodValidForCount`).

2. **Cart merge: preserve `image_url`**  
   On duplicate-key merge in `addItem` and on edit-collision merge in `replaceItem`, set `image_url: item.image_url ?? incoming.image_url ?? null` so existing non-null images win and missing images can backfill from the incoming line.

3. **Scoped extras**  
   - Add nullable `addon_match_normalized` on `modifier_options` in Prisma; ship a migration.  
   - Expose the field through [`../../apps/api/src/modules/catalog/catalog.service.ts`](../../apps/api/src/modules/catalog/catalog.service.ts) and [`../../apps/web/src/lib/types.ts`](../../apps/web/src/lib/types.ts).  
   - In [`../../apps/web/src/components/item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx), when the field is set, show the option only if a normalized removable ingredient name matches; when unset, keep the existing `optionMatchesAnyIngredient` heuristic.  
   - Populate the field in seed / [`../../packages/database/prisma/sync-builder-config.ts`](../../packages/database/prisma/sync-builder-config.ts) for the noisier shared add-on groups (incremental).

### Manual verification (from plan)

- Wings + combo: one-flavour SKU shows saucing; payload includes `saucing_method` `ON_WINGS` or `ON_SIDE`; quote/cart still work.  
- Cart: merge scenario backfills `image_url` when the first line lacked it.  
- Overlay: explicit-match add-ons only when the ingredient is present; unset options still behave as before.

### Resolution

Implemented fix documented in [`fixed issues2.md`](./fixed%20issues2.md) — see [`map.md`](./map.md) for line anchors to this issue section and the matching fix section.
