-- 0002_manual_sql_patches.sql
-- Run ONCE in Supabase SQL Editor (or psql) against an *existing* database that
-- was created from an older 0001 baseline *before* the 2026-03-22 support expansion.
--
-- Do NOT run this on a fresh database created from the current 0001 file — those
-- tables already match. Do NOT run the full 0001 baseline again on production.
--
-- After this, run: npm run db:generate (and db pull if you regenerate Prisma from DB).

BEGIN;

-- --- support_tickets: expand created_source + add priority -----------------

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_created_source_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_created_source_check
  CHECK (created_source IN (
    'CUSTOMER','CUSTOMER_APP','STAFF','STAFF_PANEL','ADMIN_PANEL','AUTO_OVERDUE'
  ));

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL';

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_priority_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_priority_check
  CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT'));

-- --- support_ticket_events: expand event_type + add payload_json ------------

ALTER TABLE support_ticket_events
  DROP CONSTRAINT IF EXISTS support_ticket_events_event_type_check;

ALTER TABLE support_ticket_events
  ADD CONSTRAINT support_ticket_events_event_type_check
  CHECK (event_type IN (
    'STATUS_CHANGE','STATUS_CHANGED',
    'PRIORITY_CHANGE','PRIORITY_CHANGED',
    'RESOLUTION_SET','RESOLVED',
    'REOPENED','NOTE_ADDED',
    'CREATED','MESSAGE_ADDED','ASSIGNED'
  ));

ALTER TABLE support_ticket_events
  ADD COLUMN IF NOT EXISTS payload_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
