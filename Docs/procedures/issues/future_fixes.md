# Future Fixes Backlog

Last updated: 2026-04-13

## 1. Missing Payment Intent for Card Delta on Add-Item Requests

**What is the finding:**
During the PRD §13 (Post-order add items) implementation, the system correctly updates the order's `finalPayableCents` when an add-items request is approved. It successfully handles `STORE_CREDIT` (by debiting the wallet) and `CASH` (collected at checkout). However, for online `CARD` payments, it simply updates the order total without actually charging the customer for the difference. The system absorbs the loss silently because no new `orderPayments` row is recorded and no payment intent is issued to a payment gateway.

**What needs to be fixed:**
We need to capture the price delta for online card payments. When `priceDelta > 0` and the `paymentMethod` is `CARD`:
1. Create an `orderPayments` row indicating a `PENDING` charge matching the delta amount.
2. Integrate with the payment gateway (e.g., Stripe) to either create a new PaymentIntent for the delta or update the existing authorization capture, so the customer is actually charged the extra amount.
3. Update end-to-end tests to verify that the `orderPayments` row is successfully appended when a delta exists on a card-paid order.

**Files to be fixed:**
- `apps/api/src/modules/order-changes/order-changes.service.ts` (Inside `approveChangeRequest` transaction logic)
- `apps/api/test/app.e2e-spec.ts` (Under the Order changes describe block)
