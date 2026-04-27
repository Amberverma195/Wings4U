import { Module } from "@nestjs/common";
import { KdsStationGuard } from "../../common/guards/kds-station.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";

@Module({
  controllers: [DriversController],
  providers: [DriversService, KdsStationGuard, StoreNetworkGuard],
  exports: [DriversService],
})
export class DriversModule {}
