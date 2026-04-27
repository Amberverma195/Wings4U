import type { Prisma } from "@prisma/client";

/**
 * Locks the customer's wallet row for the duration of the current transaction
 * and returns the current balance for checkout, order-change, and POS debits.
 */
export async function lockAndReadWalletBalanceCents(
  tx: Prisma.TransactionClient,
  customerUserId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ balance_cents: number }>>`
    SELECT balance_cents
    FROM   customer_wallets
    WHERE  customer_user_id = ${customerUserId}::uuid
    FOR UPDATE
  `;
  return rows[0]?.balance_cents ?? 0;
}
