import { TicketDetailClient } from "./ticket-detail-client";
import { RequireAuthModal } from "@/components/require-auth-modal";

export default async function AccountSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main>
      <RequireAuthModal ariaLabel="Sign in to view your support ticket">
        <TicketDetailClient ticketId={id} />
      </RequireAuthModal>
    </main>
  );
}
