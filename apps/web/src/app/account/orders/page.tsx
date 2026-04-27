import { OrdersListClient } from "./orders-list-client";
import { RequireAuthModal } from "@/components/require-auth-modal";

export default function AccountOrdersPage() {
  return (
    <main>
      <RequireAuthModal ariaLabel="Sign in to see your orders">
        <OrdersListClient />
      </RequireAuthModal>
    </main>
  );
}
