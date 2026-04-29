# Admin Menu Management Feature

Full CRUD menu management for admins — categories, items, modifiers, pricing, availability schedules, status controls, and image uploads.

## User Review Required

> [!IMPORTANT]
> **Schema migration**: This adds 2 new columns to `menu_items` (`stock_status`, `is_hidden`) and requires a Prisma migration. Existing items default to `NORMAL` stock / visible, so it's non-breaking.

> [!IMPORTANT]
> **Image uploads**: The current codebase has no image upload infrastructure. This plan uses local disk storage at `public/uploads/menu/` for simplicity. If you want S3/Cloudflare R2 instead, let me know before I start.

> [!WARNING]
> **Cart validation (§8)**: Adding fulfillment-type validation when the user switches between Pickup ↔ Delivery in their cart requires changes to the cart sidebar. This will be implemented as a follow-up phase to keep scope manageable.

---

## Proposed Changes

### Phase 1: Database Schema Changes

#### [MODIFY] [schema.prisma](file:///d:/Projects/Websites/Wings4U/Code/packages/database/prisma/schema.prisma)

Add two new fields to `MenuItem`:

```diff
 model MenuItem {
   ...
   isAvailable                 Boolean  @default(true) @map("is_available")
+  stockStatus                 String   @default("NORMAL") @map("stock_status")
+  isHidden                    Boolean  @default(false) @map("is_hidden")
   isPopular                   Boolean  @default(false) @map("is_popular")
   ...
 }
```

- `stockStatus`: `"NORMAL"` | `"LOW_STOCK"` | `"UNAVAILABLE"` 
  - `NORMAL` = default (visible, orderable)
  - `LOW_STOCK` = visible with "Low on Stock" badge, still orderable
  - `UNAVAILABLE` = visible but greyed out, not orderable ("Currently Unavailable")
- `isHidden`: `true` = completely removed from customer view (admin can still see it)

#### [NEW] Prisma migration
- Run `npx prisma migrate dev --name add-menu-stock-status-hidden`

---

### Phase 2: Backend API — Admin Menu CRUD

#### [NEW] [admin-menu.controller.ts](file:///d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/admin/admin-menu.controller.ts)

