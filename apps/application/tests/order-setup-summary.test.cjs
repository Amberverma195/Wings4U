const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } }));
jest.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', Clock3: 'Clock3' }));
const mockCart = { fulfillmentType: 'DELIVERY', scheduledFor: null, locationTimezone: 'America/Toronto' };
const mockSetup = { confirmed: true, deliveryAddress: { line1: '12 Main St', postal_code: 'N5Y 4J7' }, openOrderSetup: jest.fn() };
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => mockSetup }));
const { OrderSetupSummary } = require('../src/components/order-setup-summary');
let renderer;
const mount = async props => act(async () => { renderer = create(React.createElement(OrderSetupSummary, props)); });
afterEach(async () => { await act(async () => renderer.unmount()); jest.clearAllMocks(); });

test('Cart selector keeps fulfillment and time on one line and opens order setup', async () => {
  await mount({ singleLine: true });
  const label = renderer.root.findAllByType('Text').find(node => node.children.join('').includes('Delivery'));
  expect(label.children.join('')).toContain('ASAP'); expect(label.props.numberOfLines).toBe(1);
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes('12 Main St'))).toBe(false);
  await act(async () => renderer.root.findByType('Pressable').props.onPress());
  expect(mockSetup.openOrderSetup).toHaveBeenCalledTimes(1);
});

test('checkout shows a single read-only detail line without Change or a chevron', async () => {
  await mount({ singleLine: true, readOnly: true });
  expect(renderer.root.findAllByType('Pressable')).toHaveLength(0);
  expect(renderer.root.findAllByType('ChevronRight')).toHaveLength(0);
  const labels = renderer.root.findAllByType('Text');
  expect(labels).toHaveLength(1); expect(labels[0].props.numberOfLines).toBe(1);
  expect(labels[0].children.join('')).toContain('Delivery'); expect(labels[0].children.join('')).not.toContain('Change');
});

test('other existing consumers retain their address and Change action by default', async () => {
  await mount({});
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes('12 Main St'))).toBe(true);
  expect(renderer.root.findAllByType('Pressable')).toHaveLength(1);
});
