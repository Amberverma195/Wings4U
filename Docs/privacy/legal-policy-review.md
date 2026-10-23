# Privacy, terms and storage disclosure review

Reviewed October 23, 2026. Local implementation only; not published or legally certified.

## Result and scope

The existing `/privacy` and `/terms` routes now contain comprehensive, linked policies for the website and native app. No duplicate legal routes were added. Website footer and native authentication/profile links expose both documents. The public policies describe current in-person payment collection, Google Routes address processing, actual storage lifetimes, saved-cart expiry, account deletion, support, promotions, rewards and reviews.

No cookie banner was added. Source inspection and the limited unauthenticated website network check identified essential ordering/authentication/security storage, with no optional advertising or behavioural analytics integration identified. This is a scoped engineering finding, not a determination that every processing activity satisfies Canadian privacy law.

No production database mutations, migrations, seeds, cleanup, database-connected tests, environment changes, deployments, merges, commits or pushes were performed. No project dependencies were added. Browser review tooling ran outside the repository against isolated static renderings and read-only public pages. The pre-existing change to `Docs/account-deletion.md` was left untouched and is outside this task.

## Baseline audit and corrections

The previous policies accurately covered basic account/order data, abuse prevention, delivery-route processing, expiring quotes and customer support. These topics and the canonical URLs/metadata pattern are preserved. The previous Terms' wording authorizing a selected payment method could imply online collection. It has been replaced with explicit physical cash/card collection preferences. Generic payment-provider wording is now specific to physical terminals.

The earlier policies omitted the full cookie inventory, native storage differences, service-provider purposes, support/review/reward records, actual account-deletion conditions, refund handling, promotions/rewards eligibility and accessible policy navigation. The shared footer had no legal-document links. Mobile registration/profile lacked a common pair of links.

Inspected source includes the requested legal pages, root layout, footer, auth shell, checkout, mobile auth/profile/order setup, API auth/deletion policy, guest-cart cookies, cart/address/quote modules, mobile token storage, and related checkout, saved-cart, payment/refund, rewards, reviews, support and notification services. Backend setters contain the seven application-defined cookies listed below; no additional application cookie setter was found. Infrastructure/provider-added cookies outside the observed public flows remain outside this source inventory.

## Changed files

| Files | Change |
|---|---|
| `apps/web/src/app/privacy/page.tsx` | Rewrite existing Privacy Policy, retain route and SEO helper. |
| `apps/web/src/app/terms/page.tsx` | Rewrite existing Terms, retain route and SEO helper. |
| `apps/web/src/components/legal-page.tsx`, `legal-page.module.css` | Shared server-rendered layout, contents anchors, semantic headings/tables, focus treatment, responsive/print styles. |
| `apps/web/src/lib/legal-disclosures.ts` | Public cookie and local-storage inventory. |
| `apps/web/src/components/site-footer.tsx`, `site-footer-legal.module.css` | One accessible Next.js link per policy; existing footer content retained. |
| `apps/web/src/app/checkout/checkout-client.tsx` | Google Maps attribution presentation only: readable 12px text, supported dark colour, no translation/wrapping of the brand name. Existing display condition and quote/checkout logic unchanged. |
| `apps/application/src/components/legal-links.tsx` | Reusable accessible browser links with an opening-failure alternative. |
| `apps/application/src/components/auth-sheet.tsx`, `apps/application/app/(tabs)/profile.tsx` | Render legal links within the existing scrolling content. |
| `apps/application/src/lib/env.ts` | Derive `/terms` on the configured privacy-policy website origin; remove query/fragment. |
| `apps/web/tests/legal-pages.test.cjs` | Rendering, contents, cookie/source contract, Google links, payment/deletion wording, footer, and scoped tracking-claim checks; optional offline visual fixtures. |
| `apps/application/tests/legal-links.test.cjs`, `mobile-env.test.cjs`, `profile-tab.test.cjs` | Link actions/failure handling, configured terms URL and existing profile mock compatibility. |
| `Docs/privacy/legal-policy-review.md` | This review and verification record. |

