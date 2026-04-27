import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { KdsStationGuard } from "../../common/guards/kds-station.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { RefundModule } from "../refunds/refund.module";
import { RewardsModule } from "../rewards/rewards.module";
import { SupportModule } from "../support/support.module";
import { BusyModeService } from "./busy-mode.service";
import { DeliveryPinService } from "./delivery-pin.service";
import { KdsAutoAcceptWorker } from "./kds-auto-accept.worker";
import { KdsController } from "./kds.controller";
import { KdsHeartbeatService } from "./kds-heartbeat.service";
import { KdsService } from "./kds.service";
import { OverdueDeliveryWorker } from "./overdue-delivery.worker";

@Module({
  imports: [ChatModule, SupportModule, RefundModule, RewardsModule],
  controllers: [KdsController],
  providers: [
    KdsService,
    KdsHeartbeatService,
    KdsAutoAcceptWorker,
    BusyModeService,
    DeliveryPinService,
    KdsStationGuard,
    StoreNetworkGuard,
    OverdueDeliveryWorker,
  ],
  exports: [KdsService, KdsHeartbeatService, BusyModeService, DeliveryPinService],
})
export class KdsModule {}
