import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PromotionsModule } from "../promotions/promotions.module";
import { RewardsModule } from "../rewards/rewards.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";

@Module({
  imports: [AuthModule, RewardsModule, PromotionsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
