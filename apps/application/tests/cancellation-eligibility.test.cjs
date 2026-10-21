const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockListeners = new Set();
jest.mock('react-native', () => ({ AppState: { addEventListener: (_, fn) => { mockListeners.add(fn); return { remove: () => mockListeners.delete(fn) }; } } }));
const { useCancellationEligibility } = require('../src/hooks/use-cancellation-eligibility');
let renderer, order, focused, eligible, schedule, clear;
function Probe() { eligible = useCancellationEligibility(order, focused); return null; }
const rerender = () => act(async () => renderer.update(React.createElement(Probe)));
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-20T15:00:00Z')); focused = true;
  order = { id: 'order', status: 'PLACED', cancel_allowed_until: new Date(Date.now() + 120_000).toISOString() };
  schedule = jest.spyOn(global, 'setTimeout'); clear = jest.spyOn(global, 'clearTimeout');
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.restoreAllMocks(); jest.useRealTimers(); });
const mount = () => act(async () => { renderer = create(React.createElement(Probe)); });
const deadlineTimers = () => schedule.mock.calls.map((args, index) => ({ delay: args[1], handle: schedule.mock.results[index].value })).filter(timer => timer.delay === 120_000);

test('one deadline wakeup, no per-second updates, and cleanup on unmount', async () => {
  await mount(); expect(eligible).toBe(true); expect(deadlineTimers()).toHaveLength(1);
  const timer = deadlineTimers()[0].handle;
  await act(async () => jest.advanceTimersByTimeAsync(119_000));
  expect(eligible).toBe(true); expect(deadlineTimers()).toHaveLength(1);
  await act(async () => renderer.unmount()); renderer = null;
  expect(clear).toHaveBeenCalledWith(timer); expect(mockListeners.size).toBe(0);
});

test('changing status cancels the deadline timer immediately', async () => {
  await mount(); const timer = deadlineTimers()[0].handle;
  order = { ...order, status: 'PREPARING' }; await rerender();
  expect(eligible).toBe(false); expect(clear).toHaveBeenCalledWith(timer);
});

test('focus and foreground recheck the original deadline after suspended timers', async () => {
  await mount(); focused = false; await rerender(); expect(mockListeners.size).toBe(0);
  jest.setSystemTime(Date.now() + 121_000); focused = true; await rerender(); expect(eligible).toBe(false);
  order = { ...order, cancel_allowed_until: new Date(Date.now() + 10_000).toISOString() }; await rerender();
  expect(eligible).toBe(true); jest.setSystemTime(Date.now() + 11_000);
  await act(async () => { for (const fn of mockListeners) fn('active'); }); expect(eligible).toBe(false);
});
