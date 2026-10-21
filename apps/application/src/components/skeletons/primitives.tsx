import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

const PulseContext = createContext<Animated.Value | null>(null);
export const SKELETON_CYCLE_MS = 1400;

/** One native-driven pulse per group. Unknown accessibility settings default to static. */
export function SkeletonGroup({ children, label, active = true, style, testID }: {
  children: ReactNode; label: string; active?: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const parentPulse = useContext(PulseContext);
  const [pulse] = useState(() => new Animated.Value(1));
  const [reducedMotion, setReducedMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');

  useEffect(() => {
    if (parentPulse) return;
    let mounted = true;
    let settingChanged = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      settingChanged = true;
      setReducedMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !settingChanged) setReducedMotion(value);
    }).catch(() => { /* Keep static placeholders if the setting cannot be read. */ });
    const appState = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { mounted = false; motion.remove(); appState.remove(); };
  }, [parentPulse]);

  useEffect(() => {
    if (parentPulse || reducedMotion || !foreground || !active) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.45, duration: SKELETON_CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
      Animated.timing(pulse, { toValue: 1, duration: SKELETON_CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => { animation.stop(); pulse.stopAnimation(); pulse.setValue(1); };
  }, [parentPulse, pulse, reducedMotion, foreground, active]);

  return <PulseContext.Provider value={parentPulse ?? pulse}>
    <View testID={testID} style={style} accessible accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityState={{ busy: true }}>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </View>
  </PulseContext.Provider>;
}

export type SkeletonBlockProps = {
  width?: DimensionValue; height?: DimensionValue; radius?: number; style?: StyleProp<ViewStyle>;
};

export function SkeletonBlock({ width = '100%', height = 16, radius = 8, style }: SkeletonBlockProps) {
  const pulse = useContext(PulseContext);
  return <Animated.View accessible={false} style={[styles.block, { width, height, borderRadius: radius, opacity: pulse ?? 1 }, style]} />;
}

export function SkeletonText({ lines = 1, width = '100%', lastLineWidth = '68%', lineHeight = 13, style }: {
  lines?: number; width?: DimensionValue; lastLineWidth?: DimensionValue; lineHeight?: number; style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width, gap: 7 }, style]}>{Array.from({ length: lines }, (_, index) =>
    <SkeletonBlock key={index} height={lineHeight} width={lines > 1 && index === lines - 1 ? lastLineWidth : '100%'} radius={lineHeight / 2} />)}</View>;
}

export function SkeletonCircle({ size = 40, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return <SkeletonBlock width={size} height={size} radius={size / 2} style={style} />;
}

export function SkeletonImage({ width = '100%', height, aspectRatio, style }: {
  width?: DimensionValue; height?: DimensionValue; aspectRatio?: number; style?: StyleProp<ViewStyle>;
}) {
  return <SkeletonBlock width={width} height={height ?? (aspectRatio ? undefined : 112)} radius={12}
    style={[aspectRatio ? { aspectRatio, height: undefined } : null, style]} />;
}

export function SkeletonCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#EAEAEA' },
  card: { padding: 16, gap: 14, borderRadius: 16, borderWidth: 1, borderColor: '#F0E2D9', backgroundColor: '#FFFEFC' },
});
