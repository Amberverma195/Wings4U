const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'default-location' }));
const { apiJson } = require('../src/lib/api');
const { useMenu } = require('../src/hooks/use-menu');
let result;
let renderer;
function Probe({ method = 'PICKUP', location = 'store', scheduledFor = null }) {
  result = useMenu(method, location, scheduledFor);
  return null;
}
const render = async (props = {}) => act(async () => {
  renderer = create(React.createElement(Probe, props));
});
beforeEach(() => { jest.resetAllMocks(); apiJson.mockResolvedValue({ data: { categories: [] } }); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('requests the same location, method and schedule parameters as the website', async () => {
  const scheduledFor = '2026-10-15T17:30:00.000Z';
  await render({ method: 'DELIVERY', location: 'LON01', scheduledFor });
  const [path, options] = apiJson.mock.calls[0];
  const url = new URL(path, 'http://localhost');
  expect(url.pathname).toBe('/api/v1/menu');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    location_id: 'LON01', fulfillment_type: 'DELIVERY', scheduled_for: scheduledFor,
  });
  expect(options.locationId).toBe('LON01');
});

test('changing the schedule refetches the menu', async () => {
  await render();
  await act(async () => renderer.update(React.createElement(Probe, { scheduledFor: '2026-10-15T17:30:00.000Z' })));
  expect(apiJson).toHaveBeenCalledTimes(2);
  expect(apiJson.mock.calls[0][0]).not.toContain('scheduled_for');
  expect(apiJson.mock.calls[1][0]).toContain('scheduled_for');
});

test('surfaces missing menu data instead of silently leaving the menu empty', async () => {
  apiJson.mockResolvedValue({ data: null });
  await render();
  expect(result.loading).toBe(false);
  expect(result.error).toBe('Menu response missing data');
});
