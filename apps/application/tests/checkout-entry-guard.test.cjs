const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSetup, mockFocused, mockApproved, mockCache;
const mockRouter = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
const mockCart = { locationId: 'store', isCartHydrated: true, items: [{ menu_item_id: 'wings', quantity: 1 }], driverTipPercent: 'none' };
const mockSession = { loaded: true, authenticated: false };
const mockPromo = { promoCode: null, applyWingsReward: false };
const selection = { fulfillmentType: 'PICKUP', scheduledFor: null, deliveryAddress: null };
jest.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } }));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => mockRouter }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => mockSetup }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/promo', () => ({ usePromo: () => mockPromo }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('../src/lib/checkout-preparation', () => ({ ...jest.requireActual('../src/lib/checkout-preparation'), validateCheckout: jest.fn() }));
const { validateCheckout } = require('../src/lib/checkout-preparation');
const { CheckoutEntryGuard } = require('../src/components/checkout-entry-guard');
let renderer;
const tree = () => React.createElement(CheckoutEntryGuard, null, React.createElement('CheckoutContent'));
const mount = async () => act(async () => { renderer = create(tree()); });
const button = label => renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const hasCheckout = () => renderer.root.findAllByType('CheckoutContent').length > 0;
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockApproved = false; mockCache = null;
  mockSetup = { ready: true, confirmed: false, getConfirmedSetup: () => mockSetup.confirmed ? selection : null,
    ensureOrderSetup: jest.fn(), hasCheckoutValidation: key => mockApproved || key === mockCache,
    markCheckoutValidated: key => { mockCache = key; }, openOrderSetup: jest.fn() };
  validateCheckout.mockResolvedValue({ final_payable_cents: 1130 });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('direct checkout entry waits for setup and API validation before mounting checkout', async () => {
  let resolve;
  mockSetup.ensureOrderSetup.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount();
  expect(hasCheckout()).toBe(false);
  expect(validateCheckout).not.toHaveBeenCalled();
  await act(async () => { mockSetup.confirmed = true; resolve(selection); });
  expect(validateCheckout).toHaveBeenCalledTimes(1);
  expect(hasCheckout()).toBe(true);
});

test('cancelling setup on direct entry returns safely without mounting checkout', async () => {
  mockSetup.ensureOrderSetup.mockResolvedValue(null);
  await mount();
  expect(hasCheckout()).toBe(false);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(validateCheckout).not.toHaveBeenCalled();
});

test('API failure offers retry and change-details actions without entering checkout', async () => {
  mockSetup.confirmed = true;
  mockSetup.ensureOrderSetup.mockResolvedValue(selection);
  validateCheckout.mockRejectedValueOnce(new Error('Wings are unavailable.'));
  await mount();
  expect(hasCheckout()).toBe(false);
  expect(mockRouter.back).not.toHaveBeenCalled();
  await act(async () => button('Change order details').props.onPress());
  expect(mockSetup.openOrderSetup).toHaveBeenCalledTimes(1);
  await act(async () => button('Try again').props.onPress());
  expect(validateCheckout).toHaveBeenCalledTimes(2);
  expect(hasCheckout()).toBe(true);
});

test('a recent matching Cart validation avoids duplicate entry preflight', async () => {
  mockSetup.confirmed = true; mockApproved = true;
  await mount();
  expect(hasCheckout()).toBe(true);
  expect(mockSetup.ensureOrderSetup).not.toHaveBeenCalled();
  expect(validateCheckout).not.toHaveBeenCalled();
});

test('expiry blocks checkout content without automatically opening setup again', async () => {
  mockSetup.confirmed = true; mockApproved = true;
  await mount();
  mockSetup.confirmed = false; mockApproved = false;
  await act(async () => renderer.update(tree()));
  expect(hasCheckout()).toBe(false);
  expect(mockSetup.ensureOrderSetup).not.toHaveBeenCalled();
  expect(button('Confirm order details')).toBeDefined();
});
