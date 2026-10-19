// Never import the real Prisma service: its module loads the production root .env.
jest.mock("../../database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../realtime/realtime.gateway", () => ({ RealtimeGateway: class {} }));
jest.mock("../../common/utils/jwt-secret", () => ({ getJwtSecret: () => "isolated-unit-test-secret" }));
jest.mock("./otp-sender", () => ({ ...jest.requireActual("./otp-sender"), createOtpSender: jest.fn() }));

import { Logger } from "@nestjs/common";
import { createHash } from "crypto";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { createOtpSender, OtpDeliveryError } from "./otp-sender";

describe("email OTP issuance and private resend acknowledgements", () => {
  let service: any, prisma: any, sender: any, records: any[], log: jest.SpyInstance, locked: boolean;
  const email = "fictional@example.com";
  const purpose = "EMAIL_VERIFY";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const issue = () => service.issueEmailOtp("identity", purpose, email);
  const signup = () => {
    prisma.userIdentity.findUnique = jest.fn(async () => null);
    prisma.userIdentity.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValueOnce("identity");
    return service.signupWithPassword({ fullName: "Fictional Customer", phone: "5195550123", email, password: "Example123!" });
  };
  const matches = (record: any, where: any) => record.userIdentityId === where.userIdentityId && record.purpose === where.purpose &&
    (!where.createdAt || record.createdAt > where.createdAt.gt) &&
    (where.consumedAt !== null || record.consumedAt === null) && (!where.expiresAt || record.expiresAt > where.expiresAt.gt);
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["setImmediate"] }); jest.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    records = []; locked = false;
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    sender = { send: jest.fn(async (_email: string, code: string) => {
      expect(records.some(record => record.otpHash === hash(code))).toBe(true);
      return { provider: "resend" };
    }) };
    (createOtpSender as jest.Mock).mockReturnValue(sender);
    const otp = {
      findFirst: jest.fn(async ({ where }: any) => records.filter(record => matches(record, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null),
      count: jest.fn(async ({ where }: any) => records.filter(record => matches(record, where)).length),
      findMany: jest.fn(async ({ where }: any) => records.filter(record => record.userIdentityId === where.userIdentityId && record.purpose === where.purpose)),
      create: jest.fn(async ({ data }: any) => {
        const record = { id: String(records.length + 1), createdAt: new Date(), consumedAt: null, attemptCount: 0, ...data };
        records.push(record); return record;
      }),
      delete: jest.fn(async ({ where }: any) => { records.splice(records.findIndex(record => record.id === where.id), 1); }),
      update: jest.fn(async ({ where, data }: any) => {
        const record = records.find(record => record.id === where.id);
        if (data.attemptCount) record.attemptCount++; else Object.assign(record, data);
        return record;
      }),
    };
    prisma = { authOtpCode: otp, userIdentity: { findFirst: jest.fn(async () => ({ id: "identity", isVerified: false })) },
      $transaction: jest.fn(async (callback: any) => {
        let ownsLock = false;
        try { return await callback({ authOtpCode: otp, $queryRaw: async () => {
          if (locked) return [{ acquired: false }];
          ownsLock = true; locked = true; return [{ acquired: true }];
        } }); } finally { if (ownsLock) locked = false; }
      }) };
    service = new AuthService(prisma, {} as any);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it("persists a six-digit hashed code before one provider attempt and verifies it", async () => {
    await service.processVerificationResend(email);
    expect(sender.send).toHaveBeenCalledTimes(1);
    const code = sender.send.mock.calls[0][1]; expect(code).toMatch(/^\d{6}$/);
    expect(records[0].expiresAt.getTime() - records[0].createdAt.getTime()).toBe(300000);
    await service.consumeEmailOtp("identity", purpose, code);
    await expect(service.consumeEmailOtp("identity", purpose, code)).rejects.toThrow("No valid code");
    expect(JSON.stringify(log.mock.calls)).not.toContain(code);
    expect(JSON.stringify(log.mock.calls)).not.toContain(email);
  });
  it("suppresses requests inside 30 seconds, then generates a new code after cooldown", async () => {
    await issue(); await expect(issue()).rejects.toThrow("wait 30 seconds");
    jest.advanceTimersByTime(30000); await issue();
    expect(sender.send).toHaveBeenCalledTimes(2);
    const first = sender.send.mock.calls[0][1], latest = sender.send.mock.calls[1][1];
    if (first !== latest) await expect(service.consumeEmailOtp("identity", purpose, first)).rejects.toThrow("Invalid code");
    await service.consumeEmailOtp("identity", purpose, latest);
    await expect(service.consumeEmailOtp("identity", purpose, first)).rejects.toThrow("No valid code");
  });
  it("enforces five sends per fifteen minutes", async () => {
    for (let i = 0; i < 5; i++) { await issue(); jest.advanceTimersByTime(30000); }
    await expect(issue()).rejects.toThrow("Too many verification codes"); expect(sender.send).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "window_limit" }));
    jest.advanceTimersByTime(900000); await issue(); expect(sender.send).toHaveBeenCalledTimes(6);
  });
  it("enforces the active-code limit without sending", async () => {
    prisma.authOtpCode.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    await expect(issue()).rejects.toThrow("Too many active codes"); expect(sender.send).not.toHaveBeenCalled();
  });
  it("suppresses simultaneous issuance through the shared database lock", async () => {
    await Promise.allSettled(Array.from({ length: 10 }, issue));
    expect(sender.send).toHaveBeenCalledTimes(1); expect(records).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "concurrent_suppression" }));
  });
  it("does not send if storage/commit fails", async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error("private database detail"));
    await expect(issue()).rejects.toThrow("could not be created"); expect(sender.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "storage_failure" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private database detail");
  });
  it("removes a definitively rejected replacement and keeps the previous working code", async () => {
    await issue(); const previous = sender.send.mock.calls[0][1]; jest.advanceTimersByTime(30000);
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    await expect(issue()).rejects.toThrow("could not be confirmed");
    expect(records).toHaveLength(1); await service.consumeEmailOtp("identity", purpose, previous);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "provider_rejected" }));
  });
  it.each(["provider_timeout", "provider_network", "provider_ambiguous"])("retains a potentially delivered code after %s, without retry", async outcome => {
    sender.send.mockRejectedValueOnce(new OtpDeliveryError(outcome as any, true));
    await expect(issue()).rejects.toThrow("could not be confirmed");
    expect(records).toHaveLength(1); expect(prisma.authOtpCode.delete).not.toHaveBeenCalled();
    const code = sender.send.mock.calls[0][1]; await service.consumeEmailOtp("identity", purpose, code);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });
  it("rejects expired codes and preserves invalid-code attempt limits", async () => {
    await issue(); const code = sender.send.mock.calls[0][1];
    for (let i = 0; i < 5; i++) await expect(service.consumeEmailOtp("identity", purpose, "not-the-code")).rejects.toThrow("Invalid code");
    await expect(service.consumeEmailOtp("identity", purpose, code)).rejects.toThrow("Too many attempts");
    jest.advanceTimersByTime(300001); await expect(service.consumeEmailOtp("identity", purpose, code)).rejects.toThrow("No valid code");
  });
  it.each([null, { id: "identity", isVerified: true }])("records ineligible identities internally without sending", async identity => {
    prisma.userIdentity.findFirst.mockResolvedValue(identity); await service.processVerificationResend(email);
    expect(sender.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: identity ? "already_verified" : "unknown_identity" }));
  });
  it("acknowledges before any identity-dependent work or provider latency", async () => {
    await service.resendEmailVerification(email);
    expect(prisma.userIdentity.findFirst).not.toHaveBeenCalled();
    await new Promise(resolve => setImmediate(resolve));
    expect(sender.send).toHaveBeenCalledTimes(1);
  });
  it("keeps the controller response identical across service outcomes and limits only public IP", async () => {
    const limiter = { check: jest.fn(async () => ({ allowed: true })) };
    const controller = new AuthController(service, limiter as any);
    const req = { ip: "192.0.2.1", headers: {} } as any, res = { setHeader: jest.fn() } as any;
    for (const identity of [null, { id: "identity", isVerified: true }, { id: "identity", isVerified: false }]) {
      prisma.userIdentity.findFirst.mockResolvedValue(identity);
      expect(await controller.resendSignupVerification({ email }, req, res)).toEqual({ request_accepted: true, retry_after_seconds: 30,
        message: "If verification is needed and a code can be sent, check your inbox and spam folder." });
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(limiter.check).toHaveBeenCalledWith("auth:signup:resend:192.0.2.1", 30, 900000);
  });
  it("initial email failure allows verification recovery without creating another account", async () => {
    prisma.userIdentity.findUnique = jest.fn(async () => null);
    prisma.userIdentity.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValueOnce("identity");
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    const result = await service.signupWithPassword({ fullName: "Fictional Customer", phone: "5195550123", email, password: "Example123!" });
    expect(result).toMatchObject({ otpSent: false, email, retryAfterSeconds: 0 });
    expect(records).toHaveLength(0);
    prisma.userIdentity.findFirst.mockResolvedValue({ id: "identity", isVerified: false });
    await service.processVerificationResend(email); expect(sender.send).toHaveBeenCalledTimes(2);
  });
  it("returns the normal cooldown for an accepted initial email", async () => {
    expect(await signup()).toMatchObject({ otpSent: true, retryAfterSeconds: 30 });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });
  it("only establishes a session after verifying the delivered recovery code", async () => {
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    const session = { user: { id: "user", role: "CUSTOMER", displayName: "Fictional Customer" }, accessToken: "test-access" };
    const createSession = jest.spyOn(service, "createSessionTokens").mockResolvedValue(session);
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 0 });
    expect(createSession).not.toHaveBeenCalled();
    await issue(); const code = sender.send.mock.calls[1][1];
    prisma.userIdentity.findFirst.mockResolvedValue({ id: "identity", userId: "user", user: { ...session.user, firstName: "Fictional" } });
    prisma.userIdentity.update = jest.fn(async () => ({}));
    jest.spyOn(service, "findPrimaryPhone").mockResolvedValue(undefined);
    expect(await service.verifyEmailOtp(email, code)).toMatchObject({ accessToken: "test-access" });
    expect(createSession).toHaveBeenCalledTimes(1);
  });
  it.each(["provider_timeout", "provider_network", "provider_ambiguous"])("retained code after %s returns the actual remaining cooldown", async outcome => {
    sender.send.mockImplementationOnce(async () => {
      jest.advanceTimersByTime(11000);
      throw new OtpDeliveryError(outcome as any, true);
    });
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 19 });
    expect(records).toHaveLength(1);
    await expect(issue()).rejects.toThrow("wait 19 seconds"); expect(sender.send).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(19000); await issue(); expect(sender.send).toHaveBeenCalledTimes(2);
    await service.consumeEmailOtp("identity", purpose, sender.send.mock.calls[1][1]);
  });
  it("permits immediate recovery when persistence failed and no code or send limit remains", async () => {
    prisma.authOtpCode.create.mockRejectedValueOnce(new Error("storage failed"));
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    await issue(); expect(sender.send).toHaveBeenCalledTimes(1);
  });
  it("requires a conservative wait when cleanup or retry-state lookup is uncertain", async () => {
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    prisma.authOtpCode.delete.mockRejectedValueOnce(new Error("cleanup failed"));
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 30 });
    prisma.authOtpCode.findMany.mockRejectedValueOnce(new Error("lookup failed"));
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 30 });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });
  it("returns an existing cooldown and full send-window wait without extra emails", async () => {
    await issue(); jest.advanceTimersByTime(7000);
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 23 });
    jest.advanceTimersByTime(23000);
    for (let i = 0; i < 4; i++) { await issue(); jest.advanceTimersByTime(30000); }
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 750 });
    expect(sender.send).toHaveBeenCalledTimes(5);
  });
  it("honors active-code limits even for records outside the send window", async () => {
    records = Array.from({ length: 5 }, (_, index) => ({ userIdentityId: "identity", purpose,
      createdAt: new Date(Date.now() - 960000), consumedAt: null, expiresAt: new Date(Date.now() + (index + 1) * 20000) }));
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 20 });
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("does not offer immediate retry while another issuance transaction holds the lock", async () => {
    locked = true;
    expect(await signup()).toMatchObject({ otpSent: false, retryAfterSeconds: 30 });
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("includes the recovery delay only in initial signup, without provider or OTP details", async () => {
    const controller = new AuthController(service, {} as any);
    jest.spyOn(controller as any, "enforceSignupDeviceLimit").mockResolvedValue(undefined);
    jest.spyOn(service, "signupWithPassword").mockResolvedValue({ otpSent: false, email, expiresInSeconds: 300, retryAfterSeconds: 0 });
    expect(await controller.signup({ full_name: "Fictional Customer", phone: "5195550123", email,
      password: "Example123!", confirm_password: "Example123!" }, {} as any, {} as any)).toEqual({
      otp_sent: false, email, expires_in_seconds: 300, retry_after_seconds: 0,
    });
  });
  it.each(["cooldown", "window", "rejection", "network", "storage"])("keeps %s failures private in the public acknowledgement", async outcome => {
    if (outcome === "cooldown") await issue();
    if (outcome === "window") prisma.authOtpCode.count.mockResolvedValueOnce(5);
    if (outcome === "rejection") sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    if (outcome === "network") sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_network", true));
    if (outcome === "storage") prisma.$transaction.mockRejectedValueOnce(new Error("private database detail"));
    const controller = new AuthController(service, { check: async () => ({ allowed: true }) } as any);
    expect(await controller.resendSignupVerification({ email }, { ip: "192.0.2.1", headers: {} } as any, {} as any))
      .toEqual({ request_accepted: true, retry_after_seconds: 30,
        message: "If verification is needed and a code can be sent, check your inbox and spam folder." });
    await new Promise(resolve => setImmediate(resolve));
    expect(sender.send.mock.calls.length).toBe(outcome === "storage" || outcome === "window" ? 0 : 1);
  });
  it("reports rejected-code cleanup failure without exposing storage details or retrying email", async () => {
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    prisma.authOtpCode.delete.mockRejectedValueOnce(new Error("private database detail"));
    await expect(issue()).rejects.toThrow("could not be confirmed");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "rejected_code_cleanup_failure" }));
    expect(sender.send).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toContain("private database detail");
  });
  it("uses only IP-based retry information for a public request limit", async () => {
    const controller = new AuthController(service, { check: async () => ({ allowed: false, resetAtMs: Date.now() + 90000 }) } as any);
    const req = { ip: "192.0.2.1", headers: {} } as any, res = { setHeader: jest.fn() } as any;
    await expect(controller.resendSignupVerification({ email }, req, res)).rejects.toThrow("Too many requests");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "90");
    expect(prisma.userIdentity.findFirst).not.toHaveBeenCalled(); expect(sender.send).not.toHaveBeenCalled();
  });
  it("correct-password login of an unverified identity still withholds the session when sending fails", async () => {
    prisma.userIdentity.findFirst.mockResolvedValueOnce({ user: { id: "user", isActive: true, passwordHash: await bcrypt.hash("Example123!", 4) } })
      .mockResolvedValueOnce({ id: "identity", isVerified: false, emailNormalized: email });
    sender.send.mockRejectedValueOnce(new OtpDeliveryError("provider_rejected", false, 422));
    expect(await service.loginWithPassword(email, "Example123!")).toEqual({ kind: "email_unverified", email });
  });
});
