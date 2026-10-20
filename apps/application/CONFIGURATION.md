# Mobile API configuration

The app uses the existing NestJS API, never a database connection. Public Expo configuration is resolved by `app.config.js`.

- Local development: `npm run start --workspace @wings4u/application` retains the configured LAN origin (`extra.developmentApiOrigin` in `app.json`). Android emulators retain the host-loopback override `http://10.0.2.2:3001`.
- Development origin precedence: an explicit `EXPO_PUBLIC_API_ORIGIN` wins on every development target, including the Android emulator; otherwise the emulator uses `http://10.0.2.2:3001`, other targets use `developmentApiOrigin`, then `127.0.0.1:3001`.
- Development builds may target any local backend (loopback, `10.0.2.2`, private LAN addresses, local-only hostnames) without extra configuration. A remote backend, such as the deployed Railway API that the website KDS uses and that serves **production data**, additionally requires `MOBILE_DEV_REMOTE_API=allow`; configuration fails otherwise. The check applies to the effective development API origin, so it also covers a remote `developmentApiOrigin` in `app.json`.
- Release builds and EAS profiles other than `development` require `EXPO_PUBLIC_API_ORIGIN`. Set it to the **same deployed NestJS/Railway API origin used by the website's `API_PROXY_TARGET`**, without `/api` or any path. There is no guessed production default. A release cannot fall back to the LAN development address.
- EAS `production` and `preview` profiles (and other profiles except `development`) always require production-safe configuration. Combining one with `MOBILE_APP_ENV=development` fails configuration immediately, even if a public API origin is also provided. A production export without an EAS profile has the same conflict check.
- EAS `development` preserves the local LAN/emulator workflow, including when its build tooling sets `NODE_ENV=production`. Without an EAS profile, ordinary local development may use `MOBILE_APP_ENV=development`. `MOBILE_APP_ENV=production` may explicitly require public HTTPS for any build. Unknown environment values fail configuration.
- Production and preview require `EXPO_PUBLIC_API_ORIGIN`; they never use `developmentApiOrigin`. HTTP, IP addresses (including private/loopback), localhost and local-only/internal domains, credentials, query strings, fragments and paths are rejected before bundling. Release runtime validates the origin again.
- Optional `EXPO_PUBLIC_REALTIME_ORIGIN` overrides Socket.IO's origin; otherwise it uses the API origin. Order events only come from the API that handled the order, so in development and release builds a realtime origin that differs from the API origin is rejected whenever either one is remote. Two different local origins remain allowed for local development.
- `MOBILE_REALTIME_SAME_BACKEND_AS` is the only way to use a different realtime host, such as a separate WebSocket hostname in front of the same Railway service. Set it to the exact API origin, after confirming the realtime host routes to that same API service. It is rejected if it names any other origin, if no different realtime origin is set, or if the realtime origin already equals the API origin. Release builds repeat the check at runtime.
- `EXPO_PUBLIC_DEFAULT_LOCATION_ID` sets the initial location. Cart pricing and coupons always send the cart's current location.
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the public Stripe client key. The existing `/payments/stripe/config` endpoint remains authoritative for checkout availability/configuration.

## Choosing the backend while developing

Restart Metro with a cleared cache after changing these variables (`npx expo start -c`).

```powershell
# Default: Android emulator -> API running on this machine (http://10.0.2.2:3001)
npm run dev:app

# A physical phone on the same Wi-Fi as an API on this machine
$env:EXPO_PUBLIC_API_ORIGIN = "http://<this-machine-LAN-IP>:3001"; npm run dev:app

# The deployed API shared with the website KDS. Orders placed here are real orders.
$env:MOBILE_DEV_REMOTE_API = "allow"; $env:EXPO_PUBLIC_API_ORIGIN = "https://<railway-api-origin>"; npm run dev:app
```

Live order updates only arrive from the API process that handled the order, so the app and the KDS under test must use the same backend.

## Realtime transport

The app connects to the `/ws` Socket.IO gateway over WebSocket only (`wss://` on port 443 in release builds); the website KDS is unaffected. socket.io-client does not fall back to HTTP long-polling unless `tryAllTransports` is enabled, so the previous `["websocket", "polling"]` setting already behaved as WebSocket-only. On networks that block WebSockets (some corporate proxies, TLS-inspecting firewalls or captive portals) the order screen shows "Live updates unavailable", keeps refreshing the order over HTTP every 30 seconds, and refetches as soon as a connection succeeds. Polling is not enabled because it costs more battery and data, and needs sticky sessions if the API ever runs more than one instance. Enable it (`transports: ["websocket", "polling"]` with `tryAllTransports: true`) only if field reports show customers on such networks, and verify it against the deployed gateway first.

Reconnection has two layers. Network outages are retried by socket.io indefinitely (0.5–5 s, jittered) and recover when connectivity returns. Authentication and subscription failures (rejected or ended sessions, missing acknowledgements, connections dropped before going live) are retried at most five times with the session refreshed before each reconnect, then stop until the customer taps Retry or returns to the app.

These variables are public app configuration. Never put database URLs, Resend secrets, Stripe secret keys, or other credentials in Expo extras. Set release values manually in the build environment; this source change does not change Railway, Vercel, or EAS settings. Rebuild after changing public configuration.
