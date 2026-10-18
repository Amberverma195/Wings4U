const React = require('react');
const { act, create } = require('react-test-renderer');
const { product, group, option } = require('../../../packages/customization/test/fixtures.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { addItem: jest.fn(), replaceItem: jest.fn() };
let mockSubmit;
jest.mock('../src/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/components/builder-shared', () => ({
  BuilderShell: props => { mockSubmit = props.onSubmit; return React.createElement('main', props, props.children); },
  builderSubmitLabel: editing => editing ? 'Update Cart' : 'Add to Cart',
  BUILDER_VALIDATION_MESSAGE: 'Check required choices',
}));
const { ItemCustomizationOverlay } = require('../src/components/item-customization-overlay');
const mappedMenu = require('../../../packages/customization/test/mapped-menu-fixtures.json');
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.clearAllMocks(); });

test.each(mappedMenu.map(item => [item.slug, item]))('web retains recorded mappings and prices for %s', async (_slug, item) => {
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, onClose: jest.fn() })); });
  const expected = [];
  for (const group of item.modifier_groups) {
    const inputs = renderer.root.findAllByType('input').filter(node => node.props.name === `mod-${group.id}`);
    const options = group.context_key === 'size' ? group.options.slice(0, 1) : group.options;
    for (let i = 0; i < options.length; i++) {
      if (group.context_key === 'size') {
        const choice = renderer.root.findAllByType('button').find(node => node.children.includes(options[i].name));
        await act(async () => choice.props.onClick());
      } else await act(async () => inputs[i].props.onChange());
      expected.push(expect.objectContaining({ modifier_option_id: options[i].id, price_delta_cents: options[i].price_delta_cents }));
    }
  }
  await act(async () => mockSubmit());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: item.id, modifier_selections: expect.arrayContaining(expected) }));
  expect(mockCart.addItem.mock.calls[0][0].modifier_selections).toHaveLength(expected.length);
});

test.each(['veggie-burger', 'chicken-burger', 'buffalo-chicken-wrap'])('web applies the shared fixture for %s and preserves real IDs on add', async slug => {
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item: product(slug), onClose: jest.fn() })); });
  const text = JSON.stringify(renderer.toJSON());
  expect(text).not.toContain('Add Avocado'); expect(text).not.toContain('Add Jalapenos'); expect(text).toContain('Extra Lettuce');
  const input = renderer.root.findAllByType('input').find(node => node.props.name === 'mod-legacy');
  await act(async () => input.props.onChange());
  await act(async () => mockSubmit());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: slug,
    modifier_selections: [expect.objectContaining({ modifier_option_id: 'lettuce', price_delta_cents: 50 })] }));
});

test('web editing an option removed by admin requires explicit review', async () => {
  const item = product(); const old = { key: 'old', menu_item_id: item.id, base_price_cents: 999, quantity: 2,
    modifier_selections: [{ modifier_option_id: 'avocado', price_delta_cents: 200 }], removed_ingredients: [], special_instructions: 'Keep warm' };
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, editingLine: old, onClose: jest.fn() })); });
  await act(async () => mockSubmit()); expect(mockCart.replaceItem).not.toHaveBeenCalled();
  const review = renderer.root.findAllByType('button').find(node => node.children.includes('Review current choices'));
  await act(async () => review.props.onClick()); await act(async () => mockSubmit());
  expect(mockCart.replaceItem).toHaveBeenCalledWith('old', expect.objectContaining({ quantity: 2, special_instructions: 'Keep warm', modifier_selections: [] }));
});

