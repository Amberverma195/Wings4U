# Mobile skeleton loading implementation

Original implementation branch: `feat/mobile-loading-skeletons`, based on `main` at `380dd2c32eda1230c0a38d23b66529a912058aea`.

The original skeleton implementation was committed and published to `main` in `fc050530bcd752131e06b91be9461f47413f644d`. Website and backend code were unchanged. The review corrections described below are a separate follow-up.

## Loading-state audit and coverage

| Screen/state | Skeleton condition | Layout / available content |
| --- | --- | --- |
| Home | `useMenu().loading && !menu`, with `cinematic` true | The actual local hero image, branded header, fulfillment/setup controls and search render immediately. Category tiles and three popular-item image/cards use a dedicated Home skeleton. Existing local Trending Flavours and footer promotional carousel remain visible and navigable. |
| Menu | `loading && !menu`, with `cinematic` false | Actual compact header, fulfillment/setup controls and search remain. Category navigation, category heading and a two-column product grid have placeholders matching the 48%-width cards, 112px images, name/description, price and action shapes. No Home hero. |
| Cart | `cart.isCartHydrating` | Item-count/setup row, two illustrative image/item rows, quantity controls, coupon/tip area, summary amounts and checkout shape. No fake item names, quantities, prices or cart records. The real checkout dock is hidden during hydration. |
| Profile authentication unresolved | `!session.loaded` inside the existing ProfileTabGuard | Public header/navigation/detail-field shapes only. No private profile or account data is rendered through the guard. Known guest authentication continues to use the existing sign-in sheet and busy state. |
| Profile Overview | Account initial load, no current-account ready data | Reward/coupon hub-tab shapes, stamp card with ring/progress slots and recent order previews. No fake stamp count, wallet amount, reward eligibility or coupon code. Known authenticated name/phone and actual section navigation remain visible. |
| Profile details | Profile identity is still unresolved | Name/contact field and action shapes are included in the guarded Profile skeleton. Once session fields are known, the actual editable profile is rendered even if unrelated rewards/orders requests are pending. Valid fields and edits are never replaced just because account data is loading. |
| Profile Orders | Account initial load without ready data | Active/Past filters and order-number/date/status/price/action card shapes. Successful empty history immediately uses the existing empty state. |
| Profile Addresses | Account initial load without ready data and without an open form | Heading/action shapes and saved-address cards. Loaded saved addresses, empty state and an open Add/Edit form remain real content. |
| Profile Support | Account initial load without ready data and without an open form | Existing help/action card and ticket-title/status/date/summary list shapes. Loaded tickets, empty state and unsent ticket form remain real content. |
| Orders pagination | `loadingMoreOrders` | One compact bottom-of-list placeholder. Earlier rows, selected filter, pagination safeguards and disabled/busy button remain. The follow-up below removes the original redundant button spinner. |
| Order detail | `order.loading && !order.order` | Header/status/action, metadata/estimate, item rows, inset amounts and status-history shapes. No speculative driver identity, PIN or fake order data. Valid cached detail is never replaced during realtime or HTTP refresh. |
| Orders / Deals redirect tabs | No new skeleton | Existing authenticated redirects into Profile sections and guest sign-in experiences are unchanged. No duplicate full-page loading overlay was added. |

The current Home has a local hero and a footer promotional carousel; a second top promotional carousel was not invented. The default Overview shows its rewards hub followed by recent orders; a separate coupon section was not invented. Existing local content is preferable to unnecessary placeholders.

## Reusable architecture

Added under `src/components/skeletons/`:

- `primitives.tsx`: strongly typed `SkeletonBlock`, `SkeletonText`, `SkeletonCircle`, `SkeletonImage`, `SkeletonCard`, and `SkeletonGroup`.
- `screen-skeletons.tsx`: Home, Menu, Cart, Profile authentication, five Profile section layouts, Orders pagination and Order-detail compositions.

The MenuScreen header JSX is reused in its initial and loaded renders. Its hero image, safe-area sizing, search, fulfillment and order-setup controls retain their existing implementation and styles. Loaded screens were not redesigned.

The account hook exposes a read-only `hasLoaded` flag based on existing request completion and ownership. When the hook already resets account contents, it now also resets the matching owner/readiness marker. No request, endpoint, timer, pricing rule or mutation was added. The initial account store still publishes its existing combined Promise.allSettled result; no extra per-section fetching was introduced.

Profile is keyed by authenticated user ID so another account cannot inherit the previous customer's open form/draft. Ordinary refreshes for the same account keep those components mounted.

## State distinctions preserved

- Background menu refresh with cached data keeps the menu and customizations while pending. The original error branch still replaced the screen on refresh failure; the follow-up below corrects that behavior.
- Cart pricing refresh keeps the actual items, available amounts and quantity controls; it is separate from persistence hydration.
- A successful empty array ends initial placeholders immediately and uses the existing empty state.
- Initial failures use the existing errors/retry paths rather than keeping skeletons indefinitely.
- Profile, address and ticket drafts remain mounted during refresh and submission. Existing saving/creating busy indicators remain.
- Order-detail refresh failure retains its existing cached-data warning and action-suppression safety behavior.
- Cancellation, chat/sending, Help, delivery PIN, driver contact, reviews, reorder, Socket.IO subscriptions/recovery and the HTTP fallback remain intact.
- No artificial loading duration or deferred reveal was introduced.
- The disabled Cards section stays disabled.

