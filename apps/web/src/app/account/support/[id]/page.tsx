"use client";

import { useParams } from "next/navigation";
import { AccountSkeleton } from "@/components/account-skeleton";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { TicketDetailClient } from "./ticket-detail-client";

export default function AccountSupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = typeof id === "string" ? id : "";

  return (
    <main>
      <RequireAuthModal ariaLabel="Sign in to view your support ticket">
        {ticketId ? (
          <TicketDetailClient ticketId={ticketId} />
        ) : (
          <AccountSkeleton />
        )}
      </RequireAuthModal>
    </main>
  );
}
