jest.useFakeTimers();
let generation = 1;
jest.mock("../src/lib/auth-events", () => ({ getAuthSessionGeneration: () => generation }));
jest.mock("../src/lib/api", () => ({
  apiFetch: jest.fn(),
  getRetryAfterSeconds: (res) => {
    const retry = Number(res.headers.get("Retry-After"));
    return retry > 0 ? retry : null;
  },
}));

const { apiFetch } = require("../src/lib/api");
const { cancelDeferredSavedCartWrite, putSavedCart } = require("../src/lib/saved-cart-api");

const state = { items: [], fulfillmentType: "PICKUP", locationTimezone: "America/Toronto", scheduledFor: null, driverTipPercent: "none" };
const limited = { ok: false, status: 429, headers: { get: () => "30" }, json: async () => ({}) };
const saved = { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { items: [], is_guest: false, expires_at: null } }) };

beforeEach(() => {
  generation = 1;
  apiFetch.mockReset();
  cancelDeferredSavedCartWrite();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("a throttled cart save waits out Retry-After and sends only the newest cart", async () => {
  apiFetch.mockResolvedValueOnce(limited).mockResolvedValueOnce(saved);
  const first = putSavedCart("location", state);
  await flush();
  const second = putSavedCart("location", { ...state, driverTipPercent: "15" });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(30_000);
  await expect(first).resolves.toBeNull();
  await expect(second).resolves.toMatchObject({ items: [] });
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(apiFetch.mock.calls[1][1].body).driver_tip_percent).toBe("15");
});

test("a throttled cart save is dropped when the session changes before the retry", async () => {
  apiFetch.mockResolvedValueOnce(limited).mockResolvedValueOnce(saved);
  const pending = putSavedCart("location", state);
  generation = 2;
  await flush();
  await jest.advanceTimersByTimeAsync(30_000);
  await expect(pending).resolves.toBeNull();
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
