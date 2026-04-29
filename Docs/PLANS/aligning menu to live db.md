# Restore `/menu` by aligning the live DB schema

## Summary
- Root cause is not the env value anymore. `NEXT_PUBLIC_DEFAULT_LOCATION_ID` is set to `987c0642-3591-4ae1-badc-40836469744c`, `GET /api/v1/menu/wing-flavours` returns `200`, and `GET /api/v1/menu` returns `500`.
- The failure is inside the menu catalog query: Prisma throws `P2022` when it includes `modifierGroup`, because the live database is missing `modifier_groups.context_key`.
- Fix path: patch the live database and keep the current API code/query shape unchanged.

## Implementation Changes
- Add a new manual SQL patch named `0004_modifier_groups_context_key_patch.sql` in the existing SQL patch set.
- The patch should do exactly:
  - `ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS context_key text;`
- Apply that same SQL once to the active Supabase database used by the API.
- Do not change the menu API, Prisma schema, or catalog service for this fix.
- Do not backfill existing rows in this pass.
  - Current data check showed `menu_item_modifier_groups.context_key` has `0` non-null rows and there are no existing size-like modifier groups in the current live catalog, so backfill is not needed to remove the 500.
- Do not rerun destructive seed/import as part of this fix.
  - If the menu loads afterward but still looks older than expected, treat that as a separate catalog refresh task.

## Public Interfaces
- No HTTP/API contract changes.
- Database schema change only: `modifier_groups.context_key text NULL`.

## Test Plan
- Confirm `modifier_groups.context_key` exists in `information_schema.columns`.
- Call `GET /api/v1/menu` with:
  - query `location_id=987c0642-3591-4ae1-badc-40836469744c&fulfillment_type=PICKUP`
  - header `X-Location-Id: 987c0642-3591-4ae1-badc-40836469744c`
  - expect `200` with menu JSON.
- Load `/order` in the web app and verify the generic “Internal server error” message is gone.
- Spot-check that a wing item and a lunch special card render normally.
- Re-run the Prisma reproduction that previously failed on `modifierGroup` include and verify `P2022` no longer occurs.

## Assumptions
- The active `LON01` location remains `987c0642-3591-4ae1-badc-40836469744c`.
- The goal for this fix is restoring menu loading, not refreshing catalog content.
- Leaving existing `modifier_groups.context_key` values null is acceptable until a later seed/import populates them.
