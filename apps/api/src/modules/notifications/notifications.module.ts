import { Module } from "@nestjs/common";
import { OrderStatusEmailService } from "./order-status-email.service";

/**
 * OTP, order, support, and operational notification dispatch.
 */
@Module({
  providers: [OrderStatusEmailService],
  exports: [OrderStatusEmailService],
})
export class NotificationsModule {}
