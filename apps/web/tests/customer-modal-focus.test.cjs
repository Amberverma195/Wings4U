const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('@/lib/cart', () => ({ useCart: () => ({ addItem: jest.fn() }) }));
jest.mock('@/lib/delivery-address', () => ({
  FIXED_DELIVERY_CITY: 'London',
  DELIVERY_ADDRESS_SAVED_EVENT: 'saved-address',
  loadSavedAddresses: () => [{ id: '1', line1: '123 Main', city: 'London', postalCode: 'N6A 1A1' }],
  loadDeliveryAddressDraft: () => null,
  normalizeDeliveryPostalCode: v => v,
  removeSavedAddressById: jest.fn(),
  saveDeliveryAddressDraft: jest.fn(),
}));

const { BuilderShell } = require('../src/components/builder-shared');
const { OrderMethodModal } = require('../src/Wings4u/components/order-method-modal');
const { DeliveryAddressPickerPanel } = require('../src/Wings4u/components/delivery-address-picker-panel');
const { useModalDialog } = require('../src/lib/use-modal-dialog');
const { OrderSettingsPanel } = require('../src/components/order-settings-panel');

let renderer;
let close;
let last;
let trigger;
let dialog;
let events;
const originalDocument = global.document;
const originalHTMLElement = global.HTMLElement;
const originalWindow = global.window;

beforeEach(() => {
  events = new Map();
  class Element {
    constructor() { this.tabIndex = 0; this.isConnected = true; }
    focus() { document.activeElement = this; }
    matches() { return false; }
    closest() { return null; }
    getClientRects() { return [{}]; }
  }
  global.HTMLElement = Element;
  close = new Element();
  last = new Element();
  trigger = new Element();
  dialog = new Element();
  dialog.querySelectorAll = () => [close, last];
  dialog.contains = node => [dialog, close, last].includes(node);
  global.document = {
    activeElement: trigger,
    body: { style: { overflow: 'auto' } },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { if (events.get(name) === callback) events.delete(name); }
  };
  global.window = new EventTarget();
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  global.document = originalDocument;
  global.HTMLElement = originalHTMLElement;
  global.window = originalWindow;
});

const key = (value, shiftKey = false) => {
  const event = { key: value, shiftKey, preventDefault: jest.fn(), stopPropagation: jest.fn() };
  const handler = events.get('keydown');
  if (handler) handler(event);
  return event;
};

test('stacked dialogs give only the top modal Escape, Tab and focus containment; closing it resumes the parent', async () => {
  const listeners = new Map();
  document.addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    events.set(name, event => [...listeners.get(name)].forEach(handler => handler(event)));
  };
  document.removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
  const childClose = new HTMLElement(), childLast = new HTMLElement(), child = new HTMLElement();
  child.querySelectorAll = () => [childClose, childLast];
  child.contains = node => [child, childClose, childLast].includes(node);
  const parentDismiss = jest.fn(), childDismiss = jest.fn();
  function Harness({ element, dismiss }) {
    const ref = React.useRef(element);
    useModalDialog({ dialogRef: ref, onClose: dismiss });
    return null;
  }
  const tree = childOpen => React.createElement(React.Fragment,null,
    React.createElement(Harness,{key:'parent',element:dialog,dismiss:parentDismiss}),
    childOpen ? React.createElement(Harness,{key:'child',element:child,dismiss:childDismiss}) : null);
  await act(async()=>{renderer=create(tree(false));});
  await act(async()=>renderer.update(tree(true)));
  expect(document.activeElement).toBe(childClose);
  key('Tab',true);
  expect(document.activeElement).toBe(childLast);
  document.activeElement=trigger;
  events.get('focusin')({target:trigger});
  expect(document.activeElement).toBe(childClose);
  key('Escape');
  expect(childDismiss).toHaveBeenCalledTimes(1);
  expect(parentDismiss).not.toHaveBeenCalled();
  await act(async()=>renderer.update(tree(false)));
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(close);
  key('Escape');
  expect(parentDismiss).toHaveBeenCalledTimes(1);
  await act(async()=>renderer.unmount()); renderer=null;
  expect(document.body.style.overflow).toBe('auto');
  expect(document.activeElement).toBe(trigger);
});

