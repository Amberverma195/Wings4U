import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AlertCircle, CarFront, Bike, Search, SlidersHorizontal, X, Check } from 'lucide-react-native';
import { useMenu } from '../hooks/use-menu';
import { useCart } from '../context/cart';
import { useOrderSetup } from '../context/order-setup';
import { OrderSetupSummary } from '../components/order-setup-summary';
import { HomeSkeleton, MenuSkeleton } from '../components/skeletons/screen-skeletons';
import { TabHeader } from '../components/tab-header';
import { MenuItemBuilder } from '../components/menu-item-builder';
import { WingsBuilderMobile } from '../components/mobile-wings-builder';
import { ComboBuilderMobile } from '../components/mobile-combo-builder';
import { isWingBuilderItem, isComboBuilderItem } from '../lib/wing-builder-logic';
import { PromotionalCarousel } from '../components/promotional-carousel';
import { PopularItems } from '../components/popular-items';
import { TrendingFlavours } from '../components/trending-flavours';
import type { CartItem, MenuItem } from '../lib/types';
import { needsCustomization } from '../lib/popular-items';
import { filterMenuCategories } from '../lib/menu-search';
import { categoryImage, categoryImageForSlug, categoryLabel } from '../lib/category-images';
import { prepareMenuCategories, menuCardDetails, categoryNote, resolveCategorySlug } from '../lib/menu-display';
import type { PromotionalBanner } from '../lib/promotional-banners';
import { FOOTER_PROMOTIONAL_BANNERS, resolveFooterPromotion } from '../lib/footer-promotional-banners';

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


