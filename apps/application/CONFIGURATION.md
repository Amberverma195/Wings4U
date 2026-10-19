# Mobile API configuration

The app uses the existing NestJS API, never a database connection. Public Expo configuration is resolved by `app.config.js`.

- Local development: `npm run start --workspace @wings4u/application` retains the configured LAN origin (`extra.developmentApiOrigin` in `app.json`). Android emulators retain the host-loopback override `http://10.0.2.2:3001`.
- Release builds and EAS profiles other than `development` require `EXPO_PUBLIC_API_ORIGIN`. Set it to the **same deployed NestJS/Railway API origin used by the website's `API_PROXY_TARGET`**, without `/api` or any path. There is no guessed production default. A release cannot fall back to the LAN development address.
- `MOBILE_APP_ENV=production` explicitly enables production validation; `MOBILE_APP_ENV=development` explicitly selects the local configuration. Release runtime still requires a public HTTPS origin.
- Optional `EXPO_PUBLIC_REALTIME_ORIGIN` overrides Socket.IO's origin; otherwise it uses the API origin.
- `EXPO_PUBLIC_DEFAULT_LOCATION_ID` sets the initial location. Cart pricing and coupons always send the cart's current location.
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the public Stripe client key. The existing `/payments/stripe/config` endpoint remains authoritative for checkout availability/configuration.

These variables are public app configuration. Never put database URLs, Resend secrets, Stripe secret keys, or other credentials in Expo extras. Set release values manually in the build environment; this source change does not change Railway, Vercel, or EAS settings. Rebuild after changing public configuration.
