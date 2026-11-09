Wings4U checkout/cart refresh fix — November 8, 2026

The reported failure has a concrete loss path in the checked-in website code. A hard reload creates the cart with `items = []` and starts authentication asynchronously. The initial layout effect compares the saved draft's owner with the still-null session user, so it rejects a legitimate customer draft. The separate 200 ms draft effect does not wait for authentication or saved-cart hydration, and can replace that draft with the initial empty cart while `/cart/me` is still pending. The `pagehide` handler has the same missing gate. A subsequent server read failure returns `null`, which hydration interprets as an empty cart, completing the apparent loss.

Other confirmed weaknesses were overlapping full-replacement PUTs, retry/debounce callbacks that were not tied to an explicit expected account, and a backend lock that serialized writes without checking whether a request was based on an older cart. A delayed older request could therefore be the last writer. Initial session failures also marked the session loaded without distinguishing verified guest identity from unresolved authentication.

The failure mechanism was confirmed by source review and regression coverage of the relevant timing and ownership conditions. Production customer carts, database contents, and private request traces were not inspected or modified.

Changes:

- Authentication now exposes verified versus unresolved ownership and a recoverable initial-session error. Failed or malformed session responses cannot confirm guest identity. Session response sequencing and logout generation checks prevent older responses from restoring a previous identity.
- Cart initialization, login/logout, account switching, and location hydration use a single ownership-aware lifecycle. An unresolved session cannot read or overwrite another owner's draft. Old reads, merges, and save callbacks cannot apply across account changes; old item counts and fulfillment metadata are masked while ownership changes.
- Draft persistence now runs synchronously after committed local state changes, once owner reconciliation and hydration are complete. It retains all lines, quantities, modifiers, removed ingredients, instructions, builder payloads, fulfillment type, time zone, schedule, and tip selection. Refreshing before the backend's 400 ms debounce no longer depends on a second 200 ms storage timer. `pagehide` uses the same readiness and owner gates.
- Draft metadata distinguishes unsaved edits from an acknowledged server snapshot, and records the base server revision. Acknowledged drafts do not resurrect legitimately empty/converted carts. An explicit clear is retained as a pending empty snapshot until saved, so an older nonempty server snapshot does not undo that clear.
- Read, merge, and write failures are distinct from a successful empty or expired snapshot. Saved-cart requests have a bounded wait; recoverable errors retain the local draft. Revision conflicts preserve the draft until the customer explicitly chooses “Use saved cart.” An ownership conflict instead offers a session retry and never implicitly discards the private draft.
- Saved-cart mutations are serialized in the website client. Pending full replacements for the same account/location coalesce to the newest snapshot. Existing Retry-After handling remains. Clear/delete operations cancel queued writes, wait for already-started requests, and do not allow their callbacks to revive cleared state. When a canceled request has already committed, its acknowledged revision is retained for the subsequent empty save.
- The backend returns an opaque revision derived from existing cart fields and checks `expected_revision` inside the existing advisory-lock transaction. Conflicting stale saves receive `SAVED_CART_CONFLICT`. Identical-content retries remain no-ops and do not renew expiry. Changed saves use monotonically increasing existing `updatedAt` values so rapid A→B→A edits cannot reuse a revision. No schema migration or new database column is required.
- Checkout completion converts the saved cart inside the order transaction. If no cart has reached the server yet, it creates an empty CONVERTED marker using the existing table; a delayed first save with a null base revision is then rejected. Reads expose only the marker's revision and empty/default contents, never historical lines. A stale browser draft is invalidated; a genuinely new draft based on that marker can still start a fresh cart. Existing order records and financial calculations are unaffected.
- The `X-Cart-Owner` consistency header is checked against the authenticated server identity or guest identity. It does not grant authentication. The website proxy explicitly forwards it. This prevents an old queued request from being attributed to a different current account, including an otherwise empty destination cart.
- Cart and checkout keep their restoration screen visible until restoration finishes or a recoverable error is identified. Both show retry/conflict recovery controls rather than a false empty-cart screen. Checkout waits for successful hydration before quoting/submitting. A placed order remains successful if redundant cart cleanup fails, and an old checkout response cannot clear a different account's current cart or expose the previous account's order. After successful checkout, the provider reads the converted cart revision before accepting another order's edits instead of autosaving an empty snapshot against the previous revision.

