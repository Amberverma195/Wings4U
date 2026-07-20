import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { CatalogModule } from "../catalog/catalog.module";
import { KdsStationGuard } from "../../common/guards/kds-station.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { RefundModule } from "../refunds/refund.module";
import { RewardsModule } from "../rewards/rewards.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SupportModule } from "../support/support.module";
import { BusyModeService } from "./busy-mode.service";
import { DeliveryPinService } from "./delivery-pin.service";
import { KdsAutoAcceptScheduler } from "./kds-auto-accept.scheduler";
import { KdsController } from "./kds.controller";
import { KdsService } from "./kds.service";
import { KdsAuthController } from "./kds-auth.controller";
import { OverdueDeliveryJob } from "./overdue-delivery.job";
import { KdsOperatingHoursGuard } from "./kds-operating-hours.guard";
import { KdsStationAccessModule } from "./kds-station-access.module";

@Module({
  imports: [
    ChatModule,
    SupportModule,
    RefundModule,
    RewardsModule,
    CatalogModule,
    NotificationsModule,
    KdsStationAccessModule,
  ],
  controllers: [KdsController, KdsAuthController],
  providers: [
    KdsService,
    KdsAutoAcceptScheduler,
    BusyModeService,
    DeliveryPinService,
    KdsStationGuard,
    StoreNetworkGuard,
    OverdueDeliveryJob,
    KdsOperatingHoursGuard,
  ],
  exports: [
    KdsService,
    KdsAutoAcceptScheduler,
    BusyModeService,
    DeliveryPinService,
    OverdueDeliveryJob,
  ],
})
export class KdsModule {}
