import type { PricingBreakdown } from "@wings4u/contracts";
import type { PricingPolicy } from "./policy";

export type PricingInput = {
  itemSubtotalCents: number;
  itemDiscountTotalCents: number;
  orderDiscountTotalCents: number;
  deliveryFeeCents: number;
  driverTipCents: number;
  walletAppliedCents: number;
};

export function createPricingBreakdown(
  input: PricingInput,
  policy: PricingPolicy
): PricingBreakdown {
  const discountedSubtotalCents =
    input.itemSubtotalCents - input.itemDiscountTotalCents - input.orderDiscountTotalCents;
  const taxableBase = policy.discountsReduceTaxableBase
    ? discountedSubtotalCents
    : input.itemSubtotalCents;
  const deliveryTaxable = policy.taxDeliveryFee ? input.deliveryFeeCents : 0;
  const tipTaxable = policy.taxTip ? input.driverTipCents : 0;
  const taxableSubtotalCents = Math.max(0, taxableBase + deliveryTaxable + tipTaxable);
  const taxCents = Math.max(0, Math.round((taxableSubtotalCents * policy.taxRateBps) / 10000));
  const finalPayableCents = Math.max(
    0,
    discountedSubtotalCents +
      input.deliveryFeeCents +
      input.driverTipCents +
      taxCents -
      input.walletAppliedCents
  );

  return {
    itemSubtotalCents: input.itemSubtotalCents,
    discountedSubtotalCents: Math.max(0, discountedSubtotalCents),
    taxableSubtotalCents,
    taxCents,
    deliveryFeeCents: input.deliveryFeeCents,
    driverTipCents: input.driverTipCents,
    walletAppliedCents: input.walletAppliedCents,
    finalPayableCents
  };
}
