/** Public policy inventory audited against cookie setters and client storage, 2026-10-23. */
export const CUSTOMER_COOKIES = [
  ["access_token", "Keep you signed in and authorize account requests.", "15 minutes; replaced when the session is refreshed."],
  ["refresh_token", "Continue an authenticated session without another sign-in.", "30 days per issued cookie; may be renewed during session refresh. Removed on sign-out."],
  ["csrf_token", "Protect authenticated requests against cross-site request forgery.", "30 days per issued cookie; may be renewed with authentication. Removed on sign-out."],
  ["w4u_guest_cart", "Find your guest shopping cart without a customer account.", "Up to 7 days from the last changed cart save. Reading or saving identical contents does not extend the deadline; clearing or merging the guest cart clears the cookie."],
  ["w4u_signup_device", "Limit repeated or abusive sign-up attempts.", "180 days per issued cookie. A new browser identifier can replace it; signing out does not normally remove it."],
] as const;

export const STAFF_COOKIES = [
  ["w4u_kds_session", "Authenticate an authorized restaurant kitchen station.", "8 days per issued station session, unless revoked earlier."],
  ["w4u_pos_session", "Authenticate an authorized restaurant point-of-sale station.", "12 hours per issued station session, unless revoked earlier."],
] as const;

export const LOCAL_STORAGE = [
  ["Browser sign-up identifier (localStorage: w4u_signup_device_id)", "Random abuse-prevention ID and its creation/expiry dates; also sent with sign-up requests.", "Fixed 180-day lifetime, not extended by reading. Expired or undated legacy IDs are discarded when the website next loads or attempts sign-up; localStorage does not erase itself while the site is closed."],
  ["Cross-tab sign-out marker (localStorage)", "A timestamp/random marker that tells other open tabs to clear their session; not a password or browsing history.", "Replaced on later sign-outs or removed when you clear site data; no separate automatic expiry."],
  ["Cart recovery (sessionStorage)", "Recent cart items and ordering settings recover a failed or delayed save; the server may also hold a saved cart.", "Only drafts up to 24 hours old are accepted, and known expired server carts are not restored. Earlier cleanup on cart clearing or account changes. Tab/session storage may end sooner."],
  ["Address drafts, opt-in and saved-address cache (sessionStorage)", "Delivery details for the current order, explicit guest save preference, and a local copy of your address book.", "Browser tab session, or earlier replacement/cleanup on account changes. An order-only address is not added to the account address book unless you choose to save it."],
  ["Delivery quote (sessionStorage)", "Signed delivery quote, fee, expiry and attribution, indexed by a hashed address key; no exact route distance.", "Until its stated expiry (currently up to 1 hour) or earlier cleanup; expired entries are removed when accessed and by active-page timers."],
  ["Ordering, checkout and navigation state (sessionStorage)", "Pickup/delivery choice, schedule, tip, promo/reward choice, item-edit selection, return routes, sign-in identifier step and one-time error messages.", "Generally the browser tab session; specific handoffs are cleared after use, order completion or account cleanup. Session restoration can restore tab storage."],
  ["Native access and refresh tokens (Expo SecureStore, with in-memory fallback)", "Authorize mobile account requests and refresh your session.", "Server authorization has its own expiry (access tokens 15 minutes; refresh sessions up to 30 days). Local copies are replaced or cleared on sign-out/session cleanup; token expiry does not itself erase device storage."],
  ["Native sign-up identifier (Expo SecureStore, with in-memory fallback)", "Random sign-up abuse-prevention identifier sent to the API.", "No application-level time expiry is currently implemented on native. It survives ordinary sign-out and account deletion until cleared through application/device storage cleanup; it is separate from the web identifier's 180-day limit."],
  ["Native cart recovery (AsyncStorage)", "Cart items and settings needed to recover a recent save.", "Only drafts up to 24 hours old are accepted; known cart expiry, cart clearing and account changes also invalidate or clear drafts."],
  ["Native order setup and promo choice (AsyncStorage)", "Selected address, pickup/delivery and schedule, and a chosen promo code.", "Order setup is revalidated and expires after 15 minutes away or when its scheduled time has passed. A promo choice has no independent time expiry; replaced/cleared by selection or account/device cleanup. Expiry checks do not guarantee immediate physical erasure while the app is closed."],
  ["Staff-only pending stamp grants (sessionStorage)", "A pending grant's amount, reason, optional staff note and request reference let staff safely retry an uncertain result.", "Browser tab/session, or earlier removal after confirmed success or a definitive rejection. No independent time expiry; closing the dialog does not remove an uncertain request."],
] as const;
