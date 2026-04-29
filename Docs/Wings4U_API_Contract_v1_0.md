# Wings4U API Contract v1.0

**Aligned to:** PRD v3.5, Schema v1.4, Blueprint v4.0, Schema Spec v1.4

**Status:** Launch scope — frozen for parallel FE/BE implementation

---

## Global Conventions

### Base URL
`/api/v1`

### Browser Auth (Customers, Staff, Admin)
Sessions use Secure, HTTP-only, SameSite=Lax cookies. The server sets two cookies on successful login:
- `access_token` — short-lived JWT (Secure, HttpOnly, SameSite=Lax, Path=/api)
- `refresh_token` — long-lived opaque token (Secure, HttpOnly, SameSite=Lax, Path=/api/v1/auth/refresh)

Tokens are NEVER returned in JSON response bodies. Frontend JavaScript cannot read HTTP-only cookies — this is the security model, not a bug.

**CSRF:** All state-changing requests (POST, PUT, PATCH, DELETE) from browser sessions must include a CSRF token. The server issues a non-HttpOnly `csrf_token` cookie on login; the frontend reads it and sends it as `X-CSRF-Token` header on every mutating request.

### Device Auth (Printers, KDS Screens, POS Terminals)
Device endpoints use `X-Device-Token` header with the raw API token issued at device registration. The server validates against `devices.api_token_hash` (bcrypt). Device auth does NOT use cookies or browser session model. One device = one active token at a time. Admin can rotate tokens from the devices admin page.

### Auth Model
- `users.role` gates endpoint class: CUSTOMER, STAFF, ADMIN
- STAFF endpoints additionally check `employee_profiles.role` (MANAGER, CASHIER, KITCHEN, DRIVER)
- ADMIN bypasses all employee_profiles.role checks
- POS endpoints are IP-allowlisted to the store's network (WiFi-gated)

### Location Scoping
All operational endpoints require `X-Location-Id` header (uuid). Backend validates that the authenticated user has access to this location.

### Request Format
JSON (`Content-Type: application/json`). All monetary values in cents (int). All timestamps in ISO 8601 UTC (`timestamptz`).

### Response Envelope
```json
{
  "data": { ... },
  "meta": { "request_id": "uuid" },
  "errors": null
}
```

### Error Envelope
```json
{
  "data": null,
  "meta": { "request_id": "uuid" },
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "Human-readable message",
      "field": "optional_field_name",
      "detail": {}
    }
  ]
}
```

### Standard Error Codes
| Code | HTTP | Meaning |
|------|------|---------|
| UNAUTHORIZED | 401 | Missing or invalid token |
| FORBIDDEN | 403 | Valid token but insufficient role/permission |
| NOT_FOUND | 404 | Resource does not exist or not accessible in this location |
| VALIDATION_FAILED | 422 | Request body fails validation |
| CONFLICT | 409 | State conflict (e.g. order already cancelled) |
| IDEMPOTENCY_CONFLICT | 409 | Idempotency key already used with different payload |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

### Idempotency
Mutating endpoints that create resources accept `Idempotency-Key: <uuid>` header. If the same key is reused with the same payload, the server returns the original response. If reused with a different payload, returns `IDEMPOTENCY_CONFLICT`.

Critical idempotent endpoints: checkout, payment capture, refund issuance, credit issuance.

### Pagination
List endpoints use cursor pagination:
```
?cursor=<opaque_token>&limit=25
```
Response includes `meta.next_cursor` (null if no more pages).

### Realtime
WebSocket at `/ws` with channel subscriptions. Polling fallback every 30 seconds for all realtime surfaces. See Section 12 for event payloads.

---

## 1. Auth & Identity

### POST /auth/otp/request
Request OTP for phone login.

| Field | Notes |
|-------|-------|
| Auth | None |
| Idempotency | Rate-limited: 1 per 60s per phone |

**Request:**
```json
{ "phone": "+15191234567" }
```

**Response (200):**
```json
{ "data": { "otp_sent": true, "expires_in_seconds": 300 } }
```

**Errors:** `RATE_LIMITED` (too many OTP requests)

---

### POST /auth/otp/verify
Verify OTP and issue session.