Changed application files:

| Area | Files |
| --- | --- |
| Cart restoration and persistence | `apps/web/src/lib/cart.ts`, `apps/web/src/lib/saved-cart-api.ts` |
| Session ownership | `apps/web/src/lib/session.tsx` |
| Customer screens | `apps/web/src/Wings4u/components/cart-page.tsx`, `apps/web/src/app/checkout/checkout-client.tsx`, new `apps/web/src/components/cart-restoration-error.tsx` |
| Proxy ownership guard | `apps/web/src/app/api/v1/[...path]/route.ts` |
| Saved-cart API and storage | `apps/api/src/modules/saved-cart/cart-store.interface.ts`, `saved-cart.types.ts`, `saved-cart.controller.ts`, `saved-cart.service.ts`, `db-cart-store.ts` |
| Transactional checkout clearing | `apps/api/src/modules/checkout/checkout.service.ts` |

Changed/added regression files:

- `apps/web/tests/cart-hydration-expiration.test.cjs`
- `apps/web/tests/cart-refresh-pages.test.cjs`
- `apps/web/tests/saved-cart-api-recovery.test.cjs`
- `apps/web/tests/session-initialization.test.cjs`
- `apps/web/tests/security-proxy-catalog.test.cjs`
- `apps/api/src/modules/saved-cart/db-cart-store.spec.ts`

Regression coverage includes rendered `/checkout` and `/cart` restoration, slow signed-in session initialization, guest refresh before autosave, draft restoration, failed/delayed/malformed requests, request timeout, slow serialized and coalesced writes, revision conflicts, rapid same-millisecond edits, Retry-After, explicit clearing, successful checkout with cleanup failure, delayed checkout across an account switch, idle expiration, expired drafts, logout, cross-user isolation, and unavailable browser storage.

Verification:

- Website: 45 suites / 363 tests passed.
- API: 79 suites / 1,776 tests and one snapshot passed.
- Mobile compatibility: 70 suites / 1,092 tests passed. An initial run encountered stale Jest transform-cache failures in unchanged token/session tests; clearing the Jest cache and rerunning the full suite passed without mobile source changes.
- API, website, and mobile TypeScript checks passed.
- API Nest build and website production build passed.
- `git diff --check` passed. Delivery-pricing files, the 20 km maximum, tax/discount calculations, Prisma schema, migrations, and seed files have no changes from the current commit. The checkout service changes only add saved-cart conversion to successful order completion; historical orders are not rewritten.

Remaining risks and limits:

- Validation uses rendered component tests and mocked API/database operations. Live production browser ordering and a database-backed end-to-end run were not performed.
- Saved-cart conversion now participates in the order transaction: a storage failure during conversion rolls back the new order rather than accepting an order while leaving its cart live.
- Revision and expected-owner parameters are additive to preserve compatibility with existing native/older clients. Updated website saves use them; legacy clients that omit them retain unconditional full-replacement behavior. Rolling the web and API portions out together is necessary for the new protection. Conflicting edits from multiple clients are surfaced for recovery rather than silently merged.
- Browser-draft recovery requires sessionStorage. When browser storage is blocked or exhausted, server restoration still works, but unsaved changes cannot be guaranteed to survive a refresh before the server accepts them.
- These changes prevent the identified future loss paths. They cannot reconstruct a cart whose browser draft and server contents were both already overwritten before the fix.

Verification was completed locally before publication. The user subsequently authorized committing and pushing these changes to main; that push may trigger production auto-deployment. No manual deployment, migration, seed, or production-data modification was performed. Prisma client generation was local build preparation only.