Authentication, CSRF, cookie setters, device identifier retention, cart expiry, address saving, quote calculation, payment/refund processing, rewards and account-deletion logic were not changed.

## Policy coverage

Privacy has 13 sections: identity/contact; collected data; purposes; **Google Maps and Delivery Pricing**; providers/sharing; cookies; browser/native storage; retention; security; service/marketing messages; access/correction/deletion; children; updates.

Terms has 16 sections covering restaurant/service identity; accounts; order submission/acceptance; prices/taxes/fees; pickup/delivery/scheduling; Maps/quotes; in-person payments; changes/cancellation; complaints/refunds/disputes; coupons/first-order offers/specials; stamps/rewards; reviews/messages; allergies; acceptable use/availability; intellectual property/external services; rights/updates/contact. Some requested topics share a section.

Verified operating identity/contact is Wings 4 U, 1544 Dundas St, London, ON N5W 3C1, telephone (519) 488-0800. No corporate entity, privacy officer or email address was invented. Privacy requests use the restaurant telephone or signed-in account support.

Pickup payment is cash or a physical terminal at the store. Delivery payment is cash or the driver's physical terminal. A collection preference is not proof of payment. Refunds go through staff/support and the applicable cash/original-terminal process or eligible agreed account credit; no automatic online reversal or invented deadline is promised. Physical terminal procedures require owner confirmation.

Promotion rules come from current server eligibility. Party specials are excluded from coupon-eligible merchandise; lunch has its own schedule/configured eligibility rather than an invented universal coupon exclusion. Coupons and Wings redemption do not stack. A configured first-order offer can bundle benefits within that one offer. Regular wings, wing combos and configured party packs can earn paid-weight stamps; lunch and Wings 4 U Special do not. Fractional qualifying paid pounds round down. Current redemption requires eight available stamps and an eligible individual 1 lb item, with eligibility rechecked at checkout. These facts are documented, not changed.

Deletion links lead to `/account/delete` and the existing mobile profile flow. Documentation explains eligibility/status checks, password confirmation, unresolved obligations, explicit rewards-loss confirmation, session removal and minimized retained records. No real account deletion or production gate verification was performed in this task.

## Complete application cookie inventory

Lifetimes describe an issued cookie, not guaranteed destruction of server records. Revocation/clearing may end use sooner.

| Cookie | Audience/purpose | Lifetime and lifecycle |
|---|---|---|
| `access_token` | Customer authentication | 15 minutes; replaced on refresh. |
| `refresh_token` | Customer session refresh | 30 days per issued cookie; renewable on refresh, removed on sign-out. |
| `csrf_token` | Customer request security | 30 days per issued cookie; renewable with authentication, removed on sign-out. |
| `w4u_guest_cart` | Guest-cart lookup | Up to seven days from a changed cart save, aligned to cart expiry; reads/identical saves do not refresh it; clear/merge removes it. |
| `w4u_signup_device` | Sign-up abuse prevention | 180 days per issued cookie. Reissuing a new/different browser identifier can replace it; ordinary sign-out does not remove it. |
| `w4u_kds_session` | Staff kitchen station authentication | Eight days per issued station session, unless revoked sooner. |
| `w4u_pos_session` | Staff POS station authentication | Twelve hours per issued station session, unless revoked sooner. |

Sources: `apps/api/src/modules/auth/auth.controller.ts`, `saved-cart/guest-cart-cookie.ts`, `saved-cart/saved-cart.types.ts`, `kds/kds-auth.controller.ts`, `kds/kds-auth.service.ts`, `pos/pos-auth.controller.ts`, `pos/pos-auth.service.ts` (module paths relative to `apps/api/src/modules`). Cookie/session values are not included in this report.

## Complete application browser/native storage inventory

