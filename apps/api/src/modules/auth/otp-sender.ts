/**
 * OTP delivery abstraction.
 *
 * Customer auth delivers one-time codes over email via Resend. The API
 * generates, hashes, and verifies the code locally; the sender only delivers
 * the message.
 */

export type OtpSendResult = { provider: "local" };

export interface OtpSender {
  send(recipient: string, otp: string): Promise<OtpSendResult>;
}

export class ConsoleOtpSender implements OtpSender {
  async send(recipient: string, otp: string): Promise<OtpSendResult> {
    console.log(`[DEV OTP] ${recipient}: ${otp}`);
    return { provider: "local" };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for OTP delivery`);
  }
  return value;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function otpEmailHtml(otp: string): string {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin: 0 0 12px; color: #ff6a00;">Wings 4 U</h2>
      <p style="margin: 0 0 16px; font-size: 15px;">Use this verification code to continue:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px 0; text-align: center; background: #f6f3ee; border-radius: 8px;">
        ${otp}
      </div>
      <p style="margin: 16px 0 0; font-size: 13px; color: #666;">This code expires in 5 minutes. If you didn't request it, you can ignore this email.</p>
    </div>
  `;
}

/**
 * Resend email OTP sender. Requires:
 *   RESEND_API_KEY - API key from the Resend dashboard
 *   RESEND_FROM    - verified sender address
 */
export class ResendEmailOtpSender implements OtpSender {
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    this.apiKey = requireEnv("RESEND_API_KEY");
    this.from =
      process.env.RESEND_FROM?.trim() || "Wings 4 U <no-reply@wings4ulondon.ca>";
  }

  async send(recipient: string, otp: string): Promise<OtpSendResult> {
    if (!looksLikeEmail(recipient)) {
      throw new Error("Email OTP recipient must be a valid email address");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [recipient],
        subject: "Your Wings 4 U verification code",
        html: otpEmailHtml(otp),
        text: `Your Wings 4 U verification code is ${otp}. It expires in 5 minutes.`,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Resend email send failed (${response.status}): ${text}`);
    }

    return { provider: "local" };
  }
}

export function createOtpSender(): OtpSender {
  const provider = (process.env.OTP_PROVIDER ?? "").toLowerCase();
  const isProd = process.env.NODE_ENV === "production";

  if (provider === "console") {
    // The console sender prints plaintext OTPs to stdout — fine for local
    // dev, never acceptable in production where logs are persisted/aggregated.
    if (isProd) {
      throw new Error(
        "OTP_PROVIDER=console is not allowed in production. Configure Resend (RESEND_API_KEY + OTP_PROVIDER=resend).",
      );
    }
    return new ConsoleOtpSender();
  }

  if (provider === "resend" || process.env.RESEND_API_KEY?.trim()) {
    return new ResendEmailOtpSender();
  }

  // No explicit provider and no Resend key. Refuse to silently fall back to
  // logging codes in production; only dev/test may use the console sender.
  if (isProd) {
    throw new Error(
      "OTP delivery is not configured. Set RESEND_API_KEY (and OTP_PROVIDER=resend) before starting the server in production.",
    );
  }

  return new ConsoleOtpSender();
}
