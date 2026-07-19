import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { OverdueDeliveryJob } from "../modules/kds/overdue-delivery.job";
import { SupportModule } from "../modules/support/support.module";

@Module({
  imports: [DatabaseModule, SupportModule],
  providers: [OverdueDeliveryJob],
})
export class OverdueDeliveriesCronModule {}
