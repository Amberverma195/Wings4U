# KDS Realtime Incident: From Polling Fallback to a Working Socket.IO Subscription

## Purpose

This document explains the complete KDS realtime incident in chronological order:

1. The original symptom and why the KDS kept fetching tickets.
2. The first root cause: the KDS session cookie could not reach Railway Socket.IO.
3. The first fix: a shared API subdomain and shared station cookie.
4. The deployment issue encountered while applying that fix.
5. The new problem that became visible after WebSocket authentication worked.
6. The final root cause: `LON01` and the database location UUID represented the same location in incompatible forms.
7. The final code fix and the expected production workflow.

The goal is to preserve both the technical explanation and the practical debugging evidence so the same class of problem can be diagnosed quickly in the future.

## System Context

The production application uses two separate services:

- The Next.js website runs on Vercel at `https://www.wings4ulondon.ca`.
- The NestJS API and Socket.IO gateway run on Railway.

REST and realtime traffic intentionally follow different paths:

```text
Browser
  |
  | REST: /api/*
  v
Vercel same-origin proxy
  |
  v
Railway API

Browser
  |
  | Socket.IO: wss://api.wings4ulondon.ca/ws
  v
Railway realtime gateway
```

REST uses the Vercel proxy because it preserves a first-party web experience and forwards station-gate information. Socket.IO connects directly to Railway because Vercel's normal Next.js rewrite path is not the reliable place to proxy a long-lived WebSocket upgrade.

## Original Problem

The KDS screen repeatedly displayed messages such as:

```text
Loading kitchen tickets...
```

Later, after the fallback behavior was made visible, it displayed:

```text
KDS realtime is not connected. Using a background refresh every 60 seconds.
```

The original fallback had run much more frequently. This made the KDS repeatedly call the REST API to retrieve active tickets even when there were no new orders.

That behavior was undesirable for two reasons:

1. It created unnecessary API and PostgreSQL activity on Railway.
2. It concealed the actual Socket.IO connection failure because the screen continued to work through polling.

The fallback itself was not the fundamental bug. A fallback is useful when realtime is temporarily unavailable. The bug was that the KDS never reached a confirmed realtime subscription, so the fallback remained active indefinitely.

The current fallback correctly runs only when all of these conditions are true:

```ts
if (!canUseBoard || !pageVisible || realtimeSubscribed) return;

const intervalId = window.setInterval(() => {
  void loadOrdersRef.current({ backgroundRefresh: true });
}, 60_000);
```

Source: `apps/web/src/app/kds/kds-client.tsx`

This means:

- Do not poll before station access is available.
- Do not poll while the KDS browser tab is hidden.
- Do not poll after the server confirms the Socket.IO room subscription.
- Poll every 60 seconds only when realtime is unavailable.

## First Root Cause: The Socket Could Not Receive the KDS Cookie

### What the browser was doing

The KDS login happened through:

```text
https://www.wings4ulondon.ca
```

The station login created an HttpOnly KDS session cookie. Initially, that cookie belonged only to the website host.

At the same time, Socket.IO connected directly to Railway using a URL similar to:

```text
https://wings4uapi-production.up.railway.app
```

Cookies are scoped by domain. A browser must not send a cookie belonging to `wings4ulondon.ca` to an unrelated `up.railway.app` domain.

Therefore, the connection sequence was effectively:

```text
1. User logs into KDS on wings4ulondon.ca.
2. Browser stores w4u_kds_session for wings4ulondon.ca.
3. Browser opens Socket.IO against up.railway.app.
4. Browser does not attach the wings4ulondon.ca station cookie.
5. Railway receives a socket with no station credentials.
6. The gateway rejects realtime authentication.
7. KDS remains on REST fallback polling.
```

The gateway's authentication behavior made the problem explicit:

```ts
const cookieHeader = socket.handshake.headers.cookie;
const accessToken = this.readHandshakeAccessToken(socket);

if (!cookieHeader && !accessToken) {
  socket.emit("error", { message: "Authentication required" });
  socket.disconnect(true);
  return;
}
```

This was not caused by inactivity, Redis, or PostgreSQL. It was a browser domain-security rule.

## First Fix: Use a Shared API Subdomain

The API was assigned this Railway custom domain:

```text
api.wings4ulondon.ca
```

DNS was configured with records supplied by Railway:

```text
CNAME  api                    nxghr631.up.railway.app
TXT    _railway-verify.api    railway-verification-value
```

The important relationship is now:

```text
www.wings4ulondon.ca
api.wings4ulondon.ca
```

Both hosts are subdomains of `wings4ulondon.ca`. This makes it possible to create a shared station cookie for:

