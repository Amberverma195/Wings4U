import { Injectable, Logger } from "@nestjs/common";
import { renderBrandedEmail } from "./email-brand-template";
import { PrismaService } from "../../database/prisma.service";

export type OrderEmailStatus =
  | "ACCEPTED"
  | "PICKED_UP"
  | "DELIVERED"
  | "CANCELLED";

export type OrderEmailDetails = {
  id: string;
  orderNumber: bigint | number;
  customerNameSnapshot: string;
  customerEmailSnapshot: string | null;
  cancellationReason?: string | null;
  cancellationSource?: string | null;
};

type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export function renderEmail(
  order: OrderEmailDetails,
  status: OrderEmailStatus,
): RenderedEmail {
  const orderLabel = `Order #${String(order.orderNumber)}`;
  const customerName = order.customerNameSnapshot.trim();
  const greeting = status === "CANCELLED"
    ? (customerName ? `Hello, ${customerName}.` : "Hello,")
    : `Hello, ${customerName || "fellow wing lover"}! 🍗`;

  const content: Record<
    OrderEmailStatus,
    { subject: string; headline: string; highlight: string; message: string; closing?: string }
  > = {
    ACCEPTED: {
      subject: `${orderLabel} accepted | Wings 4 U`,
      headline: `Your order #${String(order.orderNumber)} has been accepted!`,
      highlight: "Your order is being prepared.",
      message:
        "Thanks for ordering from Wings 4 U! Our kitchen has started preparing your order.",
    },
    PICKED_UP: {
      subject: `${orderLabel} picked up | Wings 4 U`,
      headline: `Your order #${String(order.orderNumber)} has been picked up!`,
      highlight: "Enjoy your meal! 🍗",
      message:
        "Thank you for choosing Wings 4 U. We hope you enjoy every bite!",
      closing: "We can't wait to serve you again.",
    },
    DELIVERED: {
      subject: `${orderLabel} delivered | Wings 4 U`,
      headline: `Your order #${String(order.orderNumber)} has been delivered!`,
      highlight: "Your order has arrived!",
      message:
        "Thanks for inviting Wings 4 U to your table. We hope everything arrived hot, fresh, and delicious.",
    },
    CANCELLED: {
      subject: `${orderLabel} cancelled | Wings 4 U`,
      headline: `${orderLabel} has been cancelled`,
      highlight: "Order cancelled",
      message:
        order.cancellationSource === "CUSTOMER_SELF"
          ? "Your cancellation is confirmed."
          : "We’re sorry, but Wings 4 U had to cancel your order.",
    },
  };
  const selected = content[status];
  const cancellationReason =
    status === "CANCELLED" ? order.cancellationReason?.trim() : null;
  const paragraphs = [selected.message, ...(selected.closing ? [selected.closing] : [])];

  return {
    subject: selected.subject,
    text: [greeting, selected.headline, selected.highlight, ...paragraphs,
      ...(cancellationReason ? [`Reason: ${cancellationReason}`] : []),
      "See you soon,\nThe Wings 4 U Team ❤️"].join("\n\n"),
    html: renderBrandedEmail({ greeting, headline: selected.headline, highlight: selected.highlight, paragraphs,
      ...(cancellationReason ? { detail: { label: "Reason", value: cancellationReason } } : {}),
    }),
  };
}

@Injectable()
export class OrderStatusEmailService {
  private readonly logger = new Logger(OrderStatusEmailService.name);
  constructor(private readonly prisma: PrismaService) {}

  async send(
    order: OrderEmailDetails,
    status: OrderEmailStatus,
  ): Promise<boolean> {
    if (!order.customerEmailSnapshot?.trim() || !process.env.RESEND_API_KEY?.trim()) return this.deliver(order, status);
    try {
      // Hold the owner lock through the bounded provider attempt. Deletion
      // either waits for an already-started email, or prevents stale snapshots
      // from being sent after it commits. A copied in-memory recipient is insufficient.
      return await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ account_deleted_at: Date | null }>>`
          SELECT u.account_deleted_at FROM users u JOIN orders o ON o.customer_user_id = u.id
          WHERE o.id = ${order.id}::uuid FOR KEY SHARE OF u`;
        if (rows.some(row => row.account_deleted_at !== null)) return false;
        return this.deliver(order, status);
      }, { timeout: 15_000 });
    } catch {
      this.logger.error("Order notification recipient authorization could not be confirmed");
      return false;
    }
  }

  private async deliver(order: OrderEmailDetails, status: OrderEmailStatus): Promise<boolean> {
    const recipient = order.customerEmailSnapshot?.trim();
    if (!recipient) {
      this.logger.warn(
        `Skipped ${status} email for order ${order.id}: no customer email`,
      );
      return false;
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error(
        `Skipped ${status} email for order ${order.id}: RESEND_API_KEY is missing`,
      );
      return false;
    }

    const email = renderEmail(order, status);
    const from =
      process.env.RESEND_FROM?.trim() ||
      "Wings 4 U <no-reply@wings4ulondon.ca>";

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `order-status/${status.toLowerCase()}/${order.id}`,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.error(
          `Resend rejected ${status} email for order ${order.id} (${response.status})`,
        );
        return false;
      }

      this.logger.log(`Sent ${status} email for order ${order.id}`);
      return true;
    } catch {
      this.logger.error(
        `Failed to send ${status} email for order ${order.id}`,
      );
      return false;
    }
  }
}
