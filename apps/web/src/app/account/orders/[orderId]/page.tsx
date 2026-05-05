import { OrderTrackingWithAuth } from "@/app/orders/[orderId]/order-tracking-with-auth";

export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await params;
  return (
    <OrderTrackingWithAuth shellClassName="surface-shell order-detail-shell" />
  );
}
