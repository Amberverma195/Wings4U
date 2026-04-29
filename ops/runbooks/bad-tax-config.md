# Bad Tax Configuration Runbook

Placeholder for tax-policy misconfiguration diagnosis and rollback.

## Verification (current repo)

- **Contract:** frozen tax rules in API Contract §13 (HST 13%, snapshot at checkout).
- **Schema:** order lines store `tax_cents`, `tax_rate_bps`, `tax_snapshot_label` on `orders` — compare against `location_settings` / pricing config when implemented.
