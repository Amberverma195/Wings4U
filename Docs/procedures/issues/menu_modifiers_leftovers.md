# Admin Menu Leftovers Completion Plan

## Summary
- Finish the remaining gaps so the admin menu matches the promised feature set and the repo is truthful, buildable, and testable.
- Keep modifier management to **link/unlink existing shared modifier groups only**.
- Keep **local-disk image storage** for now, but wrap it behind a small storage interface so cloud storage can replace it later without another controller/service rewrite.
- Leave **cart fulfillment validation** out of scope for this pass; it remains the next follow-up.

## Implementation Changes
- **Stabilize the current implementation first**
  - Fix the web build by removing the missing `@/lib/hooks` dependency and using the existing inline debounce pattern already present in the component.
  - Clean up the admin menu client/modal/card code so it typechecks cleanly and uses ASCII-safe icons/buttons instead of mojibake characters.
  - Keep the current `stockStatus -> isAvailable` rule: `UNAVAILABLE` writes `isAvailable = false`, all other statuses write `true`.

- **Schema and persistence**
  - Add the missing Prisma migration for `menu_items.stock_status` and `menu_items.is_hidden`.
  - Do **not** refactor `stockStatus` to a Prisma enum in this pass; keep the current string column to match the existing schema and minimize extra churn.
  - Keep image files under `apps/web/public/uploads/menu/`, but introduce a menu-image storage adapter with a local implementation and a future cloud-ready interface.
  - When deleting an image, clear `imageUrl` in the DB and remove the file only if it resolves inside the managed menu uploads root.

- **Backend admin API**
  - Extend item create/update to support optional `schedules` alongside the existing fields, with replace-all-on-save semantics.
  - Add `DELETE /admin/menu/items/:id/image`.
  - Add category CRUD routes under `/admin/menu/categories`:
    - `POST` create category
    - `PUT /:id` update category
    - `DELETE /:id` archive category
  - Add `GET /admin/menu/modifier-groups` to power the link/unlink UI in the item modal.
  - Validate that category and modifier-group IDs belong to the same location and are not archived.
  - Category deletion should be a soft delete and should fail with a clear 409-style error if the category still contains non-archived items.
  - Category slug should be auto-generated on create, unique per location, and remain stable on rename in v1.

- **Frontend admin UI**
  - Keep the `/admin/menu` page layout, but add a category-management flow from the sidebar header.
  - Add a category modal/panel that supports create, rename, active toggle, sort order, and archive.
  - Expand the item modal to include:
    - editable removable ingredients list
    - modifier-group link/unlink checklist/select control fed by `GET /admin/menu/modifier-groups`
    - schedule editor with multiple windows per day
    - image remove button in addition to upload/replace
  - Keep schedule editing optional: an empty schedule list means “always available.”
  - Use replace-all save behavior for ingredients, modifier links, and schedules so the frontend state is the full source of truth on submit.

- **Schedule behavior**
  - API shape for item schedules should be:
    - `schedules?: Array<{ day_of_week: number; time_from: string; time_to: string }>`
  - `time_from` and `time_to` use 24-hour `HH:MM` strings.
  - Backend converts these to `Date` values anchored to `1970-01-01T...Z`, matching the existing `TIME` column usage.
  - Validation rules:
    - `day_of_week` must be `0..6`
    - `time_from < time_to`
    - no overlapping windows for the same day
    - no overnight windows in v1; overnight availability must be represented as two rows

- **Docs and truth alignment**
  - Add a real admin-menu walkthrough/testing doc and link it from the existing issue doc. Completed: [`walkthrough.md`](./walkthrough.md)
  - Update the feature documentation so it reflects the actual shipped scope: local storage via adapter, shared modifier groups link/unlink only, cart validation deferred.

## Public APIs / Types
- `POST /admin/menu/categories` and `PUT /admin/menu/categories/:id`
  - body: `{ name: string, sort_order: number, is_active: boolean }`
- `DELETE /admin/menu/categories/:id`
  - archives the category; rejects deletion when non-archived items still exist
- `GET /admin/menu/modifier-groups`
  - returns active, non-archived modifier groups for the current location with enough metadata to render a selection UI
- `POST /admin/menu/items` and `PUT /admin/menu/items/:id`
  - keep existing fields
  - add optional `schedules`
  - keep `modifier_groups` as `Array<{ id: string }>` for compatibility with the current modal state
- `DELETE /admin/menu/items/:id/image`
  - clears `imageUrl` and removes the managed file when present

## Test Plan
- **Build and validation**
  - `npm run db:validate`
  - `npm run build:api`
  - `npm run build:web`
- **API coverage**
  - create/update item with status, hidden flag, ingredients, modifier links, and schedules
  - reject invalid schedule rows and cross-location modifier/category IDs
  - upload image, replace image, remove image
  - create/update/archive category, including refusal to archive non-empty categories
- **Manual verification**
  - open `/admin/menu`, filter by category, search items, open edit modal
  - create a category, create an item in it, upload an image, save, reload, and confirm persistence
  - mark item `LOW_STOCK`, `UNAVAILABLE`, and `Hidden`, then verify `/order` shows the correct badge/disabled/hidden behavior
  - add and remove modifier-group links and removable ingredients, then reopen the modal and verify round-trip correctness
  - add schedule windows, verify the item appears only during matching time windows
  - remove an image and verify the admin card and customer menu no longer use it

## Assumptions
- “Leftovers” means closing the full promise gap, not just making the current code minimally shippable.
- Shared modifier groups remain shared; the item modal will not edit modifier-group definitions or options.
- Local image storage remains the runtime backend for now, but all image save/delete logic should go through a storage abstraction.
- `stockStatus` remains a string column in this pass; only the missing migration artifact is added.
- Cart fulfillment mismatch validation is still deferred to the next session.
