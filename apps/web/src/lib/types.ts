/* Menu */

export type ModifierOption = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_default: boolean;
  addon_match_normalized?: string | null;
  linked_flavour_id: string | null;
};

export type ModifierGroup = {
  id: string;
  name: string;
  display_label: string;
  selection_mode: "SINGLE" | "MULTI";
  min_select: number;
  max_select: number | null;
  is_required: boolean;
  sort_order: number;
  context_key: string | null;
  options: ModifierOption[];
};

export type RemovableIngredient = {
  id: string;
  name: string;
  sort_order: number;
};

export type BuilderMenuOption = {
  menu_item_id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  weight_lb: number;
  flavour_count: number;
  side_slot_count: number;
  drink_slot_count: number;
  modifier_groups: ModifierGroup[];
};

export type ItemSchedule = {
  day_of_week: number;
  time_from: string;
  time_to: string;
};

export type MenuItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  allowed_fulfillment_type: "BOTH" | "PICKUP" | "DELIVERY";
  is_available: boolean;
  stock_status: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
  is_popular: boolean;
  image_url: string | null;
  builder_type: string | null;
  requires_special_instructions: boolean;
  schedules: ItemSchedule[] | null;
  modifier_groups: ModifierGroup[];
  removable_ingredients: RemovableIngredient[];
  weight_options?: BuilderMenuOption[];
  combo_options?: BuilderMenuOption[];
  builder_sku_map?: Record<string, string>;
};

export type MenuCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  items: MenuItem[];
};

export type LocationInfo = {
  id: string;
  name: string;
  timezone: string;
  is_open: boolean;
  busy_mode: boolean;
  estimated_prep_minutes: number;
  delivery_fee_cents: number;
  free_delivery_threshold_cents: number | null;
  minimum_delivery_subtotal_cents: number;
  delivery_disabled?: boolean;
  delivery_available_from_minutes?: number | null;
  delivery_available_until_minutes?: number | null;
  delivery_currently_available?: boolean;
  delivery_unavailable_reason?: string | null;
  pickup_min_minutes: number;
  pickup_max_minutes: number;
  delivery_min_minutes: number;
  delivery_max_minutes: number;
  prepayment_threshold_no_shows: number;
  customer_total_no_shows: number | null;
  delivery_blocked_due_to_no_shows: boolean;
  pickup_hours: LocationServiceHours[];
  delivery_hours: LocationServiceHours[];
  store_hours?: LocationServiceHours[];
};

export type LocationServiceHours = {
  day_of_week: number;
  time_from: string;
  time_to: string;
  is_closed: boolean;
};

export type MenuResponse = {
  categories: MenuCategory[];
  location: LocationInfo;
};

/* Cart (client-side) */

export type FulfillmentType = "PICKUP" | "DELIVERY";

export type CartModifierSelection = {
  modifier_option_id?: string;
  group_name: string;
  option_name: string;
  price_delta_cents: number;
};

export type RemovedIngredientSelection = {
  id: string;
  name: string;
};

export type WingBuilderPayload = {
  builder_type: "WINGS" | "WING_COMBO";
  wing_type: "BONE_IN" | "BONELESS";
  preparation: "BREADED" | "NON_BREADED";
  weight_lb: number;
  flavour_slots: Array<{
    slot_no: number;
    wing_flavour_id: string;
    flavour_name: string;
    placement: "ON_WINGS" | "ON_SIDE" | "MIXED";
  }>;
  saucing_method?: string;
  /** Party 5-flavour packs: free-text when saucing_method is TELL_US_HOW. */
  saucing_customer_note?: string;
  /**
   * When set, 1-based slot number whose flavour is served on the side.
   * Populated when saucing_method is SIDE (2-flavour) or
   * TWO_MIXED_ONE_SIDE (3-flavour) so the kitchen can see at a glance
   * which sauce got separated. The same info is also encoded in
   * flavour_slots[*].placement, this is just a quick lookup.
   */
  side_flavour_slot_no?: number;
  extra_flavour?: {
    wing_flavour_id: string;
    flavour_name: string;
    placement: "ON_WINGS" | "ON_SIDE" | "MIXED";
  };
  side_selections?: string[];
  drink_selections?: string[];
  salad_customization?: {
    salad_menu_item_id: string;
    salad_name: string;
    salad_slug: string;
    removed_ingredients: RemovedIngredientSelection[];
    modifier_selections: Array<{
      modifier_option_id: string;
      name: string;
      price_delta_cents: number;
    }>;
  };
};

/** Standalone burger/wrap add-on: small side + pop for a fixed upcharge (see seed POP lineup). */
export const SIDE_POP_BUNDLE_PRICE_CENTS = 499;

export type ItemCustomizationPayload = {
  builder_type: "ITEM_CUSTOMIZATION";
  removed_ingredients: RemovedIngredientSelection[];
  side_pop_bundle?: {
    price_cents: typeof SIDE_POP_BUNDLE_PRICE_CENTS;
    side_label: string;
    pop_label: string;
  };
};

