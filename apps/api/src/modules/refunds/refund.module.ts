import { Module } from "@nestjs/common";
import { RefundController } from "./refund.controller";
import { RefundService } from "./refund.service";
import { WalletsModule } from "../wallets/wallets.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [WalletsModule, PaymentsModule],
  controllers: [RefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
