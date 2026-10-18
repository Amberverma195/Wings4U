const { test } = require('node:test');
const assert = require('node:assert/strict');
const { customizationCatalog, initialCustomizationSelections, validateSelections, modifierTotal } = require('../dist');
const fixtures = require('./mapped-menu-fixtures.json');

for (const item of fixtures) test(`${item.slug}: recorded recipe mappings retain IDs, prices and authorization`, () => {
  const before = JSON.stringify(item);
  const selections = initialCustomizationSelections(item);
  for (const group of item.modifier_groups.filter(g => g.context_key === 'size')) selections[group.id] = [group.options[0].id];
  for (const group of item.modifier_groups.filter(g => g.context_key === 'addon')) selections[group.id] = group.options.map(o => o.id);
  const { groups } = customizationCatalog(item, selections);
  assert.equal(validateSelections(groups, selections), null);
  assert.equal(modifierTotal(groups, selections), item.modifier_groups.filter(g => g.context_key === 'addon')
    .flatMap(g => g.options).reduce((sum, o) => sum + o.price_delta_cents, 0));
  assert.equal(JSON.stringify(item), before);
  const changed = structuredClone(item);
  changed.removable_ingredients = [];
  assert.match(validateSelections(customizationCatalog(changed, selections).groups, selections), /Menu options changed/);
});

test('Caesar Dressing is not authorized on Chicken Loaded Fries by a name or foreign option ID', () => {
  const fries = structuredClone(fixtures[0]);
  const dressing = fixtures[1].modifier_groups[0].options[0];
  fries.modifier_groups[0].options.push(dressing);
  assert.ok(!customizationCatalog(fries).groups[0].options.some(o => o.id === dressing.id));
});

test('unavailable and unconfigured extras cannot gain authorization through normalization', () => {
  const item = structuredClone(fixtures[0]);
  const group = item.modifier_groups[0];
  const names = ['Add Avocado', 'Add Jalapeños', 'Crème Fraîche'];
  group.options = names.map((name, i) => ({ id: `blocked-${i}`, name, is_default: false,
    price_delta_cents: 50, addon_match_normalized: i % 2 ? '__unconfigured__' : null }));
  assert.deepEqual(customizationCatalog(item).groups[0].options, []);
});
