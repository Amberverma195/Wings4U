import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('prepared LON01 cleanup scope', () => {
  it('only updates LON01 configuration and defaults to rollback', () => {
    const sql = readFileSync(resolve(__dirname, '../../../../packages/database/sql/disable-free-delivery.sql'), 'utf8')
      .replace(/--[^\n]*/g, '');
    const updates = sql.match(/UPDATE\s+[\s\S]*?;/gi) ?? [];
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatch(/UPDATE location_settings s SET free_delivery_threshold_cents = NULL/);
    expect(updates[1]).toMatch(/UPDATE promo_codes p SET is_active = FALSE/);
    for (const statement of updates) expect(statement).toMatch(/l\.code = 'LON01'/);
    expect(sql).not.toMatch(/\b(?:DELETE|INSERT|ALTER|DROP|TRUNCATE|COMMIT)\b/i);
    expect(sql.trim()).toMatch(/ROLLBACK;$/);
  });
});
