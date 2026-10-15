const {
  accountTabGate,
  formatBxgyDetails,
  partitionOrders,
  promoBenefitLabel,
  promoFulfillmentLabel,
  rewardProgress,
  sectionContentState,
} = require('../src/lib/deals-display');

test('guests stay signed out and never receive a placeholder balance', () => {
  expect(accountTabGate({ sessionLoaded: false, authenticated: false, loading: true })).toBe('loading');
  expect(accountTabGate({ sessionLoaded: true, authenticated: false, loading: false })).toBe('guest');
  expect(accountTabGate({ sessionLoaded: true, authenticated: true, loading: true })).toBe('loading');
  expect(accountTabGate({ sessionLoaded: true, authenticated: true, loading: false })).toBe('content');
  expect(rewardProgress(null)).toBeNull();
});

test('reward progress uses the API threshold and only unlocks at that count', () => {
  const below = rewardProgress({
    available_stamps: 7,
    lifetime_stamps: 15,
    lifetime_redemptions: 1,
    stamps_per_reward: 8,
  });
  expect(below).toMatchObject({
    stampsPerReward: 8,
    availableStamps: 7,
    stampsToNext: 1,
    eligible: false,
    lifetimeStamps: 15,
    lifetimeRedemptions: 1,
  });
  expect(rewardProgress({
    available_stamps: 10,
    lifetime_stamps: 10,
    lifetime_redemptions: 0,
    stamps_per_reward: 8,
  })?.eligible).toBe(true);
  expect(rewardProgress({
    available_stamps: 3,
    lifetime_stamps: 3,
    lifetime_redemptions: 0,
    stamps_per_reward: 0,
  })).toBeNull();
});

test('coupons render only the fields returned by the promotions API', () => {
  const promo = {
    benefitSummary: '',
    discountType: 'FIXED_AMOUNT',
    discountValue: 500,
    bxgyRule: null,
    code: 'WINGS5',
  };
  expect(promoBenefitLabel({ ...promo, benefitSummary: '$5 off wings' })).toBe('$5 off wings');
  expect(promoBenefitLabel(promo)).toBe('$5.00 OFF');
  expect(promoBenefitLabel({ ...promo, discountType: 'PERCENT', discountValue: 15 })).toBe('15% OFF');
  expect(promoBenefitLabel({ ...promo, discountType: 'FREE_DELIVERY', discountValue: 0 })).toBe('FREE DELIVERY');
  expect(promoFulfillmentLabel('PICKUP')).toBe('Pickup only');
  expect(promoFulfillmentLabel('DELIVERY')).toBe('Delivery only');
  expect(promoFulfillmentLabel('BOTH')).toBeNull();
  expect(formatBxgyDetails({
    bxgyRule: {
      requiredQty: 2,
      rewardQty: 1,
      rewardRule: 'FREE',
      maxUsesPerOrder: 1,
      qualifyingLabel: 'Wings',
      rewardLabel: '1lb wings',
    },
  })).toBe('Buy 2: Wings -> Get 1: 1lb wings');
  expect(sectionContentState('Unable to load coupons', 0)).toBe('error');
  expect(sectionContentState(null, 0)).toBe('empty');
  expect(sectionContentState('page failed', 2)).toBe('ready');
});

test('orders split into active and past using the existing status sets', () => {
  const { active, past } = partitionOrders([
    { status: 'PREPARING' },
    { status: 'DELIVERED' },
    { status: 'PLACED' },
    { status: 'CANCELLED' },
  ]);
  expect(active.map(order => order.status)).toEqual(['PREPARING', 'PLACED']);
  expect(past.map(order => order.status)).toEqual(['DELIVERED', 'CANCELLED']);
});
