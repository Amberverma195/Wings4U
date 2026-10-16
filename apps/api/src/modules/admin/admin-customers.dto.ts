/** Read-only Admin response DTOs, shared with the web through type-only imports. */
export interface AdminCustomerAddress {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  postal_code: string;
  is_default: boolean;
}

export interface AdminCustomerDetail {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  created_at: string;
  saved_addresses: AdminCustomerAddress[];
  default_address: AdminCustomerAddress | null;
}

export interface AdminCustomerOrder {
  id: string;
  order_number: string;
  placed_at: string;
  status: string;
  fulfillment_type: string;
  final_payable_cents: number;
}
export interface AdminCustomerOrdersPage {
  orders: AdminCustomerOrder[];
  next_cursor: string | null;
}

export interface AdminCustomerStampSummary {
  available_stamps: number;
  lifetime_stamps: number;
  lifetime_redemptions: number;
  stamps_per_reward: number;
  reward_available: boolean;
}
export interface AdminCustomerStampEntry {
  id: string;
  entry_type: string;
  delta_stamps: number;
  balance_after_stamps: number;
  pounds_awarded: number | null;
  reason_text: string;
  created_at: string;
  order_id: string | null;
  order_number: string | null;
  order_fulfillment_type: string | null;
  order_accessible: boolean;
}
export interface AdminCustomerStampsPage {
  summary: AdminCustomerStampSummary;
  entries: AdminCustomerStampEntry[];
  next_cursor: string | null;
}

export type StampGrantReason = "WRONG_ORDER" | "MISSING_ITEMS" | "SERVICE_RECOVERY" | "OTHER";
export interface AdminStampGrantInput {
  stamps: number;
  reason: StampGrantReason;
  note?: string;
  request_id: string;
}
export interface StampGrantEmailResult {
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED" | "UNKNOWN";
  message: string;
  retryable: boolean;
}
export interface AdminStampGrantResult {
  grant_id: string;
  stamps_granted: number;
  replayed: boolean;
  summary: AdminCustomerStampSummary;
  entry: AdminCustomerStampEntry;
  email: StampGrantEmailResult;
}
