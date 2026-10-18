# Optional catalogue inspection plan — NOT EXECUTED

Requires explicit user authorization before any production connection or query. This is a review plan, not an executable migration or seed. No query in this file has been run by this task.

Use an approved read-only role in the existing Supabase query interface. Scope catalogue checks to the restaurant's authorized location UUID. Bind `:location_id` through the query client; do not run the example unchanged. Inspect names/IDs/configuration only; no customer, order, payment or personal data is needed. Use a read-only transaction and roll it back after inspection.

```sql
BEGIN TRANSACTION READ ONLY;

-- Compare actual storage precision with the repository's Decimal(3,1).
SELECT table_schema, table_name, column_name, data_type,
       numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'order_item_wing_configs'
  AND column_name = 'weight_lb';

-- Establish actual concrete SKU labels and availability without changing data.
SELECT mi.id, mi.slug, mi.name, mi.builder_type, mi.base_price_cents,
       mi.is_available, mi.archived_at, mi.allowed_fulfillment_type,
       mc.slug AS category_slug
FROM public.menu_items mi
JOIN public.menu_categories mc ON mc.id = mi.category_id
WHERE mi.location_id = :location_id
  AND (mi.builder_type IN ('WINGS', 'WING_COMBO')
       OR mi.slug IN ('lunch-burger', 'lunch-wrap'))
ORDER BY mc.slug, mi.slug;

-- Verify mapping order, context overrides, required/min/max rules and option ownership.
SELECT mi.id AS menu_item_id, mi.slug, map.sort_order,
       map.context_key AS mapping_context, mg.id AS modifier_group_id,
       mg.location_id AS group_location_id, mg.name, mg.context_key AS group_context,
       mg.archived_at, mg.selection_mode, mg.is_required, mg.min_select, mg.max_select,
       mo.id AS modifier_option_id, mo.name AS option_name, mo.is_active,
       mo.price_delta_cents, mo.linked_flavour_id, mo.linked_menu_item_id
FROM public.menu_items mi
JOIN public.menu_item_modifier_groups map ON map.menu_item_id = mi.id
JOIN public.modifier_groups mg ON mg.id = map.modifier_group_id
LEFT JOIN public.modifier_options mo ON mo.modifier_group_id = mg.id
WHERE mi.location_id = :location_id
  AND (mi.builder_type IN ('WINGS', 'WING_COMBO')
       OR mi.slug IN ('lunch-burger', 'lunch-wrap')
       OR mi.category_id IN (
         SELECT id FROM public.menu_categories
         WHERE location_id = :location_id AND slug IN ('burgers', 'wraps', 'salads')
       ))
ORDER BY mi.slug, map.sort_order, map.modifier_group_id, mo.sort_order, mo.id;

ROLLBACK;
```

Review output for precision drift, unknown weight labels, unexpected SKU packaging, inactive/cross-location modifier configuration, and missing required selections. Do not apply corrections. Any schema, catalogue-data, packaging or pricing decision requires a separate proposal and explicit authorization.
