const { getCartItemIssue, issueAffectsLine, savedSelectionReview } = require('../src/lib/cart-validation');
const message = 'Your Wings selection needs updating. Please review this item before checkout.';
test('server row indices identify one of two matching SKUs and do not mutate the saved cart', () => {
  const cart = [{ key: 'a', menu_item_id: 'wings', quantity: 2 }, { key: 'b', menu_item_id: 'wings', quantity: 3 }];
  const snapshot = JSON.stringify(cart);
  const issue = getCartItemIssue({ body: { errors: [{ code: 'CART_ITEM_CONFIGURATION_INVALID', message, detail: { affected_item_ids: ['wings'], affected_item_indices: [1] } }] } });
  expect(issueAffectsLine(issue, cart[0].menu_item_id, 0)).toBe(false);
  expect(issueAffectsLine(issue, cart[1].menu_item_id, 1)).toBe(true);
  expect(JSON.stringify(cart)).toBe(snapshot);
  expect(getCartItemIssue(new Error('Network failure'))).toBeNull();
});
test('unavailable items retain their separate reason and ID-only legacy context remains usable', () => {
  const issue = getCartItemIssue({ errors: [{ code: 'CART_ITEM_UNAVAILABLE', message: 'No longer available', detail: { affected_item_ids: ['gone'] } }] });
  expect(issue.message).toBe('No longer available'); expect(issueAffectsLine(issue, 'gone', 0)).toBe(true);
});
test('review notices disclose changed portions and unavailable paid options before an explicit save', () => {
  const option = { weight_lb: 8, modifier_groups: [{ options: [{ id: 'valid' }] }] };
  const line = { quantity: 3, builder_payload: { weight_lb: 5 }, modifier_selections: [{ modifier_option_id: 'valid' }, { modifier_option_id: 'old-paid', option_name: 'Extra cheese' }] };
  const original = JSON.stringify(line);
  expect(savedSelectionReview(line, option)).toContain('Extra cheese'); expect(JSON.stringify(line)).toBe(original);
  expect(savedSelectionReview({ ...line, modifier_selections: [] }, option)).toContain('Portion information has changed');
  expect(savedSelectionReview({ ...line, builder_payload: { weight_lb: 8 }, modifier_selections: [{ modifier_option_id: 'valid' }] }, option)).toBeNull();
});
