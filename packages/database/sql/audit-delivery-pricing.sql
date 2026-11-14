-- Run using authorized credentials. This transaction cannot modify data.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT o.order_number, o.placed_at, o.fulfillment_type,
       o.item_subtotal_cents, o.item_discount_total_cents, o.order_discount_total_cents,
       o.delivery_fee_cents, o.driver_tip_cents, o.wallet_applied_cents,
       o.tax_cents, o.tax_rate_bps, o.tax_delivery_fee_applied,
       o.final_payable_cents, o.pricing_snapshot_json,
       s.free_delivery_threshold_cents, s.tax_delivery_fee,
       s.discounts_reduce_taxable_base
FROM orders o JOIN location_settings s ON s.location_id = o.location_id
WHERE o.order_number = 1077
  AND o.placed_at >= TIMESTAMPTZ '2026-11-13 00:00:00 America/Toronto'
  AND o.placed_at < TIMESTAMPTZ '2026-11-14 00:00:00 America/Toronto';

SELECT r.discount_amount_cents, r.metadata_json, p.code, p.discount_type
FROM promo_redemptions r JOIN promo_codes p ON p.id = r.promo_code_id
JOIN orders o ON o.id = r.order_id WHERE o.order_number = 1077;

SELECT p.transaction_type, p.transaction_status, p.signed_amount_cents
FROM order_payments p JOIN orders o ON o.id = p.order_id WHERE o.order_number = 1077;

SELECT count(*) AS delivery_orders,
       count(*) FILTER (WHERE delivery_fee_cents > 0) AS paid_fee_orders,
       count(*) FILTER (WHERE final_payable_cents <> GREATEST(0,
         item_subtotal_cents - item_discount_total_cents - order_discount_total_cents
         + delivery_fee_cents + driver_tip_cents + tax_cents - wallet_applied_cents)) AS total_mismatches,
       count(*) FILTER (WHERE pricing_snapshot_json ? 'final_payable_cents'
         AND (pricing_snapshot_json->>'final_payable_cents')::int <> final_payable_cents) AS snapshot_total_mismatches
FROM orders WHERE fulfillment_type = 'DELIVERY'
  AND location_id IN (SELECT location_id FROM orders WHERE order_number = 1077);

ROLLBACK;
