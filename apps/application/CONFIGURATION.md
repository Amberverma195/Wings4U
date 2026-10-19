# Mobile API configuration

The app uses the existing NestJS API, never a database connection. Public Expo configuration is resolved by `app.config.js`.

- Local development: `npm run start --workspace @wings4u/application` retains the configured LAN origin (`extra.developmentApiOrigin` in `app.json`). Android emulators retain the host-loopback override `http://10.0.2.2:3001`.
- Release builds and EAS profiles other than `development` require `EXPO_PUBLIC_API_ORIGIN`. Set it to the **same deployed NestJS/Railway API origin used by the website's `API_PROXY_TARGET`**, without `/api` or any path. There is no guessed production default. A release cannot fall back to the LAN development address.
- EAS `production` and `preview` profiles (and other profiles except `development`) always require production-safe configuration. Combining one with `MOBILE_APP_ENV=development` fails configuration immediately, even if a public API origin is also provided. A production export without an EAS profile has the same conflict check.
- EAS `development` preserves the local LAN/emulator workflow, including when its build tooling sets `NODE_ENV=production`. Without an EAS profile, ordinary local development may use `MOBILE_APP_ENV=development`. `MOBILE_APP_ENV=production` may explicitly require public HTTPS for any build. Unknown environment values fail configuration.
- Production and preview require `EXPO_PUBLIC_API_ORIGIN`; they never use `developmentApiOrigin`. HTTP, IP addresses (including private/loopback), localhost and local-only/internal domains, credentials, query strings, fragments and paths are rejected before bundling. Release runtime validates the origin again.
- Optional `EXPO_PUBLIC_REALTIME_ORIGIN` overrides Socket.IO's origin; otherwise it uses the API origin.
- `EXPO_PUBLIC_DEFAULT_LOCATION_ID` sets the initial location. Cart pricing and coupons always send the cart's current location.
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the public Stripe client key. The existing `/payments/stripe/config` endpoint remains authoritative for checkout availability/configuration.

These variables are public app configuration. Never put database URLs, Resend secrets, Stripe secret keys, or other credentials in Expo extras. Set release values manually in the build environment; this source change does not change Railway, Vercel, or EAS settings. Rebuild after changing public configuration.
