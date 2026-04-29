# Payment Incident Runbook

Placeholder for payment incident handling, rollback, and support coordination.

## Verification (current repo)

- **API:** `GET /api/v1/health` — confirms Nest is up.
- **Data model:** `order_payments` is source of truth (transaction rows); `orders.payment_status_summary` is UI/reporting only — see API Contract §13 and schema v1.4.
- **Investigate:** rows in `order_payments` for affected `order_id` (`transaction_type`, `transaction_status`, `signed_amount_cents`).
