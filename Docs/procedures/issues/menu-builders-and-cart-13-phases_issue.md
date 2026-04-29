# Menu, Builders, and Cart - 13 Phases Issue

Last updated: 2026-04-09

## Quick Summary

This file records the issue-side note for the large menu, builders, and cart follow-up plan.

The core problem was not one isolated bug. It was a set of unfinished or inconsistent behaviors across the ordering flow:

- builder validation feedback
- dry-rub flavour data
- flavour-picker defaults
- party-special routing
- ingredient-removal UX
- per-item extras
- wraps and burgers category notices
- tender-combo builder enforcement
- pop drill-down behavior
- inline menu-card quantity controls
- full cart-page layout
- edit-line round trip from cart back to builder

This note explains what the problem was in plain English, why it mattered, where it lived in the codebase, and how the work was grouped before the fix was completed.

Related fix note:

- [`menu-builders-and-cart-13-phases_fix.md`](./menu-builders-and-cart-13-phases_fix.md)

---

## Purpose

This file exists so the issue-side story for this plan has its own standalone note.

It is separate from the older `issues2` / `fixed issues2` chain because this was a broader menu-and-cart implementation pass, not just a follow-up on one earlier builder issue.

Use this file when you want to understand:

- what was still missing
- why the missing pieces mattered
- which files and areas were involved
- how the work was broken into phases before it was fixed

---

## How To Read This Note

Read this note as the "what was wrong / what was left" side of the work.

Then read the matching fix note:

- [`menu-builders-and-cart-13-phases_fix.md`](./menu-builders-and-cart-13-phases_fix.md)

That companion file contains the completion-side record.

---

## Problem In Plain English

The ordering flow was partly working, but it still felt inconsistent and incomplete in several important places.

Some examples:

- configurable items did not always show clear validation feedback
- dry-rub flavour counts did not match the expected menu reality
- flavour and saucing steps could still imply defaults instead of forcing an explicit customer choice
- some wing-party or special items could still route or display incorrectly
- ingredient-removal UI did not match the requested checkbox-first pattern
- extras were not always limited to the ingredients that actually belonged to that item
- some upsell or helper items were still showing as regular menu cards instead of category notices
- tenders could still behave too much like quick-add items instead of forcing required choices
- pop flow and drink grouping needed a deeper builder path
- the menu cards and cart page were still too minimal compared with the intended ordering experience
- cart editing was not yet a clean round-trip back into the right builder with the right saved state

So the problem was larger than "a builder bug."

It was really a final implementation gap between:

- the current working ordering flow
- the intended product behavior from the PRD

---

## Why This Mattered

These gaps affected both customer experience and developer reliability.

For customers, the issues could cause:

- confusion about what still needed to be selected
- unclear flavour and saucing behavior
- weak cart confidence because the cart summary and edit flow were incomplete
- item builders that did not feel consistent across categories

For developers, the issues caused:

- scattered logic across menu cards, builders, overlays, and cart pages
- weak traceability back to PRD sections
- a higher risk of regressions when changing builders or cart behavior
- documentation gaps around what was still unfinished versus what was already done

---

## Primary Files And Areas Involved

These were the main code areas tied to this plan:

- [`builder-shared.tsx`](../../apps/web/src/components/builder-shared.tsx)
- [`wings-builder.tsx`](../../apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](../../apps/web/src/components/combo-builder.tsx)
- [`item-customization-overlay.tsx`](../../apps/web/src/components/item-customization-overlay.tsx)
- [`item-modal.tsx`](../../apps/web/src/components/item-modal.tsx)
- [`menu-page.tsx`](../../apps/web/src/Wings4u/components/menu-page.tsx)
- [`menu-display.ts`](../../apps/web/src/Wings4u/menu-display.ts)
- [`menu-item-customization.ts`](../../apps/web/src/lib/menu-item-customization.ts)
- [`cart.ts`](../../apps/web/src/lib/cart.ts)
- [`cart-page.tsx`](../../apps/web/src/Wings4u/components/cart-page.tsx)
- [`seed.ts`](../../packages/database/prisma/seed.ts)
- [`Wings4U_PRD_v3_5_v24_FIXED.docx`](../../Wings4U_PRD_v3_5_v24_FIXED.docx)

---

## PRD Context

The acceptance criteria for this plan were expected to come from the PRD, especially around:

- configurable-item validation
- wings flavour and saucing flow
- ingredient removal and extras
- menu-card behavior
- cart summary
- taxes and fees
- line-item editability

The practical rule for this work was:

- use the PRD to define what "done" means
- then verify that the actual implementation matches the intended customer flow

---

## Phase Scope

This plan was organized as 13 phases because the work touched multiple parts of the ordering system.

The phases were:

