import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PaymentsModule } from "../payments/payments.module";
import { PromotionsModule } from "../promotions/promotions.module";
import { RewardsModule } from "../rewards/rewards.module";
import { KdsModule } from "../kds/kds.module";
import { DeliveryPricingModule } from "../delivery-pricing/delivery-pricing.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";

@Module({
  imports: [
    AuthModule,
    RewardsModule,
    PromotionsModule,
    PaymentsModule,
    KdsModule,
    DeliveryPricingModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
