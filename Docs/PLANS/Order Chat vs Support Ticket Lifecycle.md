# Order Chat vs Support Ticket Lifecycle

## Summary

Use **order chat** for live operational issues while the order is still active.  
Once the order reaches a **terminal status**, order chat becomes **read-only history**, and all new customer help goes through a **support ticket** linked to that order.

Chosen lifecycle:
- order chat accepts new messages only while the order is operational
- terminal status closes chat for new customer messages
- Help on a terminal order shows **read-only order chat history + support ticket entry**

## Lifecycle Rules

### 1. When order chat stays open

Order chat stays open while the order is in a non-terminal operational state, including:
- `PLACED`
- `ACCEPTED`
- `PREPARING`
- `READY`
- `OUT_FOR_DELIVERY`

Use order chat for:
- post-cancel-window cancellation/help requests
- operational questions like ETA, small order issues, add-on requests if allowed
- live coordination between customer and store staff

Important behavior:
- if self-cancel window expires, customer Help should open **order chat/help**
- staff can escalate chat-driven cancellation into `cancellation_requests` with `request_source = KDS_CHAT_REQUEST`

### 2. When order chat closes

Order chat should stop accepting new customer messages as soon as the order becomes terminal:
- `CANCELLED`
- `DELIVERED`
- `PICKED_UP`
- `NO_SHOW_PICKUP`
- `NO_SHOW_DELIVERY`

Recommended implementation behavior:
- set `order_conversations.closed_at` when the order transitions to terminal
- `GET /orders/:id/chat` still returns history
- `POST /orders/:id/chat` returns conflict once the conversation is closed

No grace period:
- close immediately on terminal transition

### 3. What Help does after terminal status

When the order is terminal, Help should show:
- existing order chat transcript as **read-only history**
- a clear CTA to **open a support ticket**

Support ticket is the canonical path for:
- wrong item
- missing item
- quality complaint
- delivery issue
- refund request
- after-delivery complaint
- any issue that is no longer live store coordination

Support ticket should be created with:
- `order_id`
- `ticket_type`
- `subject`
- `description`
- default `priority = NORMAL`

## UX / API Behavior

### Active order
- Order detail shows `Help / Chat`
- opening it goes to order chat
- new messages allowed
- unread uses side-based staff/customer semantics

### Terminal order
- Order detail shows `Need help?`
- opening it shows:
  - read-only order chat history
  - `Open support ticket` action
- no new order-chat messages allowed

### Sender identity
- backend keeps real sender surfaces in order chat (`CUSTOMER`, `KDS`, `MANAGER`, `ADMIN`)
- UI may display both `MANAGER` and `ADMIN` simply as `Staff`

## Test Scenarios

- Order in `PREPARING`:
  - `GET /orders/:id/chat` works
  - `POST /orders/:id/chat` works
  - Help opens chat
- Self-cancel window expired but order still active:
  - Help opens order chat
  - chat can be used for cancellation/help escalation
- Order becomes `DELIVERED`:
  - chat history still readable
  - new customer message is rejected
  - Help opens support ticket flow
- Order becomes `CANCELLED`:
  - same read-only history behavior
  - support ticket can still be created for refund/complaint follow-up
- Support ticket created from terminal order:
  - stores `order_id`
  - customer can continue formal issue handling there

## Assumptions

- “Manager and admin are the same thing” applies only to **UI presentation**, not backend role identity
- There is **no post-terminal chat grace period**
- Terminal order chat is preserved as history, not deleted
- Support tickets are the only writable customer-help channel after terminal status
