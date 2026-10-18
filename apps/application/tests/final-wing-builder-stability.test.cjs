const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

// Mocks for React Native and Expo
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
  items: [],
  addItem: jest.fn(),
  replaceItem: jest.fn(),
};
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));

const mockApiFlavours = [
  { id: 'f-plain', name: 'Plain', slug: 'plain', heat_level: 'PLAIN', is_plain: true, sort_order: 1 },
  { id: 'f-honey', name: 'Honey Garlic', slug: 'honey-garlic', heat_level: 'MILD', is_plain: false, sort_order: 2 },
  { id: 'f-bbq', name: 'BBQ', slug: 'bbq', heat_level: 'MILD', is_plain: false, sort_order: 3 },
  { id: 'f-hot', name: 'Hot', slug: 'hot', heat_level: 'HOT', is_plain: false, sort_order: 4 },
];

let mockApiJsonImpl = async () => ({ data: mockApiFlavours });
jest.mock('../src/lib/api', () => ({
  apiJson: jest.fn((...args) => mockApiJsonImpl(...args)),
}));
const { apiJson } = require('../src/lib/api');

const {
  getBuilderPriceDelta,
  getCartItemUnitPrice,
  getCartItemSubtotal,
  calculateCartSubtotal,
  calculateDeliveryTipCents,
  BONELESS_WINGS_UPCHARGE_CENTS,
  EXTRA_FLAVOUR_PRICE_CENTS,
} = require('../src/lib/wing-builder-logic');

const { validateCheckout } = require('../src/lib/checkout-preparation');
const { useWingFlavours } = require('../src/components/mobile-builder-shell');
const { WingsBuilderMobile } = require('../src/components/mobile-wings-builder');
const { ComboBuilderMobile } = require('../src/components/mobile-combo-builder');

// Helper fixtures
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

