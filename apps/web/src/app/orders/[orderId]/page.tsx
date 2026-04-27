import dynamic from "next/dynamic";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { OrderSkeleton } from "./order-skeleton";

const OrderDetailClient = dynamic(
  () => import("./order-detail-client").then((mod) => mod.OrderDetailClient),
  { loading: () => <OrderSkeleton /> }
);

type Props = { params: Promise<{ orderId: string }> };

export default async function PublicOrderTrackingPage({ params }: Props) {
  const { orderId } = await params;
  return (
    <RequireAuthModal
      ariaLabel="Sign in to track your order"
      fallback={<OrderSkeleton />}
    >
      <OrderDetailClient key={orderId} orderId={orderId} />
    </RequireAuthModal>
  );
}
