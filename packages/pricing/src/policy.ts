export type PricingPolicy = {
  taxRateBps: number;
  taxDeliveryFee: boolean;
  taxTip: boolean;
  discountsReduceTaxableBase: boolean;
};

export const defaultPricingPolicy: PricingPolicy = {
  taxRateBps: 0,
  taxDeliveryFee: true,
  taxTip: false,
  discountsReduceTaxableBase: true
};
