const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../src/app/admin/menu/admin-menu.module.css', () => ({}));
const mockFetch = jest.fn();
jest.mock('../src/app/admin/admin-api', () => ({ adminFetch: (...args) => mockFetch(...args), adminApiFetch: jest.fn() }));
const { MenuItemModal } = require('../src/app/admin/menu/menu-item-modal');
const item = { id: 'burger', name: 'Burger', slug: 'burger', description: '', basePriceCents: 999, categoryId: 'burgers', stockStatus: 'NORMAL', isHidden: false,
  allowedFulfillmentType: 'BOTH', removableIngredients: [{ name: 'Lettuce', sortOrder: 1 }], modifierGroups: [{ modifierGroupId: 'legacy', contextKey: 'addon',
    modifierGroup: { contextKey: 'addon', options: [{ id: 'cheese', name: 'Add Cheese', priceDeltaCents: 100, addonMatchNormalized: null }] } }], schedules: [] };
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

test('saved mapping absent from the canonical choices remains selected without rewriting it', async () => {
  const changed = structuredClone(item);
  changed.modifierGroups[0].modifierGroup.options[0].addonMatchNormalized = 'saved legacy value';
  mockFetch.mockImplementation(async (url, options) => options ? {} : url.endsWith('/modifier-groups') ? [] : changed);
  await mount();
  const select = renderer.root.findAllByType('select').find(node => node.props['aria-label'] === 'Additional ingredient 1 matching ingredient');
  expect(select.props.value).toBe('saved legacy value');
  expect(select.findAllByType('option').some(node => node.props.value === select.props.value)).toBe(true);
  await save();
  expect(JSON.parse(mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body)).not.toHaveProperty('additional_ingredients');
});
test('an off-recipe extra requires explicit item approval before it is sent', async () => {
  await mount();
  const match = renderer.root.findAllByType('select').find(node => node.props['aria-label'] === 'Additional ingredient 1 matching ingredient');
  expect(match.props.value).toBe('__unconfigured__');
  await act(async () => match.props.onChange({ target: { value: '' } })); await save();
  const request = mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(request[1].body)).toMatchObject({ modifier_groups: [{ id: 'legacy' }], additional_ingredients: [{ name: 'Add Cheese', price_delta_cents: 100, matches_ingredient: '' }] });
});

test.each([false, true])('admin explicitly approves Bacon at 150 cents (new=%s)', async isNew => {
  const changed = structuredClone(item);
  changed.modifierGroups[0].modifierGroup.options = isNew ? [] : [{ id: 'bacon', name: 'Add Bacon', priceDeltaCents: 150, addonMatchNormalized: null }];
  mockFetch.mockImplementation(async (url, options) => options ? {} : url.endsWith('/modifier-groups') ? [] : changed);
  await mount();
  if (isNew) {
    await act(async () => renderer.root.findAllByType('button').find(node => node.children.includes('+ Add additional ingredient')).props.onClick());
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Additional ingredient 1 name' }).props.onChange({ target: { value: 'Add Bacon' } }));
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Additional ingredient 1 price in cents' }).props.onChange({ target: { value: '150' } }));
  }
  const match = renderer.root.findByProps({ 'aria-label': 'Additional ingredient 1 matching ingredient' });
  expect(match.props.value).toBe('__unconfigured__');
  expect(match.findAllByType('option').find(node => node.props.value === '__unconfigured__').children.join('')).toContain('not available to customers');
  await act(async () => match.props.onChange({ target: { value: '' } }));
  await save();
  const payload = JSON.parse(mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body);
  expect(payload.additional_ingredients).toEqual([{ ...(isNew ? {} : { id: 'bacon' }), name: 'Add Bacon', price_delta_cents: 150, matches_ingredient: '' }]);
  expect(payload.removable_ingredients).toEqual(changed.removableIngredients);
});

test.each(['Add Avocado', 'Add Jalapeños'])('removing %s allows unchanged unconfigured ingredients and preserves their IDs', async name => {
  const changed = structuredClone(item);
  changed.modifierGroups[0].modifierGroup.options.push({ id: 'removed', name, priceDeltaCents: 150, addonMatchNormalized: null });
  mockFetch.mockImplementation(async (url, options) => options ? {} : url.endsWith('/modifier-groups') ? [] : changed);
  await mount();
  const remove = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === 'Remove additional ingredient 2');
  await act(async () => remove.props.onClick()); await save();
  const payload = JSON.parse(mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body);
  expect(payload.modifier_groups).toEqual([{ id: 'legacy' }]);
  expect(payload.additional_ingredients).toEqual([{ id: 'cheese', name: 'Add Cheese', price_delta_cents: 100, matches_ingredient: '__unconfigured__' }]);
});
