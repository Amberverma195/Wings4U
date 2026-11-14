import { PosService } from './pos.service';

describe('manual delivery discounts stay within remaining food charges', () => {
  function fixture() {
    const order = { locationId: 'location', fulfillmentType: 'DELIVERY', status: 'PLACED',
      itemSubtotalCents: 2000, itemDiscountTotalCents: 500, orderDiscountTotalCents: 1000,
      deliveryFeeCents: 1000, driverTipCents: 0, walletAppliedCents: 0,
      taxRateBps: 1300, taxDeliveryFeeApplied: true, taxTipApplied: false,
      netPaidAmountCents: 0, paymentStatusSummary: 'UNPAID', finalPayableCents: 1695,
      pricingSnapshotJson: { discounts_reduce_taxable_base: true, delivery_fee_cents: 1000,
        tax_cents: 195, final_payable_cents: 1695 } };
    const db = {
      $transaction: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([{ id: 'order' }]),
      order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn(async ({ data }) => Object.assign(order, data)) },
      orderDiscount: { create: jest.fn().mockResolvedValue({ id: 'discount' }) },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction.mockImplementation(fn => fn(db));
    const service = new PosService(db as never, {} as never);
    const params = { orderId: 'order', locationId: 'location', actorUserId: null,
      discountAmountCents: 500, reason: 'Food discount' };
    return { db, service, params, order };
  }

  it('rejects discounts that consume delivery before any write', async () => {
    const { db, service, params } = fixture();
    await expect(service.applyManualDiscount({ ...params, discountAmountCents: 501 })).rejects.toThrow('waive delivery');
    expect(db.orderDiscount.create).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it('allows remaining food to be discounted but rejects a repeat and retains the fee', async () => {
    const { db, service, params } = fixture();
    expect(await service.applyManualDiscount(params)).toMatchObject({ new_final_payable_cents: 1130 });
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taxCents: 130, finalPayableCents: 1130, discountedSubtotalCents: 0, taxableSubtotalCents: 1000,
      pricingSnapshotJson: expect.objectContaining({ delivery_fee_cents: 1000, tax_cents: 130, final_payable_cents: 1130 }),
    }) }));
    await expect(service.applyManualDiscount(params)).rejects.toThrow('waive delivery');
    expect(db.orderDiscount.create).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('uses the stored non-reducing tax policy, not current location settings', async () => {
    const { db, service, params, order } = fixture();
    order.pricingSnapshotJson.discounts_reduce_taxable_base = false;
    expect(await service.applyManualDiscount(params)).toMatchObject({ new_final_payable_cents: 1390 });
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taxCents: 390, taxableSubtotalCents: 3000,
      pricingSnapshotJson: expect.objectContaining({ tax_cents: 390, final_payable_cents: 1390 }),
    }) }));
  });

  it.each(['historical', 'paid', 'partially-paid', 'wallet'])('does not reprice a %s delivery order', async kind => {
    const { db, service, params, order } = fixture();
    if (kind === 'historical') order.pricingSnapshotJson = {} as never;
    if (kind === 'paid') Object.assign(order, { netPaidAmountCents: 1695, paymentStatusSummary: 'PAID' });
    if (kind === 'partially-paid') Object.assign(order, { netPaidAmountCents: 100, paymentStatusSummary: 'PARTIALLY_PAID' });
    if (kind === 'wallet') order.walletAppliedCents = 100;
    await expect(service.applyManualDiscount(params)).rejects.toThrow('cannot be repriced');
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.orderDiscount.create).not.toHaveBeenCalled();
  });
});
