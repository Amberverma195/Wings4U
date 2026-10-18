const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  Switch: 'Switch',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value) => value },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));

jest.mock('lucide-react-native', () => ({ X: 'X' }));

const mockCart = {
  locationId: 'store-1',
  addItem: jest.fn(),
  replaceItem: jest.fn(),
};
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));

const mockFlavours = [
  { id: 'f-plain', name: 'Plain', slug: 'plain', heat_level: 'PLAIN', is_plain: true, sort_order: 1 },
  { id: 'f-honey', name: 'Honey Garlic', slug: 'honey-garlic', heat_level: 'MILD', is_plain: false, sort_order: 2 },
  { id: 'f-bbq', name: 'BBQ', slug: 'bbq', heat_level: 'MILD', is_plain: false, sort_order: 3 },
  { id: 'f-hot', name: 'Hot', slug: 'hot', heat_level: 'HOT', is_plain: false, sort_order: 4 },
];

jest.mock('../src/lib/api', () => ({
  apiJson: jest.fn(async () => ({ data: mockFlavours })),
}));

const { WingsBuilderMobile } = require('../src/components/mobile-wings-builder');

const option = (id, name, extra = {}) => ({
  id,
  name,
  price_delta_cents: 0,
  is_default: false,
  linked_flavour_id: null,
  ...extra,
});
const group = (id, name, options, extra = {}) => ({
  id,
  name,
  display_label: name,
  selection_mode: 'SINGLE',
  min_select: 1,
  max_select: 1,
  is_required: true,
  sort_order: 1,
  context_key: null,
  options,
  ...extra,
});

const wingTypeGroup = group('type', 'Wing type', [
  option('bone-breaded', 'Breaded Bone-in'),
  option('bone-non-breaded', 'Non-Breaded Bone-in'),
  option('boneless', 'Breaded-Boneless', { price_delta_cents: 100 }),
]);
const flavourGroup = group('flavour', 'Flavour', [
  option('f-plain', 'Plain', { linked_flavour_id: 'f-plain' }),
  option('f-honey', 'Honey Garlic', { linked_flavour_id: 'f-honey' }),
  option('f-bbq', 'BBQ', { linked_flavour_id: 'f-bbq' }),
]);

const variants = [1, 2].map((weight) => ({
  menu_item_id: `wings-${weight}lb`,
  slug: `wings-${weight}lb`,
  name: `${weight} lb Wings`,
  description: null,
  base_price_cents: weight * 1399,
  weight_lb: weight,
  flavour_count: weight,
  side_slot_count: 0,
  drink_slot_count: 0,
  modifier_groups: [wingTypeGroup, flavourGroup],
}));

