import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlavourCard } from '../src/components/trending-flavours';
import { SAUCES } from '../src/lib/sauces';

export default function SaucesScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>FIND YOUR FLAVOUR</Text>
        <Text style={styles.title}>Big flavour. Your way.</Text>
        <Text style={styles.subtitle}>Explore our popular sauces. The full sauce guide is coming soon.</Text>
        <View style={styles.grid}>
          {SAUCES.map(sauce => <FlavourCard key={sauce.name} sauce={sauce} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF8' },
  content: { padding: 20, paddingBottom: 32, maxWidth: 720, width: '100%', alignSelf: 'center' },
  eyebrow: { color: '#C63C32', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 12 },
  title: { color: '#231B18', fontSize: 28, fontWeight: '800', marginTop: 10 },
  subtitle: { color: '#76665D', fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
