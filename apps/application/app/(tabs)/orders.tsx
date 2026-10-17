import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { AuthSheet } from '../../src/components/auth-sheet';
import { OrderHistory } from '../../src/components/order-history';
import { TabHeader } from '../../src/components/tab-header';
import { useSession } from '../../src/context/session';
import { useAccountData } from '../../src/hooks/use-account-data';
import { accountTabGate } from '../../src/lib/deals-display';

function GuestOrders() {
  const [authVisible, setAuthVisible] = useState(false);
  return (
    <View style={styles.guest}>
      <Text style={styles.guestTitle}>Sign in to see your orders</Text>
      <Text style={styles.guestBody}>Active and past orders are saved to your account.</Text>
      <TouchableOpacity style={styles.signIn} onPress={() => setAuthVisible(true)} accessibilityRole="button">
        <Text style={styles.signInText}>Sign in</Text>
      </TouchableOpacity>
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </View>
  );
}

export default function OrdersTab() {
  const router = useRouter();
  const session = useSession();
  const account = useAccountData();
  const gate = accountTabGate({
    sessionLoaded: session.loaded,
    authenticated: session.authenticated,
    loading: account.loading,
  });

  useFocusEffect(useCallback(() => {
    if (!session.loaded || !session.authenticated) return;
    router.push(`/profile?section=orders&entry=${Date.now()}`);
  }, [router, session.authenticated, session.loaded]));

  if (session.loaded && session.authenticated) {
    return <SafeAreaView style={styles.screen} edges={['left', 'right']} />;
  }

  const orders = account.data.orders;
  const ordersError = account.sectionErrors.orders;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <TabHeader title="Orders" />
      {gate === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#FF4D4D" />
        </View>
      ) : gate === 'guest' ? (
        <GuestOrders />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={account.refreshing}
              onRefresh={() => { void account.refresh('refresh'); }}
              tintColor="#FF4D4D"
            />
          }
        >
          {ordersError && orders.length === 0 ? (
            <View style={styles.centeredBlock}>
              <Text style={styles.error}>{ordersError}</Text>
              <TouchableOpacity style={styles.signIn} onPress={() => { void account.refresh('refresh'); }} accessibilityRole="button">
                <Text style={styles.signInText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {ordersError ? <Text style={styles.error}>{ordersError}</Text> : null}
              <OrderHistory orders={orders} />
              {account.data.ordersNextCursor ? (
                <TouchableOpacity
                  style={styles.more}
                  onPress={() => { void account.loadMoreOrders(); }}
                  disabled={account.loadingMoreOrders}
                  accessibilityRole="button"
                  accessibilityLabel="Load more orders"
                >
                  {account.loadingMoreOrders
                    ? <ActivityIndicator color="#FF4D4D" />
                    : <Text style={styles.moreText}>Load more orders</Text>}
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centeredBlock: { alignItems: 'center', paddingVertical: 32 },
  guest: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  guestTitle: { color: '#1A1A1A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  guestBody: { color: '#777777', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  signIn: { marginTop: 20, backgroundColor: '#FF4D4D', borderRadius: 22, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' },
  signInText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  moreText: { color: '#FF4D4D', fontSize: 15, fontWeight: '800' },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 12 },
});
