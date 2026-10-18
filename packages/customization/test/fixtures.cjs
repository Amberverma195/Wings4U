const option = (id, name, extra = {}) => ({ id, name, price_delta_cents: 50, is_default: false, linked_flavour_id: null, ...extra });
const group = (id, options, extra = {}) => ({ id, name: `${id} Extras`, display_label: 'Additional ingredients', context_key: 'addon', selection_mode: 'MULTI', min_select: 0, max_select: 10, is_required: false, sort_order: 1, options, ...extra });
const product = (slug = 'veggie-burger', extra = {}) => ({ id: slug, slug, name: slug, description: 'Lettuce, tomato', base_price_cents: 999, image_url: null, builder_type: null, is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH', requires_special_instructions: false,
  removable_ingredients: [{ id: `${slug}-lettuce`, name: 'Lettuce', sort_order: 1 }, { id: `${slug}-tomato`, name: 'Tomato', sort_order: 2 }],
  modifier_groups: [group('legacy', [option('avocado', 'Add Avocado'), option('lettuce', 'Extra Lettuce', { addon_match_normalized: 'lettuce' }), option('jalapeno-a', 'Add Jalapenos'), option('jalapeno-b', 'Add Jalapenos')])], ...extra });
module.exports = { option, group, product };