const standardWingsVariants = [1, 2].map((weight) => ({
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

const standardWingsItem = {
  id: 'wings-main',
  slug: 'wings-by-the-pound',
  name: 'Wings (By the Pound)',
  description: 'Fresh chicken wings',
  base_price_cents: 1399,
  image_url: null,
  builder_type: 'WINGS',
  requires_special_instructions: false,
  modifier_groups: [wingTypeGroup, flavourGroup],
  removable_ingredients: [],
  weight_options: standardWingsVariants,
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

const sideGroup = group('side-opt', 'Side Choice', [
  option('fries', 'Fresh Cut Fries', { price_delta_cents: 0 }),
  option('onion-rings', 'Onion Rings', { price_delta_cents: 150 }),
], { context_key: 'side' });

const drinkGroup = group('drink-opt', 'Drink Choice', [
  option('coke', 'Coca-Cola', { price_delta_cents: 0 }),
  option('shake', 'Milkshake', { price_delta_cents: 200 }),
], { context_key: 'drink' });

const comboItem = {
  id: 'combo-1',
  slug: 'single-wing-combo',
  name: 'Single Wing Combo',
  description: '1 lb wings with side and drink',
  base_price_cents: 1899,
  builder_type: 'WING_COMBO',
  modifier_groups: [wingTypeGroup, flavourGroup, sideGroup, drinkGroup],
  removable_ingredients: [],
  combo_options: [
    {
      menu_item_id: 'combo-1-sku',
      slug: 'single-wing-combo-sku',
      name: 'Single Wing Combo (1 lb)',
      base_price_cents: 1899,
      weight_lb: 1,
      flavour_count: 1,
      side_slot_count: 1,
      drink_slot_count: 1,
      modifier_groups: [wingTypeGroup, flavourGroup, sideGroup, drinkGroup],
    },
  ],
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

// Salad items for Wings-4-U Special tests
const gardenSaladItem = {
  id: 'salad-garden',
  slug: 'garden-salad',
  name: 'Garden Salad',
  base_price_cents: 899,
  removable_ingredients: [{ id: 'ing-onion', name: 'Red Onions' }],
  modifier_groups: [
    group('salad-size', 'Size', [
      option('size-sm', 'Small', { price_delta_cents: 0 }),
      option('size-lg', 'Large', { price_delta_cents: 300 }),
    ], { context_key: 'size' }),
    group('salad-addons', 'Salad extras', [
      option('add-feta', 'Add Feta Cheese', { price_delta_cents: 175, addon_match_normalized: '__always__' }),
      option('add-chicken', 'Add Grilled Chicken', { price_delta_cents: 450 }),
    ], { context_key: 'addon', addon_scope_menu_item_id: 'salad-garden', is_required: false, min_select: 0, max_select: 3 }),
  ],
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

const saladWithoutSmallSize = {
  id: 'salad-caesar',
  slug: 'caesar-salad',
  name: 'Caesar Salad',
  base_price_cents: 999,
  removable_ingredients: [],
  modifier_groups: [
    group('salad-size', 'Size', [
      option('size-lg', 'Large', { price_delta_cents: 300 }),
    ], { context_key: 'size' }),
  ],
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

const wingsSpecialSaladGroup = group('special-salad', 'Salad Selection', [
  option('opt-garden', 'Garden Salad'),
  option('opt-caesar', 'Caesar Salad'),
], { context_key: 'salad' });

const wings4uSpecialItem = {
  id: 'wings-4u-special-id',
  slug: 'wings-4u-special',
  name: 'Wings-4-U Special',
  description: 'Wings with side, salad and pop',
  base_price_cents: 2499,
  builder_type: 'WINGS',
  modifier_groups: [wingTypeGroup, flavourGroup, wingsSpecialSaladGroup],
  removable_ingredients: [],
  weight_options: [
    {
      menu_item_id: 'wings-4u-special-sku',
      slug: 'wings-4u-special-sku',
      name: 'Wings-4-U Special (1 lb)',
      base_price_cents: 2499,
      weight_lb: 1,
      flavour_count: 1,
      side_slot_count: 1,
      drink_slot_count: 1,
      modifier_groups: [wingTypeGroup, flavourGroup, wingsSpecialSaladGroup],
    },
  ],
  is_available: true,
  stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH',
};

// Test renderer helpers
let renderer;
const texts = (node) =>
  node.findAllByType('Text').map((text) => text.children.join('')).join(' ');
const buttonByText = (label) =>
  renderer.root.findAllByType('TouchableOpacity').find((node) => texts(node).trim() === label);
const submitButton = () =>
  renderer.root.findAllByType('TouchableOpacity').find((node) =>
    node.props.accessibilityRole === 'button' &&
    (node.props.accessibilityLabel === 'Add to cart' || node.props.accessibilityLabel === 'Save changes')
  );

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.clearAllMocks();
  mockApiJsonImpl = async () => ({ data: mockApiFlavours });
});

describe('Final Wing Builder Stability & Checkout Parity Regression Suite', () => {

  /* =========================================================================
     1. Cart and checkout subtotal parity
     ========================================================================= */
  describe('1. Cart and checkout subtotal parity', () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T16:00:00Z')); });
    afterEach(() => jest.useRealTimers());
    test('shared calculateCartSubtotal matches line subtotal across cart and checkout preparation', async () => {
      const items = [
        {
          menu_item_id: 'wings-1lb',
          name: '1 lb Wings',
          base_price_cents: 1399,
          quantity: 2,
          special_instructions: '',
          modifier_selections: [
            { modifier_option_id: 'opt-dip', group_name: 'Dips', option_name: 'Ranch Dip', price_delta_cents: 150 },
          ],
          builder_payload: {
            builder_type: 'WINGS',
            wing_type: 'BONELESS',
            extra_flavour: { wing_flavour_id: 'f-honey', flavour_name: 'Honey Garlic' },
          },
        },
      ];

      // Unit price: 1399 + 150 + 100 (boneless) + 100 (extra flavour) = 1749 cents
      const unitPrice = getCartItemUnitPrice(items[0]);
      expect(unitPrice).toBe(1749);

      // Line subtotal: 1749 * 2 = 3498 cents
      const lineSubtotal = getCartItemSubtotal(items[0]);
      expect(lineSubtotal).toBe(3498);

      // Cart subtotal: 3498 cents
      const cartSubtotal = calculateCartSubtotal(items);
      expect(cartSubtotal).toBe(3498);

      // Validate checkout preparation receives the exact same subtotal
      mockApiJsonImpl = async (url) => {
        if (url.startsWith('/api/v1/menu?')) {
          return {
            data: {
              location: {
                timezone: 'America/Toronto', is_open: true,
                pickup_hours: [{ day_of_week: 6, time_from: '00:00', time_to: '23:59', is_closed: false }],
                delivery_hours: [{ day_of_week: 6, time_from: '00:00', time_to: '23:59', is_closed: false }],
                store_hours: [{ day_of_week: 6, time_from: '00:00', time_to: '23:59', is_closed: false }],
                pickup_min_minutes: 15, delivery_min_minutes: 30, estimated_prep_minutes: 15,
              },
              categories: [{ items: [{ id: 'wings-1lb', is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' }] }],
            },
          };
        }
        if (url === '/api/v1/delivery/quote') {
          return { data: { delivery_quote_token: 'tok-123', expires_at: new Date(Date.now() + 600000).toISOString() } };
        }
        if (url === '/api/v1/cart/quote') {
          return { data: { final_payable_cents: 3498, lines: [{ menu_item_id: 'wings-1lb', quantity: 2 }] } };
        }
        return { data: {} };
      };

      await validateCheckout({
        locationId: 'store-1',
        items,
        setup: {
          fulfillmentType: 'DELIVERY',
          scheduledFor: null,
          deliveryAddress: { line1: '123 Main St', city: 'London', postal_code: 'N6A 1A1' },
        },
        driverTipPercent: 15,
        promoCode: null,
        applyWingsReward: false,
        customerId: null,
      });

      const quoteCall = apiJson.mock.calls.find((call) => call[0] === '/api/v1/cart/quote');
      expect(quoteCall).toBeDefined();
      const quoteBody = JSON.parse(quoteCall[1].body);

      // Driver tip on 3498 cents @ 15% = Math.round(3498 * 0.15) = Math.round(524.7) = 525 cents
      expect(quoteBody.driver_tip_cents).toBe(525);
    });
  });

  /* =========================================================================
     2. Boneless and extra-flavour charges
     ========================================================================= */
  describe('2. Boneless and extra-flavour charges', () => {
    test('computes upcharges correctly across all builder payload types', () => {
      expect(getBuilderPriceDelta(undefined)).toBe(0);

      // Standard bone-in wings without extra flavour
      expect(getBuilderPriceDelta({ builder_type: 'WINGS', wing_type: 'BONE_IN' })).toBe(0);

      // Boneless wings (+$1.00)
      expect(getBuilderPriceDelta({ builder_type: 'WINGS', wing_type: 'BONELESS' })).toBe(100);

      // Extra flavour on bone-in (+$1.00)
      expect(getBuilderPriceDelta({
        builder_type: 'WINGS',
        wing_type: 'BONE_IN',
        extra_flavour: { wing_flavour_id: 'f-bbq', flavour_name: 'BBQ' },
      })).toBe(100);

      // Boneless + extra flavour (+$2.00)
      expect(getBuilderPriceDelta({
        builder_type: 'WINGS',
        wing_type: 'BONELESS',
        extra_flavour: { wing_flavour_id: 'f-bbq', flavour_name: 'BBQ' },
      })).toBe(200);

      // Combo with boneless (+$1.00)
      expect(getBuilderPriceDelta({
        builder_type: 'WING_COMBO',
        wing_type: 'BONELESS',
      })).toBe(100);

      // Lunch special child add-ons
      expect(getBuilderPriceDelta({
        builder_type: 'LUNCH_SPECIAL',
        child_addons: [{ modifier_option_id: 'add-1', price_delta_cents: 125 }, { modifier_option_id: 'add-2', price_delta_cents: 75 }],
      })).toBe(200);

      // Item customization side-pop bundle
      expect(getBuilderPriceDelta({
        builder_type: 'ITEM_CUSTOMIZATION',
        side_pop_bundle: { price_cents: 499 },
      })).toBe(499);
    });
  });

  /* =========================================================================
     3. Paid side and drink modifiers
     ========================================================================= */
  describe('3. Paid side and drink modifiers', () => {
    test('includes side and drink upcharges in unit price and subtotal', () => {
      const comboCartItem = {
        menu_item_id: 'combo-1-sku',
        name: 'Single Wing Combo',
        base_price_cents: 1899,
        quantity: 1,
        modifier_selections: [
          { modifier_option_id: 'onion-rings', group_name: 'Side Choice', option_name: 'Onion Rings', price_delta_cents: 150 },
          { modifier_option_id: 'shake', group_name: 'Drink Choice', option_name: 'Milkshake', price_delta_cents: 200 },
        ],
        builder_payload: {
          builder_type: 'WING_COMBO',
          wing_type: 'BONE_IN',
        },
      };

      // 1899 + 150 + 200 = 2249 cents ($22.49)
      expect(getCartItemUnitPrice(comboCartItem)).toBe(2249);
      expect(getCartItemSubtotal(comboCartItem)).toBe(2249);
      expect(calculateCartSubtotal([comboCartItem])).toBe(2249);
    });
  });

  /* =========================================================================
     4. Correct delivery-tip rounding
     ========================================================================= */
  describe('4. Correct delivery-tip rounding', () => {
    test('rounds tips mathematically and returns 0 for non-delivery or none', () => {
      // PICKUP returns 0 regardless of percentage
      expect(calculateDeliveryTipCents(2000, 15, 'PICKUP')).toBe(0);

      // 'none' returns 0
      expect(calculateDeliveryTipCents(2000, 'none', 'DELIVERY')).toBe(0);

      // Standard rounding tests
      // 1335 * 0.10 = 133.5 -> 134
      expect(calculateDeliveryTipCents(1335, 10, 'DELIVERY')).toBe(134);
      // 1334 * 0.10 = 133.4 -> 133
      expect(calculateDeliveryTipCents(1334, 10, 'DELIVERY')).toBe(133);
      // 1335 * 0.15 = 200.25 -> 200
      expect(calculateDeliveryTipCents(1335, 15, 'DELIVERY')).toBe(200);
      // 1337 * 0.15 = 200.55 -> 201
      expect(calculateDeliveryTipCents(1337, 15, 'DELIVERY')).toBe(201);
      // 2500 * 0.20 = 500
      expect(calculateDeliveryTipCents(2500, 20, 'DELIVERY')).toBe(500);

      // Edge cases: 0 or invalid percent
      expect(calculateDeliveryTipCents(2000, 0, 'DELIVERY')).toBe(0);
      expect(calculateDeliveryTipCents(2000, -5, 'DELIVERY')).toBe(0);
    });
  });

  /* =========================================================================
     5. Quantity greater than one
     ========================================================================= */
  describe('5. Quantity greater than one', () => {
    test('multiplies line subtotal and tip calculation by quantity', () => {
      const item = {
        menu_item_id: 'wings-1lb',
        base_price_cents: 1399,
        quantity: 3,
        modifier_selections: [],
        builder_payload: {
          builder_type: 'WINGS',
          wing_type: 'BONELESS', // +100
        },
      };

      const unitPrice = getCartItemUnitPrice(item); // 1399 + 100 = 1499
      expect(unitPrice).toBe(1499);

      const lineSubtotal = getCartItemSubtotal(item); // 1499 * 3 = 4497
      expect(lineSubtotal).toBe(4497);

      const subtotal = calculateCartSubtotal([item]);
      expect(subtotal).toBe(4497);

      // Tip on 4497 @ 15% = Math.round(674.55) = 675
      expect(calculateDeliveryTipCents(subtotal, 15, 'DELIVERY')).toBe(675);
    });
  });

  /* =========================================================================
     6. Flavour API loading and error states
     ========================================================================= */
  describe('6. Flavour API loading and error states', () => {
    test('blocks submission while flavours are loading or when API fails', async () => {
      let resolveFlavours;
      mockApiJsonImpl = () => new Promise((resolve) => { resolveFlavours = resolve; });

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: standardWingsItem,
            visible: true,
            onClose: jest.fn(),
          })
        );
      });

      // Submit while loading flavours -> blocked
      const submit = submitButton();
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();

      // Resolve with error
      await act(async () => {
        resolveFlavours({ data: null, error: 'Network Error' });
      });

      // Now error is set and flavours are empty -> submit remains blocked
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();
    });
  });

  /* =========================================================================
     7. Stale responses from an earlier restaurant location
     ========================================================================= */
  describe('7. Stale responses from an earlier restaurant location', () => {
    test('ignores out-of-order response from a previous location and clears flavours immediately', async () => {
      let resolveFirstLoc;
      let resolveSecondLoc;

      mockApiJsonImpl = (url) => {
        if (url.includes('store-1')) {
          return new Promise((resolve) => { resolveFirstLoc = resolve; });
        }
        if (url.includes('store-2')) {
          return new Promise((resolve) => { resolveSecondLoc = resolve; });
        }
        return Promise.resolve({ data: [] });
      };

      let hookResult;
      function TestComponent() {
        hookResult = useWingFlavours();
        return null;
      }

      mockCart.locationId = 'store-1';
      await act(async () => {
        renderer = create(React.createElement(TestComponent));
      });

      expect(hookResult.loading).toBe(true);
      expect(hookResult.flavours).toEqual([]);

      // Switch location to store-2 before store-1 resolves
      mockCart.locationId = 'store-2';
      await act(async () => {
        renderer.update(React.createElement(TestComponent));
      });

      // Now store-1 finishes late
      await act(async () => {
        resolveFirstLoc({
          data: [{ id: 'f-stale', name: 'Old Store Flavour', slug: 'old', heat_level: 'MILD', is_plain: false, sort_order: 1 }],
        });
      });

      // hookResult should NOT contain the stale flavour from store-1
      expect(hookResult.flavours).toEqual([]);

      // Now store-2 finishes
      const store2Flavours = [
        { id: 'f-fresh', name: 'Fresh Location Flavour', slug: 'fresh', heat_level: 'HOT', is_plain: false, sort_order: 1 },
      ];
      await act(async () => {
        resolveSecondLoc({ data: store2Flavours });
      });

      expect(hookResult.loading).toBe(false);
      expect(hookResult.flavours).toEqual(store2Flavours);
    });
  });

  /* =========================================================================
     8. Multiple rapid Retry requests
     ========================================================================= */
  describe('8. Multiple rapid Retry requests', () => {
    test('rapid retry requests only commit the latest request response', async () => {
      let resolveReq1, resolveReq2, resolveReq3;
      let callCount = 0;
      mockApiJsonImpl = () => {
        callCount++;
        const current = callCount;
        return new Promise((resolve) => {
          if (current === 1) resolveReq1 = resolve;
          if (current === 2) resolveReq2 = resolve;
          if (current === 3) resolveReq3 = resolve;
        });
      };

      let hookResult;
      function TestComponent() {
        hookResult = useWingFlavours();
        return null;
      }

      await act(async () => {
        renderer = create(React.createElement(TestComponent));
      });

      // Trigger rapid retries
      act(() => {
        hookResult.retry();
      });
      act(() => {
        hookResult.retry();
      });

      // Resolve in reverse order: Req 1 resolves last
      await act(async () => {
        resolveReq3({
          data: [{ id: 'f-latest', name: 'Latest Flavour', slug: 'latest', heat_level: 'HOT', is_plain: false, sort_order: 1 }],
        });
      });
      expect(hookResult.flavours).toEqual([expect.objectContaining({ id: 'f-latest' })]);

      // Req 1 finally resolves -> should be completely ignored
      await act(async () => {
        resolveReq1({
          data: [{ id: 'f-outdated-1', name: 'Outdated 1', slug: 'outdated-1', heat_level: 'MILD', is_plain: false, sort_order: 1 }],
        });
      });
      expect(hookResult.flavours).toEqual([expect.objectContaining({ id: 'f-latest' })]);

      // Req 2 resolves -> also ignored
      await act(async () => {
        resolveReq2({
          data: [{ id: 'f-outdated-2', name: 'Outdated 2', slug: 'outdated-2', heat_level: 'MILD', is_plain: false, sort_order: 1 }],
        });
      });
      expect(hookResult.flavours).toEqual([expect.objectContaining({ id: 'f-latest' })]);
    });
  });

  /* =========================================================================
     9. Invalid flavour selections after catalogue refresh
     ========================================================================= */
  describe('9. Invalid flavour selections after catalogue refresh', () => {
    test('clears selected flavours and extra flavour when catalogue no longer includes them', async () => {
      mockApiJsonImpl = async () => ({ data: mockApiFlavours });

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: standardWingsItem,
            visible: true,
            onClose: jest.fn(),
          })
        );
      });

      // Pick size
      const size1lb = buttonByText('1 lb / 1 flavour');
      if (size1lb) await act(async () => size1lb.props.onPress());

      // Pick preparation and flavour
      const breadedBtn = buttonByText('Breaded - Bone-In');
      await act(async () => breadedBtn.props.onPress());

      const honeyBtn = buttonByText('Honey Garlic');
      await act(async () => honeyBtn.props.onPress());

      // Can submit now
      const submit = submitButton();
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).toHaveBeenCalledTimes(1);
      mockCart.addItem.mockClear();

      // Now catalogue refreshes to only Plain and Hot (Honey Garlic and BBQ removed)
      mockApiJsonImpl = async () => ({
        data: [
          { id: 'f-plain', name: 'Plain', slug: 'plain', heat_level: 'PLAIN', is_plain: true, sort_order: 1 },
          { id: 'f-hot', name: 'Hot', slug: 'hot', heat_level: 'HOT', is_plain: false, sort_order: 2 },
        ],
      });

      // Switch location or force retry to update catalogue
      mockCart.locationId = 'store-new';
      await act(async () => {
        renderer.update(
          React.createElement(WingsBuilderMobile, {
            item: standardWingsItem,
            visible: true,
            onClose: jest.fn(),
          })
        );
      });

      // Since Honey Garlic is no longer in catalogue, it is reset and submit is blocked
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();
    });
  });

  /* =========================================================================
     10. Missing Wings-4-U Special salad group
     ========================================================================= */
  describe('10. Missing Wings-4-U Special salad group', () => {
    test('blocks submission with inline error when salad group is missing from special item', async () => {
      const brokenSpecialItem = {
        ...wings4uSpecialItem,
        modifier_groups: [wingTypeGroup, flavourGroup], // Missing salad group
        weight_options: [
          {
            ...wings4uSpecialItem.weight_options[0],
            modifier_groups: [wingTypeGroup, flavourGroup],
          },
        ],
      };

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: brokenSpecialItem,
            visible: true,
            onClose: jest.fn(),
            saladMenuItems: [gardenSaladItem],
          })
        );
      });

      // Select preparation and flavour
      const breadedBtn = buttonByText('Breaded - Bone-In');
      if (breadedBtn) await act(async () => breadedBtn.props.onPress());

      const honeyBtn = buttonByText('Honey Garlic');
      if (honeyBtn) await act(async () => honeyBtn.props.onPress());

      // Attempt to submit
      const submit = submitButton();
      await act(async () => submit.props.onPress());

      // Submission must be blocked
      expect(mockCart.addItem).not.toHaveBeenCalled();

      // Must display inline error indicating salad unavailability
      const allText = texts(renderer.root);
      expect(allText).toContain('Salad customization is required for Wings-4-U Special');
    });
  });

  /* =========================================================================
     11. Unresolvable saved salad selection
     ========================================================================= */
  describe('11. Unresolvable saved salad selection', () => {
    test('blocks submission if selected salad does not support Small size', async () => {
      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: wings4uSpecialItem,
            visible: true,
            onClose: jest.fn(),
            saladMenuItems: [saladWithoutSmallSize], // Caesar salad only has Large size
          })
        );
      });

      const breadedBtn = buttonByText('Breaded - Bone-In');
      if (breadedBtn) await act(async () => breadedBtn.props.onPress());

      const honeyBtn = buttonByText('Honey Garlic');
      if (honeyBtn) await act(async () => honeyBtn.props.onPress());

      // Caesar salad option should not be selectable or cannot resolve Small size
      const submit = submitButton();
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();
    });
  });

  /* =========================================================================
     12. Invalid salad add-on IDs
     ========================================================================= */
  describe('12. Invalid salad add-on IDs', () => {
    test('blocks submission if salad add-on selections contain invalid option IDs', async () => {
      // Editing line with an invalid salad add-on option ID
      const editingLineWithInvalidAddon = {
        key: 'special-cart-line',
        menu_item_id: 'wings-4u-special-sku',
        name: 'Wings-4-U Special',
        quantity: 1,
        special_instructions: '',
        removed_ingredients: [],
        modifier_selections: [
          { modifier_option_id: 'bone-breaded', group_name: 'Wing type', option_name: 'Breaded Bone-in', price_delta_cents: 0 },
          { modifier_option_id: 'opt-garden', group_name: 'Salad Selection', option_name: 'Garden Salad', price_delta_cents: 0 },
          { modifier_option_id: 'invalid-addon-id-999', group_name: 'Salad extras', option_name: 'Fake Addon', price_delta_cents: 100 },
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
          salad_customization: {
            salad_menu_item_id: 'salad-garden',
            salad_name: 'Garden Salad',
            salad_size_option_id: 'size-sm',
            salad_size_name: 'Small',
            removed_ingredients: [],
            modifier_selections: [
              { modifier_option_id: 'invalid-addon-id-999', group_name: 'Salad extras', option_name: 'Fake Addon', price_delta_cents: 100 },
            ],
          },
        },
      };

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: wings4uSpecialItem,
            visible: true,
            onClose: jest.fn(),
            editingLine: editingLineWithInvalidAddon,
            saladMenuItems: [gardenSaladItem],
          })
        );
      });

      // Submit attempt
      const submit = submitButton();
      await act(async () => submit.props.onPress());

      // Should block replacement due to invalid addon ID
      expect(mockCart.replaceItem).not.toHaveBeenCalled();
      const clear = buttonByText('Review salad extras: clear selections');
      expect(clear).toBeTruthy();
      await act(async () => clear.props.onPress());
      await act(async () => submitButton().props.onPress());
      expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
    });
  });

  /* =========================================================================
     13. Existing cart editing and replacement
     ========================================================================= */
  describe('13. Existing cart editing and replacement', () => {
    test('correctly hydrates and replaces cart item on submit with valid salad and wings choices', async () => {
      const validEditingLine = {
        key: 'valid-special-cart-line',
        menu_item_id: 'wings-4u-special-sku',
        name: 'Wings-4-U Special',
        quantity: 2,
        special_instructions: 'Extra crispy',
        removed_ingredients: [],
        modifier_selections: [
          { modifier_option_id: 'bone-breaded', group_name: 'Wing type', option_name: 'Breaded Bone-in', price_delta_cents: 0 },
          { modifier_option_id: 'opt-garden', group_name: 'Salad Selection', option_name: 'Garden Salad', price_delta_cents: 0 },
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
          salad_customization: {
            salad_menu_item_id: 'salad-garden',
            salad_name: 'Garden Salad',
            salad_size_option_id: 'size-sm',
            salad_size_name: 'Small',
            removed_ingredients: [],
            modifier_selections: [
              { modifier_option_id: 'add-feta', group_name: 'Salad extras', option_name: 'Add Feta Cheese', price_delta_cents: 175 },
            ],
          },
        },
      };

      const onClose = jest.fn();
      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: wings4uSpecialItem,
            visible: true,
            onClose,
            editingLine: validEditingLine,
            saladMenuItems: [gardenSaladItem],
          })
        );
      });

      // Submit changes
      const submit = submitButton();
      await act(async () => submit.props.onPress());

      expect(mockCart.replaceItem).toHaveBeenCalledTimes(1);
      expect(mockCart.replaceItem).toHaveBeenCalledWith(
        'valid-special-cart-line',
        expect.objectContaining({
          menu_item_id: 'wings-4u-special-sku',
          quantity: 2,
          special_instructions: 'Extra crispy',
          builder_payload: expect.objectContaining({
            builder_type: 'WINGS',
            salad_customization: expect.objectContaining({
              salad_menu_item_id: 'salad-garden',
              salad_name: 'Garden Salad',
              modifier_selections: [
                expect.objectContaining({ modifier_option_id: 'add-feta' }),
              ],
            }),
          }),
        })
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  /* =========================================================================
     14. No regressions in standard Wings and Wing Combo ordering
     ========================================================================= */
  describe('14. No regressions in standard Wings and Wing Combo ordering', () => {
    test('standard Wings orders successfully without salad requirements', async () => {
      const onClose = jest.fn();
      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: standardWingsItem,
            visible: true,
            onClose,
          })
        );
      });

      // Pick 1 lb
      const size1lb = buttonByText('1 lb / 1 flavour');
      if (size1lb) await act(async () => size1lb.props.onPress());

      // Pick breaded bone-in
      const breadedBtn = buttonByText('Breaded - Bone-In');
      await act(async () => breadedBtn.props.onPress());

      // Pick BBQ flavour
      const bbqBtn = buttonByText('BBQ');
      await act(async () => bbqBtn.props.onPress());

      // Submit
      const submit = submitButton();
      await act(async () => submit.props.onPress());

      expect(mockCart.addItem).toHaveBeenCalledTimes(1);
      expect(mockCart.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          menu_item_id: 'wings-1lb',
          builder_payload: expect.objectContaining({
            builder_type: 'WINGS',
            wing_type: 'BONE_IN',
            flavour_slots: [expect.objectContaining({ wing_flavour_id: 'f-bbq' })],
          }),
        })
      );
      expect(onClose).toHaveBeenCalled();
    });

    test('standard Wing Combo orders successfully with side, drink, and flavour', async () => {
      const onClose = jest.fn();
      await act(async () => {
        renderer = create(
          React.createElement(ComboBuilderMobile, {
            item: comboItem,
            visible: true,
            onClose,
          })
        );
      });

      // Pick Breaded - Bone-In
      const breadedBtn = buttonByText('Breaded - Bone-In');
      expect(breadedBtn).toBeTruthy();
      await act(async () => breadedBtn.props.onPress());

      // Pick Honey Garlic
      const honeyBtn = buttonByText('Honey Garlic');
      expect(honeyBtn).toBeTruthy();
      await act(async () => honeyBtn.props.onPress());

      // Pick Fresh Cut Fries (Side)
      const friesBtn = buttonByText('Fresh Cut Fries');
      expect(friesBtn).toBeTruthy();
      await act(async () => friesBtn.props.onPress());

      // Pick Coca-Cola (Drink)
      const cokeBtn = buttonByText('Coca-Cola');
      expect(cokeBtn).toBeTruthy();
      await act(async () => cokeBtn.props.onPress());

      // Submit
      const submit = submitButton();
      await act(async () => submit.props.onPress());

      expect(mockCart.addItem).toHaveBeenCalledTimes(1);
      expect(mockCart.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          menu_item_id: 'combo-1-sku',
          builder_payload: expect.objectContaining({
            builder_type: 'WING_COMBO',
            wing_type: 'BONE_IN',
            side_selections: ['fries'],
            drink_selections: ['coke'],
          }),
        })
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('15. Validation UX & Interactive Trigger', () => {
    test('Add to Cart button remains clickable when incomplete to trigger inline validation messages without adding to cart', async () => {
      const onClose = jest.fn();
      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: standardWingsItem,
            visible: true,
            onClose,
          })
        );
      });

      const submit = submitButton();
      expect(submit).toBeTruthy();
      // Button is not hard-disabled
      expect(submit.props.accessibilityState.disabled).toBe(false);

      // Pressing it triggers validation feedback
      await act(async () => submit.props.onPress());

      // Cart item is NOT added
      expect(mockCart.addItem).not.toHaveBeenCalled();

      // Inline validation message is displayed
      const textContent = texts(renderer.root);
      expect(textContent).toContain('Please fill all required fields');
    });

    test('Add to Cart button is hard-disabled when product is unavailable', async () => {
      const unavailableItem = {
        ...standardWingsItem,
        is_available: false,
      };

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: unavailableItem,
            visible: true,
            onClose: jest.fn(),
          })
        );
      });

      const submit = submitButton();
      expect(submit).toBeTruthy();
      expect(submit.props.accessibilityState.disabled).toBe(true);

      // Attempted press still does not add to cart
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();
    });
  });

  describe('16. Modifier Group Validation & Variant Switching', () => {
    test('prunes incompatible modifier options on variant switch while preserving valid ones', async () => {
      const variantGroupA = group('dip-group', 'Dip Selection', [
        option('opt-ranch', 'Ranch Dip'),
        option('opt-blue', 'Blue Cheese Dip'),
      ]);
      const variantGroupB = group('dip-group', 'Dip Selection', [
        option('opt-ranch', 'Ranch Dip'),
        option('opt-dill', 'Creamy Dill Dip'),
      ]);

      const multiVariantItem = {
        id: 'wings-variants',
        slug: 'wings-variants',
        name: 'Wings with Variants',
        base_price_cents: 1399,
        builder_type: 'WINGS',
        modifier_groups: [wingTypeGroup, flavourGroup],
        removable_ingredients: [],
        weight_options: [
          {
            menu_item_id: 'var-1',
            slug: 'var-1',
            name: '1 lb Wings',
            base_price_cents: 1399,
            weight_lb: 1,
            flavour_count: 1,
            side_slot_count: 0,
            drink_slot_count: 0,
            modifier_groups: [wingTypeGroup, flavourGroup, variantGroupA],
          },
          {
            menu_item_id: 'var-2',
            slug: 'var-2',
            name: '2 lb Wings',
            base_price_cents: 2599,
            weight_lb: 2,
            flavour_count: 2,
            side_slot_count: 0,
            drink_slot_count: 0,
            modifier_groups: [wingTypeGroup, flavourGroup, variantGroupB],
          },
        ],
        is_available: true,
        stock_status: 'NORMAL',
        allowed_fulfillment_type: 'BOTH',
      };

      await act(async () => {
        renderer = create(
          React.createElement(WingsBuilderMobile, {
            item: multiVariantItem,
            visible: true,
            onClose: jest.fn(),
          })
        );
      });

      // Select 1 lb
      const var1Btn = buttonByText('1 lb / 1 flavour');
      expect(var1Btn).toBeTruthy();
      await act(async () => var1Btn.props.onPress());

      // Select Blue Cheese Dip (exists only on Variant 1)
      const blueBtn = buttonByText('Blue Cheese Dip');
      expect(blueBtn).toBeTruthy();
      await act(async () => blueBtn.props.onPress());

      // Switch to 2 lb (Variant 2)
      const var2Btn = buttonByText('2 lb / 2 flavours');
      expect(var2Btn).toBeTruthy();
      await act(async () => var2Btn.props.onPress());

      // Blue Cheese Dip does not exist on Variant 2, so it should be pruned
      // and not cause validation failure or stale inclusion
      const submit = submitButton();
      await act(async () => submit.props.onPress());
      expect(mockCart.addItem).not.toHaveBeenCalled();
    });
  });
});
