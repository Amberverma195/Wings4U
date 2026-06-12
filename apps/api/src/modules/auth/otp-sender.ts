/**
 * OTP delivery abstraction.
 *
 * Customer auth now delivers one-time codes over EMAIL via Resend. We generate
 * and hash the OTP ourselves (provider "local"), so the sender only needs to
 * deliver the message.
 *
 * Infobip SMS 2FA delivery is kept below, fully commented out, in case we
 * revisit SMS later.
 */

export type OtpSendResult =
  | { provider: "local" }
  | { provider: "infobip-2fa"; verificationRef: string };

export interface OtpSender {
  send(recipient: string, otp: string): Promise<OtpSendResult>;
  verify?(verificationRef: string, otp: string): Promise<boolean>;
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
 * Resend email OTP sender. The PIN is generated/verified locally; Resend only
 * delivers the email. Requires:
 *   RESEND_API_KEY — API key from the Resend dashboard
 *   RESEND_FROM    — verified sender address (defaults to onboarding@resend.dev for dev)
 */
export class ResendEmailOtpSender implements OtpSender {
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    this.apiKey = requireEnv("RESEND_API_KEY");
    this.from = process.env.RESEND_FROM?.trim() || "onboarding@resend.dev";
  }

  async send(recipient: string, otp: string): Promise<OtpSendResult> {
    // Customer auth is email-only now. Guard against legacy phone callers so a
    // stray phone number can't crash the request; just log and no-op.
    if (!looksLikeEmail(recipient)) {
      console.warn(
        `[ResendEmailOtpSender] Recipient "${recipient}" is not an email; skipping send.`,
      );
      return { provider: "local" };
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

/**
 * Factory: pick the OTP sender.
 *  - OTP_PROVIDER / SMS_PROVIDER === "console" forces the console logger (tests/dev).
 *  - Otherwise, if RESEND_API_KEY is set (or provider === "resend"), email via Resend.
 *  - Fallback: console logger.
 */
export function createOtpSender(): OtpSender {
  const provider = (
    process.env.OTP_PROVIDER ??
    process.env.SMS_PROVIDER ??
    ""
  ).toLowerCase();

  if (provider === "console") {
    return new ConsoleOtpSender();
  }

  if (provider === "resend" || process.env.RESEND_API_KEY?.trim()) {
    return new ResendEmailOtpSender();
  }

  return new ConsoleOtpSender();
}

/* ==================================================================== */
/*  Infobip SMS 2FA delivery — DISABLED.                                */
/*  Kept for reference in case SMS OTP is revisited. Re-enable by        */
/*  restoring this class and wiring it into createOtpSender().           */
/* ==================================================================== */
/*
type InfobipSendResponse = {
  pinId?: string;
  smsStatus?: string;
  ncStatus?: string;
  [key: string]: unknown;
};

type InfobipVerifyResponse = {
  pinVerified?: boolean;
  verified?: boolean;
  [key: string]: unknown;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function toInfobipPhone(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

async function readInfobipPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractInfobipError(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const requestError = (payload as { requestError?: unknown }).requestError;
    if (requestError && typeof requestError === "object") {
      const serviceException = (
        requestError as { serviceException?: unknown }
      ).serviceException;
      if (serviceException && typeof serviceException === "object") {
        const text = (serviceException as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) {
          return text;
        }
      }
    }
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  return "Unknown Infobip error";
}

export class InfobipOtpSender implements OtpSender {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly applicationId: string;
  private readonly messageId: string;
  private readonly from: string;

  constructor() {
    this.baseUrl = stripTrailingSlash(requireEnv("INFOBIP_BASE_URL"));
    this.apiKey = requireEnv("INFOBIP_API_KEY");
    this.applicationId = requireEnv("INFOBIP_2FA_APPLICATION_ID");
    this.messageId = requireEnv("INFOBIP_2FA_MESSAGE_ID");
    this.from =
      process.env.INFOBIP_2FA_FROM?.trim() ||
      process.env.INFOBIP_SENDER_ID?.trim() ||
      "ServiceSMS";
  }

  async send(phone: string, _otp: string): Promise<OtpSendResult> {
    const payload = {
      applicationId: this.applicationId,
      messageId: this.messageId,
      from: this.from,
      to: toInfobipPhone(phone),
    };

    const response = await fetch(`${this.baseUrl}/2fa/2/pin`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    const responsePayload = await readInfobipPayload(response);

    if (!response.ok) {
      throw new Error(
        `Infobip 2FA PIN send failed (${response.status}): ${extractInfobipError(responsePayload)}`,
      );
    }

    const parsed = responsePayload as InfobipSendResponse | null;
    const pinId = parsed?.pinId;
    if (!pinId) {
      throw new Error("Infobip 2FA PIN send failed: response did not include pinId");
    }

    if (parsed?.smsStatus && parsed.smsStatus !== "MESSAGE_SENT") {
      const ncHint =
        parsed.ncStatus && parsed.ncStatus !== "NC_NOT_CONFIGURED"
          ? ` (ncStatus: ${parsed.ncStatus})`
          : "";
      throw new Error(
        `Infobip 2FA PIN was created but SMS was not sent (smsStatus: ${parsed.smsStatus})${ncHint}.`,
      );
    }

    return { provider: "infobip-2fa", verificationRef: pinId };
  }

  async verify(verificationRef: string, otp: string): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/2fa/2/pin/${encodeURIComponent(verificationRef)}/verify`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ pin: otp }),
      },
    );

    const responsePayload = await readInfobipPayload(response);

    if (!response.ok) {
      throw new Error(
        `Infobip 2FA PIN verify failed (${response.status}): ${extractInfobipError(responsePayload)}`,
      );
    }

    const parsed = responsePayload as InfobipVerifyResponse | null;
    return parsed?.pinVerified === true || parsed?.verified === true;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `App ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
}
*/
