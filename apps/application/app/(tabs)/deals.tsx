import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { AuthSheet } from '../../src/components/auth-sheet';
import { useSession } from '../../src/context/session';

function GuestDeals() {
  const [authVisible, setAuthVisible] = useState(false);
  return (
    <View style={styles.guest}>
      <Text style={styles.guestTitle}>Sign in to see your deals</Text>
      <Text style={styles.guestBody}>Wing stamps and coupons are saved to your account.</Text>
      <TouchableOpacity style={styles.signIn} onPress={() => setAuthVisible(true)} accessibilityRole="button">
        <Text style={styles.signInText}>Sign in</Text>
      </TouchableOpacity>
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </View>
  );
}

export default function DealsTab() {
  const router = useRouter();
  const session = useSession();

  useFocusEffect(useCallback(() => {
    if (!session.loaded || !session.authenticated) return;
    router.push(`/profile?section=overview&entry=${Date.now()}`);
  }, [router, session.authenticated, session.loaded]));

  if (!session.loaded || session.authenticated) {
    return <SafeAreaView style={styles.screen} edges={['left', 'right']} />;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <GuestDeals />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  guest: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  guestTitle: { color: '#1A1A1A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  guestBody: { color: '#777777', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  signIn: { marginTop: 20, backgroundColor: '#FF4D4D', borderRadius: 22, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' },
  signInText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});
