export function cents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return shortDate(iso);
}

const STATUS_LABELS: Record<string, string> = {
  PLACED: "Order placed",
  ACCEPTED: "Order accepted",
  PREPARING: "Preparing your order",
  READY: "Ready",
  PICKED_UP: "Picked up",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  NO_SHOW_PICKUP: "No-show (not picked up)",
  NO_SHOW_DELIVERY: "Delivery not completed",
  NO_PIN_DELIVERY: "Delivery completed without PIN",
  CANCELLED: "Order cancelled",
  // Fulfillment type labels (reused by order-detail-client)
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pickup-specific ready label per PRD §7.3 */
export function readyLabel(fulfillmentType: string): string {
  return fulfillmentType === "PICKUP" ? "Ready for pickup" : "Ready";
}

/** Customer-facing order status label, with pickup-specific READY wording. */
export function orderStatusCustomerLabel(
  status: string,
  fulfillmentType: string,
): string {
  return status === "READY" ? readyLabel(fulfillmentType) : statusLabel(status);
}
