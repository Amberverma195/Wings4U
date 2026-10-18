/** Read-only reorder preview. No historical financial preferences are transferred. */
export type ReorderSkipReason = 'unavailable' | 'archived' | 'location_mismatch' | 'required_group_missing';
export type ReorderItem<Builder = Record<string, unknown>> = {
  menu_item_id: string; menu_item_slug: string | null; name: string; image_url: string | null;
  base_price_cents: number; quantity: number;
  modifier_selections: Array<{ modifier_option_id: string; group_name: string; option_name: string; price_delta_cents: number }>;
  removed_ingredients: Array<{ id: string; name: string }>;
  special_instructions: string; builder_payload: Builder | null;
};
export type ReorderResponse<Builder = Record<string, unknown>> = {
  order_id: string; location_id: string; fulfillment_type_hint: 'PICKUP' | 'DELIVERY';
  items: ReorderItem<Builder>[];
  diff: {
    skipped: Array<{ name: string; reason: ReorderSkipReason; detail?: string }>;
    modifier_changes: Array<{ name: string; dropped: string[] }>;
    price_changes: Array<{ name: string; old_cents: number; new_cents: number }>;
    configuration_changes?: Array<{ name: string; changes: string[] }>;
  };
  all_unavailable: boolean;
};
