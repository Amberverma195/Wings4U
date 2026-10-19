import {
  ConsoleOtpSender,
  createOtpSender,
  ResendEmailOtpSender,
  OtpDeliveryError,
  otpEmailHtml,
  otpEmailText,
} from "./otp-sender";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

describe("otp-sender", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OTP_PROVIDER;
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

  it("refuses to fall back to console logging in production", () => {
    process.env.NODE_ENV = "production";

    expect(() => createOtpSender()).toThrow(/OTP delivery is not configured/);
  });

  it("rejects OTP_PROVIDER=console in production", () => {
    process.env.NODE_ENV = "production";
    process.env.OTP_PROVIDER = "console";

    expect(() => createOtpSender()).toThrow(/not allowed in production/);
  });

  it("still uses Resend in production when configured", () => {
    process.env.NODE_ENV = "production";
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

    expect(result).toEqual({ provider: "resend" });
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

  it("defaults the from address to the Wings 4 U domain sender", async () => {
    process.env.RESEND_API_KEY = "re_test";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    await new ResendEmailOtpSender().send("jane@example.com", "123456");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).from).toBe(
      "Wings 4 U <no-reply@wings4ulondon.ca>",
    );
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
    ).rejects.toMatchObject({ outcome: "provider_rejected", ambiguous: false, status: 422 });
  });

  it("rejects non-email recipients", async () => {
    process.env.RESEND_API_KEY = "re_test";

    await expect(
      new ResendEmailOtpSender().send("+14379660600", "123456"),
    ).rejects.toThrow("Email OTP recipient must be a valid email address");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses the shared brand, copyable code and matching five-minute plain text", () => {
    const html = otpEmailHtml("012345");
    for (const color of ["#321a12", "#f7f1e9", "#fffdf9", "#30251e", "#983315", "#fce9d5"]) expect(html).toContain(color);
    for (const output of [html, otpEmailText("012345")]) {
      expect(output).toContain("012345"); expect(output).toContain("5 minutes");
      expect(output).toContain("Verify your email address"); expect(output).toContain("ignore this email");
    }
    expect(html).toContain("font-size:32px"); expect(html).toContain('role="presentation"');
    expect(html).toContain("<!--[if mso]>"); expect(html).not.toMatch(/<script|<img|<style/i);
    expect(otpEmailHtml('<&"\'>')).toContain("&lt;&amp;&quot;&#039;&gt;");
    expect(otpEmailText("012345")).toContain("\n\n012345\n\n");
  });

  it.each([
    ["TimeoutError", "provider_timeout"], ["AbortError", "provider_timeout"], ["TypeError", "provider_network"],
  ])("classifies %s without leaking provider content or retrying", async (name, outcome) => {
    process.env.RESEND_API_KEY = "re_test";
    (global.fetch as jest.Mock).mockRejectedValue(Object.assign(new Error("private provider detail"), { name }));
    await expect(new ResendEmailOtpSender().send("jane@example.com", "012345")).rejects.toMatchObject({ outcome, ambiguous: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a 5xx as ambiguous and never reads a potentially private error body", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const text = jest.fn(); (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text });
    await expect(new ResendEmailOtpSender().send("jane@example.com", "012345")).rejects.toBeInstanceOf(OtpDeliveryError);
    expect(text).not.toHaveBeenCalled(); expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
