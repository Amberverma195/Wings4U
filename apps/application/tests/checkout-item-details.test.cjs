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

test.each([
  [['ON_WINGS', 'ON_WINGS'], ['Honey Garlic (on wings)', 'Honey Garlic (on wings)']],
  [['ON_WINGS', 'ON_SIDE', 'MIXED'], ['Honey Garlic (on wings)', 'Honey Garlic (on the side)', 'Honey Garlic (mixed)']],
])('preserves repeated flavour slots in selection order: %j', (placements, expected) => {
  const item = { ...base, builder_payload: { builder_type: 'WINGS', flavour_slots: placements.map((placement, index) => ({
    slot_no: index + 1, flavour_name: 'Honey Garlic', placement,
  })) } };
  const original = JSON.parse(JSON.stringify(item));
  expect(checkoutItemDetails(item)).toEqual(expected);
  expect(item).toEqual(original);
});

test('wing combos preserve multiple and repeated side/drink selections', () => {
  expect(checkoutItemDetails({ ...base, builder_payload: { builder_type: 'WING_COMBO', flavour_slots: [
    { flavour_name: 'Hot', placement: 'ON_SIDE' }, { flavour_name: 'Hot', placement: 'ON_SIDE' },
  ] }, modifier_selections: [
    { group_name: 'Side', option_name: 'Fries' }, { group_name: 'Side', option_name: 'Fries' },
    { group_name: 'Drink', option_name: 'Cola' }, { group_name: 'Drink', option_name: 'Ginger ale' },
  ] })).toEqual(['Hot (on the side)', 'Hot (on the side)', 'Side: Fries', 'Side: Fries', 'Drink: Cola', 'Drink: Ginger ale']);
});

test('overlapping lunch descriptions and removals are only displayed once', () => {
  expect(checkoutItemDetails({ ...base, modifier_selections: [{ group_name: '', option_name: 'Cheddar' }],
    removed_ingredients: [{ name: 'Tomato' }, { name: 'Onion' }], builder_payload: {
      builder_type: 'LUNCH_SPECIAL', child_name: 'Chicken wrap', child_addons: [{ name: 'Cheddar' }],
      removed_ingredients: [{ name: 'Tomato' }, { name: 'Tomato' }],
    } })).toEqual(['Lunch selection: Chicken wrap', 'Cheddar', 'No Tomato', 'No Onion']);
});
