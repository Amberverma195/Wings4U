const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../src/app/admin/menu/admin-menu.module.css', () => ({}));
const mockFetch = jest.fn();
jest.mock('../src/app/admin/admin-api', () => ({ adminFetch: (...args) => mockFetch(...args), adminApiFetch: jest.fn() }));
const { MenuItemModal } = require('../src/app/admin/menu/menu-item-modal');
const item = { id: 'burger', name: 'Burger', slug: 'burger', description: '', basePriceCents: 999, categoryId: 'burgers', stockStatus: 'NORMAL', isHidden: false,
  allowedFulfillmentType: 'BOTH', removableIngredients: [{ name: 'Lettuce', sortOrder: 1 }], modifierGroups: [{ modifierGroupId: 'legacy', contextKey: 'addon',
    modifierGroup: { contextKey: 'addon', options: [{ name: 'Add Cheese', priceDeltaCents: 100, addonMatchNormalized: null }] } }], schedules: [] };
let renderer;
beforeEach(() => mockFetch.mockImplementation(async (url, options) => options ? {} : url.endsWith('/modifier-groups') ? [] : item));
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.clearAllMocks(); });
const mount = async () => act(async () => { renderer = create(React.createElement(MenuItemModal, { itemId: 'burger', categories: [{ id: 'burgers', slug: 'burgers', name: 'Burgers' }], onClose: jest.fn(), onSaved: jest.fn() })); });
const save = async () => act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));

test('unrelated admin save preserves option IDs and never upgrades unconfigured extras to __always__', async () => {
  await mount(); await save();
  const request = mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  const payload = JSON.parse(request[1].body);
  expect(payload).not.toHaveProperty('additional_ingredients');
  expect(payload.modifier_groups).toEqual([{ id: 'legacy' }]);
});
test('an off-recipe extra requires explicit item approval before it is sent', async () => {
  await mount();
  const match = renderer.root.findAllByType('select').find(node => node.props['aria-label'] === 'Additional ingredient 1 matching ingredient');
  expect(match.props.value).toBe('__unconfigured__');
  await act(async () => match.props.onChange({ target: { value: '' } })); await save();
  const request = mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(request[1].body)).toMatchObject({ modifier_groups: [], additional_ingredients: [{ name: 'Add Cheese', price_delta_cents: 100, matches_ingredient: '' }] });
});
