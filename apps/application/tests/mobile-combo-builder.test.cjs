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

const { ComboBuilderMobile } = require('../src/components/mobile-combo-builder');

const option = (id, name, extra = {}) => ({
  id,
  name,
  price_delta_cents: 0,
  is_default: false,
  linked_flavour_id: null,
  ...extra,
});
const group = (id, name, context_key, options, extra = {}) => ({
  id,
  name,
  display_label: name,
  selection_mode: 'SINGLE',
  min_select: 1,
  max_select: 1,
  is_required: true,
  sort_order: 1,
  context_key,
  options,
  ...extra,
});

const wingTypeGroup = group('type', 'Wing type', null, [
  option('bone-breaded', 'Breaded Bone-in'),
  option('bone-non-breaded', 'Non-Breaded Bone-in'),
  option('boneless', 'Breaded-Boneless', { price_delta_cents: 100 }),
]);
const flavourGroup = group('flavour', 'Flavour', null, [
  option('f-plain', 'Plain', { linked_flavour_id: 'f-plain' }),
  option('f-honey', 'Honey Garlic', { linked_flavour_id: 'f-honey' }),
  option('f-bbq', 'BBQ', { linked_flavour_id: 'f-bbq' }),
]);
const sideGroup = group('side-slot-1', 'Side', 'side', [
  option('side-fries', 'Fries'),
  option('side-rings', 'Onion Rings', { price_delta_cents: 150 }),
]);
const drinkGroup = group('drink-slot-1', 'Drink', 'drink', [
  option('drink-coke', 'Coke'),
  option('drink-sprite', 'Sprite'),
]);

const comboVariants = [1, 2].map((weight) => ({
  menu_item_id: `combo-${weight}lb`,
  slug: `combo-${weight}lb`,
  name: `${weight} lb Combo`,
  description: null,
  base_price_cents: weight * 1699,
  weight_lb: weight,
  flavour_count: weight,
  side_slot_count: 1,
  drink_slot_count: 1,
  modifier_groups: [wingTypeGroup, flavourGroup, sideGroup, drinkGroup],
}));

const comboItem = {
  id: 'combo-main',
  slug: 'wing-combo',
  name: 'Wing Combo',
  description: 'Wings served with your choice of side and drink',
  base_price_cents: 1699,
  image_url: 'https://cdn.example.com/combo.png',
  builder_type: 'WING_COMBO',
  requires_special_instructions: false,
  modifier_groups: [wingTypeGroup, flavourGroup, sideGroup, drinkGroup],
  removable_ingredients: [],
  combo_options: comboVariants,
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

const existingEditingLine = {
  key: 'cart-combo-line-456',
  menu_item_id: 'combo-1lb',
  name: '1 lb Combo',
  quantity: 1,
  special_instructions: 'Sauce on side',
  removed_ingredients: [],
  modifier_selections: [
    { modifier_option_id: 'bone-breaded', group_name: 'Wing type', option_name: 'Breaded Bone-in', price_delta_cents: 0 },
    { modifier_option_id: 'side-fries', group_name: 'Side', option_name: 'Fries', price_delta_cents: 0 },
    { modifier_option_id: 'drink-coke', group_name: 'Drink', option_name: 'Coke', price_delta_cents: 0 },
  ],
  builder_payload: {
    builder_type: 'WING_COMBO',
    wing_type: 'BONE_IN',
    preparation: 'BREADED',
    weight_lb: 1,
    flavour_slots: [
      { slot_no: 1, wing_flavour_id: 'f-honey', flavour_name: 'Honey Garlic', placement: 'ON_SIDE' },
    ],
    saucing_method: 'ON_SIDE',
    side_selections: ['side-fries'],
    drink_selections: ['drink-coke'],
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
    node.props.accessibilityRole === 'button' && (node.props.accessibilityLabel?.startsWith('Add to cart') || node.props.accessibilityLabel?.startsWith('Save changes')),
  );

const mount = async (item, editingLine = null) =>
  act(async () => {
    renderer = create(
      React.createElement(ComboBuilderMobile, {
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

describe('ComboBuilderMobile', () => {
  test('blocks submission when required sides and drinks are unselected', async () => {
    await mount(comboItem);

    // Pick preparation and flavour, but not side or drink
    const breadedBtn = buttonByText('Breaded - Bone-In');
    if (breadedBtn) await act(async () => breadedBtn.props.onPress());

    const honeyBtn = buttonByText('Honey Garlic');
    if (honeyBtn) await act(async () => honeyBtn.props.onPress());

    const submit = submitButton();
    await act(async () => submit.props.onPress());

    // Should NOT call addItem because sides and drinks are required
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  test('successfully submits combo when all steps including sides and drinks are complete', async () => {
    await mount(comboItem);

    // Pick 1 lb combo size
    const size1lb = buttonByText('1 lb / 1 flavour');
    if (size1lb) await act(async () => size1lb.props.onPress());

    // Pick Wing Preparation: Breaded - Bone-In
    const breadedBtn = buttonByText('Breaded - Bone-In');
    await act(async () => breadedBtn.props.onPress());

    // Pick Flavour: BBQ
    const bbqBtn = buttonByText('BBQ');
    await act(async () => bbqBtn.props.onPress());

    // Pick Side: Fries
    const friesBtn = buttonByText('Fries');
    expect(friesBtn).toBeTruthy();
    await act(async () => friesBtn.props.onPress());

    // Pick Drink: Coke
    const cokeBtn = buttonByText('Coke');
    expect(cokeBtn).toBeTruthy();
    await act(async () => cokeBtn.props.onPress());

    const submit = submitButton();
    await act(async () => submit.props.onPress());

    expect(mockCart.addItem).toHaveBeenCalledTimes(1);
    expect(mockCart.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        menu_item_id: 'combo-1lb',
        builder_payload: expect.objectContaining({
          builder_type: 'WING_COMBO',
          wing_type: 'BONE_IN',
          preparation: 'BREADED',
          weight_lb: 1,
          flavour_slots: [
            expect.objectContaining({
              wing_flavour_id: 'f-bbq',
              flavour_name: 'BBQ',
              placement: 'ON_WINGS',
            }),
          ],
          side_selections: ['side-fries'],
          drink_selections: ['drink-coke'],
        }),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('editing existing combo replaces cart line and preserves instructions', async () => {
    await mount(comboItem, existingEditingLine);

    // Verify instructions populated
    expect(renderer.root.findAllByType('TextInput').some((node) => node.props.value === 'Sauce on side')).toBe(true);

    // Change drink to Sprite
    const spriteBtn = buttonByText('Sprite');
    expect(spriteBtn).toBeTruthy();
    await act(async () => spriteBtn.props.onPress());

    const submit = submitButton();
    await act(async () => submit.props.onPress());

    expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
    expect(mockCart.replaceItem).toHaveBeenCalledWith(
      existingEditingLine.key,
      expect.objectContaining({
        menu_item_id: 'combo-1lb',
        special_instructions: 'Sauce on side',
        builder_payload: expect.objectContaining({
          builder_type: 'WING_COMBO',
          drink_selections: ['drink-sprite'],
        }),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
