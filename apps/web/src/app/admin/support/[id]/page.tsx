"use client";

import { useParams } from "next/navigation";
import { SupportDetailClient } from "./support-detail-client";

export default function AdminSupportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = typeof id === "string" ? id : "";

  if (!ticketId) return null;

  return <SupportDetailClient ticketId={ticketId} />;
}
