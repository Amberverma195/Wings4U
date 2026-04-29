# Fix Documentation Format: Old Structure + Expanded "Before / Now" Style

Last updated: 2026-04-19

## Purpose

This note records two things:

1. the older fixed-note format we already use
2. the expanded fix-writing style we can append when a fix needs clearer plain-English explanation

This is useful when we want a junior developer, reviewer, or non-technical reader to understand not just what changed, but also:

- what was going wrong before
- why users saw the bug
- what the implementation actually changed
- what the system does now

---

## Old Format We Use For A Fix Note

This comes from:

- [`../documentation format.md`](../documentation%20format.md)

The standard fixed-note format is:

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

### What this old format is good at

This format works well when:

- we want a clean audit-style fix note
- we need to show implementation + verification clearly
- the issue is straightforward enough to explain in the usual structure

### What this old format sometimes misses

For some bugs, especially state bugs, hydration bugs, persistence bugs, race-condition bugs, or UX bugs, the normal structure can still feel a little too abstract.

In those cases, readers usually understand the fix faster if we also explain:

- what the app was doing before
- what the user was seeing
- what safety mechanism we added
- what happens now after the fix

That is where the expanded format below helps.

---

## Expanded Fix Format We Can Append Below The Old Format

When a fix is harder to understand from the normal headings alone, append this style after the main fixed-note structure.

### Recommended added sections

1. `What those issues were`
2. `What was happening before`
3. `What we implemented`
4. `What happens now`
5. `Files touched`
6. `Verification`

This is not meant to replace the original fixed-note structure.

It is meant to make the fix easier to understand in plain English.

---

## Placeholder Template For The Expanded Format

Use the section pattern below, but replace the placeholder text with the real issue details.

### What those issues were

#### 1. `[Short issue name]`

`[Describe the first issue in plain English.]`

Explain:

- what the user was doing
- what the app/system was doing
- where the mismatch happened
- what wrong result the user saw

#### 2. `[Second short issue name, if needed]`

`[Describe the second issue in plain English.]`

If there are more than two related issues, continue the same pattern.

---

## What was happening before

Before this fix:

- `[Explain the old behavior.]`
- `[Explain why the old behavior produced the bug.]`
- `[Explain what the user could see or experience.]`

In simple English:

- `[Plain-English one-line summary of the old behavior.]`
- `[Plain-English one-line summary of why it failed.]`

---

## What we implemented

| Change | Purpose |
|---|---|
| `[Name of change 1]` | `[Why this change was added.]` |
| `[Name of change 2]` | `[Why this change was added.]` |
| `[Name of change 3]` | `[Why this change was added.]` |

Add or remove rows depending on the real fix.

---

## What happens now

Now the behavior is:

- `[Describe the corrected behavior.]`
- `[Describe the user-visible improvement.]`
- `[Describe the new safeguard or flow.]`

### Before

- `[Short old flow step 1]`
- `[Short old flow step 2]`
- `[Short old flow step 3]`

### Now

- `[Short new flow step 1]`
- `[Short new flow step 2]`
- `[Short new flow step 3]`

In simple English:

- `[One-line summary of what was broken before.]`
- `[One-line summary of what the app does correctly now.]`

---

## Files touched

The fix touched:

- `[path/to/file-1]`
- `[path/to/file-2]`
- `[path/to/file-3]`

List only the files that actually matter for understanding the fix.

---

## Verification

Verification wording should stay direct and honest.

Use wording like:

- `[build/test command] completes successfully`
- `Verified by code inspection and build.`
- `Runtime behavior still needs manual verification.` if that is true

---

## Practical Rule

Use the old fix-note format as the base structure.

When the bug is easier to understand as a story of:

- what was broken before
- what we changed
- what happens now

append this expanded format underneath.

That gives us both:

- the formal audit structure
- and the plain-English explanation

which is usually the best combination for future maintainers.

---

## Also Explain It In This Style

At the bottom of a fix note, it is often helpful to add one more plain-English explanation block written like this:

- `The problem was this:`
- `What the current fix does:`
- `Anything else that helps the reader understand the issue better`

This style is especially useful when the issue involves:

- browser state
- async behavior
- race conditions
- hydration
- caching
- persistence
- auth/session behavior
- UI states that change very quickly

These are the kinds of issues where a normal implementation summary is technically correct, but still not very easy to understand on first read.

### 1. "The problem was this:"

This section should describe the bug properly in human language.

Do not only say:

- `The cart was broken`
- `Hydration was wrong`
- `State was stale`

Instead, explain:

- what the user was doing
- what the app was doing internally
- where the mismatch happened
- what wrong result the user saw

Good style:

- `The problem was this: when the user added an item, the UI updated immediately, but the server save happened slightly later. If the user refreshed before that save completed, the app would reload from the older server cart and the new item would disappear.`

That kind of wording is much easier to understand than just saying:

- `Debounced cart persistence caused stale hydration.`

### 2. "What the current fix does:"

This section should explain the fix carefully and in steps.

This is the place where many bullet points are useful.

You should explain:

- what new safeguard was added
- what path now happens during load
- what path now happens during refresh
- what path now happens during clear/logout
- how the fix changes the user-visible behavior

Good structure here is:

- one bullet per mechanism
- one bullet per protection
- one bullet per important UI behavior

For example:

- `It stores a short-lived browser draft of the cart.`
- `It restores that draft before paint if it is still recent.`
- `It reconciles the draft with the server cart instead of blindly trusting the server response.`
- `It shows a restoring state while hydration is still happening.`
- `It clears the draft during logout and explicit clear so old cart lines are not revived later.`

This helps the reader understand not just that a fix exists, but how the fix actually protects the app.

### 3. "Anything else that helps the reader understand the issue better"

This is where you add the extra explanation that makes the note easier to learn from.

Useful things to include here:

- what happened before vs what happens now
- why the issue was easy to miss
- why the chosen fix was safer than other options
- what part is still imperfect, if anything
- what should be manually tested after the change

This is also a good place for short teaching-style language such as:

- `In simple English...`
- `Before this fix...`
- `Now...`
- `The important thing to understand is...`

That wording is good because it slows the explanation down and helps a junior developer follow the logic.

---

## Recommended Writing Pattern

If a fix is even a little tricky, the note can follow this flow:

1. use the normal fixed-note structure
2. explain the issue technically
3. then add:
   - `The problem was this:`
   - `What the current fix does:`
   - `Before`
   - `Now`
   - `Anything else that helps explain the issue better`

That gives the note two strengths at once:

- it remains structured and audit-friendly
- it also becomes much easier for another human to understand later

---

## Final Rule For This Style

When writing a fix note, do not stop at:

- what changed in code

Also explain:

- why the bug happened
- why the user experienced it
- what protection the new fix adds
- what the app does now that it did not do before

That is the difference between:

- a technical record

and

- a fix note that actually teaches the next developer what happened.
