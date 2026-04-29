-- patch2.sql — Timeclock schema expansion (editor-friendly name)
-- Same DDL as 0003_timeclock_schema_expansion.sql — pick whichever filename you prefer in SQL editor.
--
-- Run on an EXISTING database after baseline (and after 0002 / patch1 if you use support expansion).
-- Do NOT run on a database already created from the current 0001 baseline (it already includes this).
--
-- Changes:
--   1. employee_shifts.status: allow CLOCKED_IN | ON_BREAK | CLOCKED_OUT (keeps OPEN|CLOSED for legacy rows)
--   2. employee_shifts.total_break_minutes, net_worked_minutes
--   3. employee_breaks.break_type: UNPAID only
--   4. Partial uniques: one active shift per employee, one open break per shift

BEGIN;

ALTER TABLE employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_status_check;

ALTER TABLE employee_shifts
  ADD CONSTRAINT employee_shifts_status_check
  CHECK (status IN ('OPEN','CLOSED','CLOCKED_IN','ON_BREAK','CLOCKED_OUT'));

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS total_break_minutes int NOT NULL DEFAULT 0;

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS net_worked_minutes int;

ALTER TABLE employee_breaks
  DROP CONSTRAINT IF EXISTS employee_breaks_break_type_check;

ALTER TABLE employee_breaks
  ADD CONSTRAINT employee_breaks_break_type_check
  CHECK (break_type IN ('UNPAID'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_shift_per_employee
  ON employee_shifts(employee_user_id)
  WHERE status IN ('CLOCKED_IN','ON_BREAK');

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_break_per_shift
  ON employee_breaks(employee_shift_id)
  WHERE ended_at IS NULL;

COMMIT;
