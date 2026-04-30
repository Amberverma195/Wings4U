import type { Prisma } from "@prisma/client";

const FIRST_ORDER_NUMBER = 1001n;

export async function allocateNextOrderNumber(
  tx: Prisma.TransactionClient,
  locationId: string,
): Promise<bigint> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('w4u_order_number'), hashtext(${locationId}))
  `;

  const latestOrder = await tx.order.findFirst({
    where: { locationId },
    select: { orderNumber: true },
    orderBy: { orderNumber: "desc" },
  });

  return latestOrder ? latestOrder.orderNumber + 1n : FIRST_ORDER_NUMBER;
}
