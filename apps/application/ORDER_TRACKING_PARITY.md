# Verified website-to-mobile order tracking comparison

Implemented and validated on `feat/mobile-order-actions-parity`. Publication to `main` was subsequently authorized by the user; Git records the published commit.

The current local customer website source was reviewed directly, including `order-detail-client.tsx`, its CSS, `order-chat.tsx`, `support-ticket-form.tsx`, `reorder-button.tsx`, `order-reviews.tsx`, and `order-status-timeline-chakra.tsx`. Relevant order cancellation, chat and delivery-PIN API implementations were inspected without executing them. Neither website nor backend rules were changed.

## Status-to-action matrix

These are the order status-row actions for an authenticated owner. Driver contact actions, when supported, are listed separately below.

| Status/data | Website renders | Previous mobile | Verified mobile |
| --- | --- | --- | --- |
| PLACED, future valid deadline | Cancel order only | Cancel + Chat | Cancel order only |
| ACCEPTED, future valid deadline | Cancel order only | Cancel + Chat | Cancel order only |
| PLACED, elapsed deadline | Order Chat + Help | Chat + Help | Order Chat + Help |
| ACCEPTED, elapsed deadline | Order Chat + Help | Chat + Help | Order Chat + Help |
| PREPARING, non-empty deadline | Order Chat + Help | Chat + Help | Order Chat + Help |
| READY, non-empty deadline | Order Chat + Help | Chat + Help | Order Chat + Help |
| OUT_FOR_DELIVERY, non-empty deadline | Order Chat + Help | Chat + Help | Order Chat + Help |
| PICKED_UP | Order again + support Help; review when items exist | Reorder + support Help + review even for empty items | Order again + support Help; review when items exist |
| DELIVERED | Order again + support Help; review when items exist | Same mismatch as PICKED_UP | Same as website |
| CANCELLED | Order again only | Reorder only | Order again only |
| NO_SHOW_PICKUP | Order again only | Reorder only | Order again only |
| NO_SHOW_DELIVERY | Order again only | Reorder only | Order again only |
| NO_PIN_DELIVERY | Order again only | Reorder only | Order again only |
| Any active status, missing/empty deadline | No cancel/chat/help status-row actions | Chat + Help | No cancel/chat/help status-row actions |

The website condition explicitly requires `order.cancel_allowed_until` for its Chat + Help row. This edge case is included rather than assuming all historical orders have deadlines.

Cancellation requires both PLACED/ACCEPTED and a future server-provided deadline. Opening or focusing the screen never starts a new cancellation window. A single deadline timer and foreground/focus checks replace Cancel with Chat + Help automatically. Authoritative kitchen updates recalculate the actions and dismiss invalid confirmation modals.

## Interaction and information comparison