/**
 * Lunch specials (lunch-burger, lunch-wrap): the cart line is the lunch row,
 * but the customer also picks one of several child items (e.g. which burger)
 * and may remove ingredients / add extras on that child. Because the API
 * would reject child modifier_option_ids on the parent line, we serialize
 * the child choice + its customizations into the builder_payload and a
 * human-readable special_instructions string for the kitchen. Pricing for
 * any child upcharges is currently best-effort: customers see the price in
 * the builder, but the lunch row's base price still drives the cart total.
 */
export type LunchSpecialPayload = {
  builder_type: "LUNCH_SPECIAL";
  child_menu_item_id: string;
  child_name: string;
  child_slug: string;
  removed_ingredients: RemovedIngredientSelection[];
  /**
   * Add-ons selected on the child item, normalized to {name, price_delta_cents}
   * so the kitchen and the in-builder total stay aligned. These do NOT post to
   * the API as modifier_option_ids — see the type docstring above.
   */
  child_addons: Array<{
    modifier_option_id: string;
    name: string;
    price_delta_cents: number;
  }>;
};

export type CartBuilderPayload =
  | WingBuilderPayload
  | ItemCustomizationPayload
  | LunchSpecialPayload;

export type CartItem = {
  key: string;
  menu_item_id: string;
  menu_item_slug?: string | null;
  name: string;
  image_url?: string | null;
  base_price_cents: number;
  quantity: number;
  modifier_selections: CartModifierSelection[];
  removed_ingredients?: RemovedIngredientSelection[];
  special_instructions: string;
  builder_payload?: CartBuilderPayload;
};

export type WingFlavour = {
  id: string;
  name: string;
  slug: string;
  heat_level: string;
  is_plain: boolean;
  sort_order: number;
};

/* Cart quote (API response) */

export type QuoteLine = {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  modifier_total_cents: number;
  line_total_cents: number;
  special_instructions: string | null;
};

/**
 * Wings-rewards preview attached to every cart quote. Always populated
 * (never omitted) so the cart page can decide whether to show the
 * "Get 1lb of wings free" card in the Coupons modal without having to
 * make a separate `/rewards/me` call on every cart edit.
 */
export type WingsRewardPreview = {
  /** User's current available stamps (0 if signed out). */
  available_stamps: number;
  /** Total pounds of wings detected in the cart. */
  pounds_in_cart: number;
  /** True iff available_stamps >= 8 AND pounds_in_cart >= 1. */
  eligible: boolean;
  /** Whether `apply_wings_reward: true` was honored on this quote. */
  applied: boolean;
  /** When `applied`, the cheapest per-lb discount cents folded into `item_discount_total_cents`. */
  discount_cents: number;
  /** Machine-readable "why not eligible" reason the cart can translate. */
  not_eligible_reason:
    | null
    | "NOT_SIGNED_IN"
    | "NOT_ENOUGH_STAMPS"
    | "NO_WINGS_IN_CART";
};

export type ActivePromoBxgySize =
  | {
      kind: "weight_lb";
      weightLb: number;
      label: string;
    }
  | {
      kind: "modifier_option";
      modifierOptionId: string;
      label: string;
    }
  | null;

export type ActivePromo = {
  id: string;
  code: string;
  name: string;
  discountType: "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";
  discountValue: number;
  minSubtotalCents: number;
  startsAt: string | null;
  endsAt: string | null;
  isOneTimePerCustomer: boolean;
  eligibleFulfillmentType: "BOTH" | "PICKUP" | "DELIVERY" | string;
  autoApply?: boolean;
  benefitSummary?: string;
  bxgyRule:
    | null
    | {
        qualifyingProductId?: string | null;
        qualifyingCategoryId?: string | null;
        requiredQty: number;
        rewardProductId?: string | null;
        rewardCategoryId?: string | null;
        rewardQty: number;
        rewardRule: string;
        maxUsesPerOrder: number;
        qualifyingSize?: ActivePromoBxgySize;
        rewardSize?: ActivePromoBxgySize;
        qualifyingLabel?: string | null;
        rewardLabel?: string | null;
      };
};

export type CartQuoteResponse = {
  item_subtotal_cents: number;
  item_discount_total_cents: number;
  order_discount_total_cents: number;
  discounted_subtotal_cents: number;
  taxable_subtotal_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  /** Location’s configured delivery fee (e.g. 499); 0 when fulfillment is pickup. */
  delivery_fee_stated_cents: number;
  /** True when free-delivery threshold applied and the charged fee is 0. */
  delivery_fee_waived: boolean;
  applied_promo_code?: string;
  promo_discount_cents?: number;
  driver_tip_cents: number;
  wallet_applied_cents: number;
  final_payable_cents: number;
  lines: QuoteLine[];
  wings_reward: WingsRewardPreview;
};

/* Checkout (API response) */

export type CheckoutResponse = {
  id: string;
  order_number: number;
  status: string;
  fulfillment_type: FulfillmentType;
  item_subtotal_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  driver_tip_cents: number;
  wallet_applied_cents: number;
  final_payable_cents: number;
  estimated_ready_at: string;
  cancel_allowed_until: string | null;
  created_at: string;
};

