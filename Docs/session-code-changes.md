# Session code changes (chronological)

This document lists every change made in the Cursor session, from the first UI request through **re-seed**, **delivery fee**, **tax label**, and **API / dev-proxy** work. Paths are relative to the repository root `d:\Projects\Websites\Wings4U\Code` unless noted.

---

## 1. Remove “Clear cart” button (cart UI)

**File:** `apps/web/src/Wings4u/components/cart-page.tsx`

- Removed the **Clear cart** `<button>` that called `cart.clear` from the cart header row next to “YOUR ORDER”.
- The header row now only contains the `<h1>YOUR ORDER</h1>` inside `styles.cartHeaderRow`.

**File:** `apps/web/src/Wings4u/styles.ts`

- Removed the **`cartClearBtn`** style object (it was only used by the removed button).

**Note:** `apps/web/src/app/cart/cart-client.tsx` still contains a “Clear cart” button in code, but that component is not wired into the app route (the cart route uses `CartPage` from `cart-page.tsx`). No change was made there in this session unless listed elsewhere.

---

## 2. Tax row label: `Tax` → `Tax(13%)`

**Files updated (label text only; no server tax math changed):**

| File | Change |
|------|--------|
| `apps/web/src/Wings4u/components/cart-page.tsx` | Summary row: `<span>Tax</span>` → `<span>Tax(13%)</span>` |
| `apps/web/src/app/checkout/checkout-client.tsx` | Same label in checkout summary |
| `apps/web/src/app/cart/cart-client.tsx` | Same label in cart client summary |
| `apps/web/src/app/orders/[orderId]/order-detail-client.tsx` | Order detail quote row: `Tax` → `Tax(13%)` |

---

## 3. Delivery fee $5.00 (500¢) — database and API behavior

**Rationale:** Cart/checkout already show **Delivery fee** when `delivery_fee_cents > 0`. The fee amount comes from **`location_settings.delivery_fee_cents`** (see `apps/api/src/modules/cart/cart.service.ts`).

### 3.1 Prisma schema default

**File:** `packages/database/prisma/schema.prisma`

- On model **`LocationSettings`**, field **`deliveryFeeCents`**:
  - `@default(0)` → `@default(500)` (new rows default to $5.00 in cents).

### 3.2 SQL migration (new file)

**File:** `packages/database/prisma/migrations/20260410120000_delivery_fee_default_five_dollars/migration.sql`

- `ALTER TABLE "location_settings" ALTER COLUMN "delivery_fee_cents" SET DEFAULT 500;`
- `UPDATE "location_settings" SET "delivery_fee_cents" = 500 WHERE "delivery_fee_cents" IN (0, 399);`  
  (backfill old default **0** and old seed value **399** to **500**.)

**Apply in your environment:** from `packages/database`, run your usual Prisma migrate deploy / migrate dev so this migration runs against your database.

### 3.3 Seed script — full create path

**File:** `packages/database/prisma/seed.ts`

- In the **`locationSettings.create`** block for **`LON01`**, **`deliveryFeeCents`** was changed from **`399`** to **`500`**.

---

## 4. Re-seed behavior and “refresh fee” when LON01 already exists

**Context:** Running `tsx prisma/seed.ts` (or `node …/tsx …/seed.ts`) when location **`LON01`** already exists used to **exit immediately** with “Skipping” and did **not** update settings.

**File:** `packages/database/prisma/seed.ts`

- When **`existing`** location with code **`LON01`** is found:
  - **`prisma.locationSettings.update`** on **`locationId: existing.id`** with **`data: { deliveryFeeCents: 500 }`**.
  - Console message updated to explain that the **delivery fee was refreshed** and that **full seed was skipped**.
- **Operational note:** The agent ran the seed once successfully in this environment; a subsequent run was not relied on for the user’s machine. The user must run seed against their own DB with `DATABASE_URL` / `DIRECT_URL` set.

---

## 5. API / Next dev proxy — fewer plain-text 500s and clearer dev workflow

### 5.1 Root `package.json`

**File:** `package.json`

- **`devDependencies`:** added **`concurrently`** (version pinned in lockfile as installed, e.g. `^9.2.1`).
- **`scripts`:** added  
  `"dev": "concurrently -k -n api,web -c blue,green \"npm run dev:api\" \"npm run dev:web\""`  
  so one command starts **Nest API** and **Next web** together (`-k` kills both if one exits).

**Lockfile:** `package-lock.json` was updated by `npm install concurrently` (dependency tree for `concurrently`).

