const { test } = require('node:test');
const assert = require('node:assert/strict');
const { customizationCatalog: catalog, defaultSelections, validateSelections, modifierTotal, SIDE_POP_BUNDLE_PRICE_CENTS, dedicatedAddonScope } = require('../dist');
const { product, group, option } = require('./fixtures.cjs');
const ids = result => result.groups.flatMap(group => group.options.map(option => option.id));

for (const slug of ['veggie-burger', 'chicken-burger']) test(`${slug}: unassociated avocado never passes fallback matching`, () => {
  assert.deepEqual(ids(catalog(product(slug))), ['lettuce']);
});
test('Buffalo wrap does not show either unassociated duplicate jalapeno', () => assert.deepEqual(ids(catalog(product('buffalo-chicken-wrap'))), ['lettuce']));
test('prepared Jalapeno Popper remains a legitimate explicitly mapped extra', () => {
  const item = product(); item.removable_ingredients.push({ id: 'popper', name: 'Jalapeño Popper' });
  item.modifier_groups[0].options.push(option('extra-popper', 'Extra Jalapeno Popper', { addon_match_normalized: 'jalapeno popper' }));
  assert.ok(ids(catalog(item)).includes('extra-popper'));
});
test('ingredient removals and matching follow current records, including removal of last ingredient', () => {
  const item = product(); item.removable_ingredients = [];
  assert.deepEqual(ids(catalog(item)), []);
});
test('__always__ is product-scoped and cannot authorize another item', () => {
  const addon = group('item', [option('bacon', 'Add Bacon', { addon_match_normalized: '__always__' })], { addon_scope_menu_item_id: 'veggie-burger' });
  assert.deepEqual(ids(catalog(product('veggie-burger', { modifier_groups: [addon] }))), ['bacon']);
  assert.deepEqual(ids(catalog(product('chicken-burger', { modifier_groups: [addon] }))), []);
});
test('__always__ in a shared group fails closed', () => {
  assert.deepEqual(ids(catalog(product('burger', { modifier_groups: [group('shared', [option('bacon', 'Add Bacon', { addon_match_normalized: '__always__' })])] }))), []);
  assert.equal(dedicatedAddonScope('Burger Extras', ['burger', 'wrap'], 'burger'), null);
});
test('dedicated editor configuration is authoritative over legacy ingredient extras', () => {
  const item = product(); item.modifier_groups.push(group('editor', [], { name: 'Veggie Burger Additional Ingredients', addon_scope_menu_item_id: item.id }));
  assert.deepEqual(ids(catalog(item)), []);
});
test('removing an admin extra makes old selections stale', () => {
  const item = product(); const selections = { legacy: ['lettuce'] };
  item.modifier_groups[0].options = [];
  assert.match(validateSelections(catalog(item).groups, selections), /Menu options changed/);
});
test('changed price updates the live total from current catalog cents', () => {
  const item = product(); item.modifier_groups[0].options[1].price_delta_cents = 175;
  assert.equal(modifierTotal(catalog(item).groups, { legacy: ['lettuce'] }), 175);
});
test('equivalent extras deduplicate across and within linked groups without double charge', () => {
  const item = product(); item.modifier_groups.push(group('duplicate', [option('lettuce-2', 'Add Lettuce', { addon_match_normalized: 'lettuce' })], { sort_order: 2 }));
  const result = catalog(item);
  assert.deepEqual(ids(result), ['lettuce']); assert.equal(result.issues[0].kind, 'duplicate');
  assert.match(validateSelections(result.groups, { legacy: ['lettuce'], duplicate: ['lettuce-2'] }), /Menu options changed/);
});
test('conflicting prices are reported with both IDs and neither price is silently chosen', () => {
  const item = product(); item.modifier_groups.push(group('duplicate', [option('lettuce-2', 'Extra Lettuce', { price_delta_cents: 200, addon_match_normalized: 'lettuce' })]));
  const result = catalog(item); assert.deepEqual(ids(result), []);
  assert.equal(result.issues[0].kind, 'price_conflict'); assert.deepEqual(result.issues[0].option_ids.sort(), ['lettuce', 'lettuce-2']);
});
test('duplicate IDs fail closed and are reported', () => {
  const item = product(); item.modifier_groups.push(group('duplicate', [option('lettuce', 'Lettuce on side', { addon_match_normalized: 'lettuce' })]));
  const result = catalog(item); assert.ok(result.issues.some(issue => issue.kind === 'id_conflict')); assert.deepEqual(ids(result), []);
});
test('similar options with distinct meanings survive deduplication', () => {
  const item = product(); item.modifier_groups[0].options.push(option('lettuce-side', 'Extra Lettuce on the side', { addon_match_normalized: 'lettuce' }));
  assert.deepEqual(ids(catalog(item)), ['lettuce', 'lettuce-side']);
});
test('size-specific extras require authorization AND their selected size', () => {
  const size = group('size', [option('small', 'Small', { is_default: true, price_delta_cents: 0 }), option('large', 'Large', { price_delta_cents: 300 })], { context_key: 'size', selection_mode: 'SINGLE', min_select: 1, max_select: 1 });
  const extras = group('extras', [option('small-chicken', 'Add Chicken (Small)', { addon_match_normalized: '__always__', price_delta_cents: 200 }), option('large-chicken', 'Add Chicken (Large)', { addon_match_normalized: '__always__', price_delta_cents: 400 }), option('bad', 'Add Avocado (Small)')], { addon_scope_menu_item_id: 'salad' });
  const item = product('salad', { modifier_groups: [size, extras] });
  assert.ok(!ids(catalog(item, { size: ['small'] })).includes('bad'));
  assert.ok(ids(catalog(item, { size: ['small'] })).includes('small-chicken'));
  const large = catalog(item, { size: ['large'] }); assert.ok(!ids(large).includes('small-chicken'));
  assert.equal(modifierTotal(large.groups, { size: ['large'], extras: ['large-chicken'] }), 700);
  assert.match(validateSelections(large.groups, { size: ['large'], extras: ['small-chicken'] }), /Menu options changed/);
});
test('required dips, sides, drinks and SINGLE maximums use current admin constraints', () => {
  const groups = ['dip', 'side', 'drink'].map(id => group(id, [option(`${id}-a`, id), option(`${id}-b`, `${id} B`)], { context_key: id, is_required: true, min_select: 0, max_select: null, selection_mode: 'SINGLE' }));
  assert.match(validateSelections(groups, {}), /Choose/);
  const selections = Object.fromEntries(groups.map(group => [group.id, [group.options[0].id]]));
  assert.equal(validateSelections(groups, selections), null);
  assert.match(validateSelections(groups, { ...selections, dip: ['dip-a', 'dip-b'] }), /fewer/);
});
test('required and repeated flavour slots are never semantically collapsed', () => {
  const groups = [1, 2].map(i => group(`flavour-${i}`, [option(`bbq-${i}`, 'BBQ', { linked_flavour_id: 'bbq' })], { context_key: 'flavour', is_required: true, min_select: 1, max_select: 1, selection_mode: 'SINGLE' }));
  assert.equal(ids(catalog(product('tenders', { modifier_groups: groups }))).length, 2);
});
test('defaults respect maximum and auto-select one-option size only', () => {
  const size = group('size', [option('small', 'Small')], { context_key: 'size', selection_mode: 'SINGLE', max_select: 1 });
  assert.deepEqual(defaultSelections([size]), { size: ['small'] });
  const groupWithDefaults = group('defaults', [option('a', 'A', { is_default: true }), option('b', 'B', { is_default: true })], { max_select: 1 });
  assert.deepEqual(defaultSelections([groupWithDefaults]), { defaults: ['a'] });
});
test('side/pop upgrade has the established 499-cent single charge', () => assert.equal(SIDE_POP_BUNDLE_PRICE_CENTS, 499));
