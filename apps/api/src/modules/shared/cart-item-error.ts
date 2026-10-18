import { HttpException, UnprocessableEntityException } from '@nestjs/common';

/** Add recovery context without relaxing any catalogue validation. */
export function throwCartItemError(error: unknown, item: {
  id?: string; index: number; name?: string; unavailable?: boolean;
}): never {
  if (!(error instanceof HttpException) || error.getStatus() !== 422) throw error;
  const body = error.getResponse();
  const reason = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  const stockUnavailable = typeof body === 'object' && (body as { code?: string }).code === 'CART_ITEM_UNAVAILABLE';
  const name = item.name || 'This item';
  throw new UnprocessableEntityException({
    code: item.unavailable || stockUnavailable ? 'CART_ITEM_UNAVAILABLE' : 'CART_ITEM_CONFIGURATION_INVALID',
    message: stockUnavailable && typeof reason === 'string' ? reason : item.unavailable
      ? `${name} is no longer available for this order. Please remove it or choose another item.`
      : `Your ${name} selection needs updating because our menu options have changed. Please review this item before checkout.`,
    field: 'items',
    detail: { affected_item_ids: item.id ? [item.id] : [], affected_item_indices: [item.index] },
    reason,
  });
}
