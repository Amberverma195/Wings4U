const { checkoutItemDetails } = require('../src/lib/checkout-item-details');
const base = { name: 'Wings', modifier_selections: [], removed_ingredients: [], special_instructions: '' };

test('lunch selections include child add-ons, removals and full instructions', () => {
  expect(checkoutItemDetails({ ...base, special_instructions: 'No cutlery please', builder_payload: {
    builder_type: 'LUNCH_SPECIAL', child_name: 'Chicken wrap', child_addons: [{ name: 'Cheddar' }], removed_ingredients: [{ name: 'Tomato' }],
  } })).toEqual(['Lunch selection: Chicken wrap', 'Cheddar', 'No Tomato', 'Instructions: No cutlery please']);
});

test('side and pop combo keeps selections and deduplicates removals mirrored in the payload', () => {
  expect(checkoutItemDetails({ ...base, removed_ingredients: [{ name: 'Onion' }], builder_payload: {
    builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { side_label: 'Poutine', pop_label: 'Ginger ale' }, removed_ingredients: [{ name: 'Onion' }],
  } })).toEqual(['Combo: Poutine & Ginger ale', 'No Onion']);
});

test('saved wings with older optional fields still show available details', () => {
  expect(checkoutItemDetails({ ...base, builder_payload: { builder_type: 'WINGS', flavour_slots: [{ flavour_name: 'Lemon pepper', placement: 'MIXED' }], saucing_method: 'TELL_US_HOW', saucing_customer_note: 'Half dry, half sauced' } }))
    .toEqual(['Lemon pepper (mixed)', 'Saucing: tell us how', 'Half dry, half sauced']);
});
