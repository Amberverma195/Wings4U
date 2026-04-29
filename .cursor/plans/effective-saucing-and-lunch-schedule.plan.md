# Plan: Effective saucing + lunch special schedule validation

## Initiative A — Effective saucing flavour count

(See prior plan: drive saucing options from **count of non-plain / sauced slots**, not raw menu slot count. Plain + one real sauce → **Tossed on wings / On the side**; fix `resolvePlacements` for `ON_WINGS` / `ON_SIDE` when multiple slots include plain.)

**Primary files:** [apps/web/src/components/builder-shared.tsx](apps/web/src/components/builder-shared.tsx), [apps/web/src/components/wings-builder.tsx](apps/web/src/components/wings-builder.tsx), [apps/web/src/components/combo-builder.tsx](apps/web/src/components/combo-builder.tsx)

---

## Initiative B — Lunch specials vs scheduled pickup/delivery time

### Problem

A customer can schedule pickup/delivery in the **cart** ([CartOrderSettings](apps/web/src/Wings4u/components/cart-order-settings.tsx)) for a time **outside** when lunch specials are offered. Example: cart contains a lunch special; user moves the time from **1pm** to **5pm**. The store cannot honor lunch pricing/items at 5pm.

Menu/seed copy already states lunch availability: **“Available everyday 11 AM – 3 PM”** ([seed.ts](packages/database/prisma/seed.ts) `lunchDesc` on lunch-specials items).

### Desired behavior (confirmed)

- **Block checkout** with a **clear error** until the customer either:
  - changes the scheduled time to fall within lunch hours, or
  - removes lunch-special lines from the cart.

(Interception at checkout is the minimum; optionally we can also warn when applying order settings—see below.)

### Implementation outline

1. **Single source of truth for “lunch window”**

   - Introduce a small module (e.g. `apps/web/src/lib/lunch-hours.ts`) with **start/end minutes** or **HH:MM** pair in **location timezone**, defaulting to **11:00–15:00** to match current seed/marketing copy.
   - Longer term: optional **LocationSettings** or API field if hours change per store (not required for v1 if product is OK with constants).

2. **Detect “lunch-only” cart lines**

   - Treat items as lunch-constrained if any of:
     - `builder_payload?.builder_type === "LUNCH_SPECIAL"`, or
     - menu item **category** `lunch-specials`, or
     - slug matches known lunch SKUs (`lunch-burger`, `lunch-wrap`, `lunch-5-wings`, `lunch-3-tender`, etc.).
   - Centralize in one helper (e.g. `cartHasLunchSpecialItems(items)`) used by cart + checkout.

3. **Resolve scheduled instant**

   - Use existing `scheduledFor` from cart ([cart.ts](apps/web/src/lib/cart.ts)): ISO string or `"ASAP"`.
   - For **ASAP**, compare **current time** (in location TZ) to lunch window; if outside window and cart has lunch items → conflict.
   - For **scheduled ISO**, parse date+time in location TZ and test inclusion in `[lunchStart, lunchEnd]` for that calendar day.

4. **Where to enforce**

   - **Checkout** ([checkout-client.tsx](apps/web/src/app/checkout/checkout-client.tsx)): before `Place order`, if `cartHasLunchSpecialItems && !isScheduledTimeWithinLunchWindow(...)` → set inline error / banner and **do not submit**. Message should name the conflict (e.g. “Lunch specials are available 11am–3pm. Change your scheduled time or remove lunch items from your cart.”).
   - **Optional follow-up:** disable or warn on **CHECKOUT** button on [cart-page.tsx](apps/web/src/Wings4u/components/cart-page.tsx) with the same rule so users discover the issue earlier (still **block checkout** as the hard gate).

5. **Backend (recommended)**

   - Mirror validation in API checkout path so bad clients cannot bypass (e.g. [checkout.service.ts](apps/api/src/modules/checkout/checkout.service.ts) or equivalent order creation). Return a **4xx** with a stable error code/message aligned with the UI.

6. **Edge cases**

   - **Timezone:** always use `menu.location.timezone` (already on menu response) for interpreting `scheduledFor` and “now” for ASAP.
   - **Day boundaries:** lunch window is same **local** window every day per current copy (“everyday”); if later you add “weekdays only,” extend the helper.

### Testing

- Unit tests: lunch window helper (11:00–15:00), ASAP vs fixed ISO, boundary at 11:00 and 15:00.
- Cart/checkout: fixture cart with lunch item + `scheduledFor` at 17:00 → checkout blocked.

---

## Execution order

1. Implement **Initiative A** (saucing) and ship.
2. Implement **Initiative B** (lunch + schedule) with checkout block + shared helper; add API validation; optional cart CTA warning.
