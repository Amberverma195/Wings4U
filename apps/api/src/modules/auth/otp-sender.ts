/**
 * OTP delivery abstraction.
 *
 * Two implementations:
 * - ConsoleOtpSender — logs to stdout (dev/test default)
 * - InfobipOtpSender — sends via Infobip SMS API (production)
 *
 * Selected via SMS_PROVIDER env var ("infobip" | "console").
 */

export interface OtpSender {
  send(phone: string, otp: string): Promise<void>;
}

export class ConsoleOtpSender implements OtpSender {
  async send(phone: string, otp: string): Promise<void> {
    console.log(`[DEV OTP] ${phone}: ${otp}`);
  }
}

/**
 * Infobip SMS sender — placeholder implementation.
 *
 * Requires these env vars:
 *   INFOBIP_BASE_URL   — e.g. https://xxxxx.api.infobip.com
 *   INFOBIP_API_KEY    — API key from Infobip dashboard
 *   INFOBIP_SENDER_ID  — sender / from number
 *
 * The actual HTTP call is stubbed with a TODO. When Infobip credentials
 * are available, replace the placeholder with a real fetch to:
 *   POST {INFOBIP_BASE_URL}/sms/2/text/advanced
 */
export class InfobipOtpSender implements OtpSender {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string;

  constructor() {
    this.baseUrl = process.env.INFOBIP_BASE_URL ?? "";
    this.apiKey = process.env.INFOBIP_API_KEY ?? "";
    this.senderId = process.env.INFOBIP_SENDER_ID ?? "Wings4U";

    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        "InfobipOtpSender requires INFOBIP_BASE_URL and INFOBIP_API_KEY env vars",
      );
    }
  }

  async send(phone: string, otp: string): Promise<void> {
    const url = `${this.baseUrl}/sms/2/text/advanced`;
    const body = {
      messages: [
        {
          destinations: [{ to: phone }],
          from: this.senderId,
          text: `Your Wings 4 U verification code is: ${otp}`,
        },
      ],
    };

    // TODO: uncomment when Infobip credentials are configured
    // const res = await fetch(url, {
    //   method: "POST",
    //   headers: {
    //     "Authorization": `App ${this.apiKey}`,
    //     "Content-Type": "application/json",
    //     "Accept": "application/json",
    //   },
    //   body: JSON.stringify(body),
    // });
    //
    // if (!res.ok) {
    //   const text = await res.text();
    //   throw new Error(`Infobip SMS failed (${res.status}): ${text}`);
    // }

    console.log(
      `[INFOBIP PLACEHOLDER] Would send OTP to ${phone} via ${url}`,
      JSON.stringify(body),
    );
  }
}

/** Factory: pick sender based on SMS_PROVIDER env var. */
export function createOtpSender(): OtpSender {
  const provider = (process.env.SMS_PROVIDER ?? "console").toLowerCase();

  if (provider === "infobip") {
    return new InfobipOtpSender();
  }

  return new ConsoleOtpSender();
}
