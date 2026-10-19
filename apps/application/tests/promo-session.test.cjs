const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockStored, selection, renderer;
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => mockStored),
  setItem: jest.fn(async (key, value) => { mockStored = value; }),
  removeItem: jest.fn(async () => { mockStored = null; }),
}));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
const { PromoProvider, usePromo } = require('../src/context/promo');
const storage = require('@react-native-async-storage/async-storage');
function Probe() { selection = usePromo(); return null; }
const tree = () => React.createElement(PromoProvider, null, React.createElement(Probe));
const mount = async () => act(async () => { renderer = create(tree()); });
beforeEach(() => { jest.clearAllMocks(); mockStored = null; mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } }; });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
test('validated selection survives cart/checkout navigation and a fresh application mount', async () => {
  await mount(); expect(selection.hydrated).toBe(true);
  await act(async () => selection.applyPromoCode('SAVE'));
  expect(JSON.parse(mockStored)).toMatchObject({ owner: 'customer-a', promoCode: 'SAVE', applyWingsReward: false });
  await act(async () => renderer.unmount()); renderer = null;
  await mount(); expect(selection.promoCode).toBe('SAVE');
  await act(async () => selection.redeemWingsReward());
  expect(selection.promoCode).toBeNull(); expect(selection.applyWingsReward).toBe(true);
});
test.each(['logout', 'switch'])('earned reward never leaks during %s', async change => {
  await mount(); await act(async () => selection.redeemWingsReward());
  mockSession = change === 'logout' ? { loaded: true, authenticated: false, user: null } : { ...mockSession, user: { id: 'customer-b' } };
  await act(async () => renderer.update(tree()));
  expect(selection.applyWingsReward).toBe(false); expect(selection.promoCode).toBeNull();
});
test('guest coupons survive sign-in but legacy unowned rewards are not restored', async () => {
  mockSession = { loaded: true, authenticated: false, user: null }; mockStored = JSON.stringify({ promoCode: 'PUBLIC', applyWingsReward: true });
  await mount(); expect(selection.promoCode).toBe('PUBLIC'); expect(selection.applyWingsReward).toBe(false);
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } };
  await act(async () => renderer.update(tree())); expect(selection.promoCode).toBe('PUBLIC');
});
test('a delayed storage response from an old account cannot restore its selection', async () => {
  let release; storage.getItem.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await mount(); expect(selection.hydrated).toBe(false);
  mockSession = { ...mockSession, user: { id: 'customer-b' } }; await act(async () => renderer.update(tree()));
  await act(async () => release(JSON.stringify({ owner: 'customer-a', promoCode: null, applyWingsReward: true })));
  expect(selection.applyWingsReward).toBe(false);
});
