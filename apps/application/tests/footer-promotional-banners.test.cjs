const { FOOTER_PROMOTIONAL_BANNERS: banners, resolveFooterPromotion } = require('../src/lib/footer-promotional-banners');
const slugs = ['lunch-3-tender', 'lunch-5-wings', 'lunch-6-nuggets', 'lunch-burger', 'lunch-wrap', 'lunch-poutine'];
const lunch = { id: 'lunch', slug: 'lunch-specials', items: slugs.map(slug => ({ id: `backend-${slug}`,
  slug, is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' })) };
const party = { id: 'party', slug: 'party-specials', items: [{ id: 'backend-party-75', slug: 'party-75-wings',
  is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' }] };

test('the six numerically ordered lunch posters precede Party Specials', () => {
  expect(banners.map(banner => banner.key)).toEqual(['lunch-1','lunch-2','lunch-3','lunch-4','lunch-5','lunch-6','party']);
  expect(banners.slice(0, 6).map(banner => banner.itemSlug)).toEqual(slugs);
  expect(banners.every(banner => banner.contentFit === 'contain')).toBe(true);
});
test.each(slugs)('%s resolves the actual backend item and preserves all product data', slug => {
  const target = resolveFooterPromotion([lunch, party], 'lunch-specials', slug, 'PICKUP');
  expect(target.item).toBe(lunch.items.find(item => item.slug === slug));
});
test('party opens its real category instead of selecting or inventing a package', () => {
  expect(resolveFooterPromotion([lunch, party], 'party-specials', undefined, 'DELIVERY')).toEqual({ category: party, item: null });
});
test('a backend-hidden lunch category outside ordering hours is unavailable', () => {
  expect(resolveFooterPromotion([party], 'lunch-specials', slugs[0], 'PICKUP')).toBeNull();
});
test.each([{ is_available: false }, { stock_status: 'UNAVAILABLE' }, { allowed_fulfillment_type: 'DELIVERY' }])(
  'disabled, out-of-stock and incompatible fulfillment items cannot open', override => {
    const category = { ...lunch, items: [{ ...lunch.items[0], ...override }] };
    expect(resolveFooterPromotion([category], category.slug, slugs[0], 'PICKUP')).toBeNull();
  },
);
if (process.env.WINGS_FOOTER_MENU_FIXTURE) test('all seven destinations resolve against the captured live lunch menu', () => {
  const menu = JSON.parse(require('fs').readFileSync(process.env.WINGS_FOOTER_MENU_FIXTURE, 'utf8')).data;
  for (const banner of banners) {
    const target = resolveFooterPromotion(menu.categories, banner.categorySlug, banner.itemSlug, 'PICKUP');
    expect(target).not.toBeNull();
    if (banner.itemSlug) expect(target.item.id).toMatch(/^[0-9a-f-]{36}$/);
  }
});
