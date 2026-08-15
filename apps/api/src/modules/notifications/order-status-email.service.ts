import { Injectable, Logger } from "@nestjs/common";

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmail(
  order: OrderEmailDetails,
  status: OrderEmailStatus,
): RenderedEmail {
  const orderLabel = `Order #${String(order.orderNumber)}`;
  const customerName = order.customerNameSnapshot.trim();
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";

  const content: Record<
    OrderEmailStatus,
    { subject: string; headline: string; message: string }
  > = {
    ACCEPTED: {
      subject: `${orderLabel} accepted | Wings 4 U`,
      headline: `${orderLabel} has been accepted`,
      message:
        "Thanks for ordering from Wings 4 U. Our kitchen has started preparing your order.",
    },
    PICKED_UP: {
      subject: `${orderLabel} picked up | Wings 4 U`,
      headline: `${orderLabel} has been picked up`,
      message:
        "Thank you for choosing Wings 4 U. We hope you enjoy every bite.",
    },
    DELIVERED: {
      subject: `${orderLabel} delivered | Wings 4 U`,
      headline: `${orderLabel} has been delivered`,
      message:
        "Thanks for inviting Wings 4 U to your table. We hope everything arrived hot, fresh, and delicious.",
    },
    CANCELLED: {
      subject: `${orderLabel} cancelled | Wings 4 U`,
      headline: `${orderLabel} has been cancelled`,
      message:
        order.cancellationSource === "CUSTOMER_SELF"
          ? "Your cancellation is confirmed."
          : "We’re sorry, but Wings 4 U had to cancel your order.",
    },
  };
  const selected = content[status];
  const cancellationReason =
    status === "CANCELLED" ? order.cancellationReason?.trim() : null;
  const reasonText = cancellationReason
    ? `\n\nReason: ${cancellationReason}`
    : "";
  const reasonHtml = cancellationReason
    ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.5;"><strong>Reason:</strong> ${escapeHtml(cancellationReason)}</p>`
    : "";

  return {
    subject: selected.subject,
    text: `${greeting}\n\n${selected.message}${reasonText}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;color:#e85d04;">Wings 4 U</h2>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;">${escapeHtml(selected.headline)}</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${escapeHtml(greeting)}</p>
        <p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(selected.message)}</p>
        ${reasonHtml}
      </div>
    `,
  };
}

@Injectable()
export class OrderStatusEmailService {
  private readonly logger = new Logger(OrderStatusEmailService.name);

  async send(
    order: OrderEmailDetails,
    status: OrderEmailStatus,
  ): Promise<boolean> {
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
        const body = await response.text().catch(() => "");
        this.logger.error(
          `Resend rejected ${status} email for order ${order.id} (${response.status}): ${body.slice(0, 500)}`,
        );
        return false;
      }

      this.logger.log(`Sent ${status} email for order ${order.id}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send ${status} email for order ${order.id}: ${error instanceof Error ? error.message : "network error"}`,
      );
      return false;
    }
  }
}
