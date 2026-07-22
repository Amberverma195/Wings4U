import { Module } from "@nestjs/common";
import { DeliveryPricingController } from "./delivery-pricing.controller";
import { DeliveryPricingService } from "./delivery-pricing.service";
import { DeliveryQuoteTokenService } from "./delivery-quote-token.service";
import { DeliveryQuoteVerifierService } from "./delivery-quote-verifier.service";
import { GoogleRoutesClient } from "./google-routes.client";

@Module({
  controllers: [DeliveryPricingController],
  providers: [
    GoogleRoutesClient,
    DeliveryQuoteTokenService,
    DeliveryQuoteVerifierService,
    DeliveryPricingService,
  ],
  exports: [
    DeliveryPricingService,
    DeliveryQuoteTokenService,
    DeliveryQuoteVerifierService,
  ],
})
export class DeliveryPricingModule {}
