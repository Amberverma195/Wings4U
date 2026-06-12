import { Module } from "@nestjs/common";
import { CartModule } from "../cart/cart.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { StripePaymentsController } from "./stripe-payments.controller";
import { StripePaymentsService } from "./stripe-payments.service";

@Module({
  imports: [CartModule],
  controllers: [PaymentsController, StripePaymentsController],
  providers: [PaymentsService, StripePaymentsService],
  exports: [PaymentsService, StripePaymentsService],
})
export class PaymentsModule {}