New NestJS controller under `@Controller("admin/menu")` with `@Roles("ADMIN")`:

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/admin/menu/categories` | List all categories (including inactive) |
| `GET` | `/admin/menu/items` | List all items with filters (category, search query) |
| `GET` | `/admin/menu/items/:id` | Get single item with all relations |
| `PUT` | `/admin/menu/items/:id` | Update item (name, description, price, status, availability, fulfillment type, schedules) |
| `POST` | `/admin/menu/items` | Create new item |
| `DELETE` | `/admin/menu/items/:id` | Soft-delete (set `archivedAt`) |
| `POST` | `/admin/menu/items/:id/image` | Upload image (multipart/form-data) |
| `DELETE` | `/admin/menu/items/:id/image` | Remove image |

#### [NEW] [admin-menu.service.ts](file:///d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/admin/admin-menu.service.ts)

Service layer handling:
- CRUD operations with Prisma
- Image file handling (save to `public/uploads/menu/`, generate URL)
- Ingredient and modifier group management (nested creates/updates)
- Schedule (time-based availability) CRUD
- Audit logging for changes

#### [MODIFY] [admin.module.ts](file:///d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/admin/admin.module.ts)
- Register `AdminMenuController` and `AdminMenuService`

#### [MODIFY] [catalog.service.ts](file:///d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/catalog/catalog.service.ts)
- Update `getMenu()` query to filter out `isHidden: true` items
- Include `stockStatus` in serialized output so the frontend can show badges/overlays
- Change `isAvailable` filter to also consider `stockStatus === "UNAVAILABLE"` (visible but not orderable)

---

### Phase 3: Frontend — Admin Menu Page

#### [MODIFY] [admin-shell.tsx](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/admin-shell.tsx)
- Add `{ href: "/admin/menu", label: "Menu", description: "Manage items & categories" }` after "Global search"

#### [NEW] `apps/web/src/app/admin/menu/page.tsx`
- Server component that renders `AdminMenuClient`

#### [NEW] `apps/web/src/app/admin/menu/admin-menu-client.tsx`
Main client component with 3-panel layout:

**Left panel (Categories sidebar)**:
- Lists all categories
- Click to filter items
- "All" option at top
- Styled matching the admin sidebar pattern

**Top bar**:
- Search input (filters by item name, debounced)
- "+ Add Item" button

**Main area**:
- Grid of Menu Item Cards
- Each card shows: image (or placeholder), name, truncated description, price, status badges, edit button
- Cards styled to match the warm admin design system

#### [NEW] `apps/web/src/app/admin/menu/menu-item-card.tsx`
Individual item card component:
- Image thumbnail (or "No image" placeholder)
- Name, description (max 2 lines)
- Price display
- Status badges: Low Stock (amber), Hidden (grey), Unavailable (red)
- Fulfillment type indicators (🚙 Delivery, 🏪 Pickup)
- "Edit" button → opens modal

#### [NEW] `apps/web/src/app/admin/menu/menu-item-modal.tsx`
Full edit/create modal with tabs or sections:

1. **Basic info**: Name, description, base price, category dropdown
2. **Image**: Preview + change/remove/upload buttons
3. **Ingredients**: List of removable ingredients (add/remove)
4. **Add-ons/Modifiers**: List modifier groups → options with pricing
5. **Status**: Radio buttons for Normal / Low Stock / Unavailable / Hidden
6. **Availability**: Fulfillment type toggle (Pickup / Delivery / Both)
7. **Schedule**: Time windows per day of week (optional)

#### [NEW] `apps/web/src/app/admin/menu/admin-menu.css`
Styles for the menu management page, cards, and modal.

---

### Phase 4: Customer-Facing Updates

#### [MODIFY] Customer menu components
- Show "Low on Stock" badge for `stockStatus === "LOW_STOCK"` items
- Show "Currently Unavailable" overlay for `stockStatus === "UNAVAILABLE"` items (visible but not clickable, faded)
- Hide items where `isHidden === true` (already handled by backend filter)

---

## Phasing Strategy

Given the size, I'll implement in this order:

1. **Schema migration** — Add fields, run migration
2. **Backend API** — Controller + service for admin CRUD
3. **Admin sidebar** — Add "Menu" nav entry
4. **Admin menu page** — Categories panel, search, item grid
5. **Item cards** — Admin view of each menu item
6. **Edit/Create modal** — Full editing capabilities
7. **Image upload** — Multipart upload endpoint + UI
8. **Customer-facing updates** — Badges and overlays
9. **Cart validation** — Fulfillment type mismatch warnings (follow-up)

## Open Questions

> [!IMPORTANT]
> **Image storage**: Should I use local disk (`public/uploads/menu/`) or do you have a cloud storage provider (S3, R2, etc.) you'd prefer?

> [!IMPORTANT]
> **Modifier group editing**: The existing modifier groups are shared across items (many-to-many via `MenuItemModifierGroup`). When editing modifiers from the item modal, should changes apply globally to the modifier group (affecting all items using it), or should the admin only be able to link/unlink existing groups? Creating entirely new modifier groups from the item modal adds significant complexity.

## Verification Plan

### Automated Tests
- Build check: `npm run build` for both API and web
- TypeScript compilation: Ensure no type errors

### Manual Verification
1. Navigate to `/admin/menu` as an admin user
2. Verify categories load and filter items correctly
3. Create a new item with image, verify it appears on customer menu
4. Edit an existing item's price, verify change reflects immediately
5. Set item to "Low Stock" → check customer menu shows badge
6. Set item to "Unavailable" → check customer menu shows disabled overlay
7. Set item to "Hidden" → check item disappears from customer menu
8. Toggle fulfillment type → verify item only shows for selected type
9. Set time-based schedule → verify item only appears during window
