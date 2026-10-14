import { SafeAreaView } from "react-native-safe-area-context";
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ShoppingBag, Clock, AlertCircle, User } from 'lucide-react-native';
import { useMenu } from '../src/hooks/use-menu';
import { useSession } from '../src/context/session';
import { useCart } from '../src/context/cart';
import { AuthSheet } from '../src/components/auth-sheet';
import { MenuItemBuilder } from '../src/components/menu-item-builder';
import type { MenuCategory, MenuItem } from '../src/lib/types';

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
    case 'sides':
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
  'sides',
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
  const { width } = useWindowDimensions();
  const compactHeader = width < 380;
  const cart = useCart();
  const fulfillmentType = cart.fulfillmentType;
  const fulfillmentProgress = useSharedValue(fulfillmentType === 'DELIVERY' ? 1 : 0);
  const fulfillmentOptionWidth = ((compactHeader ? 110 : 136) - 6) / 2;

  useEffect(() => {
    fulfillmentProgress.value = withTiming(fulfillmentType === 'DELIVERY' ? 1 : 0, {
      duration: 280,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [fulfillmentType, fulfillmentProgress]);

  const fulfillmentPillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fulfillmentProgress.value * fulfillmentOptionWidth }],
  }));
  const pickupLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fulfillmentProgress.value, [0, 1], ['#FFFFFF', '#666666']),
  }));
  const deliveryLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fulfillmentProgress.value, [0, 1], ['#666666', '#FFFFFF']),
  }));
  const { menu, loading, error, refetch } = useMenu(fulfillmentType);
  const [activeCategorySlug, setActiveCategorySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [categoryViewportWidth, setCategoryViewportWidth] = useState(0);
  const [categoryContentWidth, setCategoryContentWidth] = useState(0);
  const categoryScrollX = useSharedValue(0);
  const categoryScrollHandler = useAnimatedScrollHandler((event) => {
    categoryScrollX.value = event.contentOffset.x;
  });
  const swipeThumbWidth = Math.max(16, Math.min(80,
    categoryContentWidth > 0 ? (categoryViewportWidth / categoryContentWidth) * 80 : 80,
  ));
  const swipeThumbStyle = useAnimatedStyle(() => {
    const scrollRange = Math.max(1, categoryContentWidth - categoryViewportWidth);
    const progress = Math.max(0, Math.min(1, categoryScrollX.value / scrollRange));
    return { transform: [{ translateX: progress * (80 - swipeThumbWidth) }] };
  });
  const session = useSession();
  const router = useRouter();

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

  const selectFulfillment = useCallback((type: 'PICKUP' | 'DELIVERY') => {
    if (type === fulfillmentType) return;
    cart.setFulfillmentType(type);
    if (type === 'PICKUP') {
      cart.setDriverTipPercent('none');
    }
    setActiveCategorySlug(null);
  }, [cart, fulfillmentType]);

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
        <View style={[styles.header, compactHeader && styles.headerCompact]}>
          <Text style={styles.greeting}>{greeting}</Text>
          <View style={styles.headerRow}>
            <Text style={[styles.title, compactHeader && styles.titleCompact]} numberOfLines={1}>
              Wings4U
            </Text>
            <View
              style={[styles.fulfillmentSwitch, compactHeader && styles.fulfillmentSwitchCompact]}
              accessibilityRole="radiogroup"
              accessibilityLabel="Order type"
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.fulfillmentPill,
                  { width: fulfillmentOptionWidth },
                  fulfillmentPillStyle,
                ]}
              />
              {(['PICKUP', 'DELIVERY'] as const).map((type) => {
                const selected = fulfillmentType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={styles.fulfillmentOption}
                    activeOpacity={1}
                    onPress={() => selectFulfillment(type)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={type === 'PICKUP' ? 'Pickup' : 'Delivery'}
                  >
                    <Animated.Text
                      style={[
                        styles.fulfillmentLabel,
                        compactHeader && styles.fulfillmentLabelCompact,
                        type === 'PICKUP' ? pickupLabelStyle : deliveryLabelStyle,
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {type === 'PICKUP' ? 'Pickup' : 'Delivery'}
                    </Animated.Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.headerActions}>
              {/* Auth button */}
              {session.authenticated ? (
                <TouchableOpacity style={[styles.authAvatarBtn, compactHeader && styles.headerIconCompact]} onPress={() => router.push('/profile')}>
                  <User size={18} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.authGuestBtn, compactHeader && styles.headerIconCompact]} onPress={() => setAuthVisible(true)}>
                  <User size={20} color="#FF4D4D" />
                </TouchableOpacity>
              )}
              {/* Cart button */}
              <TouchableOpacity style={[styles.cartButton, compactHeader && styles.headerIconCompact]} onPress={() => router.push('/cart')}>
                <ShoppingBag size={24} color="#000" />
                {cart.itemCount > 0 ? (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>
                      {cart.itemCount > 9 ? '9+' : cart.itemCount}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Auth Sheet Modal */}
        <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
        <MenuItemBuilder
          visible={Boolean(selectedItem)}
          item={selectedItem}
          categories={sortedCategories}
          onClose={() => setSelectedItem(null)}
        />

        {/* Categories Strip */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Menu</Text>
          <Text style={styles.categoryCount}>
            {sortedCategories.length} categories
          </Text>
        </View>

        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(event) => setCategoryViewportWidth(event.nativeEvent.layout.width)}
          onContentSizeChange={(contentWidth) => setCategoryContentWidth(contentWidth)}
          onScroll={categoryScrollHandler}
          scrollEventThrottle={16}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categoriesContent}
        >
          {sortedCategories.map((cat) => {
            const isActive = cat.slug === resolvedActiveSlug;
            return (
              <TouchableOpacity
                key={cat.id}
                style={styles.categoryCard}
                onPress={() => handleCategoryPress(cat.slug)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={cat.name}
              >
                <View style={[styles.categoryIcon, isActive && styles.categoryIconActive]}>
                  <Text style={styles.categoryEmoji}>{emojiForCategorySlug(cat.slug)}</Text>
                </View>
                <Text
                  style={[styles.categoryText, isActive && styles.categoryTextActive]}
                  numberOfLines={2}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.ScrollView>
        {categoryContentWidth > categoryViewportWidth && categoryViewportWidth > 0 ? (
          <View style={styles.categorySwipeTrack}>
            <Animated.View
              style={[styles.categorySwipeThumb, { width: swipeThumbWidth }, swipeThumbStyle]}
            />
          </View>
        ) : null}

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
                  onPress={() => setSelectedItem(item)}
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

function MenuItemCard({
  item,
  categorySlug,
  onPress,
}: {
  item: MenuItem;
  categorySlug: string;
  onPress: () => void;
}) {
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
      onPress={onPress}
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
    gap: 6,
  },
  headerCompact: {
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
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
    flexShrink: 1,
  },
  titleCompact: {
    fontSize: 20,
  },
  fulfillmentSwitch: {
    width: 136,
    flexDirection: 'row',
    backgroundColor: '#F0F0F0',
    borderRadius: 22,
    padding: 3,
  },
  fulfillmentSwitchCompact: {
    width: 110,
  },
  fulfillmentOption: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    paddingHorizontal: 4,
  },
  fulfillmentPill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: 19,
    backgroundColor: '#FF4D4D',
  },
  fulfillmentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
  },
  fulfillmentLabelCompact: {
    fontSize: 11,
  },
  headerIconCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    top: 8,
    right: 6,
    minWidth: 18,
    height: 18,
    backgroundColor: '#FF4D4D',
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  cartBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    marginBottom: 10,
  },
  categoriesContent: {
    paddingRight: 20,
  },
  categoryCard: {
    width: 76,
    alignItems: 'center',
    marginRight: 12,
  },
  categoryIcon: {
    width: 64,
    height: 64,
    backgroundColor: '#FFF',
    borderRadius: 32,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  categoryIconActive: {
    backgroundColor: '#FF4D4D',
  },
  categoryEmoji: {
    fontSize: 24,
  },
  categoryText: {
    minHeight: 30,
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  categoryTextActive: {
    color: '#FF4D4D',
    fontWeight: '700',
  },
  categorySwipeTrack: {
    width: 80,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    alignSelf: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  categorySwipeThumb: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FF4D4D',
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
