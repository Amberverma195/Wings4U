/** Native animation/accessibility seams for offline renderer tests. */
exports.createNativeSkeletonMock = () => ({
  Animated: {
    Value: class {
      constructor(value) { this.value = value; this.setValue = jest.fn(value => { this.value = value; }); this.stopAnimation = jest.fn(); }
    },
    View: 'AnimatedView',
    timing: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    sequence: jest.fn(steps => ({ steps })),
    loop: jest.fn(animation => ({ animation, start: jest.fn(), stop: jest.fn() })),
  },
  Easing: { inOut: value => value, ease: 'ease' },
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn(async () => true),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    setAccessibilityFocus: jest.fn(),
  },
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
});
