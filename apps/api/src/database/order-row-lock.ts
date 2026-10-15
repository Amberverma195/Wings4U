import type { Prisma } from "@prisma/client";

/**
 * Locks an order row for the rest of the current transaction so payment
 * writes for the same order run one at a time. Returns false when the order
 * does not exist at this location.
 */
export async function lockOrderForLocation(
  tx: Prisma.TransactionClient,
  orderId: string,
  locationId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM   orders
    WHERE  id = ${orderId}::uuid
      AND  location_id = ${locationId}::uuid
    FOR UPDATE
  `;
  return rows.length > 0;
}
