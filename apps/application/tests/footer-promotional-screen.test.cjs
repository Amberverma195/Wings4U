const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams = {};
let mockMenuResult;
const mockRouter = { navigate: jest.fn() };
const mockCart = { fulfillmentType: 'PICKUP', locationId: 'store', scheduledFor: null,
  setFulfillmentType: jest.fn(), setDriverTipPercent: jest.fn() };
jest.mock('expo-router', () => ({ useIsFocused: () => true, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('react-native', () => ({
  StyleSheet: { create: value => value, absoluteFill: {} },
  Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', TextInput: 'TextInput',
  useWindowDimensions: () => ({ width: 390 }), Alert: { alert: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 30, bottom: 20, left: 0, right: 0 }) }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { ScrollView: 'AnimatedScrollView', View: 'AnimatedView', Text: 'AnimatedText' },
  Easing: { inOut: value => value, cubic: value => value }, interpolateColor: () => '#FFFFFF',
  useAnimatedStyle: fn => fn(), useAnimatedScrollHandler: fn => fn, withTiming: value => value,
  useSharedValue: value => require('react').useRef({ value }).current,
}));
jest.mock('lucide-react-native', () => Object.fromEntries(['Clock','AlertCircle','CarFront','Bike','Search','SlidersHorizontal','X','Check'].map(key => [key, key])));
jest.mock('../src/hooks/use-menu', () => ({ useMenu: jest.fn(() => mockMenuResult) }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/components/tab-header', () => ({ HeaderActions: 'HeaderActions', TabHeader: 'TabHeader' }));
jest.mock('../src/components/menu-item-builder', () => ({ MenuItemBuilder: 'MenuItemBuilder' }));
jest.mock('../src/components/promotional-carousel', () => ({ PromotionalCarousel: 'PromotionalCarousel' }));
const { MenuScreen } = require('../src/screens/menu-screen');
const { FOOTER_PROMOTIONAL_BANNERS: banners } = require('../src/lib/footer-promotional-banners');
const { useMenu } = require('../src/hooks/use-menu');
const { Alert } = require('react-native');
const slugs = banners.slice(0, 6).map(banner => banner.itemSlug);
const item = slug => ({ id: `backend-${slug}`, slug, name: slug, is_available: true,
  stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH', base_price_cents: 999, modifier_groups: [] });
const menu = { categories: [
  { id: 'wings', slug: 'wings', name: 'Wings', sort_order: 2, items: [item('wings')] },
  { id: 'lunch', slug: 'lunch-specials', name: 'Lunch Specials', sort_order: 1, items: slugs.map(item) },
  { id: 'party', slug: 'party-specials', name: 'Party Specials', sort_order: 14, items: [item('party-75-wings')] },
] };
let renderer;
const originalRaf = global.requestAnimationFrame;
const originalCancel = global.cancelAnimationFrame;
const mount = async cinematic => act(async () => { renderer = create(React.createElement(MenuScreen, { cinematic })); });
const builder = () => renderer.root.findByType('MenuItemBuilder');
beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  mockMenuResult = { menu, loading: false, error: null, refetch: jest.fn(), loadedReloadKey: undefined };
  global.requestAnimationFrame = fn => { fn(); return 1; };
  global.cancelAnimationFrame = jest.fn();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount()); renderer = null;
  global.requestAnimationFrame = originalRaf; global.cancelAnimationFrame = originalCancel;
});

test('Home renders separate top and footer carousels with the footer last inside the scroll content', async () => {
  await mount(true);
  const carousels = renderer.root.findAllByType('PromotionalCarousel');
  expect(carousels).toHaveLength(2);
  expect(carousels[0].props.banners).toHaveLength(4);
  expect(carousels[1].props.banners).toBe(banners);
  const children = renderer.root.findByType('ScrollView').props.children.filter(Boolean);
  expect(children.at(-2).props.banners).toBe(banners);
  expect(children.at(-1).props.style.height).toBeGreaterThanOrEqual(40);
  expect(carousels[1].props.imageBackgroundColor).toBe('#FFFFFF');
});
test('Menu mode never renders either Home promotional carousel', async () => {
  await mount(false);
  expect(renderer.root.findAllByType('PromotionalCarousel')).toHaveLength(0);
});
test('each poster navigates to its verified category/item without changing order context', async () => {
  await mount(true);
  const footer = renderer.root.findAllByType('PromotionalCarousel')[1];
  for (const banner of banners) {
    await act(async () => footer.props.onPressBanner(banner));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/(tabs)/menu', params: {
      category: banner.categorySlug, itemSlug: banner.itemSlug ?? '', promotion: 'footer', ts: expect.any(String),
    } });
  }
  expect(mockCart.setFulfillmentType).not.toHaveBeenCalled();
  expect(mockCart.setDriverTipPercent).not.toHaveBeenCalled();
});
test.each(slugs)('the refreshed Menu opens the real %s customization flow once', async slug => {
  mockParams = { category: 'lunch-specials', itemSlug: slug, promotion: 'footer', ts: 'footer-request' };
  mockMenuResult.loadedReloadKey = 'footer-request';
  await mount(false);
  expect(builder().props.item).toBe(menu.categories[1].items.find(item => item.slug === slug));
  await act(async () => builder().props.onClose());
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(builder().props.visible).toBe(false);
});
test('a cached menu cannot open a promotion before the matching fresh response arrives', async () => {
  mockParams = { category: 'lunch-specials', itemSlug: slugs[0], promotion: 'footer', ts: 'fresh-request' };
  await mount(false);
  expect(builder().props.visible).toBe(false);
  expect(useMenu).toHaveBeenLastCalledWith('PICKUP', 'store', null, 'fresh-request');
  mockMenuResult = { ...mockMenuResult, loadedReloadKey: 'fresh-request' };
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(builder().props.visible).toBe(true);
});
test('a backend-hidden lunch special shows a message without opening or inventing a product', async () => {
  mockParams = { category: 'lunch-specials', itemSlug: slugs[0], promotion: 'footer', ts: 'outside-hours' };
  mockMenuResult = { ...mockMenuResult, menu: { categories: [menu.categories[0], menu.categories[2]] }, loadedReloadKey: 'outside-hours' };
  await mount(false);
  expect(builder().props.visible).toBe(false);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('Promotion unavailable', expect.stringContaining('selected order time'));
});
test('Party Specials selects the category and leaves package choice to the customer', async () => {
  mockParams = { category: 'party-specials', itemSlug: '', promotion: 'footer', ts: 'party' };
  mockMenuResult.loadedReloadKey = 'party';
  await mount(false);
  expect(builder().props.visible).toBe(false);
  const selected = renderer.root.findAllByProps({ accessibilityRole: 'button' })
    .find(node => node.props.accessibilityLabel === 'Party Specials');
  expect(selected.props.accessibilityState.selected).toBe(true);
});