const wingsItem = {
  id: 'wings-main',
  slug: 'wings-by-the-pound',
  name: 'Wings (By the Pound)',
  description: 'Juicy wings with your favourite flavours',
  base_price_cents: 1399,
  image_url: 'https://cdn.example.com/wings.png',
  builder_type: 'WINGS',
  requires_special_instructions: false,
  modifier_groups: [wingTypeGroup, flavourGroup],
  removable_ingredients: [],
  weight_options: variants,
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

const existingEditingLine = {
  key: 'cart-line-123',
  menu_item_id: 'wings-1lb',
  name: '1 lb Wings',
  quantity: 2,
  special_instructions: 'Well done please',
  removed_ingredients: [],
  modifier_selections: [
    { modifier_option_id: 'bone-breaded', group_name: 'Wing type', option_name: 'Breaded Bone-in', price_delta_cents: 0 },
  ],
  builder_payload: {
    builder_type: 'WINGS',
    wing_type: 'BONE_IN',
    preparation: 'BREADED',
    weight_lb: 1,
    flavour_slots: [
      { slot_no: 1, wing_flavour_id: 'f-honey', flavour_name: 'Honey Garlic', placement: 'ON_WINGS' },
    ],
    saucing_method: 'ON_WINGS',
  },
};

let renderer;
const onClose = jest.fn();

const texts = (node) =>
  node.findAllByType('Text').map((text) => text.children.join('')).join(' ');
const buttonByText = (label) =>
  renderer.root.findAllByType('TouchableOpacity').find((node) => texts(node).trim() === label);
const submitButton = () =>
  renderer.root.findAllByType('TouchableOpacity').find((node) =>
    node.props.accessibilityRole === 'button' && (node.props.accessibilityLabel === 'Add to cart' || node.props.accessibilityLabel === 'Save changes'),
  );

const mount = async (item, editingLine = null) =>
  act(async () => {
    renderer = create(
      React.createElement(WingsBuilderMobile, {
        item,
        visible: true,
        onClose,
        editingLine,
      }),
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
});

describe('WingsBuilderMobile', () => {
  test.each([['party-75-wings', '75 Wings', 8999, 8, 5], ['party-100-wings', '100 Wings', 11699, 11, 6.67]])('editing %s explicitly saves the official equivalent and retains pieces, price, quantity and flavours', async (slug, name, price, weight, oldWeight) => {
    const groups = [wingTypeGroup, ...Array.from({ length: 5 }, (_, i) => ({ ...flavourGroup, id: `flavour-${i + 1}`, name: `Flavour ${i + 1}` }))];
    const party = { ...wingsItem, id: slug, slug, name, base_price_cents: price, modifier_groups: groups, weight_options: [{ ...variants[0],
      menu_item_id: slug, slug, name, base_price_cents: price, weight_lb: weight, flavour_count: 5, modifier_groups: groups }] };
    const editingLine = { ...existingEditingLine, menu_item_id: slug, name, quantity: 3, builder_payload: { ...existingEditingLine.builder_payload,
      weight_lb: oldWeight, flavour_slots: Array.from({ length: 5 }, (_, i) => ({ slot_no: i + 1, wing_flavour_id: 'f-plain', flavour_name: 'Plain', placement: 'ON_WINGS' })) } };
    await mount(party, editingLine);
    expect(texts(renderer.root)).toContain('Portion information has changed');
    expect(mockCart.replaceItem).not.toHaveBeenCalled();
    await act(async () => submitButton().props.onPress());
    expect(mockCart.replaceItem).toHaveBeenCalledWith(editingLine.key, expect.objectContaining({ menu_item_id: slug, name, quantity: 3, base_price_cents: price,
      builder_payload: expect.objectContaining({ weight_lb: weight, flavour_slots: editingLine.builder_payload.flavour_slots }) }));
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });
  test('renders with initial unselected state when adding new item and blocks submit', async () => {
    await mount(wingsItem);
    const submit = submitButton();
    expect(submit).toBeTruthy();
    // Clicking submit without selecting wing preparation or flavour should fail validation
    await act(async () => submit.props.onPress());
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  test('selecting preparation and flavours enables submit and adds item to cart with correct payload', async () => {
    await mount(wingsItem);

    // Pick 1 lb option
    const size1lb = buttonByText('1 lb / 1 flavour');
    if (size1lb) await act(async () => size1lb.props.onPress());

    // Pick Breaded - Bone-In
    const breadedBtn = buttonByText('Breaded - Bone-In');
    expect(breadedBtn).toBeTruthy();
    await act(async () => breadedBtn.props.onPress());

    // Pick Honey Garlic
    const honeyBtn = buttonByText('Honey Garlic');
    expect(honeyBtn).toBeTruthy();
    await act(async () => honeyBtn.props.onPress());

    // Submit
    const submit = submitButton();
    await act(async () => submit.props.onPress());

    expect(mockCart.addItem).toHaveBeenCalledTimes(1);
    expect(mockCart.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        menu_item_id: 'wings-1lb',
        name: '1 lb Wings',
        builder_payload: expect.objectContaining({
          builder_type: 'WINGS',
          wing_type: 'BONE_IN',
          preparation: 'BREADED',
          weight_lb: 1,
          flavour_slots: [
            expect.objectContaining({
              wing_flavour_id: 'f-honey',
              flavour_name: 'Honey Garlic',
              placement: 'ON_WINGS',
            }),
          ],
        }),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('pre-fills from editing line and calls replaceItem on submit', async () => {
    await mount(wingsItem, existingEditingLine);

    // Should pre-fill quantity 2
    expect(renderer.root.findAllByType('TextInput').some((node) => node.props.value === 'Well done please')).toBe(true);

    // Switch flavour to BBQ
    const bbqBtn = buttonByText('BBQ');
    expect(bbqBtn).toBeTruthy();
    await act(async () => bbqBtn.props.onPress());

    const submit = submitButton();
    await act(async () => submit.props.onPress());

    expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
    expect(mockCart.replaceItem).toHaveBeenCalledWith(
      existingEditingLine.key,
      expect.objectContaining({
        menu_item_id: 'wings-1lb',
        quantity: 2,
        special_instructions: 'Well done please',
        builder_payload: expect.objectContaining({
          builder_type: 'WINGS',
          flavour_slots: [
            expect.objectContaining({
              wing_flavour_id: 'f-bbq',
              flavour_name: 'BBQ',
            }),
          ],
        }),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('boneless upcharge is correctly reflected in payload and modifier selections', async () => {
    await mount(wingsItem);

    // Pick 1 lb option
    const size1lb = buttonByText('1 lb / 1 flavour');
    if (size1lb) await act(async () => size1lb.props.onPress());

    // Pick Breaded-Boneless (+$1.00)
    const bonelessBtn = renderer.root.findAllByType('TouchableOpacity').find((node) =>
      texts(node).includes('Breaded-Boneless'),
    );
    expect(bonelessBtn).toBeTruthy();
    await act(async () => bonelessBtn.props.onPress());

    // Pick Honey Garlic
    const honeyBtn = buttonByText('Honey Garlic');
    await act(async () => honeyBtn.props.onPress());

    const submit = submitButton();
    await act(async () => submit.props.onPress());

    expect(mockCart.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        builder_payload: expect.objectContaining({
          wing_type: 'BONELESS',
          preparation: 'BREADED',
        }),
      }),
    );
  });
});
