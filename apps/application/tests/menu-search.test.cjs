const { filterMenuCategories } = require('../src/lib/menu-search');
const categories = [
  { id: 'wings', name: 'Wings', items: [
    { id: 'bbq', name: 'Glazed wings', description: 'Smoky barbecue', is_available: true, stock_status: 'NORMAL' },
    { id: 'hot', name: 'Hot wings', description: null, is_available: false, stock_status: 'UNAVAILABLE' },
  ] },
  { id: 'burgers', name: 'Burgers', items: [
    { id: 'chicken', name: 'Chicken burger', description: null, is_available: true, stock_status: 'LOW_STOCK' },
  ] },
];
test('empty search preserves the original menu', () => {
  expect(filterMenuCategories(categories, ' ')).toBe(categories);
});
test('searches all category names, item names and descriptions regardless of case', () => {
  expect(filterMenuCategories(categories, ' SMOKY ')[0].items.map(item => item.id)).toEqual(['bbq']);
  expect(filterMenuCategories(categories, 'burger')[0].id).toBe('burgers');
  expect(filterMenuCategories(categories, 'wings')[0].items).toHaveLength(2);
});
test('availability filtering combines with search without mutating the menu', () => {
  const result = filterMenuCategories(categories, 'wings', true);
  expect(result[0].items.map(item => item.id)).toEqual(['bbq']);
  expect(categories[0].items).toHaveLength(2);
  expect(filterMenuCategories(categories, '', true)[1].items[0].id).toBe('chicken');
});
test('no matches returns an empty result', () => {
  expect(filterMenuCategories(categories, 'pizza')).toEqual([]);
});
