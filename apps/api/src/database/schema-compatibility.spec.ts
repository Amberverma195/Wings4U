import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDatabaseSchemaCompatible } from "./schema-compatibility";

const probe = (overrides: Record<string, boolean> = {}) => ({
  $queryRaw: jest.fn(async () => [{ account_deleted_at: true, authorizations: true, requests: true, holds: true, ...overrides }]),
});

describe("API startup schema compatibility (mocked catalog only)", () => {
  it("starts when the account deletion migration is present", async () => {
    await expect(assertDatabaseSchemaCompatible(probe() as any)).resolves.toBeUndefined();
  });

  it("refuses to start, naming the migration, when the API is deployed before it", async () => {
    await expect(assertDatabaseSchemaCompatible(probe({ account_deleted_at: false }) as any))
      .rejects.toThrow(/missing: account_deleted_at.*20261020120000_customer_account_deletion/);
  });

  it("refuses to start when the probe returns nothing", async () => {
    await expect(assertDatabaseSchemaCompatible({ $queryRaw: jest.fn(async () => []) } as any))
      .rejects.toThrow("Database schema is older than this API build");
  });
});

describe("account deletion migration guard configuration (static)", () => {
  const sql = readFileSync(resolve(__dirname,
    "../../../../packages/database/prisma/migrations/20261020120000_customer_account_deletion/migration.sql"), "utf8");
  const entry = (table: string) => new RegExp(`\\['${table}','[a-z_]+','([^']*)'\\]`).exec(sql)?.[1];

  it("lets staff keep operating on retained records while re-applying erased values", () => {
    expect(JSON.parse(entry("support_tickets")!)).toEqual({
      subject: "Personal information removed", description: "Personal information removed" });
    for (const table of ["support_ticket_messages", "order_messages"]) {
      expect(JSON.parse(entry(table)!)).toEqual({ message_body: "Personal information removed" });
    }
    for (const table of ["customer_credit_ledger", "customer_wings_stamp_ledger"]) {
      expect(JSON.parse(entry(table)!)).toEqual({ reason_text: "Personal information removed" });
    }
    expect(JSON.parse(entry("promo_redemptions")!)).toEqual({ metadata_json: {} });
    expect(sql).toContain("RETURN jsonb_populate_record(NEW, TG_ARGV[1]::jsonb)");
  });

  it("never allows new wallet balances or credentials for a deleted account", () => {
    for (const table of ["customer_wallets", "user_identities", "auth_sessions", "customer_addresses", "customer_profiles"]) {
      expect(entry(table)).toBe("");
    }
  });
});