- validation feedback banner and scroll-to-invalid behavior
- dry-rub seed data expansion
- flavour-picker default cleanup and saucing copy cleanup
- special-instructions copy tweak
- party-special routing and metadata correction
- checkbox-only ingredient removal
- item-scoped extras
- wraps and burgers category notices instead of regular cards
- tender items forcing the correct builder path
- pop drill-down and 6-pack behavior
- inline menu-card quantity controls
- full cart-page redesign and summary behavior
- edit-line round trip from cart back into the correct builder

This is important because the issue was not "phase 13 broke."

The issue was that all of these gaps had to be closed together for the order flow to feel complete.

---

## What Was Still Missing Before The Fix

Before the follow-up was marked complete, the remaining concerns were:

- builders needed clearer submission feedback
- dry rubs needed the full seed-backed flavour set
- flavour choice needed to feel explicit instead of implied
- specials and party items needed the right builder routing and display strings
- removal UI needed to match the requested checkbox pattern
- extras needed better per-item scoping
- wraps and burgers needed cleaner category-level notice treatment
- tenders needed stronger forced-builder behavior
- drinks and pops needed a deeper selection path
- menu cards needed inline quantity controls
- the cart page needed a fuller ordering summary layout
- cart edit needed a reliable return path into the matching builder state

---

## Status

This issue note now exists mainly as historical context.

The matching completion note says the full 13-phase plan was completed:

- [`menu-builders-and-cart-13-phases_fix.md`](./menu-builders-and-cart-13-phases_fix.md)

So this file should now be read as:

- what the issue scope was
- what remained at the time of planning
- what the fix file claims was completed

---

## Plain-English Takeaway

The problem was not one simple broken button or one missing field.

It was the final stretch of work needed to make the menu, builders, and cart feel like one complete product flow instead of several partially connected pieces.

The matching fix note is where the completion claim is recorded.

---

## Final Summary

If someone asks, "What was this issue file for?" the short answer is:

It documented the remaining menu, builder, and cart gaps before the 13-phase follow-up was declared complete.

For the completion-side note, use:

- [`menu-builders-and-cart-13-phases_fix.md`](./menu-builders-and-cart-13-phases_fix.md)

---

## Final Follow-Up That Was Still Left After The 13-Phase Completion Claim

After the main 13-phase pass was marked complete, there was still one smaller follow-up batch left to close.

These were not new product directions.

They were the last practical cleanup items that still affected the live ordering experience.

The remaining follow-up scope was:

- cart line images still needed to appear on each cart row when the menu/catalog had an image URL
- single-flavour saucing still needed to be checked against the PRD so the team would not build the wrong UX by accident
- scoped extras still needed hardening so item customization did not rely on brittle token matching
- the Wings builder still had a non-functional `Suggested add-ons` placeholder step that could mislead customers
- runtime data alignment still needed a safe path for an already-seeded database

### Why This Follow-Up Still Mattered

The 13-phase completion claim covered the larger ordering system work, but these remaining details still had customer impact.

In plain English:

- the cart still looked incomplete without thumbnails
- the PRD could still be misread on single-flavour saucing
- extras could still drift from the actual item they belonged to
- the Wings builder still hinted at functionality that did not really exist yet
- developers could still think they needed a destructive reseed when the current database really needed a targeted sync

### What The Issue Actually Was

The remaining issue was not "the 13-phase work failed."

The real issue was that the 13-phase pass left behind a final polish/data-alignment layer:

- one cart presentation gap
- one PRD interpretation check
- one addon-scoping hardening task
- one misleading builder placeholder
- one database maintenance instruction gap

### PRD-Sensitive Part Of This Follow-Up

The most important thing in this leftover batch was the single-flavour saucing question.

That had to be checked against:

- `Docs/Wings4U_PRD_v3_5_v24_FIXED.docx`

Because if the PRD required a single-flavour toss-vs-side choice, the builder would need another step.

If the PRD said single-flavour orders should skip saucing entirely, then adding that step would actually be a regression.

So this follow-up issue explicitly included a PRD verification task, not just a UI task.

### Files Most Relevant To This Leftover Batch

The main files tied to this final follow-up were:

- [`cart-page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/cart-page.tsx)
- [`styles.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/styles.ts)
- [`types.ts`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/lib/types.ts)
- [`wings-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-builder.tsx)
- [`combo-builder.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/combo-builder.tsx)
- [`item-customization-overlay.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/components/item-customization-overlay.tsx)
- [`seed.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts)
- [`sync-builder-config.ts`](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/sync-builder-config.ts)

### Plain-English Takeaway

This final issue was the "last 10 percent" work after the bigger builder/cart rollout had already landed.

It existed to close the small but important gaps that could still confuse customers, drift from the PRD, or leave the live database out of sync with the current builder rules.
