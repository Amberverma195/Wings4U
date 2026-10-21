jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getAllKeys: jest.fn(), multiRemove: jest.fn() } }));
jest.mock('../src/lib/token-store', () => ({ clearAllTokens: jest.fn(async () => {}) }));
jest.mock('../src/lib/realtime', () => ({ disconnectCustomerSockets: jest.fn() }));
const storage = require('@react-native-async-storage/async-storage').default;
const { clearAllTokens } = require('../src/lib/token-store');
const { disconnectCustomerSockets } = require('../src/lib/realtime');
const { forgetDeletedAccount } = require('../src/lib/account-deletion');
test('completion erases credentials and all customer drafts but preserves the signup anti-abuse identifier and unrelated settings', async () => {
  const drafts = ['wings4u.mobile-cart-draft-v1:store', 'wings4u.order-setup-v1:store', 'wings4u.order-setup-v2:store:customer', 'wings4u.mobile-promo-selection-v1'];
  storage.getAllKeys.mockResolvedValue([...drafts, 'wings4u_signup_device_id', 'theme']);
  await forgetDeletedAccount();
  expect(disconnectCustomerSockets).toHaveBeenCalledTimes(1); expect(clearAllTokens).toHaveBeenCalledTimes(1);
  expect(storage.multiRemove).toHaveBeenCalledWith(drafts);
  expect(clearAllTokens.mock.invocationCallOrder[0]).toBeLessThan(storage.getAllKeys.mock.invocationCallOrder[0]);
});