```text
.wings4ulondon.ca
```

The leading dot expresses the intention that the cookie is shared with subdomains. Modern browsers normalize the representation, but the practical result is that both `www` and `api` can receive it.

### Cookie implementation

The API validates and normalizes `COOKIE_DOMAIN`:

```ts
export function getSharedCookieDomain(): string | undefined {
  const configured = process.env.COOKIE_DOMAIN?.trim();
  if (!configured) return undefined;

  const hostname = configured.replace(/^\./, "");
  if (!COOKIE_DOMAIN_PATTERN.test(hostname)) {
    throw new Error(
      "COOKIE_DOMAIN must be a hostname such as .wings4ulondon.ca",
    );
  }

  return `.${hostname.toLowerCase()}`;
}
```

The KDS login applies that domain when creating the station cookie:

```ts
res.cookie(KDS_STATION_COOKIE_NAME, `${result.sessionKey}:${result.token}`, {
  ...withSharedCookieDomain(KDS_COOKIE_OPTIONS),
  expires: result.expiresAt,
});
```

The same mechanism is used for POS station cookies.

Relevant files:

- `apps/api/src/common/utils/cookie-domain.ts`
- `apps/api/src/modules/kds/kds-auth.controller.ts`
- `apps/api/src/modules/pos/pos-auth.controller.ts`

### Required production variables

Railway API:

```dotenv
COOKIE_DOMAIN=.wings4ulondon.ca
JWT_SECRET=<same server-side value used by Vercel>
```

Vercel web application:

```dotenv
NEXT_PUBLIC_REALTIME_ORIGIN=https://api.wings4ulondon.ca
API_PROXY_TARGET=https://wings4uapi-production.up.railway.app
INTERNAL_API_URL=https://wings4uapi-production.up.railway.app
JWT_SECRET=<same server-side value used by Railway>
```

Important security detail:

- `NEXT_PUBLIC_REALTIME_ORIGIN` is public by design because it is a browser-visible URL.
- `JWT_SECRET` must never have a `NEXT_PUBLIC_` prefix.
- The Railway and Vercel `JWT_SECRET` values must match exactly because the web proxy signs trusted forwarded station information that the API verifies.

### What this fixed

After DNS, environment variables, cookie scope, and redeployment were correct, Chrome showed:

```text
Request URL: wss://api.wings4ulondon.ca/ws/?EIO=4&transport=websocket
Status: 101 Switching Protocols
Origin: https://www.wings4ulondon.ca
```

Chrome also showed the KDS cookie with:

```text
Name: w4u_kds_session
Domain: .wings4ulondon.ca
Path: /
HttpOnly: true
Secure: true
SameSite: Lax
```

Status `101 Switching Protocols` proved that the HTTP request successfully upgraded to a WebSocket. The regular Socket.IO ping and pong frames proved that the connection stayed alive.

Commit associated with the shared-cookie code:

```text
f7805d0 Share realtime auth cookies with API subdomain
```

## Deployment Issue Encountered During the First Fix

While configuring Vercel, the REST target variables were temporarily saved without a valid URL protocol. They effectively looked like:

```text
//wings4uapi-production.up.railway.app
```

instead of:

```text
https://wings4uapi-production.up.railway.app
```

That malformed value caused Vercel station proxy requests to fail with HTTP `500`. The KDS password screen reported:

```text
Request failed (500)
```

This was a separate REST configuration error. It was not evidence that the custom domain or WebSocket upgrade had failed.

The correction was to save the complete URL, including `https://`, for both:

```dotenv
API_PROXY_TARGET=https://wings4uapi-production.up.railway.app
INTERNAL_API_URL=https://wings4uapi-production.up.railway.app
```

After changing Vercel environment variables, a new production deployment was required because Next.js resolves public environment values during its build.

## New Problem After WebSocket Authentication Worked

After the first fix, the WebSocket was visibly healthy but the KDS still displayed:

```text
KDS realtime is not connected. Using a background refresh every 60 seconds.
```

This appeared contradictory until the Socket.IO message frames were inspected.

The browser sent:

```json
42["subscribe",{"channel":"orders:LON01"}]
```

The server replied:

```json
43[{"subscribed":false,"channel":"orders:LON01","error":"Invalid location id"}]
```

This revealed an important distinction:

- A connected WebSocket is only the transport.
- The KDS also has to join the correct Socket.IO room.
- The UI sets `realtimeSubscribed` only after the server acknowledges that room subscription.

Therefore, this state was possible:

```text
WebSocket transport connected: yes
Socket.IO heartbeat working: yes
Authentication cookie accepted: yes
Orders room subscription accepted: no
KDS realtime operational: no
REST fallback active: yes
```

