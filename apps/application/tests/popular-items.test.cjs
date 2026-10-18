const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: value => value } }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('lucide-react-native', () => ({ ArrowRight: 'ArrowRight', ShoppingBag: 'ShoppingBag', SlidersHorizontal: 'SlidersHorizontal' }));
const { PopularItems } = require('../src/components/popular-items');
const { popularItems, cartLineForPopularItem, needsCustomization } = require('../src/lib/popular-items');
const item = (id, overrides = {}) => ({ id, slug: id, name: id, description: 'From the live menu', base_price_cents: 1234,
  image_url: `https://example.test/${id}.png`, builder_type: null, is_available: true, stock_status: 'NORMAL',
  allowed_fulfillment_type: 'BOTH', modifier_groups: [], removable_ingredients: [], ...overrides });
const wings = item('wings-by-the-pound', { builder_type: 'WINGS', weight_options: [{ menu_item_id: 'wings-1lb' }] });
const combo = item('wing-combo-builder', { builder_type: 'WING_COMBO', combo_options: [{ menu_item_id: 'combo-1lb' }] });
const tenders = item('3-pc-tenders', { name: '3 pc Tenders + 1 Dip', base_price_cents: 1077 });
const categories = [
  { slug: 'burgers', name: 'Burgers', items: [item('burger', { is_popular: true })] },
  { slug: 'wings', name: 'Wings', items: [wings] },
  { slug: 'tenders', name: 'Tenders', items: [item('tender-combo', { base_price_cents: 500 }), item('5-pc-tenders', { base_price_cents: 1577 }), tenders] },
  { slug: 'wing-combos', name: 'Wing Combos', items: [combo] },
];
let renderer;
const onChoose = jest.fn(), onSeeAll = jest.fn();
const props = overrides => ({ categories, cartItems: [], fulfillmentType: 'PICKUP', updating: false, onChoose, onSeeAll, ...overrides });
const mount = async overrides => act(async () => { renderer = create(React.createElement(PopularItems, props(overrides))); });
const strings = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const cta = title => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel?.endsWith(title));
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('curates exactly the three requested families, in order, using real menu objects', () => {
  const selected = popularItems(categories, 'PICKUP');
  expect(selected.map(entry => entry.title)).toEqual(['Wings (By the Pound)', 'Chicken Tenders', 'Wing Combo']);
  expect(selected.map(entry => entry.item)).toEqual([wings, tenders, combo]);
  expect(selected[0].item).toBe(wings);
});

test('uses API prices, portions, descriptions and image URLs rather than screenshot prices', async () => {
  await mount();
  expect(strings()).toEqual(expect.arrayContaining(['From $12.34', '$10.77', '3 pc Tenders + 1 Dip · From the live menu']));
  expect(renderer.root.findAllByType('Image')[0].props.source).toEqual({ uri: wings.image_url });
  const updated = categories.map(category => category.slug === 'tenders' ? { ...category, items: [{ ...tenders, base_price_cents: 1188 }] } : category);
  await act(async () => renderer.update(React.createElement(PopularItems, props({ categories: updated }))));
  expect(strings()).toContain('$11.88');
  expect(strings()).not.toContain('$10.77');
});

test('SKU membership changes Add to Cart to Customize and passes the existing cart line', async () => {
  const line = { key: 'configured-wings', menu_item_id: 'wings-1lb', quantity: 2 };
  expect(cartLineForPopularItem(wings, [line])).toBe(line);
  await mount({ cartItems: [line] });
  expect(cta('Wings (By the Pound)').props.accessibilityLabel).toBe('Customize Wings (By the Pound)');
  expect(cta('Wing Combo').props.accessibilityLabel).toBe('Add to cart Wing Combo');
  await act(async () => cta('Wings (By the Pound)').props.onPress());
  expect(onChoose).toHaveBeenCalledWith(wings, line);
  await act(async () => cta('Chicken Tenders').props.onPress());
  expect(onChoose).toHaveBeenLastCalledWith(tenders, null);
  expect(needsCustomization(wings)).toBe(true);
  expect(needsCustomization(tenders)).toBe(true);
  expect(needsCustomization({ ...tenders, modifier_groups: [{ is_required: true }] })).toBe(true);
  expect(cartLineForPopularItem(combo, [{ key: 'combo', menu_item_id: 'combo-1lb' }])).not.toBeNull();
});

test.each([
  { is_available: false }, { stock_status: 'UNAVAILABLE' }, { allowed_fulfillment_type: 'DELIVERY' },
])('blocks unavailable items based on backend fields: %o', async overrides => {
  const updated = categories.map(category => category.slug === 'wings' ? { ...category, items: [{ ...wings, ...overrides }] } : category);
  await mount({ categories: updated });
  expect(cta('Wings (By the Pound)').props.disabled).toBe(true);
  await act(async () => cta('Wings (By the Pound)').props.onPress());
  expect(onChoose).not.toHaveBeenCalled();
});

test('missing items have disabled placeholders without invented prices or IDs', async () => {
  await mount({ categories: [] });
  expect(strings().filter(text => text === 'Unavailable')).toHaveLength(6);
  expect(strings().some(text => text.includes('$'))).toBe(false);
  expect(cta('Chicken Tenders').props.disabled).toBe(true);
});

test('stale menu data cannot be added while the order context is refreshing', async () => {
  await mount({ updating: true });
  expect(cta('Wing Combo').props.disabled).toBe(true);
  expect(strings()).toContain('Updating…');
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Browse menu' }).props.onPress());
  expect(onSeeAll).toHaveBeenCalledTimes(1);
});

test('Wing Combo uses its bundled food photo if the menu image fails to load', async () => {
  await mount();
  const photo = () => renderer.root.findAllByType('Image')[2];
  expect(photo().props.source).toEqual({ uri: combo.image_url });
  await act(async () => photo().props.onError());
  expect(photo().props.source).toEqual(require('../assets/categories/combos.png'));
  expect(photo().props.contentFit).toBe('contain');
});