/* Order (API responses) */

export type OrderStatus =
  | "PLACED"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "PICKED_UP"
  | "DELIVERED"
  | "NO_SHOW_PICKUP"
  | "NO_SHOW_DELIVERY"
  | "NO_PIN_DELIVERY"
  | "CANCELLED";

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "PICKED_UP",
  "DELIVERED",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
  "CANCELLED",
]);

export const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
]);

export type OrderSummary = {
  id: string;
  location_id: string;
  order_number: number;
  order_source: string;
  fulfillment_type: FulfillmentType;
  status: OrderStatus;
  scheduled_for: string | null;
  placed_at: string;
  item_subtotal_cents: number;
  final_payable_cents: number;
  payment_status_summary: string;
  customer_order_notes: string | null;
  estimated_ready_at: string | null;
  estimated_window_min_minutes: number | null;
  estimated_window_max_minutes: number | null;
  cancel_allowed_until: string | null;
  created_at: string;
  updated_at: string;
  unread_chat_count?: number;
};

export type OrderItemModifier = {
  id: string;
  modifier_group_id: string | null;
  modifier_option_id: string | null;
  modifier_group_name_snapshot: string;
  modifier_name_snapshot: string;
  modifier_kind: string;
  quantity: number;
  price_delta_cents: number;
  sort_order: number;
};

export type OrderItemFlavour = {
  id: string;
  wing_flavour_id: string;
  flavour_name_snapshot: string;
  heat_level_snapshot: number | null;
  slot_no: number;
  flavour_role: string;
  placement: string;
  sort_order: number;
};

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string;
  line_no: number;
  product_name_snapshot: string;
  category_name_snapshot: string;
  builder_type: string | null;
  quantity: number;
  unit_price_cents: number;
  line_discount_cents: number;
  line_total_cents: number;
  special_instructions: string | null;
  builder_payload_json: unknown;
  modifiers: OrderItemModifier[];
  flavours: OrderItemFlavour[];
};

export type OrderStatusEvent = {
  id: string;
  from_status: string | null;
  to_status: string;
  event_type: string;
  actor_user_id: string | null;
  reason_text: string | null;
  created_at: string;
};

export type OrderPayment = {
  id: string;
  payment_method: string;
  amount_cents: number;
  status: string;
  created_at: string;
};

export type OrderDetail = {
  id: string;
  location_id: string;
  customer_user_id: string;
  order_number: number;
  order_source: string;
  fulfillment_type: FulfillmentType;
  status: OrderStatus;
  contactless_pref: string | null;
  scheduled_for: string | null;
  placed_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  assigned_driver_user_id: string | null;
  estimated_arrival_at: string | null;
  delivery_started_at: string | null;
  cancellation_reason: string | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  address_snapshot_json: Record<string, string> | null;
  item_subtotal_cents: number;
  item_discount_total_cents: number;
  order_discount_total_cents: number;
  discounted_subtotal_cents: number;
  taxable_subtotal_cents: number;
  tax_cents: number;
  tax_rate_bps: number;
  delivery_fee_cents: number;
  driver_tip_cents: number;
  wallet_applied_cents: number;
  final_payable_cents: number;
  payment_status_summary: string;
  customer_order_notes: string | null;
  estimated_ready_at: string | null;
  estimated_window_min_minutes: number | null;
  estimated_window_max_minutes: number | null;
  student_discount_requested: boolean;
  cancel_allowed_until: string | null;
  location_phone: string | null;
  location_name: string | null;
  assigned_driver: {
    user_id: string;
    full_name: string;
    phone: string | null;
    vehicle_type: string | null;
    vehicle_identifier: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  status_events: OrderStatusEvent[];
  payments: OrderPayment[];
};

/* Chat (API responses) */

export type ChatMessage = {
  id: string;
  conversation_id: string;
  order_id: string;
  sender_user_id: string;
  sender_surface: "CUSTOMER" | "KDS" | "MANAGER" | "ADMIN" | "DRIVER";
  message_body: string;
  is_system_message: boolean;
  visibility: "BOTH" | "STAFF_ONLY";
  created_at: string;
};

export type ChatResponse = {
  conversation_id: string | null;
  is_closed: boolean;
  messages: ChatMessage[];
  next_cursor: string | null;
};

/* Support tickets */

export type SupportTicketType =
  | "WRONG_ITEM"
  | "MISSING_ITEM"
  | "COLD_FOOD"
  | "BURNT_FOOD"
  | "DELIVERY_ISSUE"
  | "DRIVER_ISSUE"
  | "QUALITY_ISSUE"
  | "PAYMENT_ISSUE"
  | "OTHER";

export const SUPPORT_TICKET_TYPES: readonly SupportTicketType[] = [
  "WRONG_ITEM",
  "MISSING_ITEM",
  "COLD_FOOD",
  "BURNT_FOOD",
  "DELIVERY_ISSUE",
  "DRIVER_ISSUE",
  "QUALITY_ISSUE",
  "PAYMENT_ISSUE",
  "OTHER",
];
