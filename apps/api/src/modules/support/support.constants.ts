/**
 * Mirrors `support_tickets.ticket_type` CHECK in `db/sql/0001_wings4u_baseline_v1_4.sql`.
 */
export const SUPPORT_TICKET_TYPES = [
  "WRONG_ITEM",
  "MISSING_ITEM",
  "COLD_FOOD",
  "BURNT_FOOD",
  "DELIVERY_ISSUE",
  "DRIVER_ISSUE",
  "QUALITY_ISSUE",
  "PAYMENT_ISSUE",
  "OTHER",
] as const;

export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];
