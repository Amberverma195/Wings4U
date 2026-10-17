import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { SAUCES, type Sauce } from '../lib/sauces';

export function FlavourCard({ sauce, compact = false }: { sauce: Sauce; compact?: boolean }) {
  return (
    <View style={[styles.card, compact && styles.compactCard, { backgroundColor: sauce.background }]}>
      <View style={styles.orbit} />
      <Text style={[styles.emoji, compact && styles.compactEmoji]} accessibilityElementsHidden importantForAccessibility="no">{sauce.emoji}</Text>
      <Text style={[styles.name, { color: sauce.ink }]}>{sauce.name}</Text>
    </View>
  );
}

export function TrendingFlavours() {
  const router = useRouter();
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>🔥 Trending Flavours</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="See all sauces"
          onPress={() => router.push('/sauces')} hitSlop={8}
          style={({ pressed }) => [styles.seeAll, pressed && { opacity: 0.6 }]}>
          <Text style={styles.seeAllText}>See All</Text>
          <ArrowRight size={14} color="#DC3939" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {SAUCES.map(sauce => <FlavourCard key={sauce.name} sauce={sauce} compact />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 2, marginBottom: 4 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 2, gap: 8 },
  heading: { fontSize: 15, fontWeight: '800', color: '#231B18', flexShrink: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  seeAllText: { fontSize: 12, fontWeight: '700', color: '#DC3939' },
  cards: { paddingHorizontal: 16, gap: 7 },
  card: { width: 80, minHeight: 88, borderRadius: 12, padding: 8, overflow: 'hidden', justifyContent: 'space-between' },
  compactCard: { minHeight: 72, padding: 6 },
  orbit: { position: 'absolute', width: 58, height: 58, borderRadius: 29, borderWidth: 9, borderColor: '#FFFFFF55', right: -18, top: -18 },
  emoji: { fontSize: 23, marginTop: 2, marginBottom: 6 },
  compactEmoji: { fontSize: 20, marginTop: 1, marginBottom: 2 },
  name: { fontSize: 10, fontWeight: '800', lineHeight: 13 },
});
