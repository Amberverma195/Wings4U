export type SupportActor = {
  user_id: string | null; display_name: string; role: string | null; account_available: boolean;
};
export type SupportOrder = {
  id: string; order_number: string; status: string; fulfillment_type: string;
  placed_at: string; final_payable_cents: number;
  customer_name_snapshot: string; customer_phone_snapshot: string; customer_email_snapshot: string | null;
};
export type TicketSummary = {
  id: string; subject: string; description: string; status: string; priority: string; ticket_type: string;
  order_id: string | null; customer_user_id: string | null; resolution_type: string | null;
  resolved_at: string | null; created_at: string; updated_at: string; created_source: string;
  customer: SupportActor & { first_name: string | null; last_name: string | null;
    primary_phone: string | null; primary_email: string | null };
  order: SupportOrder | null; assigned_admin: SupportActor | null;
};

export function readable(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}
