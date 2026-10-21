import { useEffect, useReducer } from 'react';
import { AppState } from 'react-native';
import { canCancelOrder } from '../lib/order-actions';
import type { OrderDetail } from '../lib/types';

export function useCancellationEligibility(order: OrderDetail, focused: boolean): boolean {
  const [, recheck] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!focused) return;
    // One wakeup at the deadline, with no countdown or per-second rendering.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      recheck();
      if (canCancelOrder(order)) timer = setTimeout(schedule,
        Math.min(Date.parse(order.cancel_allowed_until!) - Date.now(), 2_147_483_647));
    };
    schedule();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') schedule();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [order.id, order.status, order.cancel_allowed_until, focused]);
  return focused && canCancelOrder(order);
}
