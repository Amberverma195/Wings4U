import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
  FlatList,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import type { PromotionalBanner } from '../lib/promotional-banners';

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */
const AUTO_ADVANCE_MS = 3000;
/** Cinematic banners are ~3:1; a uniform ratio keeps every slide identical. */
const BANNER_ASPECT_RATIO = 3;
const SIDE_MARGIN = 16;
const CORNER_RADIUS = 16;

type Props = {
  banners: PromotionalBanner[];
  onPressBanner: (banner: PromotionalBanner) => void;
  /** Auto-advance cadence in ms (default 3000). */
  intervalMs?: number;
};

/**
 * Auto-scrolling promotional banner carousel for the Home screen.
 *
 * - Advances every `intervalMs`, looping forward from the last banner to the
 *   first via an appended clone slide (seamless, no backward rewind).
 * - Supports manual swipe + tappable pagination dots; the auto-advance timer
 *   resets after any manual interaction.
 * - Pauses when dragging, when the Home screen is unfocused, when the app is
 *   backgrounded, and when the OS "reduce motion" setting is enabled.
 * - Recomputes slide width from the live window width so it stays correct on
 *   any device size or orientation change.
 */
export function PromotionalCarousel({ banners, onPressBanner, intervalMs = AUTO_ADVANCE_MS }: Props) {
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const listRef = useRef<FlatList<PromotionalBanner>>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0); // raw index into `loopData` (0 .. count)
  const draggingRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0); // 0 .. count-1 (for dots)
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const count = banners.length;
  const slideWidth = width; // full-width paging; the image gets inner margins

  // Append a clone of the first banner so a forward advance past the last
  // slide lands on an identical frame, which we then silently reset to 0.
  const loopData = useMemo<PromotionalBanner[]>(
    () => (count > 1 ? [...banners, banners[0]] : banners),
    [banners, count],
  );

  const canAutoPlay = count > 1 && isFocused && appActive && !reduceMotion;

  /* --- Respect the OS reduce-motion preference ------------------------ */
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  /* --- Pause when the app is backgrounded ----------------------------- */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) =>
      setAppActive(state === 'active'),
    );
    return () => sub.remove();
  }, []);

  const stopTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const goTo = useCallback(
    (rawIndex: number, animated: boolean) => {
      listRef.current?.scrollToOffset({ offset: rawIndex * slideWidth, animated });
      indexRef.current = rawIndex;
    },
    [slideWidth],
  );

  const startTimer = useCallback(() => {
    stopTimer();
    if (!canAutoPlay) return;
    timer.current = setInterval(() => {
      if (draggingRef.current) return;
      goTo(indexRef.current + 1, true); // may land on the clone (index === count)
    }, intervalMs);
  }, [stopTimer, canAutoPlay, goTo, intervalMs]);

  /* --- Start/stop auto-advance as conditions change ------------------- */
  useEffect(() => {
    startTimer();
    return stopTimer; // cleanup on unmount / dependency change
  }, [startTimer, stopTimer]);

  /* --- Keep the offset aligned on width / orientation changes --------- */
  useEffect(() => {
    goTo(indexRef.current, false);
  }, [slideWidth, goTo]);

  const settle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      let raw = Math.round(offsetX / slideWidth);
      if (count > 1 && raw >= count) {
        // Landed on the appended clone of slide 0 -> jump back silently.
        raw = 0;
        goTo(0, false);
      } else {
        indexRef.current = raw;
      }
      setActiveIndex(count > 0 ? ((raw % count) + count) % count : 0);
    },
    [slideWidth, count, goTo],
  );

  const onScrollBeginDrag = useCallback(() => {
    draggingRef.current = true;
    stopTimer();
  }, [stopTimer]);

  const onScrollEndDrag = useCallback(() => {
    draggingRef.current = false;
    startTimer(); // reset the interval after a completed manual swipe
  }, [startTimer]);

  const handleDotPress = useCallback(
    (dotIndex: number) => {
      goTo(dotIndex, !reduceMotion);
      setActiveIndex(dotIndex);
      startTimer();
    },
    [goTo, reduceMotion, startTimer],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<PromotionalBanner> | null | undefined, index: number) => ({
      length: slideWidth,
      offset: slideWidth * index,
      index,
    }),
    [slideWidth],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PromotionalBanner>) => (
      <Pressable
        style={[styles.slide, { width: slideWidth }]}
        onPress={() => onPressBanner(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.label} promotion. Opens the ${item.label} menu.`}
      >
        <Image
          source={item.source}
          style={styles.image}
          contentFit="cover"
          contentPosition="center"
          transition={200}
          accessible={false}
        />
      </Pressable>
    ),
    [slideWidth, onPressBanner],
  );

  if (count === 0) return null;

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={loopData}
        keyExtractor={(item, index) => `${item.key}-${index}`}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialScrollIndex={0}
        onScrollToIndexFailed={() => undefined}
        onMomentumScrollEnd={settle}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        decelerationRate="fast"
        bounces={false}
      />
      {count > 1 ? (
        <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="Promotions">
          {banners.map((banner, index) => {
            const active = index === activeIndex;
            return (
              <Pressable
                key={banner.key}
                onPress={() => handleDotPress(index)}
                hitSlop={8}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${banner.label} promotion`}
                style={styles.dotHit}
              >
                <View style={[styles.dot, active ? styles.dotActive : styles.dotInactive]} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 8 },
  slide: { paddingHorizontal: SIDE_MARGIN, justifyContent: 'center' },
  image: {
    width: '100%',
    aspectRatio: BANNER_ASPECT_RATIO,
    borderRadius: CORNER_RADIUS,
    backgroundColor: '#120A08',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  dotHit: { padding: 4 },
  dot: { height: 8, borderRadius: 4 },
  dotActive: { width: 22, backgroundColor: '#FF4D4D' },
  dotInactive: { width: 8, backgroundColor: '#D9D9D9' },
});
