const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockAddressResponse;
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: fn => fn() }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store' }));
jest.mock('../src/lib/api', () => ({
  getApiErrorMessage: (_, fallback) => fallback,
  apiFetch: jest.fn(async path => {
    if (path === '/api/v1/customer/addresses') return mockAddressResponse();
    return { ok: true, json: async () => ({ data: { entries: [], orders: [], tickets: [] } }) };
  }),
}));
const { AccountDataProvider, useAccountData } = require('../src/hooks/use-account-data');
const { apiFetch } = require('../src/lib/api');
let renderer, account, renders;
function Probe() { account = useAccountData(); renders.push(account.data.addresses); return null; }
const tree = () => React.createElement(AccountDataProvider, null, React.createElement(Probe));
const response = items => ({ ok: true, json: async () => ({ data: { items } }) });
beforeEach(() => { jest.clearAllMocks(); renders = []; mockSession = { loaded: true, authenticated: false }; mockAddressResponse = async () => response([]); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const mount = async () => act(async () => { renderer = create(tree()); });
const update = async session => { mockSession = session; await act(async () => renderer.update(tree())); };
const customer = id => ({ loaded: true, authenticated: true, user: { id } });

test('guests never fetch private account addresses', async () => {
  await mount(); expect(apiFetch).not.toHaveBeenCalled(); expect(account.data.addresses).toEqual([]);
});

test('account switching hides the previous customer immediately and ignores late results', async () => {
  mockSession = customer('a'); mockAddressResponse = async () => response([{ id: 'a-home' }]);
  await mount(); expect(account.data.addresses).toEqual([{ id: 'a-home' }]);
  let finish;
  mockAddressResponse = () => new Promise(resolve => { finish = resolve; });
  renders = []; await update(customer('b'));
  expect(renders.every(addresses => addresses.length === 0)).toBe(true);
  await update({ loaded: true, authenticated: false });
  await act(async () => finish(response([{ id: 'b-home' }])));
  expect(account.data.addresses).toEqual([]);
});

test('address fetch failure is reported separately and a safe read-only retry loads addresses', async () => {
  mockSession = customer('a'); mockAddressResponse = async () => { throw new Error('Offline'); };
  await mount(); expect(account.loading).toBe(false); expect(account.sectionErrors.addresses).toBe('Offline');
  mockAddressResponse = async () => response([{ id: 'home' }]);
  await act(async () => account.refresh());
  expect(account.data.addresses).toEqual([{ id: 'home' }]); expect(account.sectionErrors.addresses).toBeUndefined();
  expect(apiFetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
