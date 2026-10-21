import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllTokens } from './token-store';
import { disconnectCustomerSockets } from './realtime';

/** Server completion only. Do not clear the install's signup anti-abuse device ID. */
export async function forgetDeletedAccount(): Promise<void> {
  disconnectCustomerSockets();
  const tokens = clearAllTokens(); // Invalidates in-flight refreshes synchronously.
  await tokens;
  const keys = await AsyncStorage.getAllKeys();
  const customerKeys = keys.filter(key => key === 'wings4u.mobile-promo-selection-v1' || key.startsWith('wings4u.mobile-cart-draft-v1:') ||
    key.startsWith('wings4u.order-setup-v1:') || key.startsWith('wings4u.order-setup-v2:'));
  if (customerKeys.length) await AsyncStorage.multiRemove(customerKeys);
}
