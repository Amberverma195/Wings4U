const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams = {};
let mockMenuResult;
const mockRouter = { navigate: jest.fn() };
const mockCart = { fulfillmentType: 'PICKUP', locationId: 'store', scheduledFor: null, items: [], addItem: jest.fn(),
  updateQuantity: jest.fn(), removeItem: jest.fn(),
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
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => ({ openOrderSetup: jest.fn() }) }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
jest.mock('../src/components/trending-flavours', () => ({ TrendingFlavours: 'TrendingFlavours' }));
jest.mock('../src/components/popular-items', () => ({ PopularItems: 'PopularItems' }));
jest.mock('../src/components/tab-header', () => ({ HeaderActions: 'HeaderActions', TabHeader: 'TabHeader' }));
jest.mock('../src/components/menu-item-builder', () => ({ MenuItemBuilder: 'MenuItemBuilder' }));
jest.mock('../src/components/mobile-wings-builder', () => ({ WingsBuilderMobile: 'WingsBuilderMobile' }));
jest.mock('../src/components/mobile-combo-builder', () => ({ ComboBuilderMobile: 'ComboBuilderMobile' }));
jest.mock('../src/components/promotional-carousel', () => ({ PromotionalCarousel: 'PromotionalCarousel' }));
const { MenuScreen } = require('../src/screens/menu-screen');
const { FOOTER_PROMOTIONAL_BANNERS: banners } = require('../src/lib/footer-promotional-banners');
const { useMenu } = require('../src/hooks/use-menu');
const { Alert } = require('react-native');
const { categoryImageForSlug } = require('../src/lib/category-images');
const slugs = banners.slice(0, 6).map(banner => banner.itemSlug);
const item = slug => ({ id: `backend-${slug}`, slug, name: slug, is_available: true,
  stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH', base_price_cents: 999, modifier_groups: [] });
const menu = { categories: [
  { id: 'wings', slug: 'wings', name: 'Wings', sort_order: 2, items: [item('wings')] },
  { id: 'lunch', slug: 'lunch-specials', name: 'Lunch Specials', sort_order: 1, items: slugs.map(item) },
  { id: 'party', slug: 'party-specials', name: 'Party Specials', sort_order: 14, items: [item('party-75-wings')] },
  { id: 'burgers', slug: 'burgers', name: 'Burgers', sort_order: 4, items: [item('classic-burger'), item('cheese-burger')] },
] };
let renderer;
const originalRaf = global.requestAnimationFrame;
const originalCancel = global.cancelAnimationFrame;
const mount = async cinematic => act(async () => { renderer = create(React.createElement(MenuScreen, { cinematic })); });
const builder = () => renderer.root.findByType('MenuItemBuilder');
beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  mockCart.items = [];
  mockMenuResult = { menu, loading: false, error: null, refetch: jest.fn(), loadedReloadKey: undefined };
  global.requestAnimationFrame = fn => { fn(); return 1; };
  global.cancelAnimationFrame = jest.fn();
});

test.each([
  ['wings', 'WINGS', 'weight_options'],
  ['wing-combos', 'WING_COMBO', 'combo_options'],
])('%s cards show Add to cart below the starting price and count configured cart lines', async (slug, builderType, optionsKey) => {
  const product = { ...item(slug), builder_type: builderType,
    [optionsKey]: [{ menu_item_id: 'size-one' }, { menu_item_id: 'size-two' }] };
  mockMenuResult.menu = { categories: [{ id: slug, slug, name: slug, sort_order: 1, items: [product] }] };
  await mount(false);
  const card = () => renderer.root.find(node => node.type?.name === 'MenuItemCard');
  const texts = () => card().findAllByType('Text').map(node => node.props.children);
  expect(texts()).toContain('From $9.99');
  expect(texts()).toContain('Add to cart');
  expect(texts()).not.toContain('Customize');
  const action = card().findAllByType('Text').find(node => node.props.children === 'Add to cart');
  expect(action.parent.parent.props.style[1]).toMatchObject({ flexDirection: 'column' });
  mockCart.items = [
    { key: 'first', menu_item_id: 'size-one', quantity: 2 },
    { key: 'last', menu_item_id: 'size-two', quantity: 1 },
    { key: 'unrelated', menu_item_id: 'burger', quantity: 8 },
  ];
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(texts()).toContain(3);
  expect(texts()).not.toContain('Add to cart');
  const event = { stopPropagation: jest.fn() };
  await act(async () => card().findByProps({ accessibilityLabel: `Add one ${slug}` }).props.onPress(event));
  expect(mockCart.updateQuantity).toHaveBeenLastCalledWith('last', 2);
  await act(async () => card().findByProps({ accessibilityLabel: `Remove one ${slug}` }).props.onPress(event));
  expect(mockCart.removeItem).toHaveBeenLastCalledWith('last');
  expect(event.stopPropagation).toHaveBeenCalledTimes(2);
  expect(builder().props.visible).toBe(false);
});

