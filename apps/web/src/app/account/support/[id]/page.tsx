"use client";

import { use } from "react";
import { AccountSkeleton } from "@/components/account-skeleton";
import { RequireAuthModal } from "@/components/require-auth-modal";
import { TicketDetailClient } from "./ticket-detail-client";

export default function AccountSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
