import type { PrismaClient } from "@prisma/client";

const REQUIRED_MIGRATION = "20261020120000_customer_account_deletion";

type SchemaProbe = {
  account_deleted_at: boolean;
  authorizations: boolean;
  requests: boolean;
  holds: boolean;
};

/**
 * Prisma selects every User column (including account_deleted_at) on ordinary
 * session lookups, so this API version cannot serve requests against a database
 * that is missing the migration. Refuse to start instead of failing every login.
 * Read-only: inspects the catalog, never creates or alters anything.
 */
export async function assertDatabaseSchemaCompatible(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<void> {
  const [probe] = await prisma.$queryRaw<SchemaProbe[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'account_deleted_at'
      ) AS account_deleted_at,
      to_regclass('account_deletion_authorizations') IS NOT NULL AS authorizations,
      to_regclass('account_deletion_requests') IS NOT NULL AS requests,
      to_regclass('account_deletion_holds') IS NOT NULL AS holds`;
  const missing = Object.entries(probe ?? {})
    .filter(([, present]) => present !== true)
    .map(([name]) => name);
  if (!probe || missing.length) {
    throw new Error(
      `Database schema is older than this API build (missing: ${missing.join(", ") || "probe result"}). ` +
        `Apply migration ${REQUIRED_MIGRATION} before deploying this API version.`,
    );
  }
}
