const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({ Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', StyleSheet: { create: value => value } }));
jest.mock('lucide-react-native', () => ({ X: 'X' }));
const mockCart = { fulfillmentType: 'PICKUP', addItem: jest.fn(), replaceItem: jest.fn() };
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
const { MenuItemBuilder } = require('../src/components/menu-item-builder');
const option = (id, name, extra = {}) => ({ id, name, price_delta_cents: 0, is_default: false, linked_flavour_id: null, ...extra });
const group = (id, name, options, extra = {}) => ({ id, name, display_label: name, selection_mode: 'SINGLE', min_select: 1,
  max_select: 1, is_required: true, sort_order: 1, context_key: null, options, ...extra });
const wingType = group('type', 'Wing type', [option('bone', 'Breaded Bone-in', { is_default: true })]);
const flavour = group('flavour', 'Flavour', [option('bbq', 'BBQ', { linked_flavour_id: 'flavour-bbq', is_default: true }), option('honey', 'Honey', { linked_flavour_id: 'flavour-honey' })]);
const base = { id: 'tenders', slug: 'tenders', name: 'Chicken Tenders', description: null, base_price_cents: 1234, image_url: null,
  builder_type: null, requires_special_instructions: false, modifier_groups: [], removable_ingredients: [],
  is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' };
const variants = [1, 2].map(weight => ({ menu_item_id: `wings-${weight}lb`, slug: `wings-${weight}lb`, name: `${weight} lb Wings`,
  description: null, base_price_cents: weight * 1399, weight_lb: weight, flavour_count: 1, side_slot_count: 0, drink_slot_count: 0,
  modifier_groups: [wingType, flavour] }));
const wings = { ...base, id: 'SYNTHETIC_WINGS', slug: 'wings-by-the-pound', name: 'Wings (By the Pound)', builder_type: 'WINGS', weight_options: variants };
const existing = { key: 'saved-wings-key', menu_item_id: 'wings-2lb', name: '2 lb Wings', quantity: 2, special_instructions: 'Extra crispy',
  removed_ingredients: [], modifier_selections: [{ modifier_option_id: 'bone', group_name: 'Wing type', option_name: 'Breaded Bone-in', price_delta_cents: 0 }],
  builder_payload: { builder_type: 'WINGS', wing_type: 'BONE_IN', preparation: 'BREADED', weight_lb: 2,
    flavour_slots: [{ slot_no: 1, wing_flavour_id: 'flavour-honey', flavour_name: 'Honey', placement: 'ON_WINGS' }] } };
let renderer;
const onClose = jest.fn();
const texts = node => node.findAllByType('Text').map(text => text.children.join('')).join(' ');
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => texts(node) === label);
const submit = () => renderer.root.findAllByType('TouchableOpacity').find(node => /^(Add|Update) \$/.test(texts(node)));
const mount = async (item, editItem = null) => act(async () => { renderer = create(React.createElement(MenuItemBuilder,
  { item, editItem, visible: true, categories: [], onClose })); });
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('Customize restores the real variant, quantity, notes and flavour, and updates instead of duplicating', async () => {
  await mount(wings, existing);
  expect(button('Honey').props.style[1]).toBeTruthy();
  expect(renderer.root.findAllByType('TextInput').some(node => node.props.value === 'Extra crispy')).toBe(true);
  await act(async () => button('BBQ').props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).not.toHaveBeenCalled();
  expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
  expect(mockCart.replaceItem).toHaveBeenCalledWith(existing.key, expect.objectContaining({
    menu_item_id: 'wings-2lb', base_price_cents: 2798, quantity: 2, special_instructions: 'Extra crispy',
    builder_payload: expect.objectContaining({ weight_lb: 2, flavour_slots: [expect.objectContaining({ wing_flavour_id: 'flavour-bbq' })] }),
  }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('new wings resolve the synthetic card to an actual orderable SKU', async () => {
  await mount(wings);
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: 'wings-1lb', base_price_cents: 1399,
    builder_payload: expect.objectContaining({ builder_type: 'WINGS', weight_lb: 1 }) }));
  expect(mockCart.replaceItem).not.toHaveBeenCalled();
});

test('editing a saved wing line preserves its saucing instructions and placement', async () => {
  const edit = { ...existing, builder_payload: { ...existing.builder_payload, saucing_method: 'ON_SIDE', saucing_customer_note: 'Sauce separately',
    flavour_slots: existing.builder_payload.flavour_slots.map(slot => ({ ...slot, placement: 'ON_SIDE' })) } };
  await mount(wings, edit);
  await act(async () => submit().props.onPress());
  expect(mockCart.replaceItem).toHaveBeenCalledWith(edit.key, expect.objectContaining({ builder_payload: expect.objectContaining({
    saucing_method: 'ON_SIDE', saucing_customer_note: 'Sauce separately', flavour_slots: [expect.objectContaining({ placement: 'ON_SIDE' })],
  }) }));
});

test('required tender options must be chosen before add; their API IDs and prices are preserved', async () => {
  const dip = group('dip', 'Dip', [option('real-dip-id', 'Ranch', { price_delta_cents: 50 })]);
  await mount({ ...base, modifier_groups: [dip] });
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).not.toHaveBeenCalled();
  const ranch = renderer.root.findAllByType('TouchableOpacity').find(node => texts(node).startsWith('Ranch'));
  await act(async () => ranch.props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: 'tenders', base_price_cents: 1234,
    modifier_selections: [expect.objectContaining({ modifier_option_id: 'real-dip-id', price_delta_cents: 50 })] }));
});

test('the builder refuses an unavailable item without mutating the cart', async () => {
  await mount({ ...base, is_available: false });
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).not.toHaveBeenCalled();
  expect(mockCart.replaceItem).not.toHaveBeenCalled();
});