| Field | Notes |
|-------|-------|
| Auth | None |
| Side effects | Creates user + user_identities row if first login (guest auto-registration). Sets `access_token` and `refresh_token` as Secure HTTP-only cookies. Sets `csrf_token` as non-HttpOnly cookie. |

**Request:**
```json
{ "phone": "+15191234567", "otp_code": "123456" }
```

**Response (200):**
```json
{
  "data": {
    "user": { "id": "uuid", "role": "CUSTOMER", "phone": "+15191234567" }
  }
}
```
*Tokens are set via `Set-Cookie` headers, NOT in the response body.*

**Errors:** `VALIDATION_FAILED` (invalid/expired OTP), `RATE_LIMITED` (too many attempts → lockout)

---

### POST /auth/refresh
Refresh access token. Server reads refresh token from HTTP-only cookie, not from request body.

| Field | Notes |
|-------|-------|
| Auth | Refresh token cookie (automatic) |
| Side effects | Rotates refresh token (old token invalidated, new cookie set). Issues new access token cookie. |

**Request:** Empty body. Refresh token sent automatically via cookie.

**Response (200):**
```json
{ "data": { "refreshed": true } }
```
*New tokens set via `Set-Cookie` headers.*

**Errors:** `UNAUTHORIZED` (revoked/expired/missing refresh cookie)

---

### POST /auth/logout
Revoke current session and clear auth cookies.

| Field | Notes |
|-------|-------|
| Auth | Access token cookie (automatic) |
| Side effects | Revokes server-side refresh session, clears `access_token`, `refresh_token`, and `csrf_token` cookies |

**Response (200):** `{ "data": { "logged_out": true } }`

---

### POST /auth/pos/login
POS login with 5-digit employee code.

| Field | Notes |
|-------|-------|
| Auth | None (IP-allowlisted) |
| Validation | WiFi IP range check against location_settings.trusted_ip_ranges. Backend hashes `employee_code` from request and validates against `employee_profiles.employee_pin_hash` (bcrypt). The raw code is never stored. |

**Request:**
```json
{ "employee_code": "12345", "location_id": "uuid" }
```

**Response (200):**
```json
{
  "data": {
    "user": { "id": "uuid", "role": "STAFF" },
    "employee": { "role": "CASHIER", "location_id": "uuid" }
  }
}
```
*Tokens set via `Set-Cookie` headers, same as customer login. POS sessions use the same cookie model but are additionally IP-allowlisted.*

**Errors:** `FORBIDDEN` (IP not in allowlist), `VALIDATION_FAILED` (invalid code), `CONFLICT` (employee not active at this location)

---

## 2. Customer Menu & Catalog

### GET /menu
Full menu for customer storefront.

| Field | Notes |
|-------|-------|
| Auth | Optional (guest browsing allowed) |
| Query params | `location_id` (required), `fulfillment_type` (PICKUP or DELIVERY) |

**Response (200):**
```json
{
  "data": {
    "categories": [
      {
        "id": "uuid",
        "name": "Wings",
        "sort_order": 1,
        "items": [
          {
            "id": "uuid",
            "name": "Bone-In Wings",
            "description": "...",
            "base_price_cents": 1499,
            "allowed_fulfillment_type": "BOTH",
            "is_available": true,
            "image_url": "...",
            "modifier_groups": [
              {
                "id": "uuid",
                "name": "Sauce",
                "min_selections": 1,
                "max_selections": 2,
                "options": [
                  { "id": "uuid", "name": "BBQ", "price_cents": 0 }
                ]
              }
            ]
          }
        ]
      }
    ],
    "location": {
      "id": "uuid",
      "is_open": true,
      "busy_mode": false,
      "estimated_prep_minutes": 20,
      "delivery_fee_cents": 399,
      "free_delivery_threshold_cents": 4000,
      "minimum_delivery_subtotal_cents": 2000
    }
  }
}
```

**Errors:** `NOT_FOUND` (invalid location)

---

## 3. Cart & Checkout

### POST /cart/quote
Compute live cart totals without placing order. Used by frontend for real-time total display.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER) |
| Idempotency | No (read-like) |
| Side effects | None — quote only |