## Accessibility and performance

- One shared React Native Animated.Value and one loop per mounted group; nested groups reuse their parent's pulse.
- 1,400ms cycle: 700ms fade down, 700ms fade up. Base neutral is `#EAEAEA`; opacity produces a subtle light highlight against the existing surfaces.
- Both animation steps use the native driver and `isInteraction: false`. React does not rerender for each animation frame.
- Unknown or unavailable reduced-motion settings default to static placeholders. Live reduce-motion changes are respected, including races with the initial setting query.
- Animation pauses when the app backgrounds or its owning tab loses focus.
- Unmount stops the loop and Animated.Value, resets opacity and removes AppState/accessibility subscriptions. Late setting responses cannot restart a removed group.
- Rectangles are decorative and pointer-inert, with descendants hidden from accessibility. A busy progress group announces the loading purpose; no fake interactive controls or records are exposed.
- Existing real navigation/search controls remain outside the decorative groups and retain accessibility behavior.
- Layouts use the existing warm neutral/white cards, rounded corners, responsive percentages, matching product-image sizes and wrapping where needed.
- No dependency was added.

## Exact files added or modified

Paths relative to repository root:

- `apps/application/src/components/skeletons/primitives.tsx` — new shared primitives/animation.
- `apps/application/src/components/skeletons/screen-skeletons.tsx` — new loading layouts.
- `apps/application/src/screens/menu-screen.tsx` — distinct Home/Menu initial loaders and shared real header.
- `apps/application/app/(tabs)/cart.tsx` — hydration-only cart loader.
- `apps/application/app/(tabs)/profile.tsx` — section loaders, draft isolation and pagination footer.
- `apps/application/app/orders/[id].tsx` — initial-detail loader.
- `apps/application/src/components/profile-tab-guard.tsx` — unresolved-identity placeholders.
- `apps/application/src/hooks/use-account-data.ts` — initial-readiness metadata.
- `apps/application/tests/skeleton-native-mock.cjs` — new native animation/accessibility test seams.
- `apps/application/tests/skeletons.test.cjs` — new primitive/layout/accessibility/lifecycle tests.
- `apps/application/tests/footer-promotional-screen.test.cjs` — Home/Menu loading, cache, failure and static-content tests.
- `apps/application/tests/cart-tab.test.cjs` — hydration, empty cart and pricing-only loading tests.
- `apps/application/tests/profile-tab.test.cjs` — five sections, authentication, pagination, drafts, submissions and account-switch tests.
- `apps/application/tests/account-orders-pagination.test.cjs` — readiness, successful empty response, cache and account isolation.
- `apps/application/tests/order-feedback.test.cjs` — initial-detail skeleton assertions with existing error/action checks.
- `apps/application/tests/order-detail-realtime.test.cjs` — native test seams; existing realtime behavior still exercised.
- `apps/application/LOADING_SKELETONS.md` — this report.

The Home/Menu route wrappers, Orders/Deals redirect routes, cart persistence, pricing calculations, checkout preparation, API URLs and website/backend files were not changed.

## Original implementation validation actually executed

Relevant targeted tests passed before the final full run: 8 suites, 297 tests. The final full run includes the additional readiness-reset case.

```text
node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent

Test Suites: 62 passed, 62 total
Tests:       1008 passed, 1008 total
Snapshots:   0 total
Time:        13.371 s
Exit code:   0
```

This adds 40 test cases to the previous 968-test mobile suite. Existing auth/navigation, menu builders, cart/coupon/checkout, account pagination, support/review and local Socket.IO client/server tests also passed.

```text
npx tsc -p apps/application/tsconfig.json --noEmit
Mobile TypeScript exit code: 0

git diff --check -- apps/application
Exit code: 0
```

Android and iOS release exports both succeeded:

```text
# From apps/application, with:
EXPO_NO_DOTENV=1
NODE_ENV=production
EXPO_PUBLIC_API_ORIGIN=https://api.wings4ulondon.ca

npx expo export --platform android --platform ios --output-dir <temporary-directory>

ios bundles (1):     6.5 MB
android bundles (1): 6.8 MB
Exit code: 0
```

These are Expo JS/Hermes bundle exports, not signed APK/IPA builds. The public origin was bundled as configuration; no production app/API flow was exercised.

Local temporary logs/artifacts: `wings4u-skeleton-focused.log`, `wings4u-skeleton-full.log`, `wings4u-skeleton-export.log`, and `wings4u-skeleton-export`.

## Remaining device verification

No physical-device or simulator verification was performed. Before release, check layout on narrow phones/tablets, safe areas, visual transitions to real data, actual Android/iOS accessibility announcements, native reduced-motion changes and animation smoothness/battery behavior while switching tabs/backgrounding.

