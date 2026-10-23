const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockSession = { refresh: jest.fn(async () => true), authenticated: false };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/api', () => ({ apiJson: jest.fn(), apiFetch: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('@/lib/cart', () => ({ useCart: () => ({ addItem: jest.fn() }) }));
jest.mock('@/lib/delivery-address', () => ({
  FIXED_DELIVERY_CITY: 'London',
  DELIVERY_ADDRESS_SAVED_EVENT: 'saved-address',
  loadSavedAddresses: () => [],
  loadDeliveryAddressDraft: () => null,
  normalizeDeliveryPostalCode: v => v,
  removeSavedAddressById: jest.fn(),
  saveDeliveryAddressDraft: jest.fn(),
}));

const { FlavourPicker, ExtraFlavourPicker, SaucingMethodPicker } = require('../src/components/builder-shared');
const { OrderMethodModal } = require('../src/Wings4u/components/order-method-modal');
const { CustomerAuth } = require('../src/components/customer-auth');

describe('Web Screen-Reader Labels & Selection States (P2)', () => {
  let renderer;

  beforeEach(() => {
    global.window = {
      sessionStorage: { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() },
    };
  });

  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    delete global.window;
  });

  test('FlavourPicker has compliant tablist tabs and radiogroup flavour options', async () => {
    const flavours = [
      { id: 'f1', name: 'Mild BBQ', heat_level: 'MILD', sort_order: 1 },
      { id: 'f2', name: 'Honey Garlic', heat_level: 'MILD', sort_order: 2 },
      { id: 'f3', name: 'Suicide Hot', heat_level: 'HOT', sort_order: 3 },
    ];

    await act(async () => {
      renderer = create(
        React.createElement(FlavourPicker, {
          flavours,
          selectedFlavourId: 'f1',
          onSelect: jest.fn(),
        })
      );
    });

    const root = renderer.root;
    const tablist = root.findByProps({ role: 'tablist' });
    expect(tablist).toBeTruthy();

    const tabs = tablist.findAllByProps({ role: 'tab' });
    expect(tabs.length).toBe(2); // MILD, HOT
    expect(tabs[0].props['aria-selected']).toBe(true);
    expect(tabs[1].props['aria-selected']).toBe(false);

    const radiogroup = root.findByProps({ role: 'radiogroup' });
    expect(radiogroup).toBeTruthy();
    expect(radiogroup.props['aria-label']).toBe('MILD flavours');

    const radioButtons = radiogroup.findAllByProps({ role: 'radio' });
    expect(radioButtons.length).toBe(2);
    expect(radioButtons[0].props['aria-checked']).toBe(true);
    expect(radioButtons[0].props['aria-pressed']).toBe(true);
    expect(radioButtons[1].props['aria-checked']).toBe(false);
    expect(radioButtons[1].props['aria-pressed']).toBe(false);
  });

  test('ExtraFlavourPicker heat tabs and flavour pills have proper roles and selection attributes', async () => {
    const flavours = [
      { id: 'e1', name: 'Mild BBQ', heat_level: 'MILD', sort_order: 1 },
      { id: 'e2', name: 'Dry Cajun', heat_level: 'HOT', sort_order: 2 },
    ];

    await act(async () => {
      renderer = create(
        React.createElement(ExtraFlavourPicker, {
          flavours,
          selectedFlavourId: 'e1',
          onSelect: jest.fn(),
        })
      );
    });

    const root = renderer.root;
    const tablist = root.findByProps({ role: 'tablist' });
    const tabs = tablist.findAllByProps({ role: 'tab' });
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs[0].props['aria-selected']).toBe(true);

    const radiogroup = root.findByProps({ role: 'radiogroup' });
    expect(radiogroup).toBeTruthy();

    const radios = radiogroup.findAllByProps({ role: 'radio' });
    expect(radios.length).toBeGreaterThan(0);
    expect(radios[0].props['aria-checked']).toBe(true);
    expect(radios[0].props['aria-pressed']).toBe(true);
  });

  test('SaucingMethodPicker uses radiogroup and radio items with aria-checked', async () => {
    await act(async () => {
      renderer = create(
        React.createElement(SaucingMethodPicker, {
          effectiveSaucedCount: 2,
          slotCount: 2,
          value: 'SIDE',
          onChange: jest.fn(),
          sideFlavourOptions: [
            { slotNo: 1, label: 'Flavour 1' },
            { slotNo: 2, label: 'Flavour 2' },
          ],
          sideFlavourSlot: 1,
          onSideFlavourSlotChange: jest.fn(),
        })
      );
    });

    const radiogroups = renderer.root.findAllByProps({ role: 'radiogroup' });
    expect(radiogroups.length).toBe(2); // primary saucing + side flavour option

    const mainRadios = radiogroups[0].findAllByProps({ role: 'radio' });
    const selectedRadio = mainRadios.find(r => r.props['aria-checked'] === true);
    expect(selectedRadio).toBeTruthy();

    const sideRadios = radiogroups[1].findAllByProps({ role: 'radio' });
    expect(sideRadios.length).toBe(2);
    expect(sideRadios[0].props['aria-checked']).toBe(true);
    expect(sideRadios[1].props['aria-checked']).toBe(false);
  });

  test('OrderMethodModal provides radiogroup and accessible radio options for pickup and delivery', async () => {
    await act(async () => {
      renderer = create(
        React.createElement(OrderMethodModal, {
          open: true,
          defaultMethod: 'PICKUP',
          onClose: jest.fn(),
          onContinue: jest.fn(),
        })
      );
    });

    const radiogroup = renderer.root.findByProps({ role: 'radiogroup' });
    expect(radiogroup.props['aria-label']).toBe('Order fulfillment method');

    const radios = radiogroup.findAllByProps({ role: 'radio' });
    expect(radios.length).toBe(2);

    const pickupRadio = radios[0];
    expect(pickupRadio.props['aria-checked']).toBe(true);
    expect(pickupRadio.props['aria-label']).toContain('Pickup');

    const deliveryRadio = radios[1];
    expect(deliveryRadio.props['aria-checked']).toBe(false);
    expect(deliveryRadio.props['aria-label']).toContain('Delivery');
  });

  test('CustomerAuth password toggle has no negative tabIndex and supports keyboard interaction', async () => {
    await act(async () => {
      renderer = create(
        React.createElement(CustomerAuth, {
          mode: 'signup',
          onComplete: jest.fn(),
        })
      );
    });

    const toggles = renderer.root.findAllByProps({ className: 'wk-password-toggle' });
    expect(toggles.length).toBeGreaterThan(0);

    const passwordToggle = toggles[0];
    expect(passwordToggle.props.tabIndex).toBeUndefined(); // tabIndex={-1} removed
    expect(passwordToggle.props['aria-label']).toBe('Show password');
    expect(passwordToggle.props['aria-pressed']).toBe(false);

    // Click toggle to reveal password
    await act(async () => {
      passwordToggle.props.onClick();
    });

    expect(passwordToggle.props['aria-label']).toBe('Hide password');
    expect(passwordToggle.props['aria-pressed']).toBe(true);
  });

  test('OrderMethodModal does not render privacy notice on method step and renders it on address step', async () => {
    // 1. On method step
    await act(async () => {
      renderer = create(
        React.createElement(OrderMethodModal, {
          open: true,
          defaultMethod: 'PICKUP',
          onClose: jest.fn(),
          onContinue: jest.fn(),
        })
      );
    });

    let privacyNotices = renderer.root.findAllByProps({ className: 'wk-method-privacy-notice' });
    expect(privacyNotices.length).toBe(0);

    // 2. On address step
    await act(async () => {
      renderer.update(
        React.createElement(OrderMethodModal, {
          open: true,
          initialStep: 'address',
          defaultMethod: 'DELIVERY',
          onClose: jest.fn(),
          onContinue: jest.fn(),
        })
      );
    });

    privacyNotices = renderer.root.findAllByProps({ className: 'wk-method-privacy-notice' });
    expect(privacyNotices.length).toBe(1);
    const noticeText = privacyNotices[0].children
      .map(child => (typeof child === 'string' ? child : child.children ? child.children.join('') : ''))
      .join(' ');
    expect(noticeText).toContain('To calculate delivery fees and check delivery availability, we share your delivery address with Google Maps. We do not send your name, phone number, email, or payment information.');

    const privacyLink = privacyNotices[0].findByProps({ className: 'wk-method-privacy-link' });
    expect(privacyLink).toBeTruthy();
    expect(privacyLink.props.href).toBe('/privacy');
    expect(privacyLink.props.target).toBe('_blank');
    expect(privacyLink.props.rel).toBe('noopener noreferrer');
    expect(privacyLink.children).toEqual(['Privacy Policy']);
  });
});