**Request:**
```json
{
  "location_id": "uuid",
  "fulfillment_type": "DELIVERY",
  "items": [
    {
      "menu_item_id": "uuid",
      "quantity": 2,
      "modifier_selections": [{ "modifier_option_id": "uuid" }],
      "removed_ingredients": ["uuid"],
      "special_instructions": "extra crispy"
    }
  ],
  "promo_code": "WELCOME10",
  "address_id": "uuid",
  "scheduled_for": "2025-06-15T18:30:00Z"
}
```

**Response (200):**
```json
{
  "data": {
    "item_subtotal_cents": 3647,
    "item_discount_total_cents": 365,
    "order_discount_total_cents": 0,
    "discounted_subtotal_cents": 3282,
    "taxable_subtotal_cents": 3681,
    "tax_cents": 479,
    "tax_rate_bps": 1300,
    "tax_snapshot_label": "ONTARIO_HST_13",
    "delivery_fee_cents": 399,
    "driver_tip_cents": 0,
    "wallet_available_cents": 500,
    "wallet_applied_cents": 0,
    "final_payable_cents": 4160,
    "promo_applied": { "code": "WELCOME10", "discount_cents": 365, "type": "PERCENT" },
    "estimated_ready_minutes": 25,
    "items_validated": true,
    "warnings": []
  }
}
```

**Errors:** `VALIDATION_FAILED` (unavailable items, below minimum subtotal, invalid promo, address outside delivery zone)

---

### POST /checkout
Place order. This is the critical money endpoint.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER) |
| Idempotency | REQUIRED — `Idempotency-Key` header mandatory |
| Side effects | Creates order + order_items + order_item_modifiers + snapshots + order_payments (AUTH or CAPTURE) + order_status_event + wallet debit if applicable + promo usage_count increment |
| Realtime events | `order.placed` to KDS/Manager channels |

**Request:**
```json
{
  "location_id": "uuid",
  "fulfillment_type": "DELIVERY",
  "items": [ ... ],
  "promo_code": "WELCOME10",
  "address_id": "uuid",
  "scheduled_for": "2025-06-15T18:30:00Z",
  "driver_tip_cents": 300,
  "apply_wallet": true,
  "payment_method": "CARD",
  "payment_token": "stripe_tok_...",
  "customer_order_notes": "Ring doorbell",
  "contactless_pref": "LEAVE_AT_DOOR"
}
```

**Response (201):**
```json
{
  "data": {
    "order_id": "uuid",
    "order_number": 1042,
    "status": "PLACED",
    "item_subtotal_cents": 3647,
    "discounted_subtotal_cents": 3282,
    "taxable_subtotal_cents": 3681,
    "tax_cents": 479,
    "tax_rate_bps": 1300,
    "tax_snapshot_label": "ONTARIO_HST_13",
    "delivery_fee_cents": 399,
    "driver_tip_cents": 300,
    "wallet_applied_cents": 500,
    "final_payable_cents": 3660,
    "net_paid_amount_cents": 0,
    "payment_status_summary": "PENDING",
    "payment_method": "CARD",
    "estimated_ready_at": "2025-06-15T18:55:00Z",
    "cancel_allowed_until": "2025-06-15T18:32:00Z"
  }
}
```

**Payment lifecycle at checkout:**
- **CARD (online):** AUTH only at checkout → `net_paid_amount_cents = 0`, `payment_status_summary = PENDING`. Funds are held but not captured. CAPTURE happens on ACCEPTED → `net_paid_amount_cents = 3660`, `payment_status_summary = PAID`.
- **CASH (POS):** CAPTURE immediately → `net_paid_amount_cents = 3660`, `payment_status_summary = PAID`.
- **STORE_CREDIT:** Wallet debited at checkout → `net_paid_amount_cents = 3660`, `payment_status_summary = PAID` (wallet debit is immediate).

**Business errors:**
- `CONFLICT` — duplicate idempotency key with different payload
- `VALIDATION_FAILED` — item unavailable, price changed since quote, promo expired, menu schedule inactive, below minimum subtotal
- `CONFLICT` — prepayment_required but pay-later selected
- `CONFLICT` — wallet insufficient for store-credit-only order
- `FORBIDDEN` — location closed or busy mode blocking new orders

