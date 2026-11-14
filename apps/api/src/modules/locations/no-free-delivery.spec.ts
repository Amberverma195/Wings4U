import { LocationSettingsService } from './location-settings.service';
import { AdminPromosService } from '../admin/admin-promos.service';

describe('free delivery cannot be re-enabled through administration', () => {
  it.each([{ freeDeliveryThresholdCents: 4000 }, { freeDeliveryThresholdCents: 0 },
    { free_delivery_threshold_cents: 4000 }])('rejects legacy threshold %j before accessing the database', async data => {
    const service = new LocationSettingsService({} as never, {} as never, {} as never, {} as never);
    await expect(service.updateSettings('location', data, 'admin')).rejects.toThrow('Free delivery is disabled');
  });

  it('rejects new free-delivery codes and first-order waiver components', async () => {
    const service = new AdminPromosService({} as never);
    await expect(service.createPromo('location', { discountType: 'FREE_DELIVERY' } as never))
      .rejects.toThrow('no longer available');
    await expect(service.updateFirstOrderDeal('location', { freeDelivery: true } as never))
      .rejects.toThrow('no longer available');
  });
});
