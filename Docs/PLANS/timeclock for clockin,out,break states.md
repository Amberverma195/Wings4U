# Expand Timeclock Schema for Rich Shift State and Stored Totals

## Summary

The current schema already captures the raw timestamps you care about:
- shift start: `employee_shifts.clock_in_at`
- shift end: `employee_shifts.clock_out_at`
- each break start/end: `employee_breaks.started_at` / `ended_at`

But you chose a **full schema expansion** so the database should also persist:
- richer shift state: `CLOCKED_IN`, `ON_BREAK`, `CLOCKED_OUT`
- stored per-shift totals:
  - `total_break_minutes`
  - `net_worked_minutes`
- unpaid breaks only
- driver availability becomes `UNAVAILABLE` during breaks, then `AVAILABLE` on break end if not on delivery

This should be implemented as a canonical SQL change first, then Prisma, then service/controller/doc/test alignment.

## Key Changes

### 1. Expand the canonical SQL schema

Update [0001_wings4u_baseline_v1_4.sql](/d:/Projects/Websites/Wings4U/Code/db/sql/0001_wings4u_baseline_v1_4.sql) and add a live patch file such as `db/sql/0003_timeclock_schema_expansion.sql`.

Change `employee_shifts`:
- expand `status` check from `OPEN|CLOSED` to `CLOCKED_IN|ON_BREAK|CLOCKED_OUT`
- add `total_break_minutes int NOT NULL DEFAULT 0`
- add `net_worked_minutes int`
- keep `clock_in_at` and `clock_out_at` as the raw audit timestamps

Change `employee_breaks`:
- keep `started_at` and `ended_at`
- keep `break_type`, but canonically constrain it to `UNPAID` only, since you said every break is unpaid

Add integrity constraints/indexes:
- partial unique index so one employee can have only one active shift at a time
- partial unique index so one shift can have only one open break at a time

Recommended invariant shape:
- active shift = `status IN ('CLOCKED_IN','ON_BREAK')`
- open break = `ended_at IS NULL`

### 2. Refresh Prisma to match the expanded schema

Update [schema.prisma](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/schema.prisma) so `EmployeeShift` includes:
- `status`
- `totalBreakMinutes`
- `netWorkedMinutes`

And `EmployeeBreak` matches the new break rule:
- `breakType`
- `startedAt`
- `endedAt`

Keep these as string-backed columns with updated DB constraints rather than introducing new Prisma enums in this pass.

### 3. Rewrite the timeclock service around the new canonical model

Update [timeclock.service.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/src/modules/timeclock/timeclock.service.ts):

- `clockIn()`
  - create shift with `status = CLOCKED_IN`
  - initialize `total_break_minutes = 0`
  - `net_worked_minutes = null`
  - if employee is a driver, set driver availability to `AVAILABLE`

- `startBreak()`
  - require active shift in `CLOCKED_IN`
  - create `employee_breaks` row with `break_type = UNPAID`
  - update shift to `ON_BREAK`
  - if employee is a driver and not on delivery, set availability to `UNAVAILABLE`

- `endBreak()`
  - require active shift in `ON_BREAK`
  - close the open break row by setting `ended_at`
  - recalculate `total_break_minutes`
  - set shift back to `CLOCKED_IN`
  - if employee is a driver and not on delivery, set availability back to `AVAILABLE`

- `clockOut()`
  - require active shift
  - if currently `ON_BREAK`, auto-close the open break first
  - set `clock_out_at`
  - set `status = CLOCKED_OUT`
  - recalculate `total_break_minutes`
  - calculate `net_worked_minutes = (clock_out_at - clock_in_at) - total_break_minutes`
  - if employee is a driver, set availability to `OFF_SHIFT`

- `getCurrent()` / `getHistory()`
  - return the stored totals
  - also include raw break rows
  - for an active shift, it is fine to additionally compute live in-memory display values if needed, but persisted columns remain the source of truth for completed shifts

### 4. Keep the public API surface, but improve the returned payloads

Keep the current endpoints:
- `POST /timeclock/clock-in`
- `POST /timeclock/clock-out`
- `POST /timeclock/break/start`
- `POST /timeclock/break/end`
- `GET /timeclock/current`
- `GET /timeclock/history`

Update response payloads so shift objects include:
- `status`
- `clock_in_at`
- `clock_out_at`
- `total_break_minutes`
- `net_worked_minutes`
- `breaks[]` with `started_at` / `ended_at`

No request body changes are required for break type in this pass; the backend should write `UNPAID` automatically.

### 5. Align docs and issue tracking

Update the API contract in [Wings4U_API_Contract_v1_0.md](/d:/Projects/Websites/Wings4U/Code/Docs/API_Spec/Wings4U_API_Contract_v1_0.md):
- add `/timeclock/break/start` and `/timeclock/break/end`
- document rich shift status values
- document stored totals on returned shift payloads
- document driver availability behavior during break start/end

After implementation and verification:
- move the timeclock issue out of [issues.md](/d:/Projects/Websites/Wings4U/Code/Docs/procedures/issues/issues.md)
- add a completed entry to [tasks.md](/d:/Projects/Websites/Wings4U/Code/Docs/procedures/tasks.md)

## Test Plan

Add or update e2e/service coverage for:
- clock in creates `CLOCKED_IN` shift with zero break minutes
- second clock-in is rejected while shift is active
- start break creates one `UNPAID` break row and sets shift to `ON_BREAK`
- second break start is rejected while already on break
- end break closes the open break, restores `CLOCKED_IN`, and updates `total_break_minutes`
- clock out from `CLOCKED_IN` sets `CLOCKED_OUT` and computes `net_worked_minutes`
- clock out from `ON_BREAK` auto-closes the break first, then computes totals
- multiple breaks accumulate correctly in one shift
- driver availability transitions:
  - clock-in -> `AVAILABLE`
  - break start -> `UNAVAILABLE`
  - break end -> `AVAILABLE`
  - clock-out -> `OFF_SHIFT`

## Assumptions

- You want rich persisted shift status, not inferred `OPEN/CLOSED`
- Every break is unpaid
- Totals should be stored on each shift row, not computed only at read time
- “On shift time of one day” means per-shift net worked time; if multiple shifts occur in a day, daily totals can be aggregated from shift rows later
- No full payroll/timekeeping expansion is being added now beyond rich status, unpaid breaks, and stored per-shift totals
