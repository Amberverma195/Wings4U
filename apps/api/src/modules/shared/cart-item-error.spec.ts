import { UnprocessableEntityException } from '@nestjs/common';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { throwCartItemError } from './cart-item-error';

describe('line-specific cart validation errors', () => {
  it('preserves the shared out-of-stock message and adds the saved cart row identity', () => {
    const error = new UnprocessableEntityException({ code: 'CART_ITEM_UNAVAILABLE', message: 'This item is currently out of stock. Please remove it or choose another item.', field: 'items' });
    try { throwCartItemError(error, { id: 'burger', index: 1, name: 'Burger' }); } catch (wrapped) {
      expect((wrapped as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'CART_ITEM_UNAVAILABLE',
        message: 'This item is currently out of stock. Please remove it or choose another item.', detail: { affected_item_ids: ['burger'], affected_item_indices: [1] } });
      return;
    }
    throw new Error('Expected cart validation rejection');
  });
  it('retains exact row index for duplicate SKU lines through the HTTP envelope', () => {
    let exception: unknown;
    try { throwCartItemError(new UnprocessableEntityException('Wrong weight'), { id: 'party', index: 1, name: '75 Wings' }); } catch (error) { exception = error; }
    const json = jest.fn(), status = jest.fn(() => ({ json }));
    new ApiExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ requestId: 'fixture' }) }) } as never);
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({ data: null, meta: { request_id: 'fixture' }, errors: [{ code: 'CART_ITEM_CONFIGURATION_INVALID',
      field: 'items', message: expect.stringContaining('75 Wings selection needs updating'), detail: { affected_item_ids: ['party'], affected_item_indices: [1] } }] });
  });
  it('distinguishes unavailable products and never disguises infrastructure failures as stale configuration', () => {
    expect(() => throwCartItemError(new UnprocessableEntityException('Archived'), { id: 'party', index: 0, unavailable: true })).toThrow('no longer available');
    const failure = new Error('Offline database');
    expect(() => throwCartItemError(failure, { index: 0 })).toThrow(failure);
  });
});
