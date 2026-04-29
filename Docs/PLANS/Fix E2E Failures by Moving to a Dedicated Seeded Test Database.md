# Fix E2E Failures by Moving to a Dedicated Seeded Test Database

## Summary

The root problem is not just “seed data is missing.”  
It is:

- the e2e suite expects hard-coded baseline records like `LON01`
- the test harness does not create them
- the suite appears to use the normal Prisma connection, not a dedicated test database
- so tests depend on outside state instead of creating their own state

Chosen fix:
- use a **separate e2e database**
- reset it automatically before the suite
- seed the exact baseline data before `app.e2e-spec.ts` does any lookup
- keep the current test assumptions (`LON01`, seeded users, menu data), because the seed already creates that baseline

## Key Changes

### 1. Introduce a real e2e database environment
Add a dedicated environment variable for tests, such as:
- `E2E_DATABASE_URL`

The e2e harness should force Prisma to use that connection for the test process.

Required result:
- e2e does **not** run against the normal dev/app database
- test data can be safely reset without touching real development data

Recommended default:
- set both `DIRECT_URL` and `DATABASE_URL` to the e2e DB inside the e2e bootstrap process so the API app and Prisma both point at the same test DB during the suite

### 2. Add automatic reset + seed before Jest starts the app
The correct fix point is the **test harness**, not scattered per-test inserts.

Add a global e2e bootstrap step that runs before `beforeAll()` in [app.e2e-spec.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts):

1. load the e2e DB env
2. reset the test DB to a known baseline
3. run the Prisma seed
4. then let Jest boot Nest and run tests

Use the existing seed in [seed.ts](/d:/Projects/Websites/Wings4U/Code/packages/database/prisma/seed.ts) as the canonical baseline source, because it already creates:
- location `LON01`
- test users
- employee roles
- wallet
- menu categories/items/modifiers/flavours

Preferred reset behavior:
- destructive reset of the **dedicated e2e DB only**
- then seed from scratch every run

That gives you real determinism, not “seed if missing.”

### 3. Stop relying on ambient shared state inside the suite
Keep the lookup pattern in [app.e2e-spec.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts), but make it depend on guaranteed bootstrap state, not hope.

After bootstrap, these lookups are valid:
- `location code = LON01`
- customer/admin/manager/kitchen/cashier/driver users
- menu data

Do **not** move all seeding logic into the test file unless you deliberately choose a test-only bootstrap approach. The repo already has a baseline seed; use it.

### 4. Tighten the harness configuration
Update the e2e Jest setup so environment loading and DB preparation are explicit.

Current state:
- [jest-e2e.json](/d:/Projects/Websites/Wings4U/Code/apps/api/test/jest-e2e.json) only has `setupFiles`
- [setup-env.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/setup-env.ts) loads env variables, but does not prepare DB state

Required improvement:
- add a proper global e2e setup step that prepares the DB before tests start
- keep `setup-env.ts` for env loading if useful, but do not rely on it for actual DB initialization

### 5. Add a test-running entrypoint that always does the right thing
Create a clear workflow for running e2e so no one has to remember manual prep.

Expected behavior for `npm run test:e2e`:
- point to e2e DB
- reset test DB
- seed test DB
- run the suite

This should become the single supported way to run e2e.

## Test Cases and Scenarios

After the fix, verify these conditions:

- e2e bootstrap creates or restores a clean DB state before the suite
- `beforeAll()` in [app.e2e-spec.ts](/d:/Projects/Websites/Wings4U/Code/apps/api/test/app.e2e-spec.ts) can always find:
  - `LON01`
  - customer/admin/manager/kitchen/cashier/driver users
  - at least one menu item
- repeated runs produce the same baseline and do not depend on prior manual seeding
- running e2e does not modify the normal dev database
- tests reach real assertions instead of failing at initial data lookup

## Assumptions

- The existing Prisma seed file is the correct canonical baseline for e2e.
- The right long-term fix is **isolated test DB + automatic reset/seed**, not shared dev DB reliance.
- It is acceptable for e2e bootstrap to wipe the dedicated test DB on each run.
- The suite may continue to create additional orders/tickets during tests, because the database starts from a known clean baseline each run.
