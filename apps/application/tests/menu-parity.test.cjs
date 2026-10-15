// Load website references dynamically so their web-only aliases stay out of mobile's TS graph.
jest.mock('@/lib/menu-item-description', () => require('../../web/src/lib/' + 'menu-item-description'), { virtual: true });
const web = require('../../web/src/Wings4u/' + 'menu-display');
const mobile = require('../src/lib/menu-display');

const item = (id, overrides = {}) => ({
  id, slug: id, name: id, description: null, base_price_cents: 1000,
  modifier_groups: [], stock_status: 'NORMAL', is_available: true, ...overrides,
});
const category = (slug, items = [], sortOrder = 99) => ({
  id: slug, slug, name: slug, sort_order: sortOrder, items,
});
const webCategories = categories => web.ensureSaladsCategoryInDisplay(
  web.buildDisplayMenuCategories(web.sortMenuCategories(web.combineSideCategories(categories))),
);

function expectMenuParity(categories) {
  const actual = mobile.prepareMenuCategories(categories);
  const expected = webCategories(categories);
  expect(actual.map(({ id, slug, name }) => ({ id, slug, name })))
    .toEqual(expected.map(({ id, slug, name }) => ({ id, slug, name })));
  for (let i = 0; i < actual.length; i++) {
    // Each real SKU remains available, even if the website groups legacy sizes.
    expect(actual[i].items.map(item => item.id).sort())
      .toEqual(expected[i].items.flatMap(item => item.cartMenuItemIds).sort());
    for (const expectedItem of expected[i].items) {
      if (expectedItem.kind !== 'item') continue;
      const actualItem = actual[i].items.find(item => item.id === expectedItem.item.id);
      expect(actualItem.base_price_cents).toBe(expectedItem.displayPriceCents);
      expect(mobile.menuCardDetails(actualItem, actual[i].slug)).toEqual({
        name: expectedItem.displayName, description: expectedItem.displayDescription,
      });
      expect(actualItem.modifier_groups).toEqual(expectedItem.item.modifier_groups);
    }
  }
}

test('matches the website category order and keeps exact catalog names', () => {
  const slugs = ['wings','wing-combos','burgers','tenders','wraps','salads',
    'poutines-and-sides','sides','appetizers','breads','specials','party-specials','drinks','dessert','dips'];
  const categories = [...slugs].reverse().map(slug => category(slug));
  expect(mobile.prepareMenuCategories(categories).map(category => category.slug)).toEqual(slugs);
  expectMenuParity(categories);
});

test('merges all specialty-fries items into Sides and deduplicates real IDs', () => {
  const categories = [category('sides', [item('fries')]),
    category('specialty-fries', [item('fries'), item('loaded-fries', { base_price_cents: 1299 })])];
  const sides = mobile.prepareMenuCategories(categories).find(category => category.slug === 'sides');
  expect(sides.items.map(item => item.id)).toEqual(['fries','loaded-fries']);
  expect(categories[0].items).toHaveLength(1);
  expectMenuParity(categories);
});

test('hides note-only add-ons while preserving the orderable burger and wrap', () => {
  const categories = [category('burgers', [item('burger'), item('burger-side-add')]),
    category('wraps', [item('wrap'), item('wrap-side-add')])];
  expectMenuParity(categories);
  expect(mobile.prepareMenuCategories(categories)[0].items.map(item => item.id)).toEqual(['burger']);
});

test('adds the same empty Salads category as the website without inventing products', () => {
  const categories = [category('wraps'), category('poutines-and-sides')];
  expectMenuParity(categories);
  const result = mobile.prepareMenuCategories(categories);
  expect(result[1].name).toBe('Salads');
  expect(result[1].items).toEqual([]);
});

test('matches appetizer quantities and size descriptions while preserving prices', () => {
  const categories = [category('appetizers', [item('bites', { name: 'Mac n Cheese Bites (8pc.)' })]),
    category('poutines-and-sides', [item('classic', { modifier_groups: [{ context_key: 'size',
      options: [{ name: 'Small', price_delta_cents: 0 }, { name: 'Large', price_delta_cents: 200 }] }] })])];
  expectMenuParity(categories);
});

test('uses catalog availability for lunch specials instead of hardcoding their visibility', () => {
  const categories = [category('wings'), category('lunch-specials', [item('lunch')])];
  expectMenuParity(categories);
  expect(mobile.prepareMenuCategories(categories)[0].slug).toBe('lunch-specials');
});

// Optional diagnostic against an API response captured for a particular location/method.
for (const [method, fixture] of [
  ['pickup', process.env.WINGS_MENU_PARITY_FIXTURE],
  ['delivery', process.env.WINGS_MENU_PARITY_DELIVERY_FIXTURE],
]) {
  if (!fixture) continue;
  test('all current ' + method + ' categories, IDs, prices and modifiers match the website', () => {
    const menu = JSON.parse(require('fs').readFileSync(fixture, 'utf8')).data;
    expect(menu.categories.length).toBeGreaterThan(0);
    expectMenuParity(menu.categories);
  });
}
