import { getWingSkuPortion, getWingSkuWeightLb } from './wing-sku';

describe('owner-confirmed portion identities', () => {
  it.each([[1, 9], [1.5, 14], [2, 18], [2.5, 22], [3, 27], [4, 36], [5, 45]])('%s lb is exactly %s pieces', (weight, pieces) => {
    expect(getWingSkuPortion(`wings-${weight}lb`)).toEqual({ weightLb: weight, pieces, earnsStamps: true });
    expect(getWingSkuWeightLb({ slug: `combo-${weight}lb`, name: 'Renamed catalogue label' })).toBe(weight);
  });
  it.each([['party-75-wings', 75, 8], ['party-100-wings', 100, 11]] as const)('%s retains piece count and official equivalent', (slug, pieces, weightLb) => {
    expect(getWingSkuPortion(slug)).toEqual({ weightLb, pieces, earnsStamps: true });
    expect(getWingSkuWeightLb({ slug, name: 'A label cannot alter the portion' })).toBe(weightLb);
    expect(weightLb.toFixed(1)).toBe(`${weightLb}.0`);
  });
  it('does not infer portions for unidentified products from display text', () => {
    expect(getWingSkuWeightLb({ slug: 'unknown', name: '75 Wings — 5 Flavours' })).toBeNull();
    expect(getWingSkuPortion('wings-9lb')).toBeNull();
  });
  it('retains unspecified lunch compatibility without enabling stamp earning', () => {
    expect(getWingSkuPortion('lunch-5-wings')).toEqual({ weightLb: 0.33, pieces: 5, earnsStamps: false });
    expect(getWingSkuPortion('wings-4u-special')).toEqual({ weightLb: 2, pieces: null, earnsStamps: false });
  });
});
