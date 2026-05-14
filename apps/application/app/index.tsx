import React, { useMemo, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { ShoppingBag, Clock, MapPin, ChevronRight, Flame, AlertCircle, User } from 'lucide-react-native';
import { useMenu } from '../src/hooks/use-menu';
import { useAuth } from '../src/hooks/use-auth';
import { useSession } from '../src/context/session';
import { AuthSheet } from '../src/components/auth-sheet';
import type { MenuCategory, MenuItem, FulfillmentType } from '../src/lib/types';

const { width } = Dimensions.get('window');

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function emojiForCategorySlug(slug: string): string {
  switch (slug) {
    case 'lunch-specials':
      return '\uD83E\uDD6A';
    case 'wings':
    case 'wing-combos':
    case 'tenders':
      return '\uD83C\uDF57';
    case 'burgers':
      return '\uD83C\uDF54';
    case 'wraps':
      return '\uD83C\uDF2F';
    case 'salads':
      return '\uD83E\uDD57';
    case 'poutines-and-sides':
    case 'specialty-fries':
      return '\uD83C\uDF5F';
    case 'appetizers':
    case 'appetizers-extras':
      return '\uD83C\uDF64';
    case 'breads':
      return '\uD83C\uDF5E';
    case 'dips':
      return '\uD83E\uDD63';
    case 'drinks':
      return '\uD83E\uDD64';
    case 'dessert':
      return '\uD83C\uDF70';
    case 'specials':
    case 'party-specials':
      return '\u2B50';
    default:
      return '\uD83C\uDF7D\uFE0F';
  }
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Canonical strip order - matches the website's category ordering. */
const MENU_CATEGORY_SLUG_ORDER: string[] = [
  'lunch-specials',
  'wings',
  'wing-combos',
  'burgers',
  'tenders',
  'wraps',
  'salads',
  'poutines-and-sides',
  'specialty-fries',
  'appetizers',
  'breads',
  'specials',
  'party-specials',
  'drinks',
  'dessert',
  'dips',
];

function sortCategories(categories: MenuCategory[]): MenuCategory[] {
  return [...categories].sort((a, b) => {
    const ai = MENU_CATEGORY_SLUG_ORDER.indexOf(a.slug);
    const bi = MENU_CATEGORY_SLUG_ORDER.indexOf(b.slug);
    const aKey = ai === -1 ? 1000 + a.sort_order : ai;
    const bKey = bi === -1 ? 1000 + b.sort_order : bi;
    if (aKey !== bKey) return aKey - bKey;
    return a.sort_order - b.sort_order;
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('PICKUP');
  const { menu, loading, error, refetch } = useMenu(fulfillmentType);
  const [activeCategorySlug, setActiveCategorySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const session = useSession();
  const { logout } = useAuth();

  const sortedCategories = useMemo(() => {
    if (!menu) return [];
    return sortCategories(menu.categories);
  }, [menu]);

  /* The "active" category: either user-tapped or the first one once loaded. */
  const resolvedActiveSlug = activeCategorySlug ?? sortedCategories[0]?.slug ?? null;

  const activeCategory = useMemo(
    () => sortedCategories.find((c) => c.slug === resolvedActiveSlug) ?? null,
    [sortedCategories, resolvedActiveSlug],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch();
    // The loading state from the hook will reset refreshing
    setTimeout(() => setRefreshing(false), 1500);
  }, [refetch]);

  const handleCategoryPress = useCallback((slug: string) => {
    setActiveCategorySlug(slug);
  }, []);

  const toggleFulfillment = useCallback(() => {
    setFulfillmentType((prev) => (prev === 'PICKUP' ? 'DELIVERY' : 'PICKUP'));
    setActiveCategorySlug(null);
  }, []);

  /* Greeting based on time of day */
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning!';
    if (hour < 17) return 'Good afternoon!';
    return 'Good evening!';
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Loading state                                                    */
  /* ---------------------------------------------------------------- */
  if (loading && !menu) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#FF4D4D" />
          <Text style={styles.loadingText}>Loading menu...</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Error state                                                      */
  /* ---------------------------------------------------------------- */
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.errorWrap}>
          <AlertCircle size={48} color="#FF4D4D" />
          <Text style={styles.errorTitle}>Couldn't load menu</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF4D4D" />
        }
      >
        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.title}>Wings4U</Text>
          </View>
          <View style={styles.headerActions}>
            {/* Auth button */}
            {session.authenticated ? (
              <TouchableOpacity style={styles.authAvatarBtn} onPress={logout}>
                <User size={18} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.authGuestBtn} onPress={() => setAuthVisible(true)}>
                <User size={20} color="#FF4D4D" />
              </TouchableOpacity>
            )}
            {/* Cart button */}
            <TouchableOpacity style={styles.cartButton}>
              <ShoppingBag size={24} color="#000" />
              <View style={styles.cartBadge} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Auth Sheet Modal */}
        <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />

        {/* Location Bar */}
        <TouchableOpacity style={styles.locationBar}>
          <MapPin size={20} color="#FF4D4D" />
          <Text style={styles.locationText} numberOfLines={1}>
            {menu?.location.name ?? 'Wings4U'}
          </Text>
          <ChevronRight size={20} color="#999" />
        </TouchableOpacity>

        {/* Hero Promo */}
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <View style={styles.promoBadge}>
              <Flame size={14} color="#FFF" fill="#FFF" />
              <Text style={styles.promoBadgeText}>
                {fulfillmentType === 'PICKUP' ? 'PICKUP' : 'DELIVERY'}
              </Text>
            </View>
            <Text style={styles.heroTitle}>
              {fulfillmentType === 'PICKUP' ? 'Ready for Pickup!' : 'We Deliver!'}
            </Text>
            <Text style={styles.heroSubtitle}>
              {fulfillmentType === 'PICKUP'
                ? `Est. ${menu?.location.pickup_min_minutes ?? 30}-${menu?.location.pickup_max_minutes ?? 40} min`
                : `Est. ${menu?.location.delivery_min_minutes ?? 40}-${menu?.location.delivery_max_minutes ?? 60} min`}
            </Text>
            <TouchableOpacity style={styles.heroButton} onPress={toggleFulfillment}>
              <Text style={styles.heroButtonText}>
                Switch to {fulfillmentType === 'PICKUP' ? 'Delivery' : 'Pickup'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.heroImagePlaceholder} />
        </View>

        {/* Categories Strip */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Menu</Text>
          <Text style={styles.categoryCount}>
            {sortedCategories.length} categories
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categoriesContent}
        >
          {sortedCategories.map((cat) => {
            const isActive = cat.slug === resolvedActiveSlug;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryCard, isActive && styles.categoryCardActive]}
                onPress={() => handleCategoryPress(cat.slug)}
              >
                <View style={[styles.categoryIcon, isActive && styles.categoryIconActive]}>
                  <Text style={styles.categoryEmoji}>{emojiForCategorySlug(cat.slug)}</Text>
                </View>
                <Text
                  style={[styles.categoryText, isActive && styles.categoryTextActive]}
                  numberOfLines={1}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Active Category Items */}
        {activeCategory && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{activeCategory.name}</Text>
              <Text style={styles.itemCount}>
                {activeCategory.items.length} item{activeCategory.items.length !== 1 ? 's' : ''}
              </Text>
            </View>

            {activeCategory.items.length === 0 ? (
              <View style={styles.emptyCategory}>
                <Text style={styles.emptyCategoryEmoji}>
                  {emojiForCategorySlug(activeCategory.slug)}
                </Text>
                <Text style={styles.emptyCategoryText}>
                  No items available right now
                </Text>
              </View>
            ) : (
              activeCategory.items.map((item) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  categorySlug={activeCategory.slug}
                />
              ))
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  Menu Item Card                                                     */
/* ------------------------------------------------------------------ */

function MenuItemCard({ item, categorySlug }: { item: MenuItem; categorySlug: string }) {
  const emoji = emojiForCategorySlug(categorySlug);
  const isUnavailable = item.stock_status === 'UNAVAILABLE';
  const isLowStock = item.stock_status === 'LOW_STOCK';
  const hasImage = Boolean(item.image_url);

  /** Derive the display price label. */
  const priceLabel = useMemo(() => {
    if (item.weight_options && item.weight_options.length > 0) {
      return `From ${formatPrice(item.base_price_cents)}`;
    }
    if (item.combo_options && item.combo_options.length > 0) {
      return `From ${formatPrice(item.base_price_cents)}`;
    }
    return formatPrice(item.base_price_cents);
  }, [item]);

  return (
    <TouchableOpacity
      style={[styles.itemCard, isUnavailable && styles.itemCardUnavailable]}
      disabled={isUnavailable}
      activeOpacity={0.7}
    >
      {/* Image or emoji placeholder */}
      {hasImage ? (
        <Image
          source={{ uri: item.image_url! }}
          style={styles.itemImage}
          contentFit="cover"
          transition={300}
        />
      ) : (
        <View style={styles.itemImagePlaceholder}>
          <Text style={styles.itemPlaceholderEmoji}>{emoji}</Text>
        </View>
      )}

      <View style={styles.itemDetails}>
        <View style={styles.itemNameRow}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.name}
          </Text>
          {isLowStock && (
            <View style={styles.lowStockBadge}>
              <Text style={styles.lowStockText}>LOW STOCK</Text>
            </View>
          )}
        </View>

        {item.description ? (
          <Text style={styles.itemDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.itemMeta}>
          <View style={styles.metaRow}>
            <Clock size={14} color="#999" />
            <Text style={styles.metaText}>
              {item.builder_type ? 'Customize' : 'Quick add'}
            </Text>
          </View>
          <Text style={[styles.itemPrice, isUnavailable && styles.itemPriceUnavailable]}>
            {isUnavailable ? 'UNAVAILABLE' : priceLabel}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles - identical design / colour palette as before                */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },

  /* Loading */
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },

  /* Error */
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginTop: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#FF4D4D',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },

  /* Header */
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1A1A1A',
    marginTop: 2,
  },
  cartButton: {
    width: 48,
    height: 48,
    backgroundColor: '#FFF',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cartBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 10,
    height: 10,
    backgroundColor: '#FF4D4D',
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authAvatarBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF4D4D',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  authGuestBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FF4D4D',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Location */
  locationBar: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 12,
    backgroundColor: '#FFF',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    color: '#444',
    marginLeft: 8,
    fontWeight: '500',
  },

  /* Hero */
  heroCard: {
    margin: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  heroContent: {
    flex: 1,
    zIndex: 1,
  },
  promoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 77, 77, 0.2)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  promoBadgeText: {
    color: '#FF4D4D',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 4,
  },
  heroTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroSubtitle: {
    color: '#AAA',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  heroButton: {
    backgroundColor: '#FF4D4D',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  heroButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  heroImagePlaceholder: {
    position: 'absolute',
    right: -20,
    bottom: -20,
    width: 140,
    height: 140,
    backgroundColor: '#2A2A2A',
    borderRadius: 70,
  },

  /* Section headers */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  categoryCount: {
    color: '#999',
    fontWeight: '600',
    fontSize: 13,
  },
  itemCount: {
    color: '#999',
    fontWeight: '600',
    fontSize: 13,
  },

  /* Categories strip */
  categoriesScroll: {
    paddingLeft: 20,
    marginBottom: 25,
  },
  categoriesContent: {
    paddingRight: 20,
  },
  categoryCard: {
    width: 80,
    height: 100,
    backgroundColor: '#FFF',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  categoryCardActive: {
    backgroundColor: '#FF4D4D',
  },
  categoryIcon: {
    width: 40,
    height: 40,
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryIconActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  categoryEmoji: {
    fontSize: 20,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  categoryTextActive: {
    color: '#FFF',
  },

  /* Empty category */
  emptyCategory: {
    marginHorizontal: 20,
    marginBottom: 15,
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  emptyCategoryEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyCategoryText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },

  /* Item cards */
  itemCard: {
    marginHorizontal: 20,
    marginBottom: 15,
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  itemCardUnavailable: {
    opacity: 0.5,
  },
  itemImage: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
  },
  itemImagePlaceholder: {
    width: 100,
    height: 100,
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemPlaceholderEmoji: {
    fontSize: 36,
  },
  itemDetails: {
    flex: 1,
    marginLeft: 15,
    justifyContent: 'center',
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    flexShrink: 1,
  },
  lowStockBadge: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lowStockText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F59E0B',
  },
  itemDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    marginLeft: 4,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FF4D4D',
  },
  itemPriceUnavailable: {
    fontSize: 11,
    color: '#999',
  },


});
