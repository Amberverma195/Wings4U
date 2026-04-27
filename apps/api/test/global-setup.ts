/**
 * Jest globalSetup for e2e tests.
 *
 * Runs once before any test file loads:
 * 1. Loads .env.test (overrides .env) so DATABASE_URL points at the e2e DB.
 * 2. Ensures the target database exists (CREATE DATABASE on the postgres DB if missing).
 * 3. Runs `prisma migrate deploy` so schema matches migrations.
 * 4. Truncates all application data tables (CASCADE).
 * 5. Runs the canonical Prisma seed via tsx subprocess.
 *
 * Requires: .env.test with a valid DATABASE_URL for a dedicated test database.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string, override: boolean): void {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(__dirname, ".env.test"), true);
loadEnvFile(resolve(__dirname, "../../../.env"), false);

const REPO_ROOT = resolve(__dirname, "../../..");
const DATABASE_PKG = resolve(REPO_ROOT, "packages/database");

function parseDbName(connectionString: string): string {
  const url = new URL(connectionString);
  const raw = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  const dbName = decodeURIComponent(raw);
  if (!dbName) {
    throw new Error(
      "E2E global setup: could not parse database name from DATABASE_URL pathname.",
    );
  }
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(
      `E2E global setup: database name "${dbName}" must be [a-zA-Z0-9_] for auto-create.`,
    );
  }
  return dbName;
}

function describeConnectionTarget(connectionString: string): string {
  const url = new URL(connectionString);
  const host = url.hostname || "unknown-host";
  const port = url.port || "5432";
  const database = parseDbName(connectionString);
  return `${host}:${port}/${database}`;
}

/** Connect to the default `postgres` DB and CREATE DATABASE if missing (local dev convenience). */
async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const dbName = parseDbName(connectionString);
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const r = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (r.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${dbName}`);
      console.log(`[e2e] Created database "${dbName}".`);
    }
  } finally {
    await admin.end();
  }
}

const DATA_TABLES = [
  "admin_audit_logs",
  "daily_tax_summary",
  "cash_drawer_events",
  "register_sessions",
  "registers",
  "employee_breaks",
  "employee_shifts",
  "catering_inquiries",
  "chat_read_states",
  "chat_side_read_states",
  "order_messages",
  "order_conversations",
  "support_ticket_events",
  "support_ticket_resolutions",
  "support_ticket_messages",
  "support_tickets",
  "item_reviews",
  "driver_delivery_review_tags",
  "driver_delivery_reviews",
  "driver_payout_order_links",
  "driver_payouts",
  "inventory_adjustments",
  "restock_list_items",
  "restock_lists",
  "inventory_items",
  "customer_credit_ledger",
  "customer_wallets",
  "refund_requests",
  "order_payments",
  "order_discounts",
  "promo_redemptions",
  "promo_bxgy_rules",
  "promo_valid_days",
  "promo_code_category_targets",
  "promo_code_product_targets",
  "promo_codes",
  "delivery_pin_verifications",
  "order_driver_events",
  "order_change_requests",
  "cancellation_requests",
  "order_finalization_events",
  "order_eta_events",
  "order_status_events",
  "order_item_flavours",
  "order_item_wing_configs",
  "order_item_modifiers",
  "order_items",
  "orders",
  "checkout_idempotency_keys",
  "menu_item_schedules",
  "menu_item_modifier_groups",
  "modifier_options",
  "modifier_groups",
  "menu_items",
  "wing_flavours",
  "menu_categories",
  "location_hours",
  "location_settings",
  "devices",
  "auth_sessions",
  "auth_otp_codes",
  "driver_profiles",
  "admin_location_assignments",
  "employee_profiles",
  "customer_profiles",
  "user_identities",
  "users",
  "locations",
];

export default async function globalSetup(): Promise<void> {
  const connectionString =
    process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "E2E global setup: DIRECT_URL or DATABASE_URL must be set in .env.test. " +
        "See apps/api/test/.env.test for instructions.",
    );
  }

  try {
    await ensureDatabaseExists(connectionString);
  } catch (error) {
    const target = describeConnectionTarget(connectionString);
    throw new Error(
      `E2E global setup: could not connect to Postgres at ${target}. ` +
        "Start the test database or point apps/api/test/.env.test at a reachable Postgres instance.",
      { cause: error as Error },
    );
  }

  console.log("[e2e] Applying migrations...");
  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
    cwd: DATABASE_PKG,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DIRECT_URL: connectionString,
    },
  });

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    console.log("[e2e] Resetting test database...");
    await client.query(`TRUNCATE ${DATA_TABLES.join(", ")} CASCADE`);
    console.log("[e2e] Tables truncated.");
  } finally {
    await client.end();
  }

  console.log("[e2e] Running seed...");
  execSync("npx tsx packages/database/prisma/seed.ts", {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DIRECT_URL: connectionString,
    },
  });
  console.log("[e2e] Seed complete. Test database ready.");
}
