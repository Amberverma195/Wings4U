const React = require('react');
const { act, create } = require('react-test-renderer');
const { product } = require('../../../packages/customization/test/fixtures.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { addItem: jest.fn(), replaceItem: jest.fn() };
let mockSubmit;
jest.mock('../src/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/components/builder-shared', () => ({
  BuilderShell: props => { mockSubmit = props.onSubmit; return React.createElement('main', props, props.children); },
  builderSubmitLabel: editing => editing ? 'Update Cart' : 'Add to Cart',
  BUILDER_VALIDATION_MESSAGE: 'Check required choices',
}));
const { ItemCustomizationOverlay } = require('../src/components/item-customization-overlay');
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.clearAllMocks(); });

test.each(['veggie-burger', 'chicken-burger', 'buffalo-chicken-wrap'])('web applies the shared fixture for %s and preserves real IDs on add', async slug => {
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item: product(slug), onClose: jest.fn() })); });
  const text = JSON.stringify(renderer.toJSON());
  expect(text).not.toContain('Add Avocado'); expect(text).not.toContain('Add Jalapenos'); expect(text).toContain('Extra Lettuce');
  const input = renderer.root.findAllByType('input').find(node => node.props.name === 'mod-legacy');
  await act(async () => input.props.onChange());
  await act(async () => mockSubmit());
  expect(mockCart.addItem).toHaveBeenCalledWith(expect.objectContaining({ menu_item_id: slug,
    modifier_selections: [expect.objectContaining({ modifier_option_id: 'lettuce', price_delta_cents: 50 })] }));
});

test('web editing an option removed by admin requires explicit review', async () => {
  const item = product(); const old = { key: 'old', menu_item_id: item.id, base_price_cents: 999, quantity: 2,
    modifier_selections: [{ modifier_option_id: 'avocado', price_delta_cents: 200 }], removed_ingredients: [], special_instructions: 'Keep warm' };
  await act(async () => { renderer = create(React.createElement(ItemCustomizationOverlay, { item, editingLine: old, onClose: jest.fn() })); });
  await act(async () => mockSubmit()); expect(mockCart.replaceItem).not.toHaveBeenCalled();
  const review = renderer.root.findAllByType('button').find(node => node.children.includes('Review current choices'));
  await act(async () => review.props.onClick()); await act(async () => mockSubmit());
  expect(mockCart.replaceItem).toHaveBeenCalledWith('old', expect.objectContaining({ quantity: 2, special_instructions: 'Keep warm', modifier_selections: [] }));
});
