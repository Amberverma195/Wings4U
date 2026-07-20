import { Module } from "@nestjs/common";
import { KdsStationGuard } from "../../common/guards/kds-station.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { KdsStationAccessModule } from "../kds/kds-station-access.module";
import { DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";

@Module({
  imports: [KdsStationAccessModule],
  controllers: [DriversController],
  providers: [DriversService, KdsStationGuard, StoreNetworkGuard],
  exports: [DriversService],
})
export class DriversModule {}
