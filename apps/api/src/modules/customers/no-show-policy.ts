import { UnprocessableEntityException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

export const DELIVERY_BLOCKED_NO_SHOWS_CODE = "DELIVERY_BLOCKED_NO_SHOWS";
export const DELIVERY_BLOCKED_NO_SHOWS_MESSAGE =
  "Delivery is unavailable due to your recent order history. Pickup is still available.";

export type DeliveryEligibility = {
  customerTotalNoShows: number | null;
  prepaymentThresholdNoShows: number;
  deliveryBlockedDueToNoShows: boolean;
};

type PrismaLike = Pick<PrismaClient, "customerProfile" | "locationSettings">;

export function deriveDeliveryEligibility(
  customerTotalNoShows: number | null,
  prepaymentThresholdNoShows: number,
): DeliveryEligibility {
  const total = customerTotalNoShows ?? 0;
  return {
    customerTotalNoShows,
    prepaymentThresholdNoShows,
    deliveryBlockedDueToNoShows: total > prepaymentThresholdNoShows,
  };
}

export async function getDeliveryEligibilityForCustomer(
  prisma: PrismaLike,
  locationId: string,
  userId?: string | null,
  prepaymentThresholdNoShows?: number,
): Promise<DeliveryEligibility> {
  const threshold =
    typeof prepaymentThresholdNoShows === "number"
      ? prepaymentThresholdNoShows
      : (
          await prisma.locationSettings.findUnique({
            where: { locationId },
            select: { prepaymentThresholdNoShows: true },
          })
        )?.prepaymentThresholdNoShows ?? 3;

  if (!userId) {
    return deriveDeliveryEligibility(null, threshold);
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
    select: { totalNoShows: true },
  });

  return deriveDeliveryEligibility(profile?.totalNoShows ?? 0, threshold);
}

export function assertCustomerMayUseDelivery(
  eligibility: DeliveryEligibility,
): void {
  if (!eligibility.deliveryBlockedDueToNoShows) {
    return;
  }

  throw new UnprocessableEntityException({
    code: DELIVERY_BLOCKED_NO_SHOWS_CODE,
    error: DELIVERY_BLOCKED_NO_SHOWS_CODE,
    field: "fulfillment_type",
    message: DELIVERY_BLOCKED_NO_SHOWS_MESSAGE,
    total_no_shows: eligibility.customerTotalNoShows,
    prepayment_threshold_no_shows: eligibility.prepaymentThresholdNoShows,
  });
}

/**
 * Placeholder for the future card-prepayment rule once an online gateway exists.
 * In this cash-only phase we keep payment-related schema/code in place, but we
 * do not flip `prepaymentRequired` from no-show counts yet.
 */
export function documentFuturePrepaymentPolicy() {
  return {
    active: false,
    note:
      "Future milestone: an online payment gateway may set prepaymentRequired " +
      "when totalNoShows reaches or exceeds the configured threshold.",
  } as const;
}