test('non-modal order settings focus inside, allow Tab to leave, and restore opener on Escape', async()=>{
  const onClose=jest.fn();
  await act(async()=>{renderer=create(React.createElement(OrderSettingsPanel,{onClose},null),{
    createNodeMock:element=>element.props.role==='dialog'?dialog:null,
  });});
  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe('auto');
  const panel=renderer.root.findByProps({role:'dialog'});
  expect(panel.props['aria-modal']).toBe(false);
  const tab={key:'Tab',preventDefault:jest.fn(),stopPropagation:jest.fn()};
  panel.props.onKeyDown(tab);
  expect(tab.preventDefault).not.toHaveBeenCalled();
  expect(events.has('focusin')).toBe(false);
  const escape={key:'Escape',preventDefault:jest.fn(),stopPropagation:jest.fn()};
  panel.props.onKeyDown(escape);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
});

test('BuilderShell: focus moves inside, Tab/Shift+Tab trap within panel, Escape triggers onClose, and unmount restores focus to trigger', async () => {
  const onClose = jest.fn();
  await act(async () => {
    renderer = create(
      React.createElement(
        BuilderShell,
        {
          title: 'Wings Builder',
          onClose,
          quantity: 1,
          onDecrease: jest.fn(),
          onIncrease: jest.fn(),
          totalCents: 1599,
          submitLabel: 'Add to cart',
          onSubmit: jest.fn(),
          children: null,
        }
      ),
      {
        createNodeMock: element => {
          if (element.props.role === 'dialog') return dialog;
          if (element.props.className === 'item-customization-close') return close;
          return null;
        },
      }
    );
  });

  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe('hidden');

  // Shift+Tab from close wraps to last
  expect(key('Tab', true).preventDefault).toHaveBeenCalled();
  expect(document.activeElement).toBe(last);

  // Tab from last wraps to close
  expect(key('Tab').preventDefault).toHaveBeenCalled();
  expect(document.activeElement).toBe(close);

  // Focus wandering outside is contained
  document.activeElement = trigger;
  events.get('focusin')({ target: trigger });
  expect(document.activeElement).toBe(close);

  // Escape invokes close
  const escapeEvt = key('Escape');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(escapeEvt.preventDefault).toHaveBeenCalled();

  // Unmounting restores focus to triggering control
  await act(async () => renderer.unmount());
  renderer = null;
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('auto');
});

test('OrderMethodModal: initial focus enters close button, Tab traps within modal, and Escape invokes onClose', async () => {
  const onClose = jest.fn();
  await act(async () => {
    renderer = create(
      React.createElement(OrderMethodModal, {
        open: true,
        onClose,
        onContinue: jest.fn(),
      }),
      {
        createNodeMock: element => {
          if (element.props.role === 'dialog') return dialog;
          if (element.props.className === 'wk-method-close') return close;
          return null;
        },
      }
    );
  });

  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe('hidden');

  expect(key('Tab', true).preventDefault).toHaveBeenCalled();
  expect(document.activeElement).toBe(last);

  key('Escape');
  expect(onClose).toHaveBeenCalledTimes(1);

  await act(async () => renderer.unmount());
  renderer = null;
  expect(document.activeElement).toBe(trigger);
});

test('DeliveryAddressPickerPanel: focus traps within picker dialog and restores to trigger on close', async () => {
  const onClose = jest.fn();
  await act(async () => {
    renderer = create(
      React.createElement(DeliveryAddressPickerPanel, {
        open: true,
        onClose,
        onAddNew: jest.fn(),
        onEditAddress: jest.fn(),
        currentAddress: null,
      }),
      {
        createNodeMock: element => {
          if (element.props.role === 'dialog') return dialog;
          if (element.props.className === 'wk-method-close') return close;
          return null;
        },
      }
    );
  });

  expect(document.activeElement).toBe(close);
  key('Escape');
  expect(onClose).toHaveBeenCalledTimes(1);

  await act(async () => renderer.unmount());
  renderer = null;
  expect(document.activeElement).toBe(trigger);
});
