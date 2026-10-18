const option = (id, name, extra = {}) => ({ id, name, price_delta_cents: 50, is_default: false, linked_flavour_id: null, ...extra });
const group = (id, options, extra = {}) => ({ id, name: `${id} Extras`, display_label: 'Additional ingredients', context_key: 'addon', selection_mode: 'MULTI', min_select: 0, max_select: 10, is_required: false, sort_order: 1, options, ...extra });
const product = (slug = 'veggie-burger', extra = {}) => ({ id: slug, slug, name: slug, description: 'Lettuce, tomato', base_price_cents: 999, image_url: null, builder_type: null, is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH', requires_special_instructions: false,
  removable_ingredients: [{ id: `${slug}-lettuce`, name: 'Lettuce', sort_order: 1 }, { id: `${slug}-tomato`, name: 'Tomato', sort_order: 2 }],
  modifier_groups: [group('legacy', [option('avocado', 'Add Avocado'), option('lettuce', 'Extra Lettuce', { addon_match_normalized: 'lettuce' }), option('jalapeno-a', 'Add Jalapenos'), option('jalapeno-b', 'Add Jalapenos')])], ...extra });
module.exports = { option, group, product };

const salad = (slug = 'caesar-salad') => product(slug, {
  name: slug.replace('-salad', ' Salad'),
  removable_ingredients: [{ id: `${slug}-recipe`, name: 'Dressing' }],
  modifier_groups: [
    group('size', [option('small', 'Small', { price_delta_cents: 0 }), option('large', 'Large')], { context_key: 'size', selection_mode: 'SINGLE', min_select: 1, is_required: true }),
    group('extras', [
      option('dressing', 'Extra Dressing Small', { addon_match_normalized: 'dressing', price_delta_cents: 75 }),
      option('large-dressing', 'Extra Dressing Large', { addon_match_normalized: 'dressing', price_delta_cents: 125 }),
      option('avocado', 'Add Avocado'), option('jalapenos', 'Add Jalapeños'),
      option('approved', 'Add Chicken', { addon_match_normalized: '__always__', price_delta_cents: 250 }),
    ], { addon_scope_menu_item_id: slug }),
  ],
});
module.exports.salad = salad;