**Tax contract (frozen):**
- `taxable_subtotal_cents = discounted_subtotal_cents + delivery_fee_cents` (tax_delivery_fee = true for launch)
- `tax_cents = round_half_up(taxable_subtotal_cents × 1300 / 10000)`
- Tax snapshot fields frozen at checkout: `tax_rate_bps`, `tax_delivery_fee_applied`, `tax_tip_applied`, `tax_snapshot_label`
- Tips are NOT taxable at launch

---

## 4. Customer Orders

### GET /orders
List customer's orders.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER) |
| Query | `status` (filter), `cursor`, `limit` |

**Response (200):** Array of order summaries.

---

### GET /orders/:id
Order detail with items, status, driver info, chat unread.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER — must own order) |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "order_number": 1042,
    "status": "PREPARING",
    "fulfillment_type": "DELIVERY",
    "items": [ ... ],
    "totals": { ... },
    "driver": {
      "name": "...",
      "phone": "...",
      "vehicle": "...",
      "estimated_arrival_at": "..."
    },
    "chat_unread": true,
    "cancel_allowed_until": "2025-06-15T18:32:00Z",
    "timeline": [
      { "status": "PLACED", "at": "...", "note": null },
      { "status": "ACCEPTED", "at": "...", "note": null }
    ]
  }
}
```

---

### POST /orders/:id/cancel
Customer self-cancel (within 2-minute window only).

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER — must own order) |
| Validation | `now() <= cancel_allowed_until` |
| Side effects | order → CANCELLED, order_status_event, void/refund if payment captured, cancellation_source = CUSTOMER_SELF |
| Realtime events | `order.cancelled` to KDS |

**Request:**
```json
{ "reason": "Changed my mind" }
```

**Errors:** `CONFLICT` (window expired — must use chat), `CONFLICT` (order already in terminal state)

---

## 5. Chat

### GET /orders/:id/chat
Get conversation messages.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER for customer view; STAFF/ADMIN for staff view) |
| Side effects | Advances reader-side cursor in chat_side_read_states (CUSTOMER or STAFF depending on caller) |

**Response (200):**
```json
{
  "data": {
    "conversation_id": "uuid",
    "messages": [
      {
        "id": "uuid",
        "sender_surface": "CUSTOMER",
        "message_body": "Can I add a drink?",
        "is_system_message": false,
        "created_at": "..."
      }
    ]
  }
}
```

**Unread contract:** When any staff user calls this endpoint, the service advances the STAFF-side cursor in `chat_side_read_states` and clears staff unread for all staff views. Customer-side is independent.

---

### POST /orders/:id/chat
Send a message.

| Field | Notes |
|-------|-------|
| Auth | Required |
| Side effects | Creates order_message, marks other side as unread |
| Realtime events | `chat.message` to appropriate channels |

**Request:**
```json
{
  "message_body": "Sure, adding a drink now.",
  "visibility": "BOTH"
}
```

`visibility: STAFF_ONLY` is allowed for staff senders only (internal notes).

**Errors:** `CONFLICT` (conversation closed), `FORBIDDEN` (CUSTOMER sending STAFF_ONLY), `RATE_LIMITED` (> 5 msg / 60s per user — PRD §15.2)

**Rate limiting:** 5 messages per 60 seconds per `(order_id, sender_user_id)`. Sliding window; fails open if Redis is unavailable. Error payload includes `retry_after_seconds`.

---

## 5b. Reviews (PRD §14)

Customer item-level reviews and admin replies. Reviews are internal by default; admins may publish publicly.

### POST /orders/:order_id/order-items/:order_item_id/reviews
Create a review for one line of a completed order.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER — must own the order) |
| Eligibility | Order status must be `PICKED_UP` or `DELIVERED` |
| Uniqueness | One review per (order_item, customer) — duplicate returns 409 |

**Request:**
```json
{
  "rating": 5,
  "review_body": "Perfect crisp"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "order_id": "uuid",
    "order_item_id": "uuid",
    "customer_user_id": "uuid",
    "rating": 5,
    "review_body": "Perfect crisp",
    "is_approved_public": false,
    "admin_reply": null,
    "admin_replied_at": null,
    "admin_replied_by_user_id": null,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Errors:** `VALIDATION_FAILED` (rating outside 1..5, body too long), `CONFLICT` (already reviewed), `FORBIDDEN` (not the order's customer), `NOT_FOUND` (order item / order not found), `VALIDATION_FAILED` (status not PICKED_UP/DELIVERED — returned as 400).

---

### GET /orders/:order_id/reviews
List reviews attached to one order.

| Field | Notes |
|-------|-------|
| Auth | Required — CUSTOMER (own order) or STAFF/ADMIN |

**Response (200):** `{ "data": [ItemReview, ...] }`

---

### GET /admin/reviews
Admin paginated list across all reviews.

| Field | Notes |
|-------|-------|
| Auth | ADMIN or STAFF+MANAGER |
| Query | `cursor`, `limit` (1–100, default 50), `has_reply` (`true` \| `false`) |

**Response (200):** `{ "data": { "items": [ItemReview, ...], "next_cursor": "uuid"|null } }`

---

### POST /admin/reviews/:id/reply
Set / update the admin reply on a review.

| Field | Notes |
|-------|-------|
| Auth | ADMIN or STAFF+MANAGER |
| Side effects | Sets `admin_reply`, `admin_replied_at`, `admin_replied_by_user_id` |

**Request:** `{ "reply": "Thanks for the kind words!" }`

---

### POST /admin/reviews/:id/publish
Toggle public visibility of a review.

| Field | Notes |
|-------|-------|
| Auth | ADMIN or STAFF+MANAGER |
| Side effects | Sets `is_approved_public` |

**Request:** `{ "publish": true }`

---

## 5c. Order change requests — add items (PRD §13)

Customers may request to add items within 3 minutes of placing an order. The
request enters a PENDING queue for admin/manager action unless the location
has `add_items_auto_approve_enabled = true`, in which case it is applied
inline. The 3-minute window and payment-method matrix are enforced server-side:

- Online-card orders — add-items allowed only while `status = PLACED`.
- Cash / POS orders (`paymentStatusSummary = UNPAID` on non-online source, or
  `paymentMethod = CASH`) — allowed through `PLACED | ACCEPTED | PREPARING`.
- Store-credit orders — the customer's wallet is debited for the price delta
  atomically on approval (insufficient balance rejects the approval).

Rejection requires a reason of at least 5 characters; the reason is surfaced
to the customer on the order detail page.

### POST /orders/:orderId/changes
Customer submits an add-items change request.

| Field | Notes |
|-------|-------|
| Auth | CUSTOMER (own order only) |
| Window | 3 minutes from `placed_at`; returns 422 `ADD_ITEMS_WINDOW_EXPIRED` after |
| Status | Returns 422 `ADD_ITEMS_NOT_ALLOWED_IN_STATUS` outside the payment matrix |
| Side effects | Creates PENDING request; emits `order.change_requested` |

**Request:**
```json
{
  "items": [
    { "menu_item_id": "uuid", "quantity": 2,
      "modifier_option_ids": ["uuid"], "special_instructions": "no sauce" }
  ]
}
```

### GET /orders/:orderId/changes
Lists change requests for the order. Customers see only their own orders'
requests; staff/admin see all requests on the order.

### GET /admin/order-changes
Admin / manager queue of PENDING ADD_ITEMS requests scoped to
`X-Location-Id`. Paginated via `cursor` / `limit`.

| Field | Notes |
|-------|-------|
| Auth | ADMIN or STAFF+MANAGER |

### POST /admin/order-changes/:id/approve
Applies the request: appends order items + modifiers, recomputes totals, and
(for STORE_CREDIT orders) debits the wallet for the delta atomically.

| Field | Notes |
|-------|-------|
| Auth | ADMIN or STAFF+MANAGER |
| Side effects | Mutates order totals, inserts order_items, emits `order.change_approved` |

### POST /admin/order-changes/:id/reject
Rejects the request with a mandatory reason.

**Request:** `{ "reason": "sold out" }`  (min 5 chars; 400 otherwise)

Emits `order.change_rejected`.

---

## 6. Support Tickets

### POST /support/tickets
Create a support ticket.

| Field | Notes |
|-------|-------|
| Auth | Required (CUSTOMER or STAFF) |

**Request:**
```json
{
  "order_id": "uuid",
  "ticket_type": "WRONG_ITEM",
  "subject": "Missing sauce on wings",
  "description": "Ordered BBQ but received plain wings",
  "created_source": "CUSTOMER"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "status": "OPEN",
    "ticket_type": "WRONG_ITEM",
    "resolution_type": null,
    "created_at": "..."
  }
}
```

---

### POST /support/tickets/:id/resolutions
Add a resolution action.

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN) |
| Side effects | Creates support_ticket_resolutions row, updates support_tickets.resolution_type summary, may create refund_request or replacement order |

**Request:**
```json
{
  "resolution_type": "STORE_CREDIT",
  "credit_amount_cents": 1000,
  "note": "Credited $10 for missing sauce"
}
```

**Resolution types (canonical enum):** `NO_ACTION`, `STORE_CREDIT`, `PARTIAL_REFUND`, `FULL_REFUND`, `REPLACEMENT`, `FOLLOW_UP`

`NULL` on ticket = no resolution yet. `NO_ACTION` = real business decision (acknowledged, no compensation).

---

### POST /support/tickets/:id/messages
Add a message to ticket thread.

| Field | Notes |
|-------|-------|
| Auth | Required |

**Request:**
```json
{
  "message_body": "We're looking into this now.",
  "is_internal_note": false
}
```

---

## 7. POS

### POST /pos/orders
Create a walk-in/phone order from POS.

| Field | Notes |
|-------|-------|
| Auth | Required (STAFF — WiFi-gated) |
| Idempotency | REQUIRED |
| Side effects | Same as /checkout but order_source = POS or PHONE, payment captured immediately for cash |
| Realtime events | `order.placed` to KDS |

**Request:**
```json
{
  "order_source": "POS",
  "fulfillment_type": "PICKUP",
  "customer_phone": "+15191234567",
  "customer_name": "Jane Doe",
  "items": [ ... ],
  "payment_method": "CASH",
  "student_discount_requested": false,
  "manual_discount_cents": 0,
  "manual_discount_reason": null
}
```

**Payment behavior:**
- CASH → CAPTURE immediately (single order_payments row, transaction_type = CAPTURE, transaction_status = SUCCESS)
- CARD → AUTH at creation, CAPTURE on ACCEPTED
- STORE_CREDIT → wallet debit at creation
- orders.payment_method and payment_status_summary updated as summary fields

---

## 8. KDS / Manager Operations

All KDS endpoints require STAFF auth with employee_profiles.role check. ADMIN bypasses role check.

### GET /kds/orders
Active order queue for KDS display.

| Field | Notes |
|-------|-------|
| Auth | Required (STAFF or ADMIN) |
| Query | `location_id`, `status` (filter), `fulfillment_type` |

---

### POST /kds/orders/:id/accept
Accept an order.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Side effects | order → ACCEPTED, order_status_event, payment CAPTURE for online card orders |
| Realtime events | `order.accepted` to customer |

**Errors:** `CONFLICT` (not in PLACED status)

---

### POST /kds/orders/:id/status
Advance order status.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Allowed transitions | ACCEPTED→PREPARING, PREPARING→READY |

**Request:**
```json
{ "status": "PREPARING" }
```

**Errors:** `CONFLICT` (invalid transition)

---

### POST /kds/orders/:id/cancel-request
Request cancellation (creates pending request, does NOT cancel the order).

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Side effects | Creates cancellation_requests row (PENDING). Order stays in current status. |
| Realtime events | `cancellation.requested` to admin channel |

**Request:**
```json
{
  "reason_text": "Customer called to cancel",
  "request_source": "KDS_CANCEL_REQUEST"
}
```

**Errors:** `CONFLICT` (order in terminal state), `CONFLICT` (pending request already exists)

**Important:** `CANCEL_PENDING` is NOT an order status. The order remains in its current operational state until Admin approves.

---

### POST /kds/orders/:id/assign-driver
Assign driver to delivery order.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Validation | Driver must be STAFF + employee_profiles.role = DRIVER, is_active, availability_status = AVAILABLE or ON_DELIVERY (with busy override) |

**Request:**
```json
{
  "driver_user_id": "uuid",
  "estimated_travel_minutes": 15,
  "busy_override": false
}
```

**Side effects:** order.assigned_driver_user_id set, order_driver_event created, driver availability updated if needed.

---

### POST /kds/orders/:id/start-delivery
Start delivery.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Side effects | order → OUT_FOR_DELIVERY, estimated_arrival_at computed, driver → ON_DELIVERY |

---

### POST /kds/orders/:id/complete-delivery
Complete delivery with PIN verification.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |

**Request:**
```json
{
  "delivery_pin": "1234",
  "bypass_pin": false,
  "bypass_reason": null
}
```

**Side effects:** order → DELIVERED, driver availability reset, delivery_completed_at + delivery_completed_by_user_id set, order_finalization_event.

---

### POST /kds/orders/:id/eta
Adjust ETA.

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Side effects | order_eta_event created, estimated_ready_at updated |

**Request:**
```json
{
  "new_estimated_ready_at": "2025-06-15T19:10:00Z",
  "reason": "Kitchen backed up"
}
```

---

### POST /kds/orders/:id/refund-request
Initiate refund request from KDS (does NOT issue refund).

| Field | Notes |
|-------|-------|
| Auth | Required (KITCHEN, MANAGER, or ADMIN) |
| Side effects | Creates refund_requests row (PENDING). Admin must approve. |

**Request:**
```json
{
  "amount_cents": 1500,
  "refund_method": "STORE_CREDIT",
  "reason_text": "Customer received wrong order"
}
```

---

## 9. Admin

### POST /admin/cancellation-requests/:id/decide
Approve or reject a pending cancellation request.

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN) |
| Side effects | On APPROVED: order → CANCELLED, refund workflow triggered if net_paid > 0. On REJECTED: request closed, order continues. |
| Realtime events | `order.cancelled` or `cancellation.rejected` |

