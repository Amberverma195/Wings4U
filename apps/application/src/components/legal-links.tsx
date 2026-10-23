import { Alert, Linking, TouchableOpacity, StyleSheet, Text, View } from 'react-native';
import { getPrivacyPolicyUrl, getTermsOfServiceUrl } from '../lib/env';

export function LegalLinks() {
  const open = async (url: string) => {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Unable to open document', `Please visit ${url} in your browser.`); }
  };
  return (
    <View style={styles.links}>
      <TouchableOpacity accessibilityRole="link" accessibilityLabel="Privacy Policy, opens in your browser"
        style={styles.link} onPress={() => void open(getPrivacyPolicyUrl())}>
        <Text style={styles.text}>Privacy Policy</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="link" accessibilityLabel="Terms of Service, opens in your browser"
        style={styles.link} onPress={() => void open(getTermsOfServiceUrl())}>
        <Text style={styles.text}>Terms of Service</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginVertical: 12 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  text: { color: '#853108', fontSize: 14, textDecorationLine: 'underline', fontWeight: '600' },
});
