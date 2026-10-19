import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { STAMPS_PER_REWARD } from "../rewards/rewards.service";
import type { StampGrantEmailResult } from "../admin/admin-customers.dto";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** Only an operator-configured public HTTPS origin, with a fixed ordering path. */
export function stampOrderUrl(): string {
  const value = process.env.PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) throw new Error("Public ordering URL is not configured.");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || url.port || !host.includes(".") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    /^[\d.]+$/.test(host) || host.includes(":")) {
    throw new Error("Public ordering URL must be a public HTTPS site origin.");
  }
  return new URL("/menu", url.origin).href;
}

export function renderStampGrantEmail(name: string, stamps: number, balance: number, orderUrl: string) {
  const greeting = `Hello, ${name.trim() || "fellow wing lover"}! 🍗`;
  const award = `We've added ${stamps} bonus ${stamps === 1 ? "stamp" : "stamps"} to your Wings 4 U stamp collection!`;
  const progress = `Your new balance is ${balance} out of ${STAMPS_PER_REWARD} stamps.`;
  const reward = balance >= STAMPS_PER_REWARD
    ? "Your stamp card is full! 🎉 You have a free 1 lb Wings reward ready to redeem on your next eligible order."
    : `Every stamp brings you closer to something delicious. Collect ${STAMPS_PER_REWARD} stamps and unlock 1 lb of wings on us!`;
  const thanks = "Thanks for being part of the Wings 4 U family. We can't wait to serve you again.";
  return {
    subject: "🍗 A little something extra for you | Wings 4 U",
    text: `${greeting}\n\n${award}\n\n${progress}\n\n${reward}\n\n${thanks}\n\nOrder Now: ${orderUrl}\n\nSee you soon,\nThe Wings 4 U Team ❤️`,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;background:#f7f1e9;color:#30251e;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
      <div style="max-width:560px;margin:0 auto;padding:24px;">
        <div style="background:#321a12;color:#fff4e4;padding:24px;border-radius:16px 16px 0 0;font-size:26px;font-weight:bold;">Wings 4 U</div>
        <div style="background:#fffdf9;padding:24px;border-radius:0 0 16px 16px;">
          <p>${escapeHtml(greeting)}</p><h1 style="font-size:24px;color:#983315;">${escapeHtml(award)}</h1>
          <p style="padding:16px;background:#fce9d5;border-radius:10px;font-size:20px;font-weight:bold;">${escapeHtml(progress)}</p>
          <p>${escapeHtml(reward)}</p><p>${escapeHtml(thanks)}</p>
          <p style="margin:28px 0;"><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#a73713;color:#fff;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none;">Order Now</a></p>
          <p>See you soon,<br>The Wings 4 U Team ❤️</p>
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
      let url: string;
      try { url = stampOrderUrl(); }
      catch { return finish(result("SKIPPED", "Public ordering URL is missing or invalid.", true)); }
      payload = { from, to: [recipient], ...renderStampGrantEmail(customer!.displayName, record.grant.deltaStamps, record.grant.balanceAfterStamps, url) };
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
