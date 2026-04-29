# Make `/order` fulfillment behave like a committed route change, not a live toggle

## Summary
Keep the committed URL model as `/order?fulfillment_type=...`, but stop changing it on every fulfillment pill click. Treat pickup/delivery inside the expanded panel as a draft selection only. The only commit action is the top sticky bar button, which becomes `Done` while the panel is open. Clicking `Done` should close the panel and trigger a real `/order` route transition/reload feel. Also restructure the sticky stack so the navbar, fulfillment summary bar, and category bar never overlap.

## Implementation Changes
- **Commit model**
  - Keep `fulfillment_type` in the committed URL.
  - Remove the current immediate `router.replace(...)` behavior from fulfillment-pill clicks.
  - In `MenuPage`, introduce separate state for:
    - committed fulfillment: from the page prop / URL
    - draft fulfillment: local state used only while the panel is open
  - The collapsed top bar shows fulfillment as read-only display, not clickable buttons.
  - The expanded panel contains the actual selectable pickup/delivery controls.
  - The top sticky bar action is:
    - `Change` when closed
    - `Done` when open
  - Clicking top `Done`:
    - if draft differs from committed, navigate to the new `/order?fulfillment_type=...`
    - if draft is unchanged, just close the panel
  - Do not commit fulfillment on outside click, scroll, or panel selection alone.

- **Professional route transition**
  - Convert [`apps/web/src/app/order/page.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/order/page.tsx) to a server-driven page that reads `searchParams` instead of `useSearchParams()` in a client wrapper.
  - Pass `fulfillmentType` into `MenuPage` from the page boundary and key `MenuPage` by fulfillment type so the menu resets cleanly on committed changes.
  - Add [`apps/web/src/app/order/loading.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/order/loading.tsx) for a route-level loading state.
  - Use `router.push(...)` on top `Done` so the change feels like a real route transition, not an instant in-place param mutation.
  - Keep cart context synchronized from the committed prop/URL only; do not update cart fulfillment from draft selection.

- **Panel behavior**
  - Remove the inner `Done` button from the expanded order-settings panel.
  - Close the expanded panel when:
    - user clicks outside the order-settings shell
    - user scrolls
  - On close without top `Done`, discard draft changes and reset the panel selection back to the committed fulfillment.
  - Leave date/time fields as display-only for now; no new date/time behavior in this pass.

- **Sticky layout / overlap fix**
  - Replace the separate sticky bars with one sticky stack wrapper containing:
    - collapsed order-settings summary bar
    - expanded panel anchor area
    - category bar
  - Make that stack sticky directly below the real navbar, with no hidden overlap.
  - Stop relying on the hardcoded `--wk-nav-offset: 64px`.
  - Measure the actual `.wk-nav-bar` height and set the CSS variable from runtime so sticky offsets match the real navbar height on desktop and mobile.
  - Measure the sticky stack height as well and use it for section `scroll-margin-top`, so category jumps and headings do not slide under the navbar/stack.
  - Keep order-settings summary above the category bar when scrolling.

## Public Interfaces
- Committed route format stays:
  - `/order?fulfillment_type=PICKUP`
  - `/order?fulfillment_type=DELIVERY`
- No API contract changes.
- No cart schema/type changes.
- New route file:
  - [`apps/web/src/app/order/loading.tsx`](/d:/Projects/Websites/Wings4U/Code/apps/web/src/app/order/loading.tsx)

## Test Plan
- `npx tsc --noEmit` in `apps/web`
- Manual `/order` checks:
  - Open `/order?fulfillment_type=PICKUP`; top bar shows pickup as committed state.
  - Click collapsed pickup/delivery display in the top bar; nothing commits.
  - Click `Change`; panel opens and top action becomes `Done`.
  - Select `DELIVERY` inside panel; URL does not change yet.
  - Click outside panel; panel closes and selection reverts to committed state.
  - Reopen panel, select `DELIVERY`, click top `Done`; route transitions to `/order?fulfillment_type=DELIVERY`.
  - During commit, user sees a real loading/reload state, not the current instant param swap.
  - After transition, menu fetches delivery mode and cart fulfillment is aligned to delivery.
  - Scroll down; expanded panel closes automatically.
  - With page scrolled, sticky order summary sits directly below navbar and category bar sits below it.
  - Category bar top edge and section headings never hide behind the navbar.

## Assumptions
- `Done` in the top sticky bar is the only commit action for fulfillment changes.
- Outside click and scroll are cancel/close actions, not commit actions.
- The committed URL should remain query-based, not move to separate `/order/pickup` and `/order/delivery` routes.
- Date and time controls remain presentational only in this pass.
