# Printer Outage Runbook

Placeholder for the production runbook required by the system blueprint.

## Verification (current repo)

- **Devices:** `devices` table (`device_type` includes `RECEIPT_PRINTER`); auth uses `X-Device-Token` per API Contract.
- **Agent:** local [`apps/print-agent`](../../apps/print-agent) — ensure it can reach API and registered device token matches `devices.api_token_hash`.