/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MenuScreen({ cinematic = false }: { cinematic?: boolean }) {
  const focused = useIsFocused();
  const router = useRouter();
  // Deep-link params set by the Home promo carousel (e.g. ?category=wings&ts=...).
  const params = useLocalSearchParams<{ category?: string; ts?: string; itemSlug?: string; promotion?: string; query?: string; editKey?: string }>();
  const footerReloadKey = !cinematic && (params.promotion === 'footer' || params.promotion === 'reward' || typeof params.editKey === 'string') && typeof params.ts === 'string' ? params.ts : undefined;
  const handledCartEdit = useRef<string | null>(null);
  const handledFooterRequest = useRef<string | null>(null);
  const footerNavigationNonce = useRef(0);
  const categoryNavigationNonce = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const productSectionY = useRef(0);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compactHeader = width < 380;
  const brandFontSize = Math.min(compactHeader ? 30 : 34,
    (width - (compactHeader ? 32 + 172 : 40 + 184) - 6) / 4.8);
  const categoryTileSize = cinematic ? 50 : Math.max(52, Math.min(60, (width - 32) / 6 - 3));
  const headerHeight = Math.max(156, Math.min(width * 0.39, 196)) + insets.top;
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(headerHeight);
  const [headerScrolledAway, setHeaderScrolledAway] = useState(false);
  const cart = useCart();
  const orderSetup = useOrderSetup();
  const fulfillmentType = cart.fulfillmentType;
  const fulfillmentProgress = useSharedValue(fulfillmentType === 'DELIVERY' ? 1 : 0);
  const fulfillmentSwitchWidth = cinematic ? (compactHeader ? 172 : 184) : Math.min(208, width - 32);
  const fulfillmentOptionWidth = (fulfillmentSwitchWidth - 6) / 2;

  useEffect(() => {
    fulfillmentProgress.value = withTiming(fulfillmentType === 'DELIVERY' ? 1 : 0, {
      duration: 460,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [fulfillmentType, fulfillmentProgress]);

  const fulfillmentPillStyle = useAnimatedStyle(() => {
    const lift = Math.sin(fulfillmentProgress.value * Math.PI);
    return {
      transform: [
        { translateX: fulfillmentProgress.value * fulfillmentOptionWidth },
        { translateY: -2 * lift },
        { rotate: `${-4 * lift}deg` },
        { scaleX: 1 - 0.05 * lift },
        { scaleY: 1 + 0.05 * lift },
      ],
    };
  });
  const fulfillmentIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fulfillmentProgress.value * 360}deg` }],
  }));
  const pickupLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fulfillmentProgress.value, [0, 1], ['#FFFFFF', '#666666']),
  }));
  const deliveryLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fulfillmentProgress.value, [0, 1], ['#666666', '#FFFFFF']),
  }));
  const { menu, loading, error, refetch, loadedReloadKey } = useMenu(
    fulfillmentType, cart.locationId, cart.scheduledFor, footerReloadKey,
  );
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) refetch();
    wasFocused.current = focused;
  }, [focused, refetch]);
  const [activeCategorySlug, setActiveCategorySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [rewardWeightId, setRewardWeightId] = useState<string | null>(null);
  const handledRewardRequest = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);

  const sortedCategories = useMemo(() => {
    if (!menu) return [];
    return prepareMenuCategories(menu.categories);
  }, [menu]);

  useEffect(() => {
    if (loading || !menu) return;
    setSelectedItem(previous => previous ? menu.categories.flatMap(category => category.items).find(item => item.id === previous.id) ?? null : null);
  }, [menu, loading]);

  useEffect(() => {
    if (cinematic || !focused || !params.editKey || loading || !menu || loadedReloadKey !== footerReloadKey) return;
    const request = `${params.editKey}:${params.ts ?? ''}`;
    if (handledCartEdit.current === request) return;
    handledCartEdit.current = request;
    const line = cart.items.find(candidate => candidate.key === params.editKey);
    if (!line) return;
    const item = menu.categories.flatMap(category => category.items).find(candidate => candidate.id === line.menu_item_id ||
      [...(candidate.weight_options ?? []), ...(candidate.combo_options ?? [])].some(option => option.menu_item_id === line.menu_item_id));
    if (!item) { Alert.alert('Item no longer available', 'This item cannot be edited. You can remove it from your cart and choose another item.'); return; }
    setRewardWeightId(null);
    setEditingCartItem(line);
    setSelectedItem(item);
  }, [cinematic, focused, params.editKey, params.ts, loading, menu, loadedReloadKey, footerReloadKey, cart.items]);

  /* The "active" category: either user-tapped or the first one once loaded. */
  const resolvedActiveSlug = sortedCategories.some(category => category.slug === activeCategorySlug)
    ? activeCategorySlug : sortedCategories[0]?.slug ?? null;

  const activeCategory = useMemo(
    () => sortedCategories.find((c) => c.slug === resolvedActiveSlug) ?? null,
    [sortedCategories, resolvedActiveSlug],
  );
  const displayedCategories = useMemo(() => filterMenuCategories(
    searchQuery.trim() ? sortedCategories : activeCategory ? [activeCategory] : [],
    searchQuery,
    availableOnly,
  ), [sortedCategories, activeCategory, searchQuery, availableOnly]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch();
    // The loading state from the hook will reset refreshing
    setTimeout(() => setRefreshing(false), 1500);
  }, [refetch]);

  const handleCategoryPress = useCallback((slug: string) => {
    if (cinematic) {
      router.navigate({ pathname: '/(tabs)/menu', params: {
        category: slug, promotion: 'category', itemSlug: '',
        ts: `${Date.now()}-${++categoryNavigationNonce.current}`,
      } });
      return;
    }
    setActiveCategorySlug(slug);
    setSearchQuery('');
  }, [cinematic, router]);

  const handleFooterBannerPress = useCallback((banner: PromotionalBanner) => {
    router.navigate({ pathname: '/(tabs)/menu', params: {
      category: banner.categorySlug, itemSlug: banner.itemSlug ?? '',
      promotion: 'footer', ts: `${Date.now()}-${++footerNavigationNonce.current}`,
    } });
  }, [router]);

  /* Apply an incoming category deep-link once the menu has loaded. Depending
     on `sortedCategories` means a param set before the menu is ready is
     retried automatically once data arrives (no race condition). Unknown
     categories resolve to null and are ignored. */
  const categoryParam = typeof params.category === 'string' ? params.category : undefined;
  const categoryParamTs = typeof params.ts === 'string' ? params.ts : undefined;
  useEffect(() => {
    if (params.promotion === 'footer' || params.promotion === 'reward') return;
    if (!categoryParam || sortedCategories.length === 0) return;
    const resolved = resolveCategorySlug(categoryParam, sortedCategories);
    if (!resolved) return;
    setActiveCategorySlug(resolved);
    setSearchQuery('');
    setAvailableOnly(false);
    setSelectedItem(null);
    requestAnimationFrame(() => {
      if (productSectionY.current > 0) {
        scrollRef.current?.scrollTo({ y: productSectionY.current, animated: true });
      }
    });
  }, [categoryParam, categoryParamTs, sortedCategories, params.promotion]);

  useEffect(() => {
    if (cinematic || !focused || params.promotion !== 'reward' || !footerReloadKey || loading || !menu ||
      loadedReloadKey !== footerReloadKey || handledRewardRequest.current === footerReloadKey) return;
    handledRewardRequest.current = footerReloadKey;
    const category = menu.categories.find(category => category.items.some(item => item.builder_type === 'WINGS' &&
      (item.slug === 'wings-1lb' || item.slug === 'wings-by-the-pound')));
    const item = category?.items.find(item => item.slug === 'wings-1lb') ?? category?.items.find(item => item.slug === 'wings-by-the-pound');
    const option = item?.weight_options?.find(option => option.weight_lb === 1);
    if (!item || !item.is_available || item.stock_status === 'UNAVAILABLE' ||
      (item.allowed_fulfillment_type !== 'BOTH' && item.allowed_fulfillment_type !== fulfillmentType) ||
      (item.slug !== 'wings-1lb' && !option)) {
      Alert.alert('Item unavailable', '1lb individual wings are not available for this order time or type. Please check the menu.'); return;
    }
    setEditingCartItem(null); setRewardWeightId(option?.menu_item_id ?? item.id);
    setActiveCategorySlug(category!.slug); setSearchQuery(''); setAvailableOnly(false); setSelectedItem(item);
  }, [cinematic, focused, params.promotion, footerReloadKey, loading, menu, loadedReloadKey, fulfillmentType]);

  useEffect(() => {
    if (cinematic || params.promotion !== 'search' || typeof params.query !== 'string') return;
    setSearchQuery(params.query);
    setAvailableOnly(false);
    setSelectedItem(null);
  }, [cinematic, params.promotion, params.query, categoryParamTs]);

  useEffect(() => {
    if (cinematic || params.promotion !== 'footer' || !focused || !footerReloadKey || loading || error || !menu ||
      loadedReloadKey !== footerReloadKey || handledFooterRequest.current === footerReloadKey) return;
    handledFooterRequest.current = footerReloadKey;
    setRewardWeightId(null);
    setSelectedItem(null);
    const target = resolveFooterPromotion(menu.categories, categoryParam ?? '',
      typeof params.itemSlug === 'string' ? params.itemSlug : undefined, fulfillmentType);
    if (!target) {
      Alert.alert('Promotion unavailable', 'This special is not available for your selected order time or order type. Please check the menu for current availability.');
      return;
    }
    setActiveCategorySlug(target.category.slug);
    setSearchQuery('');
    setAvailableOnly(false);
    if (target.item) setSelectedItem(target.item);
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: productSectionY.current, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [cinematic, params.promotion, focused, footerReloadKey, loading, error, menu, loadedReloadKey,
    categoryParam, params.itemSlug, fulfillmentType]);

  const selectFulfillment = useCallback((type: 'PICKUP' | 'DELIVERY') => {
    orderSetup.openOrderSetup(type);
  }, [orderSetup.openOrderSetup]);

  const choosePopularItem = (item: MenuItem, line: CartItem | null) => {
    setRewardWeightId(null);
    if (line || needsCustomization(item)) {
      setEditingCartItem(line);
      setSelectedItem(item);
    } else {
      cart.addItem({ menu_item_id: item.id, menu_item_slug: item.slug, name: item.name,
        image_url: item.image_url, base_price_cents: item.base_price_cents, quantity: 1,
        modifier_selections: [], removed_ingredients: [], special_instructions: '' });
    }
  };

  const menuHeader = (
    <View style={[styles.header, !cinematic && styles.compactHeader, !cinematic && styles.menuHeader, cinematic && { minHeight: headerHeight }]}
          onLayout={({ nativeEvent }) => setMeasuredHeaderHeight(nativeEvent.layout.height)}>
          {cinematic && <View
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Image
              source={require('../../assets/head-banner.png')}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              contentPosition="right center"
              accessible={false}
            />
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="headerShade" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor="#000" stopOpacity={0.55} />
                  <Stop offset="55%" stopColor="#000" stopOpacity={0.3} />
                  <Stop offset="100%" stopColor="#000" stopOpacity={0.12} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#headerShade)" />
            </Svg>
          </View>}
          <View style={[
            styles.headerContent,
            cinematic && styles.homeHeaderContent,
            !cinematic && styles.menuHeaderContent,
            {
              paddingTop: cinematic ? insets.top + 12 : 12,
              paddingLeft: Math.max(compactHeader ? 16 : 20, insets.left),
              paddingRight: Math.max(compactHeader ? 16 : 20, insets.right),
            },
          ]}>
            <View style={[styles.headerRow, !cinematic && styles.menuHeaderRow]}>
              {cinematic && <View style={styles.branding}>
                <View style={styles.wordmark} accessible accessibilityRole="header" accessibilityLabel="Wings4U">
                  <Text style={[styles.title, { fontSize: brandFontSize }]} accessible={false}>W</Text>
                  <View>
                    <Text style={[styles.title, { fontSize: brandFontSize }]} accessible={false}>{'\u0131'}</Text>
                    <View style={[styles.brandDot, {
                      width: brandFontSize * 0.15, height: brandFontSize * 0.15,
                      top: brandFontSize * 0.2,
                    }]} />
                  </View>
                  <Text style={[styles.title, { fontSize: brandFontSize }]} accessible={false}>ngs4U</Text>
                </View>
                <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit>
                  WINGS · BURGERS · TENDERS · MORE
                </Text>
              </View>}
            <View
              style={[styles.fulfillmentSwitch, compactHeader && styles.fulfillmentSwitchCompact, !cinematic && styles.menuFulfillmentSwitch, { width: fulfillmentSwitchWidth }]}
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
                const FulfillmentIcon = type === 'PICKUP' ? CarFront : Bike;
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
                    <Animated.View style={fulfillmentIconStyle} pointerEvents="none" accessible={false}
                      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <FulfillmentIcon size={14}
                        color={selected ? '#FFF' : '#666'} strokeWidth={2} />
                    </Animated.View>
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
            </View>
            {!cinematic ? <View style={styles.menuOrderSummary}><OrderSetupSummary /></View> : <OrderSetupSummary light />}
          </View>
          {/* Search and menu filters */}
          <View style={[styles.searchSection, !cinematic && styles.menuSearchSection]}>
            <View style={styles.searchRow}>
              <View style={[styles.searchField, !cinematic && styles.menuSearchField]}>
                <Search size={18} color="#555" />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search wings, combos, burgers, tenders..."
                  placeholderTextColor="#888"
                  accessibilityLabel="Search menu"
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (cinematic && searchQuery.trim()) router.navigate({ pathname: '/(tabs)/menu', params: {
                      query: searchQuery.trim(), category: '', promotion: 'search', itemSlug: '',
                      ts: `${Date.now()}-${++categoryNavigationNonce.current}`,
                    } });
                  }}
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && <TouchableOpacity
                  onPress={() => setSearchQuery('')} accessibilityRole="button"
                  accessibilityLabel="Clear search" style={styles.clearSearch}>
                  <X size={16} color="#666" />
                </TouchableOpacity>}
              </View>
              <TouchableOpacity
                style={[styles.filterButton, !cinematic && styles.menuFilterButton, availableOnly && styles.filterButtonActive]}
                onPress={() => setFiltersVisible(value => !value)}
                accessibilityRole="button"
                accessibilityLabel="Menu filters"
                accessibilityState={{ expanded: filtersVisible }}
              >
                <SlidersHorizontal size={20} color={availableOnly ? '#FFF' : '#333'} />
              </TouchableOpacity>
            </View>
            {filtersVisible && <View style={styles.filtersPanel}>
              <Text style={[styles.filterLabel, !cinematic && styles.filterLabelDark]}>Show</Text>
              <TouchableOpacity
                style={[styles.filterChip, availableOnly && styles.filterChipActive]}
                onPress={() => setAvailableOnly(value => !value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: availableOnly }}
                accessibilityLabel="Available items only"
              >
                {availableOnly && <Check size={14} color="#FF4D4D" />}
                <Text style={styles.filterChipText}>Available now</Text>
              </TouchableOpacity>
            </View>}
          </View>
        </View>
  );

  /* ---------------------------------------------------------------- */
  /*  Loading state                                                    */
  /* ---------------------------------------------------------------- */
  if (loading && !menu) {
    return <SafeAreaView style={[styles.container, !cinematic && styles.menuContainer]} edges={['left', 'right']}>
      {focused && <StatusBar style={cinematic && !headerScrolledAway ? 'light' : 'dark'} />}
      {!cinematic && <TabHeader title="Menu" />}
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="never" scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => { if (cinematic) setHeaderScrolledAway(nativeEvent.contentOffset.y >= measuredHeaderHeight - insets.top); }}>
        {menuHeader}
        {cinematic ? <HomeSkeleton active={focused} /> : <MenuSkeleton active={focused} />}
        {cinematic ? <TrendingFlavours /> : null}
        {cinematic ? <PromotionalCarousel banners={FOOTER_PROMOTIONAL_BANNERS}
          onPressBanner={handleFooterBannerPress} imageBackgroundColor="#FFFFFF" /> : null}
      </ScrollView>
    </SafeAreaView>;
  }

  /* ---------------------------------------------------------------- */
  /*  Error state                                                      */
  /* ---------------------------------------------------------------- */
  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <TabHeader title={cinematic ? 'Wings4U' : 'Menu'} />
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
    <SafeAreaView style={[styles.container, !cinematic && styles.menuContainer]} edges={['left', 'right']}>
      {focused && <StatusBar style={cinematic && !headerScrolledAway ? 'light' : 'dark'} />}
      {!cinematic && <TabHeader title="Menu" />}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="never"
        onScroll={({ nativeEvent }) => {
          if (cinematic) setHeaderScrolledAway(nativeEvent.contentOffset.y >= measuredHeaderHeight - insets.top);
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF4D4D" />
        }
      >
        {menuHeader}

        {selectedItem && isWingBuilderItem(selectedItem) ? (
          <WingsBuilderMobile
            key={`${selectedItem.id}:${editingCartItem?.key ?? 'new'}:${rewardWeightId ?? ''}`}
            visible={Boolean(selectedItem)}
            item={selectedItem}
            editingLine={editingCartItem}
            initialWeightId={rewardWeightId}
            saladMenuItems={menu?.categories?.find((c) => c.slug === 'salads')?.items ?? []}
            onClose={() => { setSelectedItem(null); setEditingCartItem(null); setRewardWeightId(null); }}
          />
        ) : selectedItem && isComboBuilderItem(selectedItem) ? (
          <ComboBuilderMobile
            visible={Boolean(selectedItem)}
            item={selectedItem}
            editingLine={editingCartItem}
            onClose={() => { setSelectedItem(null); setEditingCartItem(null); }}
          />
        ) : (
          <MenuItemBuilder
            visible={Boolean(selectedItem)}
            item={selectedItem}
            categories={menu?.categories ?? []}
            editItem={editingCartItem}
            onClose={() => { setSelectedItem(null); setEditingCartItem(null); }}
          />
        )}

        {/* Categories Strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(event) => {
            productSectionY.current = event.nativeEvent.layout.y;
          }}
          style={[styles.categoriesScroll, cinematic && styles.homeCategoriesScroll, !cinematic && styles.menuCategoriesScroll]}
          contentContainerStyle={styles.categoriesContent}
        >
          {sortedCategories.map((cat) => {
            const isActive = cat.slug === resolvedActiveSlug;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryCard, !cinematic && styles.menuCategoryCard, { width: categoryTileSize }]}
                onPress={() => handleCategoryPress(cat.slug)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={cat.name}
              >
                <View style={[
                  styles.categoryIcon,
                  cinematic && styles.homeCategoryIcon,
                  !cinematic && styles.menuCategoryIcon,
                  { width: categoryTileSize, height: categoryTileSize },
                  isActive && styles.categoryIconActive,
                  !cinematic && isActive && styles.menuCategoryIconActive,
                ]}>
                  <Image source={categoryImage(cat)} style={styles.categoryPhoto}
                    contentFit="contain" accessible={false} />
                </View>
                <Text
                  style={[styles.categoryText, cinematic && styles.homeCategoryText, !cinematic && styles.menuCategoryText, isActive && styles.categoryTextActive]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {categoryLabel(cat)}
                </Text>
                <View style={[styles.categoryUnderline, cinematic && styles.homeCategoryUnderline, !cinematic && styles.menuCategoryUnderline, isActive && styles.categoryUnderlineActive]} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Active Category Items */}
        {!cinematic && displayedCategories.map(activeCategory => (
          <React.Fragment key={activeCategory.id}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeadingCopy}><Text style={styles.sectionKicker}>MENU</Text><Text style={styles.sectionTitle}>{activeCategory.name}</Text></View>
              <Text style={styles.itemCount}>
                {activeCategory.items.length} item{activeCategory.items.length !== 1 ? 's' : ''}
              </Text>
            </View>
            {categoryNote(activeCategory.slug) ? (
              <Text style={styles.categoryNote}>{categoryNote(activeCategory.slug)}</Text>
            ) : null}

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
              <View style={styles.itemGrid}>
                {activeCategory.items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    categorySlug={activeCategory.slug}
                    onPress={() => setSelectedItem(item)}
                  />
                ))}
              </View>
            )}
          </React.Fragment>
        ))}
        {!cinematic && displayedCategories.length === 0 && (searchQuery.trim() || availableOnly) ? (
          <View style={styles.emptyCategory}>
            <Text style={styles.emptyCategoryText}>No items match your search or filters.</Text>
          </View>
        ) : null}

        {cinematic ? <PopularItems categories={menu?.categories ?? []} cartItems={cart.items} fulfillmentType={fulfillmentType}
          updating={loading || Boolean(error)} onChoose={choosePopularItem}
          onSeeAll={() => router.navigate({ pathname: '/(tabs)/menu', params: {
            category: '', promotion: 'category', itemSlug: '', ts: `${Date.now()}-${++categoryNavigationNonce.current}`,
          } })} /> : null}
        {cinematic ? <TrendingFlavours /> : null}

        {/* Final scroll section: separate instance, Home only, above the fixed tab bar. */}
        {cinematic ? <PromotionalCarousel banners={FOOTER_PROMOTIONAL_BANNERS}
          onPressBanner={handleFooterBannerPress} imageBackgroundColor="#FFFFFF" /> : null}
        <View style={{ height: cinematic ? 8 : 40 }} />
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
  const cart = useCart();
  const cartItemIds = new Set([item.id, ...(item.weight_options ?? []).map(option => option.menu_item_id),
    ...(item.combo_options ?? []).map(option => option.menu_item_id)]);
  const cartLines = cart.items.filter(line => cartItemIds.has(line.menu_item_id));
  const quantityInCart = cartLines.reduce((total, line) => total + line.quantity, 0);
  const lastLine = cartLines[cartLines.length - 1];
  const hasStartingPrice = (isWingBuilderItem(item) || isComboBuilderItem(item)) &&
    Boolean(item.weight_options?.length || item.combo_options?.length);
  const isUnavailable = item.stock_status === 'UNAVAILABLE';
  const isLowStock = item.stock_status === 'LOW_STOCK';
  const hasImage = Boolean(item.image_url);
  const details = useMemo(() => menuCardDetails(item, categorySlug), [item, categorySlug]);

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
      {/* Catalog image, with the existing local category image as the offline fallback. */}
      {hasImage ? (
        <Image
          source={{ uri: item.image_url! }}
          style={styles.itemImage}
          contentFit="cover"
          transition={300}
        />
      ) : (
        <View style={styles.itemImagePlaceholder}>
          <Image source={categoryImageForSlug(categorySlug)} style={styles.itemImage}
            contentFit="contain" accessible={false} />
        </View>
      )}

      <View style={styles.itemDetails}>
        <View style={styles.itemNameRow}>
          <Text style={styles.itemName} numberOfLines={2}>
            {details.name}
          </Text>
          {isLowStock && (
            <View style={styles.lowStockBadge}>
              <Text style={styles.lowStockText}>LOW STOCK</Text>
            </View>
          )}
        </View>

        {details.description ? (
          <Text style={styles.itemDesc} numberOfLines={2}>
            {details.description}
          </Text>
        ) : null}

        <View style={[styles.itemMeta, hasStartingPrice && styles.itemMetaStartingPrice]}>
          <View style={styles.itemPriceRow}>
          <Text style={[styles.itemPrice, hasStartingPrice && styles.itemStartingPrice, isUnavailable && styles.itemPriceUnavailable]}>
            {isUnavailable ? 'UNAVAILABLE' : priceLabel}
          </Text>
          {quantityInCart > 0 && !isUnavailable ? (
            <View style={styles.itemQuantity}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove one ${details.name}`}
                style={styles.itemQuantityButton}
                onPress={event => {
                  event.stopPropagation();
                  if (lastLine.quantity === 1) cart.removeItem(lastLine.key);
                  else cart.updateQuantity(lastLine.key, lastLine.quantity - 1);
                }}>
                <Text style={styles.itemQuantityText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.itemQuantityText}>{quantityInCart}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add one ${details.name}`}
                style={styles.itemQuantityButton}
                onPress={event => {
                  event.stopPropagation();
                  cart.updateQuantity(lastLine.key, lastLine.quantity + 1);
                }}>
                <Text style={styles.itemQuantityText}>+</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          </View>
          {quantityInCart === 0 && !isUnavailable ? (
            <View style={styles.itemAction}>
              <Text style={styles.itemActionText}>Add to cart</Text>
            </View>
          ) : null}
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
  menuContainer: { backgroundColor: '#FFF9F5' },

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
    backgroundColor: '#120A08',
    overflow: 'hidden',
  },
  compactHeader: { backgroundColor: '#FAFAFA' },
  menuHeader: { backgroundColor: '#FFF7F1', borderBottomWidth: 1, borderBottomColor: '#F0E3DA' },
  filterLabelDark: { color: '#666' },
  headerContent: {
    flex: 1,
    paddingBottom: 10,
    gap: 4,
  },
  homeHeaderContent: { gap: 10, paddingBottom: 16 },
  menuHeaderContent: { gap: 9, paddingBottom: 14 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  menuHeaderRow: { justifyContent: 'flex-start' },
  branding: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFF',
    flexShrink: 1,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
  brandDot: { position: 'absolute', alignSelf: 'center', borderRadius: 1, backgroundColor: '#FFD43B' },
  tagline: {
    fontSize: 9,
    fontWeight: '700',
    color: '#E8E0DD',
    letterSpacing: 0.5,
  },
  fulfillmentSwitch: {
    width: 184,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: '#F0F0F0',
    borderRadius: 22,
    padding: 3,
  },
  fulfillmentSwitchCompact: {
    width: 172,
  },
  menuFulfillmentSwitch: { backgroundColor: '#F4E8E1', borderWidth: 1, borderColor: '#EBD8CC' },
  fulfillmentOption: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    paddingHorizontal: 2,
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
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
  },
  fulfillmentLabelCompact: {
    fontSize: 11,
  },
  menuOrderSummary: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#F0E3DA', borderRadius: 14, paddingHorizontal: 11, shadowColor: '#533229', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.035, shadowRadius: 6, elevation: 1 },
  headerIconCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  cartButton: {
    width: 40,
    height: 40,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
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
    top: -3,
    right: -2,
    minWidth: 16,
    height: 16,
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
    gap: 10,
  },
  authAvatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 21,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  authGuestBtn: {
    width: 40,
    height: 40,
    borderRadius: 21,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Search inside the banner */
  searchSection: {
    marginHorizontal: 24,
    paddingBottom: 12,
    zIndex: 1,
  },
  menuSearchSection: { marginHorizontal: 20, paddingBottom: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  menuSearchField: { borderWidth: 1, borderColor: '#EEDFD5', shadowOpacity: 0.035, elevation: 1 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 40, fontSize: 12, color: '#222' },
  clearSearch: { minWidth: 30, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  filterButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center', elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
  },
  menuFilterButton: { borderWidth: 1, borderColor: '#EEDFD5', shadowOpacity: 0.035, elevation: 1 },
  filterButtonActive: { backgroundColor: '#FF4D4D' },
  filtersPanel: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  filterLabel: { fontSize: 13, color: '#E8E0DD' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#DDD', paddingHorizontal: 12, minHeight: 38,
    backgroundColor: '#FFF',
  },
  filterChipActive: { borderColor: '#FF4D4D', backgroundColor: '#FFF1F1' },
  filterChipText: { fontSize: 13, color: '#333' },

  /* Section headers */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 13,
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#30241F',
  },
  sectionHeadingCopy: { gap: 2 },
  sectionKicker: { color: '#E53C3C', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  itemCount: {
    color: '#876F63',
    fontWeight: '700',
    fontSize: 12,
    backgroundColor: '#F7EAE2',
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },

  /* Categories strip */
  categoriesScroll: {
    paddingLeft: 16,
    marginTop: 10,
    marginBottom: 10,
  },
  categoriesContent: {
    paddingRight: 12,
  },
  menuCategoriesScroll: { paddingLeft: 20, marginTop: 15, marginBottom: 8 },
  homeCategoriesScroll: { marginTop: 20, marginBottom: 18 },
  homeCategoryIcon: { borderRadius: 13, marginBottom: 3, padding: 2 },
  homeCategoryText: { fontSize: 10 },
  homeCategoryUnderline: { marginTop: 2 },
  categoryCard: {
    alignItems: 'center',
    marginRight: 4,
  },
  menuCategoryCard: { marginRight: 8 },
  categoryIcon: {
    backgroundColor: '#F2F2F2',
    borderRadius: 14,
    marginBottom: 5,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryIconActive: {
    backgroundColor: '#FF4D4D',
  },
  menuCategoryIcon: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#EEDFD5', borderRadius: 18, padding: 5, marginBottom: 6, shadowColor: '#533229', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 5, elevation: 1 },
  menuCategoryIconActive: { backgroundColor: '#FFF0EA', borderColor: '#E53C3C' },
  categoryPhoto: {
    width: '100%',
    height: '100%',
  },
  categoryText: {
    minHeight: 26,
    lineHeight: 13,
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 1,
  },
  categoryTextActive: {
    color: '#FF4D4D',
    fontWeight: '700',
  },
  menuCategoryText: { minHeight: 28, color: '#6F5A4F', fontSize: 10, lineHeight: 14, fontWeight: '700' },
  categoryUnderline: {
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
    marginTop: 4,
  },
  categoryUnderlineActive: { backgroundColor: '#FF4D4D' },
  menuCategoryUnderline: { width: 28, height: 3, marginTop: 5 },
  categoryNote: {
    marginHorizontal: 20,
    marginBottom: 12,
    color: '#777',
    fontSize: 12,
    lineHeight: 17,
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
  itemGrid: {
    marginHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  itemCard: {
    width: '48%',
    minHeight: 250,
    backgroundColor: '#FFFEFC',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F0E2D9',
    shadowColor: '#533229',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.045,
    shadowRadius: 8,
    elevation: 2,
  },
  itemCardUnavailable: {
    opacity: 0.5,
  },
  itemImage: {
    width: '100%',
    height: 112,
    borderRadius: 12,
    backgroundColor: '#F8EEE8',
  },
  itemImagePlaceholder: {
    width: '100%',
    height: 112,
    backgroundColor: '#F8EEE8',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemPlaceholderEmoji: {
    fontSize: 36,
  },
  itemDetails: {
    flex: 1,
    marginTop: 8,
    justifyContent: 'space-between',
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#30241F',
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
    color: '#806F66',
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  itemMetaStartingPrice: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  itemPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  itemStartingPrice: { fontSize: 15 },
  itemQuantity: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  itemQuantityButton: { minWidth: 24, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#FFF0ED' },
  itemQuantityText: { fontSize: 13, fontWeight: '800', color: '#E53C3C' },
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
  itemAction: { backgroundColor: '#E53C3C', borderRadius: 10, paddingHorizontal: 9, minHeight: 30, justifyContent: 'center', alignItems: 'center' },
  itemActionText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  itemPrice: {
    fontSize: 17,
    fontWeight: '800',
    color: '#E53C3C',
  },
  itemPriceUnavailable: {
    fontSize: 11,
    color: '#999',
  },


});