**Request:**
```json
{
  "decision": "APPROVED",
  "decision_note": "Customer confirmed"
}
```

---

### POST /admin/refund-requests/:id/decide
Approve and issue refund, or reject.

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN) |
| Idempotency | REQUIRED for APPROVED |
| Side effects | On APPROVED: order_payments REFUND row created, wallet credit or gateway refund, payment_status_summary updated |

**Request:**
```json
{
  "decision": "APPROVED",
  "refund_method": "STORE_CREDIT"
}
```

---

### POST /admin/orders/:id/cancel
Direct admin cancel (no pending request needed).

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN) |
| Side effects | order → CANCELLED, cancellation_source = ADMIN, refund workflow if applicable |

**Request:**
```json
{ "reason": "Duplicate order" }
```

---

### POST /admin/customers/:id/credit
Issue store credit.

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN, or MANAGER within manager_credit_limit_cents) |
| Side effects | customer_credit_ledger entry, wallet balance updated |

**Request:**
```json
{
  "amount_cents": 1000,
  "reason": "Service recovery",
  "expires_at": null
}
```

---

### GET /admin/reports/daily-tax
Daily tax summary.

| Field | Notes |
|-------|-------|
| Auth | Required (ADMIN) |
| Source | daily_tax_summary table |

**Query:** `location_id`, `date_from`, `date_to`