test('fixed-price cards keep price and Add to cart on one row', async () => {
  mockMenuResult.menu = { categories: [menu.categories[3]] };
  await mount(false);
  const card = renderer.root.findAll(node => node.type?.name === 'MenuItemCard')[0];
  const action = card.findAllByType('Text').find(node => node.props.children === 'Add to cart');
  expect(action.parent.parent.props.style[0]).toMatchObject({ flexDirection: 'row' });
  expect(action.parent.parent.props.style[1]).toBe(false);
});

test('Cart edit waits for the fresh menu and preserves the selected line and quantity', async () => {
  const line = { key: 'saved-party', menu_item_id: 'backend-party-75-wings', name: '75 Wings', quantity: 3, builder_payload: { builder_type: 'WINGS', weight_lb: 5 } };
  mockCart.items = [line]; mockParams = { editKey: line.key, ts: 'cart-edit-request' };
  await mount(false);
  expect(builder().props.visible).toBe(false);
  mockMenuResult = { ...mockMenuResult, loadedReloadKey: 'cart-edit-request' };
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(builder().props.item.id).toBe('backend-party-75-wings');
  expect(builder().props.editItem).toBe(line);
  expect(builder().props.editItem.quantity).toBe(3);
  expect(mockCart.items).toEqual([line]);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount()); renderer = null;
  global.requestAnimationFrame = originalRaf; global.cancelAnimationFrame = originalCancel;
});

test('Home renders only the footer carousel, last inside the scroll content', async () => {
  await mount(true);
  const carousels = renderer.root.findAllByType('PromotionalCarousel');
  expect(carousels).toHaveLength(1);
  expect(carousels[0].props.banners).toBe(banners);
  const children = renderer.root.findAllByType('ScrollView').find(node => node.props.refreshControl).props.children.filter(Boolean);
  expect(children.at(-2).props.banners).toBe(banners);
  expect(children.at(-1).props.style.height).toBe(8);
  expect(carousels[0].props.imageBackgroundColor).toBe('#FFFFFF');
});
test('Menu mode never renders the Home footer carousel', async () => {
  await mount(false);
  expect(renderer.root.findAllByType('PromotionalCarousel')).toHaveLength(0);
});
test('each poster navigates to its verified category/item without changing order context', async () => {
  await mount(true);
  const footer = renderer.root.findByType('PromotionalCarousel');
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

const categoryButton = label => renderer.root.findAllByType('TouchableOpacity')
  .find(node => node.props.accessibilityLabel === label);
const shownNames = () => renderer.root.findAllByType('Text').map(node => node.children.filter(child => typeof child === 'string').join(''));

test('Home category taps navigate to Menu without displaying the selected category on Home', async () => {
  await mount(true);
  await act(async () => categoryButton('Burgers').props.onPress());
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/(tabs)/menu', params: {
    category: 'burgers', promotion: 'category', itemSlug: '', ts: expect.any(String),
  } });
  expect(categoryButton('Burgers').props.accessibilityState.selected).toBe(false);
  expect(shownNames()).not.toContain('classic-burger');
  const firstRequest = mockRouter.navigate.mock.calls[0][0].params.ts;
  await act(async () => categoryButton('Burgers').props.onPress());
  expect(mockRouter.navigate.mock.calls[1][0].params.ts).not.toBe(firstRequest);
});

