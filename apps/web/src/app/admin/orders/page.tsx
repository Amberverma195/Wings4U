import { OrdersListClient } from "./orders-list-client";
import { Suspense } from "react";

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<p className="surface-muted">Loading orders...</p>}>
      <OrdersListClient />
    </Suspense>
  );
}