**Response (200):**
```json
{
  "data": [
    {
      "business_date": "2025-06-15",
      "location_id": "uuid",
      "orders_count": 47,
      "taxable_sales_cents": 235000,
      "tax_collected_cents": 30550,
      "refund_tax_reversed_cents": 1300,
      "net_tax_cents": 29250
    }
  ]
}
```

---

## 10. Driver Dispatch

Driver-specific state queries used by KDS driver picker and future driver app.

### GET /drivers/available
List available drivers for assignment.

| Field | Notes |
|-------|-------|
| Auth | Required (STAFF or ADMIN) |
| Query | `location_id` |

**Response (200):** Array of driver profiles with availability_status, is_on_delivery, last_delivery_completed_at.

---

## 11. Timeclock

### POST /timeclock/clock-in
Employee clock in.

| Field | Notes |
|-------|-------|
| Auth | Required (STAFF — WiFi-gated) |
| Side effects | employee_shifts row created, driver availability → AVAILABLE if role = DRIVER |

---

### POST /timeclock/clock-out
Employee clock out.

| Field | Notes |
|-------|-------|
| Auth | Required (STAFF) |
| Side effects | employee_shifts.clock_out_at set, driver availability → OFF_SHIFT if role = DRIVER |
| Validation | Cannot clock out while assigned to active delivery |

