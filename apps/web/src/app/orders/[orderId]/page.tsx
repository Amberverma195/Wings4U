import { OrderTrackingWithAuth } from "./order-tracking-with-auth";

export default async function PublicOrderTrackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await params;
  return <OrderTrackingWithAuth />;
}
