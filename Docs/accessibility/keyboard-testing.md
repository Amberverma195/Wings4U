# Website keyboard testing

Reviewed: October 23, 2026. Status: **public keyboard paths tested; complete authenticated end-to-end and screen-reader verification remains incomplete.**

## What was actually tested

The live public website at `https://www.wings4ulondon.ca` was tested in isolated, fresh Microsoft Edge sessions on Windows. Viewports were 1365 × 900 and 390 × 900. The narrow viewport is a responsive desktop-browser test, not a real phone/device test. The deployed commit was not independently identified.

An automated sweep visited ten routes at both widths: `/`, `/login`, `/signup`, `/privacy`, `/terms`, `/account/delete`, `/checkout`, `/cart`, `/order?cat=wings`, and `/sauces`. It recorded the first 45 Tab stops per route/viewport (900 observations, not 900 independent tests), a reverse-navigation sample, focused element names/roles/outlines/bounds, headings and screenshots. Both policy contents links were activated with Enter and focused their destination sections. Reduced motion was enabled for this repeatable sweep; a separate desktop exploratory session used default motion.

All interactions after direct URL navigation used keyboard events: Tab, Shift+Tab, Enter, Space and arrow keys. No mouse clicks, locator focus calls or injected DOM clicks were used. DOM reads and screenshots inspected the result. Navigating directly to a route does not prove every incoming navigation link works.

The in-app browser connection failed before execution with `missing field sandboxPolicy`. Separate headless Edge provided the actual browser evidence. No production credentials or personal data were entered. Non-GET/HEAD/OPTIONS requests were blocked before transmission, including attempted cart PUT saves. No real account, order, address, payment, deletion or support submission was created. No database-connected tests, migrations, environment changes or deployments were run.

## Results by flow

| Flow | Result and evidence limit |
|---|---|
| Home, sauces, footer and public route traversal | Tab/Shift+Tab traversal sampled at both widths. Public controls and legal links appear in the focus sequence. This does not certify all focus colours or every link's activation. |
| Sign-in/registration | Form fields, password buttons, submit controls and Terms/Privacy links are keyboard reachable. On desktop, Space on Show password changes the field to text and the accessible name to Hide password while keeping focus. No sign-in, verification email or registration was submitted. |
| Privacy and Terms | Enter on the contents anchor updates the hash and focuses the named section at both widths (`#about` / `#service`). Existing isolated policy tests also cover scrollable tables and footer links; see the separate legal-policy review. |
| Account deletion | Signed-out public entry sampled at both widths. No authenticated password verification, blocker resolution, confirmation, deletion or session cleanup was exercised live. |
| Checkout/cart | Signed-out/empty entry surfaces sampled. No populated-cart placement or completed checkout was tested. |
| Order-settings dialog | Initial Tab sequence remains within the dialog at both widths. Desktop pickup selection with Space, Continue with Enter, schedule controls with arrows and Continue to Menu with Enter reached the menu. A desktop follow-up reopened settings from Change, traversed forward/backward, and verified Escape closes the dialog and restores focus to Change. Delivery was reported unavailable during this session, so address/quote progression was not tested live. |
| Menu and wings builder | Desktop category controls and the wings Add button were reached using Tab/Shift+Tab. Enter opened the builder and focused Close. Space selected 1 lb and then Honey BBQ; the flavour radio reported `aria-checked=true`. ArrowRight moved the heat tab from MILD to MEDIUM, with the active tab selected and `tabIndex=0`, other heat tabs `-1`. Escape closed the builder and restored focus to its Add Wings trigger. No item was saved to the production cart. |
| Other builders and authenticated account/admin flows | No exhaustive live keyboard run. Mocked tests supply narrower evidence, not a replacement for those missing live checks. |
| Screen readers | **Not tested with NVDA, Narrator, VoiceOver or TalkBack.** DOM names/roles and semantic tests do not prove spoken announcements, reading order or usable screen-reader interaction. |

## Focus visibility follow-up