---

## 12. Realtime Events

WebSocket channel subscriptions. All events include `event_type`, `payload`, and `timestamp`.

### Channels
| Channel | Subscribers | Events |
|---------|------------|--------|
| `orders:{location_id}` | KDS, Manager Ops | order.placed, order.accepted, order.status_changed, order.cancelled, order.change_requested, order.change_approved, order.change_rejected, cancellation.requested, cancellation.decided |
| `order:{order_id}` | Customer (own order) | order.accepted, order.status_changed, order.cancelled, order.driver_assigned, order.delivery_started, order.eta_updated, order.change_requested, order.change_approved, order.change_rejected |
| `chat:{order_id}` | Customer + Staff | chat.message, chat.read |
| `admin:{location_id}` | Admin panel | cancellation.requested, refund.requested, support.ticket_created, support.auto_ticket |
| `drivers:{location_id}` | KDS driver picker | driver.availability_changed, driver.delivery_completed |

### Event Payloads

**order.placed:**
```json
{
  "event_type": "order.placed",
  "order_id": "uuid",
  "order_number": 1042,
  "fulfillment_type": "DELIVERY",
  "status": "PLACED",
  "customer_name": "Jane Doe",
  "item_count": 3,
  "estimated_ready_at": "...",
  "timestamp": "..."
}
```