test.each([false, true])('SINGLE selection can be cleared only when optional (required=%s)', async required => {
  const item = product('tenders', { modifier_groups: [group('dip', [option('ranch', 'Ranch', { price_delta_cents: 125 })], {
    context_key: 'dip', selection_mode: 'SINGLE', is_required: required, min_select: required ? 1 : 0, max_select: 1,
  })] });
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, onClose: jest.fn() })); });
  const input = () => renderer.root.findAllByType('input').find(node => node.props.name === 'mod-dip');
  expect(input().props.type).toBe(required ? 'radio' : 'checkbox');
  await act(async () => input().props.onChange());
  expect(renderer.root.findByType('main').props.totalCents).toBe(1124);
  await act(async () => input().props.onChange());
  expect(input().props.checked).toBe(required);
  expect(renderer.root.findByType('main').props.totalCents).toBe(required ? 1124 : 999);
  await act(async () => mockSubmit());
  const selections = mockCart.addItem.mock.calls[0][0].modifier_selections;
  expect(selections).toEqual(required ? [expect.objectContaining({ modifier_option_id: 'ranch', price_delta_cents: 125 })] : []);
});

test('optional SINGLE dropdown accepts its empty choice', async () => {
  const item = product('tenders', { modifier_groups: [group('dip', Array.from({ length: 7 }, (_, i) => option('dip-' + i, 'Dip ' + i)), {
    context_key: 'dip', selection_mode: 'SINGLE', max_select: 1,
  })] });
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, onClose: jest.fn() })); });
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'dip-0' } }));
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: '' } }));
  await act(async () => mockSubmit());
  expect(mockCart.addItem.mock.calls[0][0].modifier_selections).toEqual([]);
});

test.each(['stale', 'required', 'price-conflict'])('Add to Cart scrolls and focuses the visible %s validation alert', async problem => {
  const item = product('tenders');
  let editingLine;
  if (problem === 'stale') editingLine = { key: 'saved', menu_item_id: item.id, base_price_cents: 999, quantity: 1,
    modifier_selections: [{ modifier_option_id: 'avocado', price_delta_cents: 200 }], removed_ingredients: [] };
  if (problem === 'required') item.modifier_groups = [group('dip', [option('ranch', 'Ranch')], { context_key: 'dip', is_required: true, min_select: 1 })];
  if (problem === 'price-conflict') item.modifier_groups[0].options.push(option('lettuce-conflict', 'Extra Lettuce', { addon_match_normalized: 'lettuce', price_delta_cents: 100 }));
  const alert = { scrollIntoView: jest.fn(), focus: jest.fn(), classList: { add: jest.fn(), remove: jest.fn() } };
  const previousWindow = global.window; global.window = { setTimeout: jest.fn() };
  try {
    await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, editingLine, onClose: jest.fn() }), {
      createNodeMock: element => element.type === 'section' && element.props.role === 'alert' ? alert : null,
    }); });
    await act(async () => mockSubmit());
    expect(alert.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(alert.focus).toHaveBeenCalledWith({ preventScroll: true });
    const section = renderer.root.findAllByType('section').find(node => node.props.role === 'alert');
    expect(section.props.tabIndex).toBe(-1); expect(section.props['aria-live']).toBe('assertive');
    expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockCart.replaceItem).not.toHaveBeenCalled();
    await act(async () => renderer.unmount()); renderer = null;
  } finally { global.window = previousWindow; }
});

const { buffaloBurger } = require('../../../packages/customization/test/buffalo-burger-fixture.cjs');
test.each([false, true])('web Buffalo burger requires explicit Bacon approval (%s)', async approved => {
  const item = buffaloBurger(approved);
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, onClose: jest.fn() })); });
  const text = JSON.stringify(renderer.toJSON());
  for (const name of ['Extra Sriracha Mayo', 'Extra Lettuce', 'Extra Red Onion', 'Extra Tomato']) expect(text).toContain(name);
  expect(text.includes('Add Bacon')).toBe(approved);
  expect(text).not.toMatch(/Add Avocado|Add Jalapenos/);
  const inputs = renderer.root.findAllByType('input').filter(node => node.props.name === 'mod-' + item.modifier_groups[0].id);
  expect(inputs).toHaveLength(approved ? 5 : 4);
  if (!approved) return;
  await act(async () => inputs[2].props.onChange());
  await act(async () => mockSubmit());
  const bacon = item.modifier_groups[0].options.find(o => o.name === 'Add Bacon');
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ modifier_selections: [expect.objectContaining({ modifier_option_id: bacon.id, price_delta_cents: 150 })] }));
});