## Second Root Cause: Location Code Versus Location UUID

The KDS frontend uses the configured public location reference:

```ts
subscribeToChannels(socket, [`orders:${DEFAULT_LOCATION_ID}`], {
  onSubscribed: () => setRealtimeSubscribed(true),
  onDenied: () => setRealtimeSubscribed(false),
});
```

For production, `DEFAULT_LOCATION_ID` was the human-readable location code:

```text
LON01
```

However, backend orders, station sessions, event emissions, and KDS presence tracking use the canonical database UUID, for example:

```text
11111111-1111-4111-8111-111111111111
```

Before the final fix, the gateway required the `orders:*` subject itself to match the UUID format. It rejected `LON01` before joining a room.

Even simply allowing `LON01` without converting it would not have worked. The backend emits order events to a UUID room:

```ts
this.emitToChannel(`orders:${locationId}`, event, payload);
```

If the KDS joined `orders:LON01` while the API emitted to `orders:<uuid>`, they would be two different Socket.IO rooms:

```text
KDS room:     orders:LON01
API emits to: orders:11111111-1111-4111-8111-111111111111
Result:       no event delivered
```

The same mismatch would also break socket-based KDS presence. Auto-accept checks presence by the order's canonical `locationId`, so presence recorded under `LON01` would incorrectly look offline.

## Final Fix: Normalize the Location Before Authorization and Room Join

The gateway now accepts a location code or UUID for an `orders:*` subscription and resolves it to the canonical database UUID.

The existing shared resolver performs the conversion:

```ts
export async function resolveLocationRef(
  prisma: PrismaService,
  value: string,
): Promise<string | null> {
  const normalized = normalizeLocationRef(value);
  if (!normalized || !isLocationRef(normalized)) return null;

  if (isLocationUuid(normalized)) {
    return normalized;
  }

  const location = await prisma.location.findUnique({
    where: { code: normalized.toUpperCase() },
    select: { id: true, isActive: true },
  });

  if (!location?.isActive) return null;
  return location.id;
}
```

The exact repository implementation also handles the development placeholder UUID by resolving it to the default location code.

Source: `apps/api/src/common/utils/location-ref.ts`

### Gateway normalization

The realtime gateway now normalizes location-level order channels:

```ts
private async normalizeSubscriptionChannel(
  prefix: string,
  subject: string,
): Promise<{ channel: string; subject: string } | null> {
  if (prefix !== "orders") {
    return { channel: `${prefix}:${subject}`, subject };
  }

  const locationId = await resolveLocationRef(this.prisma, subject);
  if (!locationId) {
    return null;
  }

  return {
    channel: `${prefix}:${locationId}`,
    subject: locationId,
  };
}
```

Only the location-level `orders:*` channel is normalized. Subjects for `order:*` and `chat:*` are order IDs, so treating every channel subject as a location would be incorrect.

### Correct subscription order

The gateway now follows this sequence:

```ts
const [, prefix, requestedSubject] = match;
const normalized = await this.normalizeSubscriptionChannel(
  prefix,
  requestedSubject,
);

if (!normalized) {
  return { subscribed: false, channel, error: "Invalid location id" };
}

const authError = await this.authorizeChannel(
  prefix,
  normalized.subject,
  user,
  socket,
);

if (authError) {
  return { subscribed: false, channel, error: authError };
}

socket.join(normalized.channel);
```

This ordering matters:

1. Parse the requested channel.
2. Convert the public location code to a canonical UUID.
3. Authorize the station against that UUID.
4. Join the canonical UUID room.
5. Mark KDS presence under the same UUID.
6. Return a positive subscription acknowledgement.

KDS presence is now recorded consistently:

```ts
if (
  prefix === "orders" &&
  user.role === "KDS_STATION" &&
  user.stationLocationId === normalized.subject
) {
  this.kdsPresence.markSubscribed(normalized.subject, socket.id);
}
```

Unsubscribe performs the same normalization so room cleanup and presence cleanup use the identical canonical key.

Source: `apps/api/src/modules/realtime/realtime.gateway.ts`

Commit associated with the final location fix:

```text
ca8ed23 Fix KDS realtime location subscriptions
```

## End-to-End Example After the Final Fix

Assume the database contains:

```text
Location code: LON01
Location UUID: 11111111-1111-4111-8111-111111111111
```

The browser still sends the convenient public code:

```json
{
  "channel": "orders:LON01"
}
```

The API resolves it:

```text
LON01 -> 11111111-1111-4111-8111-111111111111
```

The gateway validates that the authenticated KDS station belongs to that UUID and joins:

