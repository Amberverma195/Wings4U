const React = require('react');
const { act, create } = require('react-test-renderer');
const { product, salad, group, option } = require('../../../packages/customization/test/fixtures.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { addItem: jest.fn(), replaceItem: jest.fn() };
let mockSubmit;
jest.mock('../src/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/components/builder-shared', () => ({
  ...jest.requireActual('../src/components/builder-shared'),
  useWingFlavours: () => ({ flavours: [{ id: 'plain', name: 'Plain', is_plain: true, heat_level: 'PLAIN' }], loading: false, error: null }),
  BuilderShell: props => { mockSubmit = props.onSubmit; return React.createElement('main', null, props.children); },
  StepContainer: props => React.createElement('section', null, props.children),
}));
const { WingsBuilder } = require('../src/components/wings-builder');
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.clearAllMocks(); });

async function mount(slug, picks = []) {
  const child = salad(slug);
  const item = product('wings-4u-special', { builder_type: 'WINGS', modifier_groups: [
    group('flavour', [option('plain-option', 'Plain', { linked_flavour_id: 'plain' })]),
    group('salad-picker', [option('salad-choice', child.name)], { context_key: 'salad', selection_mode: 'SINGLE', is_required: true, min_select: 1 }),
  ] });
  const line = { key: 'old', menu_item_id: item.id, quantity: 2, special_instructions: 'Crispy', removed_ingredients: [],
    modifier_selections: [{ modifier_option_id: 'salad-choice', price_delta_cents: 0 }],
    builder_payload: { builder_type: 'WINGS', wing_type: 'BONE_IN', preparation: 'BREADED', weight_lb: 2,
      flavour_slots: [{ slot_no: 1, wing_flavour_id: 'plain', placement: 'ON_WINGS' }],
      salad_customization: { salad_menu_item_id: child.id, salad_name: child.name, removed_ingredients: [],
        modifier_selections: picks.map(id => ({ modifier_option_id: id, name: id, price_delta_cents: 75 })) } } };
  await act(async () => { renderer = create(React.createElement(WingsBuilder, { item, saladMenuItems: [child], editingLine: line, onClose: jest.fn() })); });
}
test.each(['caesar-salad', 'garden-salad', 'greek-salad'])('web embedded %s renders only shared authorized Small extras', async slug => {
  await mount(slug, ['dressing']);
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('Extra Dressing Small'); expect(text).toContain('Add Chicken');
  for (const name of ['Add Avocado', 'Add Jalapeños', 'Extra Dressing Large']) expect(text).not.toContain(name);
  await act(async () => mockSubmit());
  expect(mockCart.replaceItem).toHaveBeenCalledWith('old', expect.objectContaining({ quantity: 2,
    builder_payload: expect.objectContaining({ salad_customization: expect.objectContaining({ modifier_selections: [expect.objectContaining({ modifier_option_id: 'dressing', price_delta_cents: 75 })] }) }) }));
});
test.each(['avocado', 'deleted'])('web requires explicit review of stale salad ID %s before replacing a cart line', async id => {
  await mount('caesar-salad', [id]);
  await act(async () => mockSubmit()); expect(mockCart.replaceItem).not.toHaveBeenCalled();
  const clear = renderer.root.findAllByType('button').find(node => node.children.includes('Review salad extras: clear selections'));
  expect(clear).toBeDefined(); await act(async () => clear.props.onClick());
  await act(async () => mockSubmit()); expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
});