Browser `localStorage` survives closing tabs until explicitly removed. `sessionStorage` belongs to a tab/session and may be restored by the browser. Native SecureStore and AsyncStorage persist independently of a browser. Application deadlines normally invalidate data and remove it on a later check; a closed app does not continuously purge physical storage.

| Store / key | Data and purpose | Validity / cleanup |
|---|---|---|
| localStorage `w4u_signup_device_id` | Random ID plus creation/expiry timestamps for sign-up abuse prevention; sent with sign-up. | Fixed 180 days, no read renewal. Expired/undated legacy values replaced on next load/signup. Browser clear removes it sooner. |
| localStorage `wings4u:auth-session-cleared` | Timestamp/random cross-tab sign-out marker; no password. | Replaced on later sign-out; no independent TTL. |
| sessionStorage `wings4u.cart-items-draft-v1` | Cart recovery items/settings and owner/known expiry. | Only drafts up to 24 hours old accepted; known server expiry/account switch/clear also invalidates or clears. |
| sessionStorage `wings4u.order-context` | Pickup/delivery, schedule, delivery details, committed state and tip choice. | Tab/session, replacement, order/account cleanup; no separate universal TTL. |
| sessionStorage `wings4u.delivery-address` | Current order's delivery-address draft. | Tab/session, replacement/account cleanup. Does not itself save to server address book. |
| sessionStorage `wings4u.delivery-addresses` | Guest/local address list and mirrored signed-in saved-address cache. | Tab/session, refresh/account cleanup. Server address-book rows have a separate lifecycle. |
| sessionStorage `wings4u.pending-guest-delivery-address.explicit-v2` | Explicit guest preference/address to save when authenticated. | Cleared on consumption/account cleanup; tab/session otherwise. Legacy `wings4u.pending-guest-delivery-address` is removed, not treated as consent. |
| sessionStorage `wings4u.delivery-quotes.v2` | Quote token, fee, expiry, attribution; indexed by hashed address key. | Stated expiry, currently up to one hour; removal on access and active timers. No exact distance in cache. Legacy `.v1` removed. |
| sessionStorage `wings4u.cart-edit-key` | Item-edit handoff. | Removed after consumption/invalid selection; tab/session otherwise. |
| sessionStorage `wings4u.apply-wings-reward` | Redemption selection between cart/checkout. | Selection, completion/account cleanup or tab/session. |
| sessionStorage `wings4u.reward-add-1lb-wings` | Add eligible reward item handoff flag written by the cart; no active consumer read found. | Tab/session or account-deletion cleanup; no independent TTL. |
| sessionStorage `wings4u.promo-checkout-handoff` | Chosen promo code, not a guaranteed discount. | Consumed/cleared during checkout/account cleanup; tab/session otherwise. Legacy `wings4u.promo-applied` removed. |
| sessionStorage `w4u_login_identifier_pending` | Login identifier for the password step, not the password. | Authentication-step cleanup or tab/session. |
| sessionStorage `wings4u:auth-handoff-error` | One-time sign-in handoff error. | Removed when read; tab/session otherwise. |
| sessionStorage `wings4u:current-route`, `wings4u:previous-route`, `wings4u:support-return-route` | Navigation/return routes. | Updated during navigation; tab/session. |
| sessionStorage `wings4u:pending-stamp-grant:<customerId>` | **Staff only:** amount, reason, optional internal note and retry request reference. | Removed on confirmed success/definitive rejection; uncertain results survive closing the dialog. No independent TTL beyond tab/session. |
| Expo SecureStore `wings4u_access_token`, `wings4u_refresh_token` | Native authentication; in-memory fallback if secure storage unavailable. | Authorization validity is 15 minutes / up to 30 days respectively. Local copies replaced/cleared by session lifecycle; expiry alone does not erase device bytes. |
| Expo SecureStore `wings4u_signup_device_id` | Native random sign-up abuse-prevention ID; in-memory fallback. | **No application TTL.** Survives ordinary sign-out and account deletion. Removed only by relevant application/device storage cleanup. Do not assume uninstall clears secure storage on every platform. |
| AsyncStorage `wings4u.mobile-cart-draft-v1:<locationId>` | Native cart recovery with owner/known expiry. | Only drafts up to 24 hours old accepted; account/clear/known-expiry checks also apply. |
| AsyncStorage `wings4u.order-setup-v2:<locationId>:<owner>` | Native address, pickup/delivery and schedule. | Revalidated; invalid after 15 minutes away or a passed schedule. Owner changes clean previous selection. Legacy `wings4u.order-setup-v1:<locationId>` removed. |
| AsyncStorage `wings4u.mobile-promo-selection-v1` | Owner-scoped native promo selection. | No independent TTL; replacement/selection/account/device cleanup. |

