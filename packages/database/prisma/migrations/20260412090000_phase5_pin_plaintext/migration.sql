-- Phase 5 (PRD §7.8): expose the delivery PIN to the customer so they can
-- relay it to the driver. The existing pin_hash column supports driver-side
-- verification, but a 4-digit PIN that must be customer-visible cannot be
-- reconstructed from a hash — we also persist the plaintext here, cleared
-- once the PIN is verified / bypassed / expired / locked.

ALTER TABLE "delivery_pin_verifications"
    ADD COLUMN "pin_plaintext" TEXT;
