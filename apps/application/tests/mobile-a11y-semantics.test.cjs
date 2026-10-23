const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

let mockMenuResult;
const mockRouter = { navigate: jest.fn(), push: jest.fn() };
const mockCart = {
  fulfillmentType: 'PICKUP',
  locationId: 'store',
  scheduledFor: null,
  items: [],
  addItem: jest.fn(),
  updateQuantity: jest.fn(),
  removeItem: jest.fn(),
  setFulfillmentType: jest.fn(),
  setDriverTipPercent: jest.fn(),
};

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('react-native', () => ({
  ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock(),
  StyleSheet: { create: value => value, absoluteFill: {} },
  Text: 'Text',
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  TextInput: 'TextInput',
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 390 }),
  Alert: { alert: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 30, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Rect: 'Rect',
  Stop: 'Stop',
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { ScrollView: 'AnimatedScrollView', View: 'AnimatedView', Text: 'AnimatedText' },
  Easing: { inOut: value => value, cubic: value => value },
  interpolateColor: () => '#FFFFFF',
  useAnimatedStyle: fn => fn(),
  useAnimatedScrollHandler: fn => fn,
  withTiming: value => value,
  useSharedValue: value => require('react').useRef({ value }).current,
}));
jest.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['Clock', 'AlertCircle', 'CarFront', 'Bike', 'Search', 'SlidersHorizontal', 'X', 'Check'].map(
      key => [key, key]
    )
  )
);
jest.mock('../src/hooks/use-menu', () => ({ useMenu: jest.fn(() => mockMenuResult) }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/order-setup', () => ({
  useOrderSetup: () => ({ openOrderSetup: jest.fn(), promptOrderSetup: jest.fn() }),
}));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
jest.mock('../src/components/trending-flavours', () => ({ TrendingFlavours: 'TrendingFlavours' }));
jest.mock('../src/components/popular-items', () => ({ PopularItems: 'PopularItems' }));
jest.mock('../src/components/tab-header', () => ({ HeaderActions: 'HeaderActions', TabHeader: 'TabHeader' }));
jest.mock('../src/components/menu-item-builder', () => ({ MenuItemBuilder: 'MenuItemBuilder' }));
jest.mock('../src/components/mobile-wings-builder', () => ({ WingsBuilderMobile: 'WingsBuilderMobile' }));
jest.mock('../src/components/mobile-combo-builder', () => ({ ComboBuilderMobile: 'ComboBuilderMobile' }));
jest.mock('../src/components/promotional-carousel', () => ({ PromotionalCarousel: 'PromotionalCarousel' }));
jest.mock('../src/lib/api', () => ({
  apiJson: jest.fn(async () => ({ data: [] })),
}));

const { MobileBuilderShell } = require('../src/components/mobile-builder-shell');
const { MenuScreen } = require('../src/screens/menu-screen');

describe('Mobile Accessibility Semantics (P2)', () => {
  let renderer;

  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
  });

  test('MobileBuilderShell quantity controls have button roles and Add to Cart includes total price', async () => {
    await act(async () => {
      renderer = create(
        React.createElement(
          MobileBuilderShell,
          {
            visible: true,
            title: '1LB Traditional Wings',
            description: 'Includes 1 flavour',
            onClose: jest.fn(),
            quantity: 1,
            onDecrease: jest.fn(),
            onIncrease: jest.fn(),
            totalCents: 1599,
            submitLabel: 'Add to Cart',
            submitDisabled: false,
            onSubmit: jest.fn(),
          },
          React.createElement('View', null)
        )
      );
    });

    const root = renderer.root;

    // Decrease quantity button
    const decBtn = root.findByProps({ accessibilityLabel: 'Decrease quantity' });
    expect(decBtn).toBeTruthy();
    expect(decBtn.props.accessibilityRole).toBe('button');
    expect(decBtn.props.accessibilityState).toEqual({ disabled: true }); // quantity is 1

    // Increase quantity button
    const incBtn = root.findByProps({ accessibilityLabel: 'Increase quantity' });
    expect(incBtn).toBeTruthy();
    expect(incBtn.props.accessibilityRole).toBe('button');
    expect(incBtn.props.accessibilityState).toEqual({ disabled: false });

    // Submit button
    const submitBtn = root.findByProps({ accessibilityLabel: 'Add to Cart, $15.99' });
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.props.accessibilityRole).toBe('button');
    expect(submitBtn.props.accessibilityState).toEqual({ disabled: false });
  });

  test('MenuScreen product cards and category chips have explicit button roles and labels', async () => {
    const mockCategories = [
      {
        id: 'wings',
        slug: 'wings',
        name: 'Wings',
        sort_order: 1,
        items: [
          {
            id: 'item-1',
            slug: 'single-wings',
            name: 'Single Wings',
            description: 'Crispy seasoned chicken wings',
            base_price_cents: 1499,
            stock_status: 'NORMAL',
            is_available: true,
            modifier_groups: [],
          },
          {
            id: 'item-2',
            slug: 'sold-out-wings',
            name: 'Sold Out Wings',
            description: 'Popular limited flavour',
            base_price_cents: 1699,
            stock_status: 'UNAVAILABLE',
            is_available: false,
            modifier_groups: [],
          },
        ],
      },
    ];

    mockMenuResult = {
      menu: { categories: mockCategories, location: { id: 'store-1' } },
      loading: false,
      error: null,
      refetch: jest.fn(),
      loadedReloadKey: undefined,
    };

    await act(async () => {
      renderer = create(React.createElement(MenuScreen, { cinematic: false }));
    });

    const root = renderer.root;

    // Category button
    const catBtn = root.findByProps({ accessibilityLabel: 'Wings' });
    expect(catBtn).toBeTruthy();
    expect(catBtn.props.accessibilityRole).toBe('button');
    expect(catBtn.props.accessibilityState).toEqual({ selected: true });

    // Product cards
    const availableCard = root.findByProps({
      accessibilityLabel: 'Single Wings, $14.99. Crispy seasoned chicken wings',
    });
    expect(availableCard).toBeTruthy();
    expect(availableCard.props.accessibilityRole).toBe('button');
    expect(availableCard.props.accessibilityState).toEqual({ disabled: false });

    const unavailableCard = root.findByProps({
      accessibilityLabel: 'Sold Out Wings, currently unavailable. Popular limited flavour',
    });
    expect(unavailableCard).toBeTruthy();
    expect(unavailableCard.props.accessibilityRole).toBe('button');
    expect(unavailableCard.props.accessibilityState).toEqual({ disabled: true });
  });
});
