# Dynamic IP / Store Network Runbook

Placeholder for trusted-network and device-access recovery steps.

## Verification (current repo)

- **Schema:** `location_settings.trusted_ip_ranges` (JSON / text per schema) — POS login validates client IP against allowlist (API Contract §1 `POST /auth/pos/login`).
- **Ops:** update ranges via admin when implemented; restart not required for DB-only change.
