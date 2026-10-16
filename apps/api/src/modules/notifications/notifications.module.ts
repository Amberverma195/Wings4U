import { Module } from "@nestjs/common";
import { OrderStatusEmailService } from "./order-status-email.service";
import { StampGrantEmailService } from "./stamp-grant-email.service";

/**
 * OTP, order, support, and operational notification dispatch.
 */
@Module({
  providers: [OrderStatusEmailService, StampGrantEmailService],
  exports: [OrderStatusEmailService, StampGrantEmailService],
})
export class NotificationsModule {}
