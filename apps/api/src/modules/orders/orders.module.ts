import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { KdsModule } from "../kds/kds.module";
import { RefundModule } from "../refunds/refund.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [ChatModule, KdsModule, RefundModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
