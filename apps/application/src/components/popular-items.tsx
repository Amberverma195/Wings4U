import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ArrowRight, ShoppingBag, SlidersHorizontal } from 'lucide-react-native';
import { categoryImage } from '../lib/category-images';
import { cartLineForPopularItem, isOrderable, popularItems } from '../lib/popular-items';
import type { CartItem, FulfillmentType, MenuCategory, MenuItem } from '../lib/types';

type Props = {
  categories: MenuCategory[];
  cartItems: CartItem[];
  fulfillmentType: FulfillmentType;
  updating: boolean;
  onChoose: (item: MenuItem, line: CartItem | null) => void;
  onSeeAll: () => void;
};

export function PopularItems({ categories, cartItems, fulfillmentType, updating, onChoose, onSeeAll }: Props) {
  return <View style={styles.section}>
    <View style={styles.header}>
      <Text style={styles.heading}>Popular Items</Text>
      <Pressable onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all menu items" hitSlop={8} style={styles.seeAll}>
        <Text style={styles.seeAllText}>See All</Text><ArrowRight size={12} color="#E53C3C" />
      </Pressable>
    </View>
    <View style={styles.cards}>
      {popularItems(categories, fulfillmentType).map(({ title, categorySlug, item, category }) => {
        const line = item ? cartLineForPopularItem(item, cartItems) : null;
        const available = Boolean(item && isOrderable(item, fulfillmentType) && !updating);
        const Icon = line ? SlidersHorizontal : ShoppingBag;
        const price = item ? `${item.weight_options?.length || item.combo_options?.length ? 'From ' : ''}$${(item.base_price_cents / 100).toFixed(2)}` : null;
        return <View key={categorySlug} style={styles.card}>
          <View style={styles.photo}>
            {item && category ? <Image source={item.image_url ? { uri: item.image_url } : categoryImage(category)}
              style={styles.image} contentFit={item.image_url ? 'cover' : 'contain'} accessible={false} /> :
              <Text style={styles.placeholder}>🍗</Text>}
          </View>
          <View style={styles.content}>
            <Text style={styles.name} numberOfLines={2}>{title}</Text>
            <Text style={styles.description} numberOfLines={2}>{item ? categorySlug === 'tenders' ?
              [item.name, item.description].filter(Boolean).join(' · ') : item.description : 'Not available right now'}</Text>
            <Text style={styles.price}>{price ?? 'Unavailable'}</Text>
            {item?.stock_status === 'LOW_STOCK' && <Text style={styles.stock}>Low stock</Text>}
            <Pressable disabled={!available} accessibilityRole="button" accessibilityState={{ disabled: !available }}
              accessibilityLabel={`${line ? 'Customize' : 'Add to cart'} ${title}`}
              onPress={() => { if (item && available) onChoose(item, line); }}
              style={({ pressed }) => [styles.button, line && styles.customize, !available && styles.disabled, pressed && { opacity: 0.7 }]}>
              {available && <Icon size={12} color={line ? '#FFF' : '#DF3535'} />}
              <Text style={[styles.buttonText, line && styles.customizeText, !available && styles.disabledText]}>
                {updating ? 'Updating…' : !available ? 'Unavailable' : line ? 'Customize' : 'Add to Cart'}
              </Text>
            </Pressable>
          </View>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  heading: { fontSize: 15, fontWeight: '800', color: '#211B18' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 36 },
  seeAllText: { fontSize: 11, fontWeight: '700', color: '#E53C3C' },
  cards: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  card: { flex: 1, minWidth: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#F0EBE7' },
  photo: { aspectRatio: 1.5, backgroundColor: '#FFF3EB', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  placeholder: { fontSize: 28 },
  content: { padding: 7, flex: 1 },
  name: { fontSize: 12, fontWeight: '800', lineHeight: 15, minHeight: 30, color: '#251E1B' },
  description: { fontSize: 10, lineHeight: 13, height: 26, marginTop: 3, marginBottom: 5, color: '#85756A' },
  price: { fontSize: 12, fontWeight: '800', color: '#DF3535', marginTop: 'auto', marginBottom: 7 },
  stock: { fontSize: 9, color: '#946123', marginBottom: 4 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 34, borderRadius: 8, backgroundColor: '#FFF0ED', paddingHorizontal: 3 },
  buttonText: { fontSize: 10, fontWeight: '700', color: '#DF3535', flexShrink: 1 },
  customize: { backgroundColor: '#ED3434' },
  customizeText: { color: '#FFF' },
  disabled: { backgroundColor: '#F0ECE8' },
  disabledText: { color: '#94877F' },
});
