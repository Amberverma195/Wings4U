import { use } from "react";
import { TicketDetailClient } from "./ticket-detail-client";
import { RequireAuthModal } from "@/components/require-auth-modal";

export default function AccountSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <main>
      <RequireAuthModal ariaLabel="Sign in to view your support ticket">
        <TicketDetailClient ticketId={id} />
      </RequireAuthModal>
    </main>
  );
}
