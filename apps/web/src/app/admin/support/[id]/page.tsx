import { SupportDetailClient } from "./support-detail-client";

export default async function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SupportDetailClient ticketId={id} />;
}
