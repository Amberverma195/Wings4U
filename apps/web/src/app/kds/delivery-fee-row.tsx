import { cents } from "@/lib/format";

/** Display the persisted charge, including zero, without repricing the order. */
export function DeliveryFeeRow({ order }: {
  order: { fulfillment_type: string; delivery_fee_cents: number };
}) {
  if (order.fulfillment_type !== "DELIVERY") return null;

  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
      <span>Delivery Fee</span>
      <span>{order.delivery_fee_cents === 0 ? "Free" : cents(order.delivery_fee_cents)}</span>
    </div>
  );
}
