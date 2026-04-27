-- Align database with current Prisma schema (columns present in schema.prisma but not in init migration).

-- Timeclock (see db/sql/0003_timeclock_schema_expansion.sql)
ALTER TABLE employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_status_check;

ALTER TABLE employee_shifts
  ADD CONSTRAINT employee_shifts_status_check
  CHECK (status IN ('OPEN','CLOSED','CLOCKED_IN','ON_BREAK','CLOCKED_OUT'));

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS total_break_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS net_worked_minutes INTEGER;

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

-- Support tickets / events
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';

ALTER TABLE support_ticket_events
  ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;
