const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({
  ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock(), View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: value => value },
}));
const { Animated, AccessibilityInfo, AppState } = require('react-native');
const { SkeletonGroup, SkeletonBlock, SkeletonText, SkeletonCircle, SkeletonImage, SkeletonCard, SKELETON_CYCLE_MS } = require('../src/components/skeletons/primitives');
const layouts = require('../src/components/skeletons/screen-skeletons');
let renderer;
const tree = (active = true, nested = false) => React.createElement(SkeletonGroup, { label: 'Loading content', active },
  React.createElement(SkeletonCard, null,
    React.createElement(SkeletonText, { lines: 3 }), React.createElement(SkeletonCircle), React.createElement(SkeletonImage),
    ...Array.from({ length: 20 }, (_, index) => React.createElement(SkeletonBlock, { key: index })),
    nested ? React.createElement(SkeletonGroup, { label: 'Nested' }, React.createElement(SkeletonBlock)) : null));
const mount = async value => act(async () => { renderer = create(value ?? tree()); });
const motionChange = value => act(async () => AccessibilityInfo.addEventListener.mock.calls.find(([event]) => event === 'reduceMotionChanged')[1](value));
const appStateChange = value => act(async () => AppState.addEventListener.mock.calls.find(([event]) => event === 'change')[1](value));
beforeEach(() => { jest.clearAllMocks(); AppState.currentState = 'active'; AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(false); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('one native-driven pulse serves every block, text line and nested skeleton group', async () => {
  await mount(tree(true, true));
  expect(Animated.loop).toHaveBeenCalledTimes(1); expect(Animated.timing).toHaveBeenCalledTimes(2);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1); expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  const [first, second] = Animated.timing.mock.calls;
  expect(first[0]).toBe(second[0]); expect(first[1]).toMatchObject({ duration: SKELETON_CYCLE_MS / 2, useNativeDriver: true, isInteraction: false });
  const animations = renderer.root.findAllByType('AnimatedView'); expect(animations.length).toBeGreaterThan(20);
  expect(animations.every(node => node.props.style[1].opacity === first[0])).toBe(true);
});

test('ordinary rerenders do not restart a group, and unmount stops its animation and subscriptions', async () => {
  await mount(); const loop = Animated.loop.mock.results[0].value, pulse = Animated.timing.mock.calls[0][0];
  await act(async () => renderer.update(tree())); expect(Animated.loop).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount()); renderer = null;
  expect(loop.stop).toHaveBeenCalledTimes(1); expect(pulse.stopAnimation).toHaveBeenCalled(); expect(pulse.setValue).toHaveBeenLastCalledWith(1);
  expect(AccessibilityInfo.addEventListener.mock.results[0].value.remove).toHaveBeenCalled(); expect(AppState.addEventListener.mock.results[0].value.remove).toHaveBeenCalled();
});

test('reduced motion keeps static placeholders and changing the setting stops/resumes the pulse', async () => {
  AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true); await mount(); expect(Animated.loop).not.toHaveBeenCalled();
  await motionChange(false); const loop = Animated.loop.mock.results[0].value; expect(loop.start).toHaveBeenCalled();
  await motionChange(true); expect(loop.stop).toHaveBeenCalled();
});

test('background and tab blur pause animation, with no animation until returning active', async () => {
  await mount(); const first = Animated.loop.mock.results[0].value;
  await appStateChange('background'); expect(first.stop).toHaveBeenCalled();
  await act(async () => renderer.update(tree(false))); await appStateChange('active'); expect(Animated.loop).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(tree(true))); expect(Animated.loop).toHaveBeenCalledTimes(2);
});

test('late motion queries cannot override a newer setting or restart after unmount', async () => {
  let resolve; AccessibilityInfo.isReduceMotionEnabled.mockReturnValue(new Promise(r => { resolve = r; })); await mount();
  expect(Animated.loop).not.toHaveBeenCalled(); await motionChange(true); await act(async () => resolve(false)); expect(Animated.loop).not.toHaveBeenCalled();
  await act(async () => renderer.unmount()); renderer = null;
});

test('an accessibility query resolving after unmount cannot start an animation', async () => {
  let resolve; AccessibilityInfo.isReduceMotionEnabled.mockReturnValue(new Promise(r => { resolve = r; }));
  await mount(); await act(async () => renderer.unmount()); renderer = null;
  await act(async () => resolve(false)); expect(Animated.loop).not.toHaveBeenCalled();
});

test('a failed accessibility query and a background initial state do not animate', async () => {
  AccessibilityInfo.isReduceMotionEnabled.mockRejectedValueOnce(new Error('Unavailable')); await mount(); expect(Animated.loop).not.toHaveBeenCalled();
  await act(async () => renderer.unmount()); renderer = null; AppState.currentState = 'background'; AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(false);
  await mount(); expect(Animated.loop).not.toHaveBeenCalled();
});

test('placeholders are decorative, non-interactive and announced as a single busy group', async () => {
  await mount(); const groups = renderer.root.findAllByProps({ accessibilityRole: 'progressbar' }); expect(groups).toHaveLength(1);
  expect(groups[0].props.accessibilityState).toEqual({ busy: true });
  expect(renderer.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ pointerEvents: 'none' })).toHaveLength(1);
  expect(renderer.root.findAll(node => ['button', 'textbox', 'link'].includes(node.props.accessibilityRole))).toHaveLength(0);
});

test.each([
  ['HomeSkeleton', 'home-skeleton'], ['MenuSkeleton', 'menu-skeleton'], ['CartSkeleton', 'cart-skeleton'],
  ['OrderDetailSkeleton', 'order-detail-skeleton'], ['OrdersPaginationSkeleton', 'orders-pagination-skeleton'],
])('%s renders its distinct layout without fake record text', async (name, testID) => {
  await mount(React.createElement(layouts[name])); expect(renderer.root.findAllByType('View').filter(node => node.props.testID === testID)).toHaveLength(1);
  expect(renderer.root.findAllByType('Text')).toHaveLength(0);
});

test.each(['overview', 'profile', 'orders', 'addresses', 'support'])('Profile %s has its own section layout', async section => {
  await mount(React.createElement(layouts.ProfileSectionSkeleton, { section }));
  expect(renderer.root.findAllByType('View').filter(node => node.props.testID === `profile-${section}-skeleton`)).toHaveLength(1);
  expect(renderer.root.findAllByType('Text')).toHaveLength(0);
});
