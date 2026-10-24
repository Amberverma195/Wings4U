import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { MAX_AVAILABLE_STAMPS, STAMPS_PER_REWARD } from "../rewards/rewards.service";
import type { StampGrantEmailResult } from "../admin/admin-customers.dto";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export function renderStampGrantEmail(
  name: string,
  stamps: number,
  balance: number,
  _orderUrl?: string,
) {
  const customerName = name.trim() || "Customer";
  const greeting = `Hello, ${customerName}!`;
  const stampWord = stamps === 1 ? "stamp" : "stamps";
  const award = `We've added ${stamps} bonus ${stampWord} to your Wings4U rewards account.`;
  const progress = `Your updated stamp balance: ${balance} / ${MAX_AVAILABLE_STAMPS}`;
  const status = "Your rewards account has been updated successfully. No action is required.";
  const availableRewards = Math.floor(balance / STAMPS_PER_REWARD);
  const reward = availableRewards > 0
    ? `You have ${availableRewards} free ${availableRewards === 1 ? "pound" : "pounds"} available. Each reward uses ${STAMPS_PER_REWARD} stamps for one individual 1 lb wings item. To redeem, add a qualifying individual 1 lb wings item and apply the wings reward at checkout. One reward per order.`
    : null;

  const textSections = [
    greeting,
    award,
    progress,
    status,
    ...(reward ? [reward] : []),
    "Thank you,\nThe Wings4U Team ❤️\n\nWings 4 U\n1544 Dundas St, London, ON N5W 3C1",
  ];

  return {
    subject: "Wings4U — Bonus Stamps Added to Your Account",
    text: textSections.join("\n\n"),
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;background:#f7f1e9;color:#30251e;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
      <div style="max-width:560px;margin:0 auto;padding:24px;">
        <div style="background:#321a12;color:#fff4e4;padding:24px;border-radius:16px 16px 0 0;font-size:26px;font-weight:bold;">Wings 4 U</div>
        <div style="background:#fffdf9;padding:24px;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(award)}</p>
          <p style="padding:16px;background:#fce9d5;border-radius:10px;font-size:20px;font-weight:bold;margin:0 0 16px;">${escapeHtml(progress)}</p>
          <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(status)}</p>
          ${reward ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(reward)}</p>` : ""}
          <p style="margin:24px 0 0;font-size:16px;line-height:1.6;">Thank you,<br>The Wings4U Team ❤️</p>
          <div style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e8ded2;font-size:13px;color:#7a6b63;line-height:1.4;">
            Wings 4 U<br>
            1544 Dundas St, London, ON N5W 3C1
          </div>
        </div></div></body></html>`,
  };
}

type EmailPayload = { from: string; to: string[]; subject: string; text: string; html: string };
const result = (status: StampGrantEmailResult["status"], message: string, retryable = false): StampGrantEmailResult => ({ status, message, retryable });

@Injectable()
export class StampGrantEmailService {
  private readonly logger = new Logger(StampGrantEmailService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Called only after commit. Leases and provider keys make retries safe across API instances. */
  async send(grantId: string): Promise<StampGrantEmailResult> {
    try { return await this.deliver(grantId); }
    catch {
      this.logger.error(`Unable to record stamp email status for grant ${grantId}`);
      return result("UNKNOWN", "Stamps were added, but email delivery could not be confirmed. Retry notification status.", true);
    }
  }

  private async deliver(grantId: string): Promise<StampGrantEmailResult> {
    const initial = await this.prisma.wingsStampGrantEmail.findUniqueOrThrow({ where: { grantId } });
    if (initial.status === "SENT") return result("SENT", "Notification email accepted by the email provider.");
    const now = new Date();
    const token = randomUUID();
    const claim = await this.prisma.wingsStampGrantEmail.updateMany({
      where: { grantId, status: { not: "SENT" }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + 60_000), attemptToken: token },
    });
    if (!claim.count) return result("PENDING", "Notification email is being processed. Check its status shortly.", true);
    // Another worker may have persisted the original payload between our initial read and claim.
    const record = await this.prisma.wingsStampGrantEmail.findUniqueOrThrow({ where: { grantId }, include: { grant: true } });
    const finish = async (value: StampGrantEmailResult, extra: Prisma.WingsStampGrantEmailUpdateManyMutationInput = {}) => {
      await this.prisma.wingsStampGrantEmail.updateMany({ where: { grantId, attemptToken: token },
        data: { status: value.status, lastError: value.status === "SENT" ? null : value.message,
          leaseUntil: null, attemptToken: null, ...extra } });
      return value;
    };
    // Resend retains keys for 24h. Stop uncertain retries after 23h rather than risk a second email.
    if (record.firstAttemptAt && now.getTime() - record.firstAttemptAt.getTime() >= 23 * 3600_000) {
      return finish(result("UNKNOWN", "Email retry window expired. Check the provider log before any manual notification."));
    }
    const customer = await this.prisma.user.findFirst({
      where: { id: record.grant.customerUserId, role: "CUSTOMER", isActive: true, archivedAt: null },
      select: { displayName: true, identities: { where: { provider: "EMAIL", isVerified: true, emailNormalized: { not: null } },
        orderBy: [{ verifiedAt: "desc" }, { id: "asc" }], take: 1, select: { emailNormalized: true } } },
    });
    const recipient = customer?.identities[0]?.emailNormalized;
    if (!recipient) return finish(result("SKIPPED", "No current verified email is available.", !record.firstAttemptAt));
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM?.trim();
    if (!apiKey || !from) return finish(result("SKIPPED", "Notification email is not configured.", true));
    let payload = record.payloadJson as EmailPayload | null;
    if (payload && payload.to[0] !== recipient) {
      return finish(result("SKIPPED", "Verified email changed. The original notification will not be sent to an old contact."));
    }
    if (!payload) {
      payload = {
        from,
        to: [recipient],
        ...renderStampGrantEmail(
          customer!.displayName,
          record.grant.deltaStamps,
          record.grant.balanceAfterStamps,
        ),
      };
    }
    // Persist the exact request before talking to Resend; a crash can safely replay the same bytes/key.
    const prepared = await this.prisma.wingsStampGrantEmail.updateMany({ where: { grantId, attemptToken: token },
      data: { payloadJson: payload as unknown as Prisma.InputJsonValue, firstAttemptAt: record.firstAttemptAt ?? now } });
    if (!prepared.count) return result("PENDING", "Notification email is being processed. Check its status shortly.", true);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `stamp-grant/${grantId}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return finish(result("FAILED", `Notification email was not accepted by the email provider (${response.status}).`, true));
      const body = await response.json().catch(() => null) as { id?: string } | null;
      return finish(result("SENT", "Notification email accepted by the email provider."), { sentAt: new Date(), providerEmailId: body?.id ?? null });
    } catch {
      return finish(result("UNKNOWN", "The email provider did not confirm delivery. Retry with the same notification.", true));
    }
  }
}
