import { Module } from "@nestjs/common";
import { PromotionsModule } from "../promotions/promotions.module";
import { RewardsModule } from "../rewards/rewards.module";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";

@Module({
  imports: [RewardsModule, PromotionsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
