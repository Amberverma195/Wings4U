const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockLists = [];
const mockAppListeners = new Set();
const mockMotionListeners = new Set();
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native', () => {
  const React = require('react');
  return {
    View: 'View', Pressable: 'Pressable', StyleSheet: { create: styles => styles },
    useWindowDimensions: () => ({ width: 390 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(async () => false),
      addEventListener: (_, fn) => { mockMotionListeners.add(fn); return { remove: () => mockMotionListeners.delete(fn) }; },
    },
    AppState: { currentState: 'active', addEventListener: (_, fn) => {
      mockAppListeners.add(fn); return { remove: () => mockAppListeners.delete(fn) };
    } },
    FlatList: React.forwardRef((props, ref) => {
      const handle = React.useMemo(() => {
        const value = { scrollToOffset: jest.fn() }; mockLists.push(value); return value;
      }, []);
      React.useImperativeHandle(ref, () => handle, [handle]);
      return React.createElement('FlatList', props);
    }),
  };
});
const { AccessibilityInfo } = require('react-native');
const { PromotionalCarousel } = require('../src/components/promotional-carousel');
const banners = Array.from({ length: 7 }, (_, i) => ({ key: `poster-${i}`, label: `Poster ${i + 1}`,
  source: i + 1, categorySlug: 'lunch-specials', contentFit: 'contain' }));
let renderer;
const onPressBanner = jest.fn();
const props = () => ({ banners, onPressBanner, imageBackgroundColor: '#FFFFFF' });
const mount = async children => act(async () => { renderer = create(children ?? React.createElement(PromotionalCarousel, props())); });
const list = () => renderer.root.findByType('FlatList');
const event = index => ({ nativeEvent: { contentOffset: { x: index * 390 } } });
const advance = async ms => act(async () => jest.advanceTimersByTime(ms));
const dots = () => renderer.root.findAllByProps({ accessibilityRole: 'tab' });
const selected = () => dots().findIndex(dot => dot.props.accessibilityState.selected);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  jest.clearAllMocks(); mockFocused = true; mockLists = [];
  mockAppListeners.clear(); mockMotionListeners.clear();
  AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(false);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });

test('renders seven posters in order, a loop clone, contain scaling and seven tappable indicators', async () => {
  await mount();
  expect(list().props.data.map(banner => banner.key)).toEqual([...banners.map(banner => banner.key), banners[0].key]);
  expect(dots()).toHaveLength(7);
  for (const banner of banners) {
    const slide = list().props.renderItem({ item: banner });
    expect(slide.props.children.props.contentFit).toBe('contain');
    expect(slide.props.children.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ aspectRatio: 3 })]));
    slide.props.onPress();
    expect(onPressBanner).toHaveBeenLastCalledWith(banner);
  }
});

test('advances every 3 seconds and loops forward through the clone back to poster one', async () => {
  await mount(); mockLists[0].scrollToOffset.mockClear();
  await advance(2999);
  expect(mockLists[0].scrollToOffset).not.toHaveBeenCalled();
  await advance(1);
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 390, animated: true });
  expect(selected()).toBe(1);
  await act(async () => list().props.onMomentumScrollEnd(event(1)));
  for (let i = 2; i <= 7; i++) {
    await advance(3000);
    expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: i * 390, animated: true });
    await act(async () => list().props.onMomentumScrollEnd(event(i)));
  }
  expect(selected()).toBe(0);
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  expect(jest.getTimerCount()).toBe(1);
});

test('never scrolls past the clone even when a platform skips programmatic momentum events', async () => {
  await mount(); await advance(3000 * 10);
  expect(mockLists[0].scrollToOffset.mock.calls.every(([call]) => call.offset <= 7 * 390)).toBe(true);
});

test('manual dragging pauses autoplay and a swipe without momentum updates dots and restarts the timer', async () => {
  await mount();
  await advance(2500);
  await act(async () => list().props.onScrollBeginDrag());
  mockLists[0].scrollToOffset.mockClear();
  await advance(9000);
  expect(mockLists[0].scrollToOffset).not.toHaveBeenCalled();
  await act(async () => list().props.onScrollEndDrag(event(3)));
  expect(selected()).toBe(3);
  await advance(2999);
  expect(mockLists[0].scrollToOffset).not.toHaveBeenCalled();
  await advance(1);
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 4 * 390, animated: true });
});

test('dot selection updates the slide and resets the timer', async () => {
  await mount(); await advance(2500);
  await act(async () => dots()[5].props.onPress());
  expect(selected()).toBe(5);
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 5 * 390, animated: true });
  mockLists[0].scrollToOffset.mockClear();
  await advance(2999);
  expect(mockLists[0].scrollToOffset).not.toHaveBeenCalled();
  await advance(1);
  expect(selected()).toBe(6);
});

test('focus loss and backgrounding pause autoplay, resuming with a fresh interval', async () => {
  await mount();
  mockFocused = false;
  await act(async () => renderer.update(React.createElement(PromotionalCarousel, props())));
  expect(jest.getTimerCount()).toBe(0);
  mockFocused = true;
  await act(async () => renderer.update(React.createElement(PromotionalCarousel, props())));
  await act(async () => mockAppListeners.forEach(fn => fn('background')));
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => mockAppListeners.forEach(fn => fn('active')));
  expect(jest.getTimerCount()).toBe(1);
});

test('reduced motion disables autoplay and dot animations; timers and listeners clean up', async () => {
  AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true);
  await mount();
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => dots()[2].props.onPress());
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 2 * 390, animated: false });
  await act(async () => mockMotionListeners.forEach(fn => fn(false)));
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => renderer.unmount()); renderer = null;
  expect(jest.getTimerCount()).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  expect(mockMotionListeners.size).toBe(0);
});

test('top and bottom carousels keep independent indices and timers', async () => {
  await mount(React.createElement(React.Fragment, null,
    React.createElement(PromotionalCarousel, { banners: banners.slice(0, 4), onPressBanner }),
    React.createElement(PromotionalCarousel, props())));
  expect(jest.getTimerCount()).toBe(2);
  await advance(2000);
  await act(async () => dots()[2].props.onPress());
  mockLists.forEach(handle => handle.scrollToOffset.mockClear());
  await advance(1000);
  expect(mockLists[0].scrollToOffset).not.toHaveBeenCalled();
  expect(mockLists[1].scrollToOffset).toHaveBeenLastCalledWith({ offset: 390, animated: true });
});

test('parent width changes preserve the current slide inside safe-area content', async () => {
  await mount();
  await act(async () => dots()[2].props.onPress());
  await act(async () => renderer.root.findAllByType('View')[0].props.onLayout({ nativeEvent: { layout: { width: 350 } } }));
  expect(mockLists[0].scrollToOffset).toHaveBeenLastCalledWith({ offset: 700, animated: false });
  expect(list().props.getItemLayout(null, 1).length).toBe(350);
});

test('an initial preference lookup cannot override a newer reduced-motion change', async () => {
  let resolve;
  AccessibilityInfo.isReduceMotionEnabled.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await mount();
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => mockMotionListeners.forEach(fn => fn(true)));
  await act(async () => resolve(false));
  expect(jest.getTimerCount()).toBe(0);
});
