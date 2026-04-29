# Documentation Format

Last updated: 2026-04-08

## Purpose

This file defines the expected writing format for Wings4U issue documentation.

Use it when writing:

- a current issue note
- a detailed verification note
- a fixed issue note
- a follow-up note that explains what changed, what was verified, and what still remains

The goal is simple:

- write in plain English first
- keep the technical detail accurate
- make the note readable for both developers and non-technical reviewers
- keep the structure consistent across files

---

## Core Rule

Every issue note must do three things clearly:

1. explain the problem in plain English
2. explain the technical path and files involved
3. explain what was actually verified, not what was only planned

Do not write issue notes like loose chat summaries.

Do not write issue notes like a changelog dump.

Write them like a technical audit note for humans.

---

## Where Different Notes Belong

### 1. Current issue / active issue note

Use:

- `Code/Docs/procedures/issues/<descriptive-name>.md`

This is where the issue should be explained in detail.

If the issue is still active, partially verified, or being tracked as the current version of the story, it belongs here.

Examples:

- [`issues2.md`](./issues/issues2.md)
- [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./issues/wing-combo-wings-drinks-sides-saucing-and-api-fix.md)

### 2. Fixed / archived / long-form resolved note

Use:

- `Code/Docs/procedures/issues/fixed issues2.md`

Append the new section below the last added content when you are storing a longer resolved-note or follow-up write-up in the same running archive.

Use this when the issue is no longer the live active issue note and you want to preserve the detailed fix history.

Example:

- [`fixed issues2.md`](./issues/fixed%20issues2.md)

### 3. Register-style summary files

Use:

- `Code/Docs/procedures/issues/issues.md`
- `Code/Docs/procedures/issues/Fixed Issues.md`

These are not the best place for the long narrative.

These are best for:

- summary registration
- status at a glance
- quick lookup
- links to the deeper note

---

## Required Format For A Current Issue Note

This is the format to use in an `issues` note.

At minimum, the note should contain:

1. `Title`
2. `Last updated`
3. `Quick Summary`
4. `Purpose`
5. `How To Read This Note`
6. `Problem in plain English`
7. `Technical path / files involved`
8. `Why this mattered`
9. `What was found`
10. `Fix implemented` or `What still needs to be fixed`
11. `Files changed` if changes already happened
12. `Verification`
13. `Status`
14. `Plain-English takeaway`
15. `Final plain-English summary`

### How the current issue note should read

The issue note should explain:

- what happened
- where it happened
- why it was a real problem
- what the code currently does
- whether the issue is still open, partly fixed, or resolved

It should be written in a way that someone unfamiliar with the code can still understand the problem.

### What to avoid

Do not:

- only paste commands
- only paste stack traces
- only say "fixed" without showing what was verified
- write one giant paragraph with no structure

---

## Required Format For A Fixed Issue Note

This is the format to use in the `fixed issues` style note.

At minimum, the fixed note should contain:

1. `Title`
2. `Last updated` or fixed date
3. `Quick Summary`
4. `Purpose`
5. `How To Read This Note`
6. `What the issue was`
7. `Why it mattered`
8. `What changed`
9. `Files reviewed / files changed`
10. `Verification run`
11. `Remaining caveats` if any still exist
12. `Final conclusion`
13. `Plain-English summary`

### What the fixed issue note should do

The fixed note should explain the fix in detail.

It should not only say that something was changed.

It should explain:

- what the original issue was
- what exact change corrected it
- what proof exists
- what is still imperfect, if anything

### Important honesty rule

A fixed issue note may still include caveats.

If something is "mostly fixed" but not perfect, say that directly.

Do not overstate completion.

---

## Writing Style Rules

### 1. Plain English first

Start with human-readable explanation before diving into implementation details.

### 2. Technical detail second

After the plain-English summary, show:

- file paths
- relevant functions/components
- exact behavior
- verification commands

### 3. Separate these clearly

Always separate:

- planned
- implemented
- verified
- still pending

These are not the same thing.

### 4. Keep the note readable

Use:

- short headings
- short sections
- bullets where helpful
- small summaries after technical detail

### 5. Use file links

Whenever you mention an important file, link it.

That makes the issue note useful as a review document, not just as prose.

---

## Verification Rules

Every note should say which of these happened:

- code inspection
- build verification
- typecheck
- runtime test
- API/manual probing
- database reseed/migration check

If something was **not** verified, say so directly.

Good wording examples:

- `Implemented in code, but not runtime-verified yet.`
- `Verified by build and code inspection; still depends on reseeding the database.`
- `Reason identified, but full runtime proof was not completed in this pass.`

---

## Map File Rule

Whenever a new long-form issue or fixed note is added, update:

- [`map.md`](./issues/map.md)

The map file should include:

1. the title of the plan or note
2. a link to the detailed current issue note, if one exists
3. a link to the detailed fixed/archive note, if one exists
4. the starting line number for the relevant section in those files

This is important because these files can get long, and the line number makes the entry easy to jump to.

---

## Recommended Workflow For Any AI Agent

When an AI agent is asked to document an issue, it should follow this order:

1. read the code first
2. verify the plan against the real code
3. verify builds/typechecks/runtime if possible
4. decide whether the issue is:
   - open
   - partial
   - resolved
5. write the current issue note in the active `issues` file if needed
6. write or append the fixed-note version in the fixed issue file if needed
7. update `tasks.md` with a short linked summary
8. update `map.md` with the new title, file links, and line numbers

---

## Best Example Files Right Now

If you want to match the current preferred style, use these as examples:

### Current issue-note style

- [`issues2.md`](./issues/issues2.md)
- [`wing-combo-wings-drinks-sides-saucing-and-api-fix.md`](./issues/wing-combo-wings-drinks-sides-saucing-and-api-fix.md)

### Fixed / archived note style

- [`fixed issues2.md`](./issues/fixed%20issues2.md)

These files are the best current examples of:

- plain English first
- detailed technical explanation second
- explicit verification
- clear caveats
- readable structure

---

## Final Plain-English Summary

The rule is:

- `issues` files explain the problem in detail
- `fixed issues` files explain the fix in detail
- `map.md` points to both with line numbers

If someone follows this file, the documentation will stay:

- consistent
- readable
- traceable
- honest about what is done and what is still missing
