const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: 'a' }));
jest.mock('../src/app/account/addresses/addresses.module.css', () => ({}));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/session', () => {
  const session = { loaded: true, authenticated: true, user: { id: 'customer' }, refresh: jest.fn(), clear: jest.fn() };
  return { useSession: () => session };
});
jest.mock('@/lib/use-modal-dialog', () => ({ useModalDialog: jest.fn() }));
jest.mock('@/components/require-auth-modal', () => ({ RequireAuthModal: ({ children }) => children }));
jest.mock('@/components/account-skeleton', () => ({ AccountSkeleton: () => null }));
jest.mock('../src/app/account/account-surface-links', () => ({ AccountSurfaceLinks: () => null }));
jest.mock('@/Wings4u/components/order-method-modal', () => ({ OrderMethodModal: () => null }));
jest.mock('@/lib/delivery-address', () => ({
  DELIVERY_ADDRESSES_UPDATED_EVENT: 'addresses-updated',
  loadSavedAddresses: jest.fn(),
  removeSavedAddressByIdSync: jest.fn(),
  syncSavedAddressesFromServer: jest.fn(async () => {}),
  setDeliveryAddressAuthState: jest.fn(),
}));

const Page = require('../src/app/account/addresses/page').default;
const addressBook = require('@/lib/delivery-address');
let renderer;
const button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
const dialogs = () => renderer.root.findAllByProps({ role: 'alertdialog' });

beforeEach(async () => {
  global.window = new EventTarget();
  jest.clearAllMocks();
  addressBook.loadSavedAddresses.mockReturnValue([{ id: 'saved-id', line1: '20 King Street', city: 'London', postalCode: 'N6A 1A1' }]);
  await act(async () => { renderer = create(React.createElement(Page)); });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  delete global.window;
});

test('Remove opens a confirmation with the selected address, and Keep address cancels without a request', async () => {
  await act(async () => button('Remove').props.onClick());
  expect(dialogs()).toHaveLength(1);
  expect(dialogs()[0].findAllByType('span').some(node => node.children.includes('20 King Street'))).toBe(true);
  await act(async () => button('Keep address').props.onClick());
  expect(dialogs()).toHaveLength(0);
  expect(addressBook.removeSavedAddressByIdSync).not.toHaveBeenCalled();
});

test('confirmation waits for deletion, prevents repeated requests, and closes on success', async () => {
  let complete;
  addressBook.removeSavedAddressByIdSync.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => button('Remove').props.onClick());
  let pending;
  await act(async () => { pending = button('Remove address').props.onClick(); });
  expect(button('Removing…').props.disabled).toBe(true);
  await act(async () => {
    button('Removing…').props.onClick();
    button('Keep address').props.onClick();
  });
  expect(addressBook.removeSavedAddressByIdSync).toHaveBeenCalledTimes(1);
  expect(addressBook.removeSavedAddressByIdSync.mock.calls[0][0]).toBe('saved-id');
  expect(dialogs()).toHaveLength(1);
  addressBook.loadSavedAddresses.mockReturnValue([]);
  await act(async () => { complete(); await pending; });
  expect(dialogs()).toHaveLength(0);
  expect(button('Remove')).toBeUndefined();
});

test('failed deletion shows an error, preserves the card, and allows retry', async () => {
  addressBook.removeSavedAddressByIdSync.mockRejectedValueOnce(new Error('Please try again.'));
  await act(async () => button('Remove').props.onClick());
  await act(async () => button('Remove address').props.onClick());
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['Please try again.']);
  expect(button('Remove')).toBeDefined();
  expect(button('Remove address').props.disabled).toBe(false);
  addressBook.removeSavedAddressByIdSync.mockResolvedValueOnce();
  await act(async () => button('Remove address').props.onClick());
  expect(dialogs()).toHaveLength(0);
});
