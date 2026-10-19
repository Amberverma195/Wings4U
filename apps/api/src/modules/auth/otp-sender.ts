/**
 * OTP delivery abstraction.
 *
 * Customer auth delivers one-time codes over email via Resend. The API
 * generates, hashes, and verifies the code locally; the sender only delivers
 * the message.
 */

import { renderBrandedEmail } from "../notifications/email-brand-template";

export type OtpSendResult = { provider: "local" | "resend" };

export class OtpDeliveryError extends Error {
  constructor(public readonly outcome: "provider_rejected" | "provider_timeout" | "provider_network" | "provider_ambiguous",
    public readonly ambiguous: boolean, public readonly status?: number) {
    super("Verification email could not be confirmed. Please try again later.");
  }
}

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

export function otpEmailHtml(otp: string): string {
  return renderBrandedEmail({ greeting: "Hello!", headline: "Verify your email address",
    highlight: otp, highlightIsCode: true,
    paragraphs: ["Use this verification code to continue. This code expires in 5 minutes.",
      "If you didn't request this code, you can ignore this email. Never share your code with anyone."],
  });
}

export function otpEmailText(otp: string): string {
  return `Wings 4 U\n\nVerify your email address\n\n${otp}\n\nUse this verification code to continue. This code expires in 5 minutes.\n\nIf you didn't request this code, you can ignore this email. Never share your code with anyone.\n\nSee you soon,\nThe Wings 4 U Team`;
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

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
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
          text: otpEmailText(otp),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const name = (error as Error)?.name;
      throw new OtpDeliveryError(name === "TimeoutError" || name === "AbortError" ? "provider_timeout" : "provider_network", true);
    }

    if (!response.ok) {
      const ambiguous = response.status >= 500 || response.status === 408;
      throw new OtpDeliveryError(ambiguous ? "provider_ambiguous" : "provider_rejected", ambiguous, response.status);
    }

    // Acceptance by Resend is not confirmation of inbox delivery.
    return { provider: "resend" };
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
