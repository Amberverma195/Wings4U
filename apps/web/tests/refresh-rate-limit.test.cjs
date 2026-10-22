jest.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("../src/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("../src/lib/auth-events", () => ({
  addAuthSessionClearedListener: jest.fn(),
  notifyAuthSessionCleared: jest.fn(),
  getAuthSessionGeneration: () => 1,
}));
jest.mock("../src/lib/account-deletion", () => ({ forgetDeletedAccount: jest.fn() }));
jest.mock("../src/lib/delivery-quote", () => ({ clearStoredDeliveryQuotes: jest.fn(), pruneStoredDeliveryQuotes: jest.fn() }));

const { isDefinitiveRefreshFailure } = require("../src/lib/session");

test("a throttled or timed-out refresh is not treated as a signed-out session", () => {
  expect(isDefinitiveRefreshFailure(409)).toBe(false);
  expect(isDefinitiveRefreshFailure(429)).toBe(false);
  expect(isDefinitiveRefreshFailure(408)).toBe(false);
  expect(isDefinitiveRefreshFailure(503)).toBe(false);
  expect(isDefinitiveRefreshFailure(401)).toBe(true);
});
