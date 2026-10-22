jest.mock("../../database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../../common/utils/jwt-secret", () => ({ getJwtSecret: () => "refresh-budget-test-secret" }));
import { createHash } from "crypto";
import { AuthService } from "./auth.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function harness() {
  const sessions: any[] = [{ id: "initial-session", userId: "customer", refreshTokenHash: hash("legacy-token"), revokedAt: null,
    expiresAt: new Date(Date.now() + 999999), user: { isActive: true, role: "CUSTOMER" } }];
  const db: any = { authSession: {
    findFirst: jest.fn(async ({ where }: any) => sessions.find(row => row.refreshTokenHash === where.refreshTokenHash && !row.revokedAt) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => { const row = sessions.find(row => row.id === where.id && !row.revokedAt); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    create: jest.fn(async ({ data }: any) => { const row = { ...data, revokedAt: null, id: 'session-' + sessions.length, user: sessions[0].user }; sessions.push(row); return row; }),
  }, $transaction: async (fn: any) => fn(db) };
  const service = new AuthService(db, { disconnectSession: jest.fn() } as never);
  const limiter = new RateLimiterService({ withClient: async () => null } as never);
  const budget = jest.fn(async (id: string) => limiter.enforce(id, { name: "test", limit: 3, windowMs: 60000 }, "Slow down"));
  return { service, budget, sessions, db };
}
it("keeps the verified session budget through successful token and session-row rotations", async () => {
  const { service, budget, sessions } = harness(); let token = "legacy-token";
  for (let i = 0; i < 3; i++) { const result = await service.refresh(token, budget); expect(result.refreshToken).not.toBe(token); token = result.refreshToken; }
  expect(budget.mock.calls.map(call => call[0])).toEqual(Array(3).fill("initial-session"));
  await expect(service.refresh(token, budget)).rejects.toMatchObject({ status: 429 });
  expect(sessions.filter(row => !row.revokedAt)).toHaveLength(1);
  expect(sessions).toHaveLength(4);
});
it("does not derive a session budget from a forged or invalid token", async () => {
  const { service, budget } = harness();
  await expect(service.refresh("initial-session.forged", budget)).rejects.toMatchObject({ status: 401 });
  expect(budget).not.toHaveBeenCalled();
});
it("claims a refresh token only once during simultaneous refreshes", async () => {
  const { service, budget, sessions } = harness();
  const results = await Promise.allSettled([service.refresh("legacy-token", budget), service.refresh("legacy-token", budget)]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
  expect(sessions.filter(row => !row.revokedAt)).toHaveLength(1);
});