test('incoming Home category navigation clears old search/filter state and selects all burgers in Menu', async () => {
  mockMenuResult = { ...mockMenuResult, menu: { categories: menu.categories.map(category => category.slug === 'burgers'
    ? { ...category, items: [item('classic-burger'), { ...item('cheese-burger'), is_available: false }] } : category) } };
  await mount(false);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Search menu' }).props.onChangeText('wings'));
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Menu filters' }).props.onPress());
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Available items only' }).props.onPress());
  mockParams = { category: 'burgers', promotion: 'category', itemSlug: '', ts: 'home-category-1' };
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(categoryButton('Burgers').props.accessibilityState.selected).toBe(true);
  expect(renderer.root.findByProps({ accessibilityLabel: 'Search menu' }).props.value).toBe('');
  expect(renderer.root.findByProps({ accessibilityLabel: 'Available items only' }).props.accessibilityState.checked).toBe(false);
  expect(shownNames()).toEqual(expect.arrayContaining(['classic-burger', 'cheese-burger']));
  expect(builder().props.visible).toBe(false);
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('Menu category taps still select locally and a repeated Home link reselects Burgers', async () => {
  mockParams = { category: 'burgers', promotion: 'category', itemSlug: '', ts: 'home-category-1' };
  await mount(false);
  await act(async () => categoryButton('Wings').props.onPress());
  expect(categoryButton('Wings').props.accessibilityState.selected).toBe(true);
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  mockParams = { ...mockParams, ts: 'home-category-2' };
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(categoryButton('Burgers').props.accessibilityState.selected).toBe(true);
});

test('category links wait for Menu data before selecting the requested category', async () => {
  mockParams = { category: 'burgers', promotion: 'category', ts: 'home-loading' };
  mockMenuResult = { ...mockMenuResult, menu: null, loading: true };
  await mount(false);
  mockMenuResult = { ...mockMenuResult, menu, loading: false };
  await act(async () => renderer.update(React.createElement(MenuScreen, { cinematic: false })));
  expect(categoryButton('Burgers').props.accessibilityState.selected).toBe(true);
  expect(shownNames()).toEqual(expect.arrayContaining(['classic-burger', 'cheese-burger']));
});

test('Home replaces the product list with Popular Items immediately above Trending Flavours', async () => {
  await mount(true);
  const popular = renderer.root.findByType('PopularItems');
  expect(popular.props.categories).toBe(menu.categories);
  expect(popular.props.fulfillmentType).toBe('PICKUP');
  expect(shownNames()).not.toContain(slugs[0]);
  const content = renderer.root.findAllByType('ScrollView').find(node => node.props.refreshControl).props.children.flat().filter(Boolean);
  const index = content.findIndex(child => child.type === 'PopularItems');
  expect(content[index + 1].type).toBe('TrendingFlavours');
  await act(async () => popular.props.onSeeAll());
  expect(mockRouter.navigate).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(tabs)/menu' }));
});

test('Home quick-adds plain items but sends required choices and existing lines through the builder', async () => {
  await mount(true);
  const popular = () => renderer.root.findByType('PopularItems');
  const tender = { ...item('tenders'), removable_ingredients: [], builder_type: null, description: null };
  const plain = { ...tender, id: 'pop', slug: 'pop', name: 'Pop' };
  await act(async () => popular().props.onChoose(plain, null));
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: 'pop', quantity: 1 }));
  await act(async () => popular().props.onChoose(tender, null));
  expect(mockCart.addItem).toHaveBeenCalledTimes(1);
  expect(builder().props.item).toBe(tender);
  const configured = { ...tender, modifier_groups: [{ id: 'dip' }] };
  await act(async () => popular().props.onChoose(configured, null));
  expect(builder().props.item).toBe(configured);
  expect(builder().props.editItem).toBeNull();
  await act(async () => builder().props.onClose());
  const line = { key: 'saved-line', menu_item_id: tender.id };
  await act(async () => popular().props.onChoose(tender, line));
  expect(builder().props.editItem).toBe(line);
  expect(mockCart.addItem).toHaveBeenCalledTimes(1);
});

test('Home search opens Menu search results without restoring the old Home product list', async () => {
  await mount(true);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Search menu' }).props.onChangeText('burger'));
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Search menu' }).props.onSubmitEditing());
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/(tabs)/menu', params: {
    query: 'burger', category: '', promotion: 'search', itemSlug: '', ts: expect.any(String),
  } });
  expect(shownNames()).not.toContain('classic-burger');
  await act(async () => renderer.unmount());
  mockParams = mockRouter.navigate.mock.calls[0][0].params;
  await mount(false);
  expect(shownNames()).toEqual(expect.arrayContaining(['classic-burger', 'cheese-burger']));
});

test('Menu cards use the local category image fallback and keep the product action visually prominent', async () => {
  mockMenuResult = { ...mockMenuResult, menu: { categories: [{ id: 'wings', slug: 'wings', name: 'Wings', sort_order: 1,
    items: [{ ...item('offline-wings'), image_url: null, builder_type: 'WINGS' }] }] } };
  await mount(false);
  const productImage = renderer.root.findAllByType('Image').find(node => node.props.contentFit === 'contain');
  expect(productImage.props.source).toBe(categoryImageForSlug('wings'));
  expect(productImage.props.contentFit).toBe('contain');
  expect(shownNames()).toContain('Add to cart');
  expect(shownNames()).not.toContain('Customize');
  const productCard = renderer.root.findAllByType('TouchableOpacity').find(node => Array.isArray(node.props.style) && node.props.style[0]?.borderColor === '#F0E2D9');
  expect(productCard).toBeDefined();
});

test('reward handoff opens the existing wings builder with the real 1lb SKU selected', async () => {
  mockParams = { promotion: 'reward', category: 'wings', ts: 'reward-one' };
  const product = { ...item('wings-by-the-pound'), builder_type: 'WINGS', weight_options: [
    { menu_item_id: 'real-one-pound', weight_lb: 1 }, { menu_item_id: 'real-two-pound', weight_lb: 2 },
  ] };
  mockMenuResult = { ...mockMenuResult, loadedReloadKey: 'reward-one', menu: { categories: [{ id: 'wings', slug: 'wings', name: 'Wings', sort_order: 1, items: [product] }] } };
  await mount(false);
  expect(renderer.root.findByType('WingsBuilderMobile').props).toMatchObject({ item: product, initialWeightId: 'real-one-pound', visible: true, editingLine: null });
  expect(mockCart.addItem).not.toHaveBeenCalled();
});

test('unavailable 1lb wings never creates a synthetic reward item', async () => {
  mockParams = { promotion: 'reward', category: 'wings', ts: 'reward-unavailable' };
  mockMenuResult = { ...mockMenuResult, loadedReloadKey: 'reward-unavailable' };
  await mount(false); expect(Alert.alert).toHaveBeenCalledWith('Item unavailable', expect.any(String));
  expect(mockCart.addItem).not.toHaveBeenCalled();
});
