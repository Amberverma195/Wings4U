import { Module } from "@nestjs/common";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";

@Module({
  controllers: [DriversController],
  providers: [DriversService, StoreNetworkGuard],
  exports: [DriversService],
})
export class DriversModule {}
