const {
  HEAT_ORDER,
  WING_PREPARATION_OPTIONS,
  normalizeInitialPreparation,
  selectedWingPreparationId,
  isFlavourWithoutSauce,
  areAllSelectedFlavoursPlain,
  countEffectiveSaucedFlavours,
  getSaucingOptions,
  defaultSaucingMethodForCount,
  isSaucingMethodValidForCount,
  methodRequiresSideFlavourPick,
  groupFlavoursByHeat,
  groupFlavoursForExtraPicker,
  resolveInitialHeatTab,
  resolveSaucingPlacements,
  extractWeightLb,
  formatCents,
  isWingBuilderItem,
  isComboBuilderItem,
  extractFlavoursFromItem,
  BONELESS_WINGS_UPCHARGE_CENTS,
  EXTRA_FLAVOUR_PRICE_CENTS,
} = require('../src/lib/wing-builder-logic');

const mockFlavour = (id, name, heat_level, is_plain = false) => ({
  id,
  name,
  slug: id,
  heat_level,
  is_plain,
  sort_order: 1,
});

describe('wing-builder-logic pure unit tests', () => {
  const plainFlavour = mockFlavour('plain-1', 'Plain', 'PLAIN', true);
  const mildFlavour = mockFlavour('mild-1', 'Mild BBQ', 'MILD', false);
  const hotFlavour = mockFlavour('hot-1', 'Hot Suicide', 'HOT', false);
  const dryRubFlavour = mockFlavour('dry-1', 'Lemon Pepper', 'DRY_RUB', false);

  const flavourMap = new Map([
    ['plain-1', plainFlavour],
    ['mild-1', mildFlavour],
    ['hot-1', hotFlavour],
    ['dry-1', dryRubFlavour],
  ]);

  test('constants have expected values', () => {
    expect(BONELESS_WINGS_UPCHARGE_CENTS).toBe(100);
    expect(EXTRA_FLAVOUR_PRICE_CENTS).toBe(100);
    expect(HEAT_ORDER).toEqual(['PLAIN', 'MILD', 'MEDIUM', 'HOT', 'DRY_RUB']);
  });

  test('wing preparation normalization and selection id', () => {
    expect(normalizeInitialPreparation('BONELESS', 'NON_BREADED')).toBe('BREADED');
    expect(normalizeInitialPreparation('BONE_IN', 'NON_BREADED')).toBe('NON_BREADED');
    expect(selectedWingPreparationId('BONELESS', 'BREADED')).toBe('BREADED_BONELESS');
    expect(selectedWingPreparationId('BONE_IN', 'NON_BREADED')).toBe('NON_BREADED_BONE_IN');
    expect(selectedWingPreparationId('BONE_IN', 'BREADED')).toBe('BREADED_BONE_IN');
    expect(selectedWingPreparationId(null, null)).toBeNull();
  });

  test('plain flavour identification and plain set detection', () => {
    expect(isFlavourWithoutSauce(plainFlavour)).toBe(true);
    expect(isFlavourWithoutSauce(mildFlavour)).toBe(false);
    expect(isFlavourWithoutSauce(undefined)).toBe(false);

    expect(areAllSelectedFlavoursPlain(['plain-1'], flavourMap)).toBe(true);
    expect(areAllSelectedFlavoursPlain(['plain-1', 'mild-1'], flavourMap)).toBe(false);
    expect(areAllSelectedFlavoursPlain([], flavourMap)).toBe(false);
    expect(areAllSelectedFlavoursPlain([''], flavourMap)).toBe(false);
  });

  test('countEffectiveSaucedFlavours ignores plain flavours', () => {
    expect(countEffectiveSaucedFlavours(['plain-1'], flavourMap)).toBe(0);
    expect(countEffectiveSaucedFlavours(['mild-1'], flavourMap)).toBe(1);
    expect(countEffectiveSaucedFlavours(['plain-1', 'mild-1', 'hot-1'], flavourMap)).toBe(2);
  });

  test('saucing options logic for various counts', () => {
    // 1 sauced flavour
    const single = getSaucingOptions(1, 1);
    expect(single.map((o) => o.value)).toEqual(['ON_WINGS', 'ON_SIDE']);

    // 2 sauced flavours
    const double = getSaucingOptions(2, 2);
    expect(double.map((o) => o.value)).toEqual(['HALF_HALF', 'SIDE']);

    // 3 sauced flavours with threeFlavourTellUsHow
    const triple = getSaucingOptions(3, 3, false, true);
    expect(triple.map((o) => o.value)).toEqual(['SPLIT_EVENLY', 'ALL_MIXED', 'TELL_US_HOW']);

    // party 5 special
    const party = getSaucingOptions(5, 5, true, false);
    expect(party.map((o) => o.value)).toEqual(['ALL_MIXED', 'SPLIT_EVENLY', 'TELL_US_HOW']);
  });

  test('defaultSaucingMethodForCount returns expected defaults', () => {
    expect(defaultSaucingMethodForCount(0)).toBeNull();
    expect(defaultSaucingMethodForCount(1)).toBe('ON_WINGS');
    expect(defaultSaucingMethodForCount(2)).toBe('HALF_HALF');
    expect(defaultSaucingMethodForCount(3, false, 3, true)).toBe('SPLIT_EVENLY');
    expect(defaultSaucingMethodForCount(5, true, 5, false)).toBe('ALL_MIXED');
  });

  test('methodRequiresSideFlavourPick', () => {
    expect(methodRequiresSideFlavourPick(1, 'ON_SIDE')).toBe(false);
    expect(methodRequiresSideFlavourPick(2, 'SIDE')).toBe(true);
    expect(methodRequiresSideFlavourPick(2, 'HALF_HALF')).toBe(false);
    expect(methodRequiresSideFlavourPick(3, 'TWO_MIXED_ONE_SIDE')).toBe(true);
    expect(methodRequiresSideFlavourPick(3, 'ALL_MIXED')).toBe(false);
  });

  test('resolveSaucingPlacements for 1, 2, and 3 slots', () => {
    // 1 flavour ON_SIDE
    const p1 = resolveSaucingPlacements({
      flavourIds: ['mild-1'],
      flavourMap,
      saucingMethod: 'ON_SIDE',
      sideSlot: null,
    });
    expect(p1).toEqual(['ON_SIDE']);

    // 2 flavours SIDE where slot 2 is on the side
    const p2 = resolveSaucingPlacements({
      flavourIds: ['mild-1', 'hot-1'],
      flavourMap,
      saucingMethod: 'SIDE',
      sideSlot: 2,
    });
    expect(p2).toEqual(['ON_WINGS', 'ON_SIDE']);

    // 2 flavours with one plain: effective count 1
    const p3 = resolveSaucingPlacements({
      flavourIds: ['plain-1', 'mild-1'],
      flavourMap,
      saucingMethod: 'ON_SIDE',
      sideSlot: null,
    });
    expect(p3).toEqual(['ON_WINGS', 'ON_SIDE']);
  });

  test('extractWeightLb parses pound weights correctly', () => {
    expect(extractWeightLb('1 lb Wings')).toBe(1);
    expect(extractWeightLb('2.5 Pound Combo')).toBe(2.5);
    expect(extractWeightLb('Wings Special')).toBe(1);
  });

  test('formatCents formats currency string', () => {
    expect(formatCents(1399)).toBe('$13.99');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(100)).toBe('$1.00');
  });

  test('isWingBuilderItem and isComboBuilderItem', () => {
    expect(isWingBuilderItem({ builder_type: 'WINGS' })).toBe(true);
    expect(isWingBuilderItem({ builder_type: 'WING_COMBO' })).toBe(false);
    expect(isComboBuilderItem({ builder_type: 'WING_COMBO' })).toBe(true);
    expect(isComboBuilderItem({ builder_type: 'WINGS' })).toBe(false);
  });

  test('groupFlavoursForExtraPicker excludes plain flavours', () => {
    const list = [plainFlavour, mildFlavour, hotFlavour, dryRubFlavour];
    const extraGroups = groupFlavoursForExtraPicker(list);
    const allPicks = extraGroups.flatMap((g) => g.items);
    expect(allPicks.some((f) => f.is_plain)).toBe(false);
    expect(allPicks.length).toBe(3);
  });
});
