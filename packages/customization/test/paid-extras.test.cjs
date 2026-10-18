const { test } = require('node:test');
const assert = require('node:assert/strict');
const { customizationCatalog, validateSelections, modifierTotal, dedicatedAddonScope } = require('../dist');
const { buffaloBurger } = require('./buffalo-burger-fixture.cjs');
test('Buffalo burger retains four mapped extras and hides unconfigured Bacon and unavailable inventory', () => {
  const item = buffaloBurger();
  const before = JSON.stringify(item);
  const options = customizationCatalog(item).groups[0].options;
  assert.deepEqual(options.map(o => o.name), ['Extra Sriracha Mayo', 'Extra Lettuce', 'Extra Red Onion', 'Extra Tomato']);
  for (const option of options) assert.equal(option.price_delta_cents, 50);
  const bacon = item.modifier_groups[0].options.find(o => o.name === 'Add Bacon');
  assert.match(validateSelections(customizationCatalog(item).groups, { [item.modifier_groups[0].id]: [bacon.id] }), /Menu options changed/);
  assert.equal(JSON.stringify(item), before);
});
test('explicit Bacon approval retains its ID and 150-cent price without adding a removable ingredient', () => {
  const item = buffaloBurger(true);
  const group = item.modifier_groups[0];
  const bacon = group.options.find(o => o.name === 'Add Bacon');
  const groups = customizationCatalog(item).groups;
  assert.equal(groups[0].options.length, 5);
  assert.deepEqual(groups[0].options.find(o => o.id === bacon.id), bacon);
  assert.ok(!item.removable_ingredients.some(o => o.name === 'Bacon'));
  assert.equal(validateSelections(groups, { [group.id]: [bacon.id] }), null);
  assert.equal(modifierTotal(groups, { [group.id]: [bacon.id] }), 150);
  assert.ok(!groups[0].options.some(o => /Avocado|Jalapenos/.test(o.name)));
});
test('item approval cannot leak when the group is shared or copied for another product', () => {
  const item = buffaloBurger(true), group = item.modifier_groups[0];
  for (const [name, ids, itemId] of [[group.name, [item.id, 'other'], item.id], [group.name, [item.id], 'other'], [`${group.name} [shared copy]`, [item.id], item.id]]) {
    group.addon_scope_menu_item_id = dedicatedAddonScope(name, ids, itemId);
    assert.ok(!customizationCatalog({ ...item, id: itemId }).groups[0].options.some(o => o.name === 'Add Bacon'));
  }
});
