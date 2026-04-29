# Stuck Delivery State Runbook

Placeholder for resolving inconsistent delivery-status or driver-state issues.

## Verification (current repo)

- **Schema:** `orders.status`, `order_driver_events`, `driver_profiles` — trace transitions vs. `order_status` enum in [`Docs/Wings4U_schema_v1_4_postgres_FINAL.sql`](../../Docs/Wings4U_schema_v1_4_postgres_FINAL.sql).
- **API:** driver/dispatch section of API Contract v1.0 §10 when endpoints are fully implemented.