Automated tests verify state selection, shared animation configuration, cleanup and reduced-motion handling; they do not establish a measured frame rate or prove native visual alignment.

## Production and Git safety

No production database mutations, migrations, resets, seeds, live customer/checkout writes, credential changes, deployment changes, backend/website changes or production deployments were performed.

The original implementation was subsequently committed and pushed to `main` in `fc050530bcd752131e06b91be9461f47413f644d` after explicit authorization. No deployment was performed. Existing unrelated database-guard edits and root untracked files were preserved.

## Review corrections (2026-10-20)

Branch: `fix/mobile-skeleton-review`, based on latest fetched `origin/main` at `fc050530bcd752131e06b91be9461f47413f644d`. These corrections were implemented and validated locally before the user authorized publication to main. Publication is recorded in Git history; no deployment was performed.

### P2: menu refresh and context validity

Root cause: the screen's unconditional error branch replaced previously loaded content, while the hook retained data without identifying the store, fulfillment, schedule or navigation reload context that produced it.

The hook now stores menu/request status together with a key containing the effective location ID, fulfillment type, scheduled time and reload key. A context mismatch returns no menu and an initial-loading state during render, before request effects run. Context changes discard the old response; cancelled requests cannot publish a late success or failure. Manual/focus refresh nonce changes keep compatible data. No extra fetch was added; existing dependencies and request cancellation remain. Navigation reload keys require a fresh matching response as before.

The full-screen error now applies only when no compatible menu exists. A refresh failure with compatible content shows an inline accessible warning and Retry action. Cards remain mounted during retries; search/category state and the ScrollView are retained. Initial failures retain the existing Try Again flow. A missing compatible menu also clears open builder/edit/reward selection so an old-context product cannot reopen with a new menu. Availability, fulfillment, cart-edit and promotional-link checks remain.

### P3: one pagination indicator

Root cause: the pagination footer skeleton and the button ActivityIndicator were both rendered for the same pending request. The footer skeleton remains and the button spinner is removed. Button disabled/busy state and loading text remain. Existing rows, Active/Past filter, cursor handling, deduplication, synchronous request lock and failure/retry behavior are unchanged; no API or account-fetching architecture change was needed.

### P3: publication history

Root cause: this report described its original pre-publication state after the implementation had been pushed. Publication details now identify the actual original commit above, and original validation/safety information is retained as historical evidence. This section records the separate follow-up.

### Exact follow-up files

- `apps/application/src/hooks/use-menu.ts`: compatible cache ownership and atomic request state.
- `apps/application/src/screens/menu-screen.tsx`: inline refresh error/Retry and clearing incompatible product selection.
- `apps/application/app/(tabs)/profile.tsx`: remove duplicate pagination spinner.
- `apps/application/tests/use-menu.test.cjs`: initial failure/retry, compatible cache refresh/retry, all four context changes before effects, and late old-context success/failure.
- `apps/application/tests/footer-promotional-screen.test.cjs`: initial Retry through success and Home/Menu refresh failures, inline Retry, retained cards/search/category/scroll identity.
- `apps/application/tests/profile-tab.test.cjs`: exactly one pagination skeleton, no spinner and disabled/busy button.
- `apps/application/LOADING_SKELETONS.md`: corrected publication history and this follow-up report.

Existing account pagination tests also verify duplicate-call suppression before rerender, cursor preservation and retry after failure, deduplication, refresh races and account isolation. Existing screen suites exercise customization, cart editing, promotion navigation, profile section navigation and account switching.

### Follow-up validation

- Targeted initial run: 4 suites, 93 tests passed (before the two additional late-response cases and expanded initial Retry assertions).
- Complete mobile suite: **62 suites passed; 1,018 tests passed; 0 snapshots; exit 0**, 15.789 seconds. Command: `node node_modules/jest/bin/jest.js --config apps/application/jest.config.cjs --runInBand --silent`.
- TypeScript: `npx tsc -p apps/application/tsconfig.json --noEmit`, exit 0.

- Android and iOS Expo exports: `npx expo export --dev --platform android --platform ios --output-dir <temporary-directory>` from `apps/application`, exit 0. Both platforms produced a 14 MB JavaScript bundle plus assets/metadata. These are development bundle exports, not release/Hermes or signed APK/IPA builds; `--dev` uses the existing development configuration without setting or changing environment variables. No app/API flow was run.
- Whitespace: `git diff --check -- apps/application`, exit 0.
- Temporary logs: `wings4u-skeleton-review-tests.log`, `wings4u-skeleton-review-export.log`; export directory: `wings4u-skeleton-review-export` (all under the local temporary directory).

No physical-device or simulator testing was performed. Native visual alignment, smoothness and accessibility still require device QA. Production data, environment files/variables/secrets, deployment configuration, website and backend business rules were untouched. No database commands, live order/customer writes or deployments were executed. Unrelated local database-guard changes, root `.expo/` and root `tsconfig.json` were preserved.