```text
orders:11111111-1111-4111-8111-111111111111
```

The acknowledgement becomes:

```json
{
  "subscribed": true,
  "channel": "orders:11111111-1111-4111-8111-111111111111"
}
```

When checkout creates an order, the API emits to:

```text
orders:11111111-1111-4111-8111-111111111111
```

The KDS is in that exact room, receives the event, and performs a targeted ticket refresh. Because `onSubscribed` has set `realtimeSubscribed` to `true`, the 60-second fallback interval is not started.

## Final Production Workflow

```text
1. KDS operator logs in at www.wings4ulondon.ca/kds.
2. Vercel proxies the REST login to Railway.
3. Railway creates w4u_kds_session for .wings4ulondon.ca.
4. Browser opens wss://api.wings4ulondon.ca/ws.
5. Browser includes the shared HttpOnly KDS cookie.
6. Railway validates the KDS station session.
7. Browser requests orders:LON01.
8. Gateway resolves LON01 to the canonical location UUID.
9. Gateway authorizes the station against that UUID.
10. Socket joins orders:<location UUID>.
11. KDS presence is marked online for that UUID.
12. New order events arrive through Socket.IO.
13. REST fallback polling remains stopped while subscription is healthy.
14. If the socket disconnects, the warning appears and the 60-second fallback begins.
15. Socket.IO reconnects automatically and the client re-subscribes.
16. After the server confirms the subscription, fallback polling stops again.
```

## Cost Impact

With realtime working, opening one or more KDS screens does create one logical Socket.IO connection per visible device. That is expected and substantially cheaper than querying ticket tables repeatedly from each device.

Normal connected behavior:

```text
Two KDS devices = two mostly idle sockets
Database polling = none after initial load
Database work = event-driven refreshes when orders actually change
```

Disconnected behavior:

```text
Two disconnected KDS devices = up to two REST refreshes per minute
```

The visible warning makes that fallback state detectable. It should be treated as degraded operation, not normal long-term operation.

The location-code resolution adds one location lookup when a code-based room subscription is established. It is not a timer and does not poll. It occurs on initial connection or reconnection, after which events flow through the long-lived socket.

## Verification Checklist

### Browser cookie

In DevTools, open `Application` -> `Cookies` and confirm:

```text
Name: w4u_kds_session
Domain: .wings4ulondon.ca
Path: /
HttpOnly: enabled
Secure: enabled
```

### WebSocket transport

In DevTools, open `Network` -> `Socket`, select the `/ws` request, and confirm:

```text
Request URL: wss://api.wings4ulondon.ca/ws/?EIO=4&transport=websocket
Status: 101 Switching Protocols
```

### Socket.IO subscription

In the socket `Messages` panel, confirm that the subscription acknowledgement contains:

```json
{
  "subscribed": true,
  "channel": "orders:<uuid>"
}
```

The following response means transport works but the room subscription still failed:

```json
{
  "subscribed": false,
  "error": "Invalid location id"
}
```

### KDS screen

Healthy realtime behavior:

- The disconnected warning is absent.
- `Loading kitchen tickets (background refresh)...` does not flash every minute.
- A new order appears promptly after the corresponding Socket.IO event.

Fallback behavior:

- The screen explicitly says realtime is disconnected.
- A background refresh is shown every 60 seconds.
- The board remains usable while Socket.IO attempts to reconnect.

## Automated Verification Added

The realtime gateway tests cover:

1. Resolving `orders:LON01` to the canonical UUID room.
2. Marking KDS presence with the canonical UUID.
3. Rejecting an unknown location code without joining a room.
4. Resolving and cleaning up the same UUID room during unsubscribe.

Test file:

```text
apps/api/src/modules/realtime/realtime.gateway.spec.ts
```

The final fix was also checked with:

```text
TypeScript API type check: passed
Focused realtime gateway tests: 3 passed
API production build: passed
git diff --check: passed
```

No browser automation or web UI tests were run.

## Key Lessons

1. A WebSocket status of `101` proves the transport upgraded, but it does not prove application-level room subscription succeeded.
2. Socket authentication and Socket.IO room authorization are separate stages and should be displayed or logged separately.
3. A fallback can preserve functionality while hiding a permanent realtime failure. Fallback state should remain visible.
4. Browser cookies cannot cross unrelated registrable domains. A shared custom subdomain is required when cookie-authenticated realtime connects directly to another service.
5. Public location codes and internal UUIDs must be normalized at system boundaries.
6. Socket rooms, event emitters, authorization checks, and presence tracking must all use the same canonical identifier.
7. Environment URLs must include their protocol, and production variable changes require redeployment.
