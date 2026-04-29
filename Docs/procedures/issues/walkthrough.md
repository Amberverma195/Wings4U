# Admin Menu Leftovers Walkthrough

## Summary
- This walkthrough covers the completed admin-menu leftovers pass: build stabilization, category CRUD, modifier-group link/unlink, schedule editing, image remove/replace, and the customer-facing hidden / low-stock / unavailable behavior.
- Cart fulfillment validation is still a separate follow-up and is not part of this walkthrough.

## What Was Added
- Prisma migration `20260420130000_menu_item_stock_status_hidden`
- Admin menu category CRUD under `/admin/menu/categories`
- `GET /admin/menu/modifier-groups`
- `DELETE /admin/menu/items/:id/image`
- Menu image storage abstraction with the local adapter still writing to `apps/web/public/uploads/menu/`
- Admin UI support for category editing, removable ingredients, modifier-group linking, schedules, and image removal

## Verification Steps
1. Run `npm run db:validate`.
2. Run `npm run build:api`.
3. Run `npm run build:web`.
4. Start the app with `npm run dev`.
5. Open `http://localhost:3000/admin/menu` as an admin.
6. Create a category and confirm it appears in the sidebar.
7. Edit that category's name, sort order, and active toggle, then reload and confirm the changes persist.
8. Try archiving a category that still has active items and confirm the UI surfaces the conflict error.
9. Create a menu item with a category, price, fulfillment type, removable ingredients, linked modifier groups, and at least one schedule window.
10. Upload an image, save the item, reopen it, and confirm the image persists.
11. Replace the image, save again, and confirm the new image is shown.
12. Remove the image, save, and confirm the preview and card revert to the no-image state.
13. Set the item to `LOW_STOCK` and confirm `/order` shows the low-stock badge.
14. Set the item to `UNAVAILABLE` and confirm `/order` shows the disabled / faded state.
15. Set the item to hidden and confirm it disappears from `/order`.
16. Clear all schedules, save, and confirm the item is treated as always available again.

## Notes
- Schedule rows use `day_of_week`, `time_from`, and `time_to` in `HH:MM` format.
- Overnight windows are still intentionally unsupported in this pass; use two rows if that behavior is needed later.
- Modifier groups remain shared entities; the item modal only links and unlinks existing groups.
