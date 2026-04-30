import { OrderTrackingWithAuth } from "@/app/orders/[orderId]/order-tracking-with-auth";

export default function AccountOrderDetailPage() {
  return (
    <OrderTrackingWithAuth shellClassName="surface-shell order-detail-shell" />
  );
}