| Feature | Website behavior | Previous mobile difference | Correction / final behavior |
| --- | --- | --- | --- |
| Cancellation confirmation | “Cancel this order?”, same order-number warning, “Keep order”, “Yes, cancel order”, “Cancelling…” | Different capitalization and generic submitting label; dismissal allowed while pending | Exact copy and busy feedback; dismissal and repeated confirmation disabled while pending |
| Cancellation request | Authenticated POST to order cancel endpoint, empty JSON, then authoritative refresh | Request was already correct, with safer actual-location scoping | Retained empty payload, silent refresh, location/session guards and duplicate lock; never fabricates CANCELLED |
| Cancellation failure | Actual backend message remains in confirmation | Previous conflict handling immediately removed confirmation | Errors stay in confirmation while eligible; refresh reconciles a kitchen/deadline conflict and closes it when the returned order disallows cancellation |
| Order chat visibility | Hidden during self-cancellation eligibility | Visible alongside Cancel | Hidden during eligibility, with the same non-empty deadline guard as website |
| Chat header and authors | Order Chat / Driver chat, “(closed)”; You / Driver / Staff | Generic Wings4U/system author labels; no closed header | Matching headers, author-side bubbles and relative message times |
| Chat history | Oldest to newest, auto-scroll to latest | Chronology and auto-scroll were already present | Preserved, with actual order location, session isolation and realtime refresh |
| Suggestions | Same five strings; selected suggestion toggles, disables other choices, can be cleared; typed text preserved | Suggestions only replaced the draft | Matching select/toggle/clear/edit behavior |
| Chat loading/sending/errors | Initial composer hidden while loading, empty-state copy, ellipsis while sending, backend send error text | Generic submitting label, HTTP diagnostics, extra reload action | Matching initial/empty/closed behavior and send feedback; no duplicate lower chat panel |
| Chat rate limits | Server owns limits | An independent local five-message quota, plus assumed cooldown | Removed local quota and assumed cooldown; displays server errors and honors only explicit server retry timing, with no automatic mutation retries |
| Active Help | READY-specific warning; otherwise preparation warning; actual phone, Chat with us, Close | Main behavior already correct; labels differed | Exact messages and action text; native sanitized telephone URI; same chat modal; no ticket POST |
| Completed Help | Support form only after PICKED_UP/DELIVERED | Status guard already correct | Preserved; no tickets/reviews added to other terminal states |
| Support ticket, multiple items | Select items, select-all/clear, issue categories, required description, submit, success | Core selection and payload already correct | Preserved; aligned visible labels, success text and busy dismissal |
| Support ticket, one item | Skip selection and select the only item automatically | Forced an extra selection step | Opens details with the actual item already selected |
| Support ticket, zero items | Whole-order ticket; description required | Submission was blocked | Same Whole order subject/description and order ID; no fabricated line IDs |
| Reviews | Completed orders only, with at least one item; item-specific reviews, 2000-character limit, saved review/reply/publication display | Empty orders exposed a review action; labels differed | Empty-item action hidden; matching prompt/submit/close labels; existing validated saved-review workflow retained |
| Reorder availability | All six terminal statuses only | Availability already correct | Preserved with website “Order again” label on detail |
| Reorder request/preview | Original location; no cart-context override in preview request; review diffs before confirming; no independent preview expiry | Detail inherited cart-context override and two-minute preview expiry from shared mobile reorder | Detail uses website request and expiry behavior, with the same diff/confirm/empty-cart/location behavior; other pages retain their existing workflow |
| Order metadata | Order number, status, Pickup/Delivery, placement date/time | Only number/status were prominent | Adds method and placement date/time, plus Back to my orders navigation |
| Ready estimate | Active orders only, ready time and optional min–max minutes | Missing | Added with website visibility and copy |
| Delivery PIN | Best-effort delivery-pin fetch for owned OUT_FOR_DELIVERY delivery orders | Missing | Added with actual location and generation guards; hidden on status/order/account/focus change; non-fatal failures |
| Delivery details | After delivery starts or delivery statuses, when driver/address/preference information exists | Missing | Driver name/phone, vehicle/plate, address, preference and active arrival ETA added with the same guards and fallbacks |
| Driver contact | Assigned driver and non-terminal delivery details: Chat with driver and Call driver when phone exists | Missing | Native dialer plus Driver chat modal; uses the same order conversation/API as website, not an invented driver-only endpoint |
| Terminal delivery details | Read-only details, no arrival ETA or driver contact | Missing | Added with terminal-state guards |
| Cancelled notice | Current website literal: “Order cancelled by Staff.” | Missing | Same literal notice; no new cancellation-attribution rule introduced |
| Item contents and totals | Item snapshots, quantity, removed/additional modifiers, flavours, instructions, subtotal, delivery fee, tax, wallet, total | Core mobile values already correct | Retained; existing correct mobile discounts, tips and API tax-rate display also preserved as explicitly requested |
| Status history | Actual API events descending, latest preview, full expansion, reason text and special item-added event copy | Synthesized events, omitted reasons/item-added copy | Uses only real events, hides absent history, preserves all expanded events, includes reasons and legacy added-item amounts |
| Realtime events | Includes order changes, driver changes, ETA and cancellation.decided | cancellation.decided missing | Added that event to the existing coalesced refresh controller; all existing subscriptions/recovery/fallback retained |
| Account/order isolation | Customer route rejects another owner and clears private state | Request generation isolation existed; returned owner was not explicitly checked | Added returned-owner check; modal, conversation and PIN responses remain scoped to account/order/location/generation |
| Technical connection UI | Not required as customer actions | Already hidden by previous work | Remains hidden; native pull-to-refresh replaces the extra header refresh button and retains recovery |
| Failed order refresh | Website error state has no order actions | Cached mobile details could still show actions | Cached details remain visibly marked as last available, with actions suppressed until refresh succeeds |

## Native adaptations and source edge cases

- Native sheets, keyboard avoidance, scroll behavior, hardware-back dismissal, accessible touch targets, red/charcoal/white styling, phone URIs, and pull-to-refresh replace desktop/browser controls.
- The desktop two-column layout is not copied. Items, pricing and status history retain their native layout.
- Mobile retains last known owned details with an explicit warning during a transient refresh failure. Actions are suppressed, matching website error-state availability; native Retry and the existing HTTP/realtime recovery remain.
- Website source currently labels tax as 13% and omits separate discount/tip rows. Correct existing mobile API tax-rate, discount and tip information is retained under the instruction to preserve correct mobile behavior and show applicable charges.
- Malformed deadline strings are rejected for cancellation. The website comparison does not reject Invalid Date explicitly, but this implementation follows the request's stricter “deadline is in the future” requirement. Normal API ISO deadlines have the same eligibility.
- Explicit server Retry-After timing may temporarily disable another send; no additional local quota or invented duration remains.
- Existing defensive validation of review/ticket/reorder responses, double-submission locks, authenticated session guards, and native cart hydration safeguards remain. These do not change normal successful server responses or supported customer actions.
- No known supported customer tracking capability remains unimplemented. Real-device interaction/layout verification is still outstanding.