The public table groups related keys into eleven readable categories, including staff-only storage. Exact names above are engineering reference identifiers, not values. In-memory component state and operating-system/provider-managed caches are not claimed to be exhaustively inventoried.

The web identifier already had a fixed 180-day implementation before this task. The cookie can be issued on a different date; matching maximum durations do not imply identical expiration timestamps. Native intentionally retains a different abuse-prevention lifecycle. No retention/security code was changed merely to make the disclosures match.

Guest server carts logically expire after seven days and customer carts after thirty days without a meaningful update. Reads/no-op saves do not extend the deadline. Legacy rows fall back to their saved-update timestamp. Expired rows may remain physically stored; local draft deletion does not delete an order or account. Other financial/support/security/backups retention requires an owner-approved schedule, not an invented statutory period.

## Google Maps and provider audit

The backend's `google-routes.client.ts` submits restaurant origin, destination address and driving-route settings to Google Routes. It does not intentionally add names, phones, email, account IDs or payment details. Pickup avoids this route request. Google controls its own processing/retention. Order-address snapshots, saved address-book entries and local address drafts are distinct from route results. Exact route distance is used to compute fees, not stored in order records or the derived fee/availability cache; quotes/cache validity is up to one hour. No new Google API calls were made for testing.

Both policies link Google Privacy, Google Terms and Maps Platform Terms. These three destinations were successfully retrieved during review. Website checkout keeps its existing conditional Google attribution next to the fee, with readable, untranslated, unbroken brand text. Existing native checkout attribution is retained. This follows the text-attribution presentation guidance; it does not establish that every Maps contractual obligation has been audited. See [Routes API policies and attribution](https://developers.google.com/maps/documentation/routes/policies) and [Maps Platform Terms](https://cloud.google.com/maps-platform/terms).

| Provider/integration | Evidence and role | Review limit |
|---|---|---|
| Vercel | Website hosting/request processing; deployment architecture and repository configuration. | Dashboard settings, access logs, regions and subprocessors not independently audited. |
| Railway | API hosting/server processing. | No deployment or environment changes; live infrastructure settings unverified. |
| Supabase | PostgreSQL hosting for accounts/orders/operations. | No direct DB operations/tests; backup/export retention and region unverified. |
| Resend | Verification/auth, order-status and rewards-related emails. | Actual delivery settings and messaging consent/content need operational review. |
| Google Maps Platform | Server-side destination-address route calculation. | No provider retention or Canadian residency guarantee. |
| Stripe | Payment infrastructure remains in source; online customer payments are disabled under the stated operating model. Native root still mounts `StripeProvider`. | **Do not equate dormant checkout with an absent SDK. Native initialization/telemetry was not network tested.** Future activation requires renewed disclosure/consent and payment review. |
| Physical card terminal provider | Processes in-person card transactions under the owner-described collection model. | Provider identity/contract and operational refund process require owner confirmation. |

## Tracking audit and banner decision

Searches covered web/native source and dependencies for GA4, Google Tag Manager, Google Ads, Meta Pixel, Vercel Analytics, Clarity, Hotjar, PostHog, Plausible, Sentry and other injected analytics/tracking scripts. None of those optional integrations was identified. Next/font Google fonts are self-hosted in the deployed app; build-time font downloads are different from visitor tracking.

A fresh, unauthenticated headless Edge session visited `/`, `/login`, `/signup` and `/order?cat=wings` on the live public website. Every non-GET/HEAD/OPTIONS request was blocked before transmission. No credentials, personal address, actual account, order, refund, deletion or payment was submitted. The cart's attempted PUT was blocked. Observed request hosts and script hosts were limited to `www.wings4ulondon.ca`; no external request host or cookies were observed. No localStorage keys were observed. Session keys observed were order context, cart recovery and current/previous/support-return routes. Script/resource queries, request bodies, cookie values and secrets were not retained in the review evidence.

This does not establish absence of optional tracking after authentication, consent-dependent features, server-side integrations, other deployment versions, native SDK initialization or off-site links. The in-app browser connection failed before executing code (`missing field sandboxPolicy`); isolated headless Edge supplied the browser/network evidence instead. See [sanitized network evidence](review-artifacts/live-tracking-check.json).

**Decision:** accurate essential-feature disclosure without a new consent banner is appropriate for the inspected implementation because no separate optional tracking was identified. This is an engineering recommendation within the tested scope. Reassess before introducing analytics/advertising, activating payments, or changing SDKs. A policy page does not replace meaningful, contextual consent when required. The [OPC meaningful-consent guidelines](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/) support clear purposes, sharing information and choices rather than a blanket compliance assertion.

## Verification results

| Check | Actual result |
|---|---|
| Web Jest: legal-pages, signup-device, web-a11y-semantics, delivery-address, cart-hydration-expiration, account-deletion-session | **PASS: six suites, 64 tests.** API/session dependencies mocked; no live database tests. |
| Final legal-page fixture/content rerun after wording/style refinements | **PASS: one suite, 11 tests** (included in the 64, not additional unique tests). |
| Mobile Jest: legal-links, mobile-env, auth-sheet, profile-tab, order-setup-modal, checkout-entry-guard, mobile-checkout-quote-identity, checkout-preparation | **PASS: eight suites, 188 tests.** Mocked/local tests only. |
| Web TypeScript `npx tsc --noEmit -p apps/web/tsconfig.json` | **PASS.** |
| Mobile TypeScript `npx tsc --noEmit -p apps/application/tsconfig.json` | **PASS.** |
| `git diff --check` | **PASS.** |
| Public Google Privacy/Terms/Maps Platform links | **PASS:** retrieved; link hrefs also covered in both policy renders. |
| Isolated Edge legal-page previews at 1365x900 and 390x900 | **PASS:** one main/h1, no page-width overflow; tables scroll internally on narrow screens. |
| Keyboard in isolated previews | **PASS:** Tab/Enter contents navigation focuses the destination section; Tab reaches scroll regions, ArrowRight scrolls the narrow cookie table, and both footer links have visible focus and 44px height. |
| Offline production web build | **FAIL / incomplete:** existing next/font Google downloads blocked by the outbound-socket safety preload. Build stops fetching Bebas Neue, Black Han Sans, DM Sans, Libre Baskerville and Oswald. No production-ready build is claimed. |
| Native device binary, VoiceOver/TalkBack, authenticated live checkout, real deletion/refund, provider telemetry | **NOT RUN / unverified.** No production mutations authorized. |

Web test command: `npm run test --workspace @wings4u/web -- --runTestsByPath tests/legal-pages.test.cjs tests/signup-device.test.cjs tests/web-a11y-semantics.test.cjs tests/delivery-address.test.cjs tests/cart-hydration-expiration.test.cjs tests/account-deletion-session.test.cjs --silent`.

Mobile test command: `npm run test --workspace @wings4u/application -- --runTestsByPath tests/legal-links.test.cjs tests/mobile-env.test.cjs tests/auth-sheet.test.cjs tests/profile-tab.test.cjs tests/order-setup-modal.test.cjs tests/checkout-entry-guard.test.cjs tests/mobile-checkout-quote-identity.test.cjs tests/checkout-preparation.test.cjs --silent`.

Build command: `npm run build:web` with process-only `NODE_OPTIONS=--require=D:/Projects/Websites/Wings4U/Code/packages/customization/offline-validation.cjs`. The existing preload blocks outbound sockets while allowing local build IPC; no production connection settings were changed.

The initial mobile profile test needed its existing environment mock extended for the new legal-link helper; the corrected suite passes. An exploratory keyboard script's extra Home key produced an off-screen footer focus in narrow Edge; removing that extraneous scroll command produced a passing normal Tab flow. This is not a claim that all browser/key combinations were audited.

Visual fixtures render real policy components and global/legal/footer CSS, with footer menu/hours/branding dependencies mocked and a system-font fallback. They do not include the full interactive navigation shell or native screens. Screenshots were inspected. New palette contrast calculations: body/white 15.66:1; links/white 7.72:1, cream 7.21:1, contents background 6.68:1; footer links/dark background 19:1; native link colour/white 8.61:1. These are checks of the new colours, not a complete WCAG or device audit.

Review artifacts: [Privacy desktop](review-artifacts/privacy-1365.png), [Privacy phone](review-artifacts/privacy-390.png), [Terms desktop](review-artifacts/terms-1365.png), [Terms phone](review-artifacts/terms-390.png), [phone cookie-table focus](review-artifacts/privacy-cookies-390.png), [phone footer focus](review-artifacts/footer-legal-390.png), [layout/anchor checks](review-artifacts/visual-checks.json), [table/footer/contrast checks](review-artifacts/keyboard-tables.json). Artifacts are local generated review evidence, not product assets.

## Owner/legal confirmation before publication

1. Confirm the registered legal entity/trade name and who handles privacy access/correction/withdrawal/deletion requests. Telephone/support are real contact routes, but internal response ownership and procedures are not established by code.
2. Approve record-specific retention, disposal, backups/export and legal-hold practices. Seven/thirty-day cart validity is not physical deletion. Review the native identifier's indefinite retention and whether a future carefully tested change is appropriate.
3. Confirm physical terminal provider and refund eligibility/remedy procedures, including staff handling of cash, original-terminal returns and agreed store credit. No deadline or guaranteed resolution time was invented. [Ontario returns/exchanges guidance](https://www.ontario.ca/page/returns-exchanges-and-warranties-ontario) informed preserving consumer remedies rather than a universal no-refunds or automatic-refund rule. Direct fetch returned 403; official search-indexed content was available. Ontario online-order contract/disclosure requirements still warrant legal review.
4. Review actual promotional and rewards-email content and any offline marketing lists under CASL. No general newsletter consent ledger or automated unsubscribe pipeline was identified; the website's newsletter-labelled component is an ordering promotion. Service-related labels alone do not decide a message's legal classification. The [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm) describes consent, sender identification and unsubscribe requirements for commercial electronic messages. No claim of a verified CASL exemption or compliance is made.
5. Confirm provider accounts, regions, subprocessors, logs, backup retention and contractual privacy terms. Perform native device network review of Stripe initialization and other SDK behaviour before asserting absence of nonessential native telemetry.
6. Decide the intended age/audience and appropriate consent handling with legal advice; no minimum age or parental-consent mechanism was invented.
7. Recheck live deletion gating/status and store-app legal URL configuration without deleting a real account. This task verifies documentation/entry points and mocked regressions, not a production deletion transaction.
8. Review allergy/ingredient, cancellation, reward/promotion and consumer-law wording against actual restaurant procedures before release. Policy text is not evidence of full legal compliance.
9. The pages say **Last updated October 23, 2026**, the local revision date. They do not claim this draft is already effective in production. Check/update the date to the actual release date when publication is authorized, and provide material-change notice/consent where applicable.

The implementation and reviewable diff are complete locally. Publication and any additional operational/legal work above have not been performed.
