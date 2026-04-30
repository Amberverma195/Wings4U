"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { OrderSkeleton } from "./order-skeleton";

const OrderDetailClient = dynamic(
  () => import("./order-detail-client").then((mod) => mod.OrderDetailClient),
  { loading: () => <OrderSkeleton /> },
);

export function OrderTrackingWithAuth({
  shellClassName,
}: {
  shellClassName?: string;
}) {
  const { orderId } = useParams<{ orderId: string }>();
  const safeOrderId = typeof orderId === "string" ? orderId : "";

  const body =
    safeOrderId === "" ? (
      <OrderSkeleton />
    ) : (
      <RequireAuthModal
        ariaLabel="Sign in to track your order"
        fallback={<OrderSkeleton />}
      >
        <OrderDetailClient key={safeOrderId} orderId={safeOrderId} />
      </RequireAuthModal>
    );

  return shellClassName ? (
    <main className={shellClassName}>{body}</main>
  ) : (
    body
  );
}
