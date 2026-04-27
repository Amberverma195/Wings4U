import { OrderDetailClient } from "@/app/orders/[orderId]/order-detail-client";
import { OrderSkeleton } from "@/app/orders/[orderId]/order-skeleton";
import { RequireAuthModal } from "@/components/require-auth-modal";

type Props = { params: Promise<{ orderId: string }> };

export default async function AccountOrderDetailPage({ params }: Props) {
  const { orderId } = await params;
  return (
    <main className="surface-shell order-detail-shell">
      <RequireAuthModal
        ariaLabel="Sign in to track your order"
        fallback={<OrderSkeleton />}
      >
        <OrderDetailClient key={orderId} orderId={orderId} />
      </RequireAuthModal>
    </main>
  );
}
