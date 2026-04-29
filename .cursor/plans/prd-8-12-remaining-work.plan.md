---
name: PRD §8 / §12 remaining work
overview: "Most PRD §8/§12 leftover work is shipped. One optional E2E remains: customer self-cancel on a paid order → assert auto-created PENDING refund_request (QA matrix parity with the existing admin-approved path)."
todos:
  - id: e2e-customer-self-cancel-paid-refund
    content: "E2E: SUCCESS order_payment + POST /orders/:id/cancel within window → one PENDING refund_request with expected amountCents"
    status: completed
  - id: docs-qa-matrix-after-e2e
    content: "After test lands: note customer-cancel path in prd-section-8-qa-matrix.md follow-up list if needed"
    status: completed
isProject: false
---

# PRD §8 / §12 — remaining work (updated)

**Status:** The bulk of the earlier §8/§12 leftover backlog is **implemented**: QA-matrix E2Es (archived main + salad, postal, lead time, wallet race), admin/KDS cancel chat + refund, salad archived in checkout/cart, `FOR UPDATE` on orders in `createForCancelledOrder`, prep defaults migration/seed/schema, clearer `global-setup` errors, and doc appendices in `prd_point_8,12_*` and [map.md](../Docs/procedures/issues/map.md).

**What is left:** Full **symmetry** for QA matrix row 5 (“Auto-refund on paid cancel”). The suite already covers **staff-approved** cancel with a synthetic `order_payments` row and asserts a **PENDING** `refund_request` (`app.e2e-spec.ts` ~“admin-approved chat cancellations…”). It does **not** yet cover the **`customerCancel`** branch: **POST `/orders/:id/cancel`** after a successful capture.

---

## Plan: E2E — customer self-cancel + paid balance → auto-refund

### Goal

Add one `it(...)` in [apps/api/test/app.e2e-spec.ts](../apps/api/test/app.e2e-spec.ts) (suggested location: **`describe("Orders")`** or the checkout block, after existing cancel tests) that proves:

1. An order exists with **net positive** captured payment (`order_payments` with `transaction_status = SUCCESS`, `signed_amount_cents` summing to the intended capture — mirror the pattern from the admin-approved test ~1617–1704).
2. The customer calls **`POST /api/v1/orders/:id/cancel`** **inside** the self-cancel window (`cancel_allowed_until`).
3. After **201**, **`refund_requests`** for that `order_id` has **exactly one** row in **PENDING** with **`amount_cents`** equal to the **remaining** refundable amount (typically `final_payable_cents` minus any existing claims — for a single full capture with no prior refunds, match `final_payable_cents` or the net payment sum used in `RefundService.createForCancelledOrder`).

### Implementation notes

- **Cancel window:** If the test does `checkout` → insert payment → assertions, the 2-minute window may expire. Prefer: **create order** → **immediately** insert `order_payment` (if the test harness allows) → **cancel in the same flow**, or **`prisma.order.update`** to set `cancelAllowedUntil` to `new Date(Date.now() + 120_000)` **before** `POST …/cancel` so the test is deterministic (same pattern as other time-sensitive tests in the file).
- **Payment row fields:** Use the same shape as the existing admin test (`paymentMethod`, `transactionType: "CAPTURE"`, `transactionStatus: "SUCCESS"`, `signedAmountCents`, `initiatedByUserId` / `createdByUserId` = seeded customer).
- **Cleanup:** If the test mutates wallet or order state, use `try/finally` to restore wallet rows or leave data acceptable for subsequent tests (follow existing `finally` blocks in the file).
- **Assertions:**  
  - `POST /cancel` → **201**, `cancellation_source: "CUSTOMER_SELF"`.  
  - `prisma.refundRequest.findMany({ where: { orderId } })` → length **1**, `status: "PENDING"`, `amountCents` matches expected.

### Docs

- Append a bullet under “Follow-up status” in [Docs/audits/prd-section-8-qa-matrix.md](../Docs/audits/prd-section-8-qa-matrix.md) that the **customer self-cancel + paid** path is covered by E2E once the test exists.

### Verification

- `npm run build:api` (compile).
- `npm test --workspace @wings4u/api` or the project’s e2e command with `.env.test` and Postgres reachable (see [global-setup.ts](../apps/api/test/global-setup.ts)).

---

## Still deferred (unchanged)

- Promo application inside `placeOrder` (transactional redemption).
- Admin **GET** cancelled-orders / refund-requests lists + UI tables.

These are **not** part of this small E2E task.
