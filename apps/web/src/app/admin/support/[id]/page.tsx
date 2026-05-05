"use client";

import { use } from "react";
import { SupportDetailClient } from "./support-detail-client";

export default function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const ticketId = typeof id === "string" ? id : "";

  if (!ticketId) return null;

  return <SupportDetailClient ticketId={ticketId} />;
}
