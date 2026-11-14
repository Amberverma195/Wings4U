-- Prepared only: do not run against production without explicit approval.
-- Deploy the API policy first and drain old API instances before this cleanup.
-- Defaults to ROLLBACK so reviewing/running this file alone changes no settings.
-- After approval, replace the final ROLLBACK with COMMIT to apply.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT l.code, s.free_delivery_threshold_cents
FROM locations l JOIN location_settings s ON s.location_id = l.id
WHERE l.code = 'LON01';

UPDATE location_settings s SET free_delivery_threshold_cents = NULL
FROM locations l
WHERE s.location_id = l.id AND l.code = 'LON01'
  AND s.free_delivery_threshold_cents IS NOT NULL
RETURNING s.location_id, s.free_delivery_threshold_cents;

-- Defense in depth for any legacy or newly discovered waiver components.
-- Retain the records and redemptions for historical reporting.
-- LON01-only cleanup. Global and other-location promotions are not modified;
-- the new backend rejects their delivery waivers regardless of configuration.
UPDATE promo_codes p SET is_active = FALSE
FROM locations l
WHERE p.location_id = l.id AND l.code = 'LON01'
  AND p.discount_type = 'FREE_DELIVERY' AND p.is_active = TRUE
RETURNING p.id, p.code, p.is_active;

SELECT order_number, delivery_fee_cents, tax_cents, final_payable_cents
FROM orders WHERE order_number = 1077
  AND location_id = (SELECT id FROM locations WHERE code = 'LON01');

ROLLBACK;
