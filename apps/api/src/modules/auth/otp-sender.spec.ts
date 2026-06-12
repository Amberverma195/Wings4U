import {
  ConsoleOtpSender,
  createOtpSender,
  ResendEmailOtpSender,
} from "./otp-sender";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

describe("otp-sender", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OTP_PROVIDER;
    delete process.env.SMS_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("uses console sender by default", () => {
    expect(createOtpSender()).toBeInstanceOf(ConsoleOtpSender);
  });

  it("forces console sender when OTP_PROVIDER=console even if RESEND_API_KEY is set", () => {
    process.env.OTP_PROVIDER = "console";
    process.env.RESEND_API_KEY = "re_test";

    expect(createOtpSender()).toBeInstanceOf(ConsoleOtpSender);
  });

  it("uses the Resend email sender when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_test";

    expect(createOtpSender()).toBeInstanceOf(ResendEmailOtpSender);
  });

  it("uses the Resend email sender when OTP_PROVIDER=resend", () => {
    process.env.OTP_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";

    expect(createOtpSender()).toBeInstanceOf(ResendEmailOtpSender);
  });

  it("sends the OTP email through the Resend API", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@wings4u.test";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "email-id" }),
    });

    const result = await new ResendEmailOtpSender().send("jane@example.com", "123456");

    expect(result).toEqual({ provider: "local" });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Content-Type": "application/json",
    });
    const payload = JSON.parse(init.body);
    expect(payload.from).toBe("noreply@wings4u.test");
    expect(payload.to).toEqual(["jane@example.com"]);
    expect(payload.text).toContain("123456");
    expect(payload.html).toContain("123456");
  });

  it("defaults the from address to onboarding@resend.dev", async () => {
    process.env.RESEND_API_KEY = "re_test";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    await new ResendEmailOtpSender().send("jane@example.com", "123456");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).from).toBe("onboarding@resend.dev");
  });

  it("throws when the Resend API returns an error", async () => {
    process.env.RESEND_API_KEY = "re_test";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ message: "Invalid from address" }),
    });

    await expect(
      new ResendEmailOtpSender().send("jane@example.com", "123456"),
    ).rejects.toThrow("Resend email send failed (422)");
  });

  it("skips (does not call Resend) for non-email recipients", async () => {
    process.env.RESEND_API_KEY = "re_test";

    const result = await new ResendEmailOtpSender().send("+14379660600", "123456");

    expect(result).toEqual({ provider: "local" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