## Files in the feature working tree

All paths are relative to the repository root. This includes the earlier implementation and these corrections.

### Screen/components

- `apps/application/app/orders/[id].tsx`
- `apps/application/src/components/order-active-actions.tsx`
- `apps/application/src/components/order-chat-modal.tsx`
- `apps/application/src/components/order-feedback-sheet.tsx`
- `apps/application/src/components/order-help-modal.tsx`
- `apps/application/src/components/order-history.tsx`
- `apps/application/src/components/order-review-modal.tsx`
- `apps/application/src/components/order-tracking-details.tsx`
- `apps/application/src/components/reorder-button.tsx`

### Hooks/helpers

- `apps/application/src/hooks/use-cancellation-eligibility.ts`
- `apps/application/src/hooks/use-chat.ts`
- `apps/application/src/hooks/use-delivery-pin.ts`
- `apps/application/src/hooks/use-order-detail.ts`
- `apps/application/src/lib/order-actions.ts`
- `apps/application/src/lib/order-feedback.ts`
- `apps/application/src/lib/order-realtime.ts`
- `apps/application/src/lib/order-tracking.ts`

### Tests/report

- `apps/application/tests/cancellation-eligibility.test.cjs`
- `apps/application/tests/delivery-pin.test.cjs`
- `apps/application/tests/order-actions.test.cjs`
- `apps/application/tests/order-chat-modal.test.cjs`
- `apps/application/tests/order-detail-realtime.test.cjs`
- `apps/application/tests/order-feedback-session.test.cjs`
- `apps/application/tests/order-feedback.test.cjs`
- `apps/application/tests/order-tracking-details.test.cjs`
- `apps/application/tests/reorder.test.cjs`
- `apps/application/tests/use-chat.test.cjs`
- `apps/application/ORDER_TRACKING_PARITY.md`

## Validation actually executed

Final full mobile suite, including existing real local Socket.IO client/server tests and the actual website reorder component tests:

```text
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent

Test Suites: 61 passed, 61 total
Tests:       968 passed, 968 total
Snapshots:   0 total
Time:        12.688 s
Exit code:   0
```

The full suite has 44 more cases than the previous 924-test implementation. Coverage includes valid/expired/missing deadlines; cancellation-only visibility; automatic expiry and kitchen changes; confirmation/errors/busy dismissal; all terminal statuses; chat sending/incoming events/quick selection/closed flags; support item-count routing; original-location reorder; real history and item-added details; delivery PIN privacy and stale responses; driver details/contact; foreground/focus/account/order transitions; subscriptions and HTTP fallback.

```text
npx tsc -p apps/application/tsconfig.json --noEmit
TypeScript exit code: 0

git diff --check
Exit code: 0
```

Android and iOS release export: PASS (exit code 0). Android bundle: 6.8 MB; iOS bundle: 6.5 MB. These are JS/Hermes bundle exports, not signed native app builds.

Release export command, run from apps/application with dotenv loading disabled:

```text
EXPO_NO_DOTENV=1
NODE_ENV=production
EXPO_PUBLIC_API_ORIGIN=https://api.wings4ulondon.ca

npx expo export --platform android --platform ios --output-dir <temporary-directory>
```

The origin above is bundled public configuration; no live cancellation/chat/support/PIN API request was executed. Logs/artifacts are in the local temporary directory: `wings4u-exact-parity-full.log`, `wings4u-exact-parity-export.log`, and `wings4u-exact-parity-export`.

The mobile workspace still has no lint script/configuration or ESLint dependency. No lint tooling was installed; this is not reported as a lint pass.

## Device verification and production safety

No simulator, signed APK/IPA build, device run, or production end-to-end test was performed. Before release, verify small-screen text/wrapping, keyboard behavior on both OSes, native phone launch, hardware back, real network background/reconnect behavior, driver contact and PIN presentation with authorized non-production fixtures.

During implementation and validation, no production data, credentials, root dotenv files, migrations, seeds, resets, deployment configuration or services were modified. No website/backend business-rule changes, live API mutations, deployments, or app publications were performed. Commit and push to `main` were separately authorized after validation; existing deployment automation may run on that push. Existing unrelated local work, including the database guard edits and root untracked files, was preserved.