The signup password-toggle button deliberately removes its outline in `apps/web/src/components/auth-shell.tsx` and instead changes foreground/background on `:focus-visible`. Browser evidence confirms keyboard focus and successful activation; the screenshot shows the subtle highlight. Record this as a **focus-visibility review item**, not a proven keyboard activation failure or a blanket WCAG failure. Stronger focus treatment and a measured contrast review would make the control easier to assess. No UI changes were made during this testing task.

The default-motion home exploration also encountered moving marquee/promotional controls. The reduced-motion sweep does not establish visibility of every moving control throughout its animation. Repeat these controls with motion enabled in a visual keyboard audit before claiming complete coverage.

## Automated checks

Command:

```powershell
npm run test --workspace @wings4u/web -- --runTestsByPath tests/web-a11y-semantics.test.cjs tests/customer-modal-focus.test.cjs tests/admin-order-modal-focus.test.cjs tests/address-editor.test.cjs tests/account-address-removal.test.cjs tests/account-deletion.test.cjs tests/legal-pages.test.cjs --silent
```

**PASS: 7 suites, 51 tests.** These use mocked/local dependencies and cover builder tab/selection semantics, dialog focus management, address controls, deletion entry points and policy rendering. Their success is not a full live keyboard or assistive-technology certification. No new product code or tests were added for this documentation task.

The 20 route/viewport sweeps completed without navigation errors. Some early script probes searched for visual button text rather than accessible names and did not find a target within their bounded tab loop; subsequent probes used the observed accessible names and successfully opened the wings builder. Immediate post-Escape readings in the sweep are snapshots before React settles and must not be treated as definitive close failures; the separate wings action check waited and verified closure/focus restoration.

## Review evidence

- [Route/viewport focus observations](keyboard-review-evidence/results.json)
- [Wings builder keyboard actions and state](keyboard-review-evidence/builder-actions.json)
- [Wings builder screenshot](keyboard-review-evidence/builder-keyboard.png)
- [Password toggle state](keyboard-review-evidence/signup-toggle.json)
- [Password toggle focused screenshot](keyboard-review-evidence/signup-toggle-focused.png)
- [Order setup follow-up](keyboard-review-evidence/setup-actions.json)
- [Earlier policy layout/table/contrast review](../privacy/legal-policy-review.md)

The linked screenshots and JSON evidence accompany this report in the repository. No secrets or session token values are included. These are review evidence, not product assets.

## Accurate audit-row wording

Source fixes included with this report: Date/Time selects now have accessible names; pickup/delivery settings use a shared radio group; button radio groups implement arrow/Home/End selection and roving Tab stops. The shared modal hook now restricts focus/keyboard handling to the top active modal and keeps scroll locking until the final locking modal closes. Both menu/cart settings use a non-modal panel with initial focus, free Tab traversal and scoped Escape/return focus. Focus regression coverage includes two stacked modals and the non-modal panel. These source fixes and mocked tests are distinct from the historical live-browser evidence above; deployment of these changes and full live/screen-reader verification are not established by this report.

Follow-up validation: **47 tests passed across six suites** (`customer-modal-focus`, `admin-order-modal-focus`, `web-a11y-semantics`, `fulfillment-picker`, `radio-group`, `pickup-eta`). Web TypeScript and `git diff --check` passed. The initial rerun exposed a missing DOM constructor in an existing renderer-only fixture; the panel now checks for a mounted DOM ref before attempting focus, and the rerun passes.

| Area | Status | Suggested wording |
|---|---|---|
| Keyboard navigation | Partially verified | Public keyboard traversal tested at desktop and narrow widths; desktop pickup scheduling, wings-builder selection, tab arrows, Escape/focus restoration and policy anchors verified. Source fixes add scheduling labels, radio keyboard behavior, stacked-modal ownership and non-modal settings focus. Latest focused regression run: six suites, 47 tests passed; the earlier broader audit ran seven suites, 51 tests. Authenticated end-to-end flows, other builders, motion/focus contrast and real screen-reader testing remain unverified. |

Do not mark all keyboard work as untested. Equally, do not turn this row green for full keyboard/screen-reader coverage based on these sampled checks. Completion requires a safe staging/test account and data for populated checkout/account/support/deletion workflows, the remaining builders, actual assistive-technology runs and resolution of any issues found. Production mutations are not required to obtain that evidence.