**order.status_changed:**
```json
{
  "event_type": "order.status_changed",
  "order_id": "uuid",
  "from_status": "PREPARING",
  "to_status": "READY",
  "changed_by_user_id": "uuid",
  "timestamp": "..."
}
```

**chat.message:**
```json
{
  "event_type": "chat.message",
  "order_id": "uuid",
  "message_id": "uuid",
  "sender_surface": "CUSTOMER",
  "message_body": "...",
  "visibility": "BOTH",
  "timestamp": "..."
}
```

**cancellation.requested:**
```json
{
  "event_type": "cancellation.requested",
  "order_id": "uuid",
  "request_id": "uuid",
  "request_source": "KDS_CANCEL_REQUEST",
  "reason_text": "...",
  "requested_by_user_id": "uuid",
  "timestamp": "..."
}
```

### Polling Fallback
All surfaces must implement 30-second polling fallback for each subscribed channel. WebSocket reconnect uses exponential backoff (1s, 2s, 4s, max 30s).

---

## 13. Cross-Cutting Rules

### Payment Transaction Model
- `orders.payment_method` and `orders.payment_status_summary` are summary fields for UI/reporting only
- `order_payments` rows are the source of truth (payment_tender_method, transaction_type, transaction_status, signed_amount_cents)
- SPLIT never appears on order_payments — it is an order-level summary only
- Online card: AUTH at checkout → CAPTURE on ACCEPTED → REFUND if cancelled
- Cash: CAPTURE immediately
- Store credit: wallet debit at checkout (not modeled as order_payments row)

### Cancellation Contract
- `CANCEL_PENDING` is NOT an order status
- Cancellation is a separate `cancellation_requests` record
- Order remains in current operational status until Admin approves
- Only on approval does order → CANCELLED

### Tax Contract (Frozen)
- HST 13% (tax_rate_bps = 1300), London Ontario, CAD
- Taxable base = discounted_subtotal + delivery_fee (if tax_delivery_fee = true)
- Tips NOT taxable
- Round half-up, once, on total taxable base
- Per-order snapshot frozen at checkout — never recalculated

### Refund Contract
- KDS initiates refund_request (PENDING) — does not issue money
- Admin approves and issues
- net_paid_amount_cents derived from order_payments (CAPTURE - REFUND)
- Refund amount must not exceed remaining refundable balance
- Store credit refund is launch default; original-payment refund is future scope

### Unread Contract
- `chat_side_read_states` (CUSTOMER vs STAFF) is canonical
- When any staff opens conversation → STAFF cursor advances for all staff
- `chat_read_states` (per-user) is optional audit/helper only