### 5.2 Browser API base — optional direct Nest URL

**File:** `apps/web/src/lib/env.ts`

- **`getPublicApiBase()`**:
  - **Browser:** if **`NEXT_PUBLIC_API_ORIGIN`** is set (trimmed, trailing slash stripped), it is used as the base for **`fetch`** (e.g. `http://127.0.0.1:3001`), so requests go **directly** to Nest and **not** through Next’s `/api` rewrite.
  - If unset, behavior remains **same-origin** `""` (relative `/api/...`).
  - **Server (RSC):** unchanged default: **`INTERNAL_API_URL`** or **`http://127.0.0.1:3001`**.
- Added a short JSDoc comment describing the above.

### 5.3 Next rewrite target default

**File:** `apps/web/next.config.ts`

- **`apiProxyTarget`** default changed from **`http://127.0.0.1:3001`** to **`http://localhost:3001`** (still overridable via **`API_PROXY_TARGET`**).
- Comment added explaining why **`localhost`** is preferred on Windows.

### 5.4 `apiJson` error hint (non-JSON / proxy 500)

**File:** `apps/web/src/lib/api.ts`

- When the response is not JSON and status is **500** with body **`Internal Server Error`**, the thrown **`Error` message** (the `hint` string) was **updated** to:
  - Explain the **Next proxy** vs **Nest on port 3001**,
  - Suggest starting the API (`npm run dev:api` or `npm run dev`),
  - Suggest **`NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001`** in **`apps/web/.env.local`** and restarting Next,
  - Remind **`NEXT_PUBLIC_DEFAULT_LOCATION_ID`** must match **`locations.id`** for LON01.

(Earlier in the session, the same hint was expanded from a shorter version; the file’s current content reflects the **latest** wording.)

### 5.5 Example env

**File:** `apps/web/.env.example`

- **`NEXT_PUBLIC_DEFAULT_LOCATION_ID`** comment clarified (must match DB location row).
- **`NEXT_PUBLIC_API_ORIGIN`** documented as optional dev bypass.
- **`API_PROXY_TARGET`** example updated to **`localhost`**.
- **`INTERNAL_API_URL`** left as example `http://127.0.0.1:3001` (server-side RSC fetch).

### 5.6 Local env (your machine)

**File:** `apps/web/.env.local`

- Added:

  ```env
  NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001
  ```

  with a short comment that the browser calls Nest directly and bypasses the Next dev proxy.

**Important:** Restart Next after changing any **`NEXT_PUBLIC_*`** variable.

---

## 6. Files touched — summary checklist

| Path | Nature of change |
|------|------------------|
| `apps/web/src/Wings4u/components/cart-page.tsx` | Remove Clear cart; Tax label |
| `apps/web/src/Wings4u/styles.ts` | Remove `cartClearBtn` |
| `apps/web/src/app/checkout/checkout-client.tsx` | Tax label |
| `apps/web/src/app/cart/cart-client.tsx` | Tax label |
| `apps/web/src/app/orders/[orderId]/order-detail-client.tsx` | Tax label |
| `packages/database/prisma/schema.prisma` | `deliveryFeeCents` default 500 |
| `packages/database/prisma/migrations/20260410120000_delivery_fee_default_five_dollars/migration.sql` | **New** migration |
| `packages/database/prisma/seed.ts` | 500¢ seed; early-exit refresh fee |
| `package.json` | `dev` script; `concurrently` devDependency |
| `package-lock.json` | Lockfile after `npm install concurrently` |
| `apps/web/src/lib/env.ts` | `NEXT_PUBLIC_API_ORIGIN` / `getPublicApiBase` |
| `apps/web/next.config.ts` | Default proxy `localhost:3001` |
| `apps/web/src/lib/api.ts` | Error hint text for non-JSON 500 |
| `apps/web/.env.example` | Comments + optional vars |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_ORIGIN` |

---

## 7. What was *not* changed (clarifications)

- **No** change to **tax calculation** server-side (still driven by `tax_rate_bps` / location settings and cart service math).
- **`Docs/schema.prisma`** (if present as a duplicate of Prisma schema) was **not** updated in this session.
- **Re-seed** did not add a full “wipe DB and reseed” flow; the seed script still **skips** the heavy insert when `LON01` exists, except for the **delivery fee refresh** described above.

---

*Generated for audit / handoff. Adjust or delete this file if you prefer not to keep session notes in-repo.*
