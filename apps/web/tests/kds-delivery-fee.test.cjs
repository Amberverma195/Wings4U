const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { DeliveryFeeRow } = require('../src/app/kds/delivery-fee-row');

test.each([[800, '$8.00'], [1000, '$10.00'], [2300, '$23.00'], [0, 'Free']])(
  'renders persisted delivery charge %i as %s', (fee, expected) => {
    const html = renderToStaticMarkup(React.createElement(DeliveryFeeRow, {
      order: { fulfillment_type: 'DELIVERY', delivery_fee_cents: fee },
    }));
    expect(html).toContain('Delivery Fee');
    expect(html).toContain(expected);
  },
);

test.each([0, 1000])('pickup has no delivery row even with legacy fee %i', fee => {
  expect(renderToStaticMarkup(React.createElement(DeliveryFeeRow, {
    order: { fulfillment_type: 'PICKUP', delivery_fee_cents: fee },
  }))).toBe('');
});
