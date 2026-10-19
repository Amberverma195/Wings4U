import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { cents, orderStatusCustomerLabel } from '../lib/format';
import type { CheckoutResponse } from '../lib/types';

export function CheckoutConfirmation({ order }: { order: CheckoutResponse }) {
  const router = useRouter();
  const ready = Date.parse(order.estimated_ready_at);
  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={s.screen}>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}>
        <View style={s.icon}><CheckCircle2 size={42} color="#E53C3C" /></View>
        <Text style={s.eyebrow}>THANK YOU FOR ORDERING</Text>
        <Text accessibilityRole="header" style={s.title}>Your cravings, confirmed.</Text>
        <Text style={s.body} accessibilityLiveRegion="polite">Order #{order.order_number} has been placed.</Text>
        <View style={s.details}>
          <Text style={s.status}>{orderStatusCustomerLabel(order.status, order.fulfillment_type)}</Text>
          {Number.isFinite(ready) && <Text style={s.body}>Estimated {order.fulfillment_type === 'DELIVERY' ? 'arrival' : 'ready time'}: {new Date(ready).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>}
          <Text style={s.total}>{cents(order.final_payable_cents)}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" style={s.button} onPress={() => router.replace(`/orders/${order.id}`)}>
          <Text style={s.buttonText}>Track Order</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => router.replace('/(tabs)/menu')}><Text style={s.status}>Back to menu</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF9F5' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#EFE4DE', padding: 24, alignItems: 'center' },
  icon: { padding: 22, borderRadius: 50, backgroundColor: '#FFF0EA', marginBottom: 24 },
  eyebrow: { color: '#75665C', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textAlign: 'center' },
  title: { color: '#30241F', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 30, textAlign: 'center', marginVertical: 12 },
  body: { color: '#75665C', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  details: { alignSelf: 'stretch', padding: 18, gap: 10, marginVertical: 24, borderRadius: 16, backgroundColor: '#F6EEE9' },
  status: { color: '#30241F', fontWeight: '700', textAlign: 'center' },
  total: { color: '#E53C3C', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  button: { alignSelf: 'stretch', minHeight: 54, justifyContent: 'center', alignItems: 'center', backgroundColor: '#E53C3C', borderRadius: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondary: { minHeight: 48, justifyContent: 'center', marginTop: 8 },
});
