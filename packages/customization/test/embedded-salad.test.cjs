const { test } = require('node:test');
const assert = require('node:assert/strict');
const { salad, option, group } = require('./fixtures.cjs');
const { customizationCatalog, embeddedSaladCatalog, validateSelections, modifierTotal, dedicatedAddonScope } = require('../dist/index.js');

for (const slug of ['caesar-salad', 'garden-salad', 'greek-salad']) {
  test(`${slug}: embedded and standalone Small have identical authorized extras and prices`, () => {
    const item = salad(slug);
    const standalone = customizationCatalog(item, { size: ['small'] }).groups.filter(group => group.context_key === 'addon');
    const embedded = embeddedSaladCatalog(item);
    assert.equal(embedded.supportsIncludedSize, true);
    assert.deepEqual(embedded.groups, standalone);
    assert.deepEqual(embedded.groups.flatMap(group => group.options.map(option => option.id)), ['approved', 'dressing']);
    assert.equal(modifierTotal(embedded.groups, { extras: ['dressing', 'approved'] }), 325);
    for (const id of ['avocado', 'jalapenos', 'large-dressing', 'deleted']) assert.match(validateSelections(embedded.groups, { extras: [id] }), /review/i);
    assert.match(validateSelections(embedded.groups, { extras: ['dressing', 'dressing'] }), /review/i);
  });
}
test('embedded duplicate extras charge once and conflicting prices require review', () => {
  const item = salad();
  item.modifier_groups.push(group('copy', [option('duplicate', 'Extra Dressing Small', { addon_match_normalized: 'dressing', price_delta_cents: 75 })]));
  let catalog = embeddedSaladCatalog(item);
  const ids = catalog.groups.flatMap(group => group.options).filter(option => /Dressing Small/.test(option.name));
  assert.equal(ids.length, 1);
  assert.equal(modifierTotal(catalog.groups, Object.fromEntries(catalog.groups.map(group => [group.id, group.options.filter(option => /Dressing Small/.test(option.name)).map(option => option.id)]))), 75);
  item.modifier_groups.at(-1).options[0].price_delta_cents = 100;
  catalog = embeddedSaladCatalog(item);
  assert.equal(catalog.issues[0].kind, 'price_conflict');
  assert.equal(catalog.groups.flatMap(group => group.options).some(option => /Dressing Small/.test(option.name)), false);
});
test('a shared-group copy cannot create item approvals from formerly shared mappings', () => {
  assert.equal(dedicatedAddonScope('Salad extras [shared copy]', ['salad'], 'salad'), null);
});
