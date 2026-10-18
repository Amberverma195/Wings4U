const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }) }));
jest.mock('react-native', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
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
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => texts(node).replace(/^\u2713 /, '') === label);
const submit = () => renderer.root.findAllByType('TouchableOpacity').find(node => /^(Add to Cart|Update Cart) \$/.test(texts(node)));
const mount = async (item, editItem = null, categories = []) => act(async () => { renderer = create(React.createElement(MenuItemBuilder,
  { item, editItem, visible: true, categories, onClose })); });
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

const { product: sharedProduct } = require('../../../packages/customization/test/fixtures.cjs');
test.each(['veggie-burger', 'chicken-burger', 'buffalo-chicken-wrap'])('mobile uses the identical web fixture for %s', async slug => {
  await mount(sharedProduct(slug));
  expect(texts(renderer.root)).not.toContain('Add Avocado');
  expect(texts(renderer.root)).not.toContain('Add Jalapenos');
  await act(async () => button('Extra Lettuce +$0.50').props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: slug,
    modifier_selections: [expect.objectContaining({ modifier_option_id: 'lettuce', price_delta_cents: 50 })] }));
});

test('included checkboxes remove real ingredients for free and bundle is charged once in its payload', async () => {
  await mount(sharedProduct());
  const included = button('Lettuce');
  expect(included.props.accessibilityState.checked).toBe(true);
  await act(async () => included.props.onPress());
  expect(button('− Lettuce').props.accessibilityState.checked).toBe(false);
  await act(async () => button('Add side + pop').props.onPress());
  await act(async () => button('Wedges').props.onPress());
  await act(async () => button('Coke Zero').props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ base_price_cents: 999, modifier_selections: [],
    removed_ingredients: [{ id: 'veggie-burger-lettuce', name: 'Lettuce' }],
    builder_payload: { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [{ id: 'veggie-burger-lettuce', name: 'Lettuce' }],
      side_pop_bundle: { price_cents: 499, side_label: 'Wedges', pop_label: 'Coke Zero' } } }));
});

test('changed admin price requires review before editing with the latest price, quantity and notes', async () => {
  const item = sharedProduct();
  const saved = { key: 'old', menu_item_id: item.id, quantity: 3, base_price_cents: 999, special_instructions: 'Keep warm',
    modifier_selections: [{ modifier_option_id: 'lettuce', price_delta_cents: 25 }], removed_ingredients: [],
    builder_payload: { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [], side_pop_bundle: { price_cents: 499, side_label: 'Fries', pop_label: 'Pepsi' } } };
  await mount(item, saved); await act(async () => submit().props.onPress());
  expect(mockCart.replaceItem).not.toHaveBeenCalled();
  await act(async () => button('Review current choices').props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.replaceItem).toHaveBeenCalledWith('old', expect.objectContaining({ quantity: 3, special_instructions: 'Keep warm',
    modifier_selections: [expect.objectContaining({ modifier_option_id: 'lettuce', price_delta_cents: 50 })],
    builder_payload: expect.objectContaining({ side_pop_bundle: expect.objectContaining({ price_cents: 499 }) }) }));
});

test('tender combo requires API dip, side and drink choices', async () => {
  const groups = ['dip', 'side', 'drink'].map(id => group(id, id, [option(`${id}-api`, id)], { context_key: id }));
  await mount({ ...base, modifier_groups: groups });
  await act(async () => submit().props.onPress()); expect(mockCart.addItem).not.toHaveBeenCalled();
  for (const id of ['dip', 'side', 'drink']) await act(async () => button(id).props.onPress());
  await act(async () => submit().props.onPress());
  expect(mockCart.addItem.mock.calls[0][0].modifier_selections.map(row => row.modifier_option_id)).toEqual(['dip-api', 'drink-api', 'side-api']);
});

test('lunch edit restores child, removals, extras and customer notes without duplicating kitchen summaries', async () => {
  const child = sharedProduct(); const parent = { ...base, id: 'lunch', slug: 'lunch-burger' };
  const saved = { key: 'lunch-old', menu_item_id: 'lunch', base_price_cents: 1234, quantity: 2,
    modifier_selections: [], removed_ingredients: [], special_instructions: 'veggie-burger | No Tomato | Add Extra Lettuce | Keep warm',
    builder_payload: { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: child.id, child_name: child.name, child_slug: child.slug,
      removed_ingredients: [{ id: 'veggie-burger-tomato', name: 'Tomato' }], child_addons: [{ modifier_option_id: 'lettuce', name: 'Extra Lettuce', price_delta_cents: 50 }] } };
  await mount(parent, saved, [{ slug: 'burgers', items: [child] }]);
  expect(renderer.root.findAllByType('TextInput').some(node => node.props.value === 'Keep warm')).toBe(true);
  await act(async () => submit().props.onPress());
  expect(mockCart.replaceItem).toHaveBeenCalledWith(saved.key, expect.objectContaining({ quantity: 2,
    special_instructions: saved.special_instructions, builder_payload: saved.builder_payload }));
});
