-- 0003_timeclock_schema_expansion.sql
-- Editor-friendly duplicate: db/sql/patch2.sql (same DDL)
-- Date: 2026-03-22
-- Purpose: Expand timeclock schema for rich shift state and stored totals.
--
-- Changes:
--   1. employee_shifts.status: expand from OPEN|CLOSED to CLOCKED_IN|ON_BREAK|CLOCKED_OUT
--   2. employee_shifts.total_break_minutes: new column (stored total)
--   3. employee_shifts.net_worked_minutes: new column (stored total, nullable for active shifts)
--   4. employee_breaks.break_type: constrain to UNPAID only (every break is unpaid)
--   5. Partial unique: one active shift per employee, one open break per shift
--
-- Apply AFTER 0001 + 0002 on existing databases.

BEGIN;

-- 1. Expand shift status
ALTER TABLE employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_status_check;

ALTER TABLE employee_shifts
  ADD CONSTRAINT employee_shifts_status_check
  CHECK (status IN ('OPEN','CLOSED','CLOCKED_IN','ON_BREAK','CLOCKED_OUT'));

-- 2. Add stored totals on shifts
ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS total_break_minutes int NOT NULL DEFAULT 0;

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS net_worked_minutes int;

-- 3. Constrain break_type to UNPAID only
ALTER TABLE employee_breaks
  DROP CONSTRAINT IF EXISTS employee_breaks_break_type_check;

ALTER TABLE employee_breaks
  ADD CONSTRAINT employee_breaks_break_type_check
  CHECK (break_type IN ('UNPAID'));

-- 4. Partial unique: one active shift per employee
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_shift_per_employee
  ON employee_shifts(employee_user_id)
  WHERE status IN ('CLOCKED_IN','ON_BREAK');

-- 5. Partial unique: one open break per shift
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_break_per_shift
  ON employee_breaks(employee_shift_id)
  WHERE ended_at IS NULL;

COMMIT;
