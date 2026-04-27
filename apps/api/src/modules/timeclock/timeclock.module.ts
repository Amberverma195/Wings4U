import { Module } from "@nestjs/common";
import { TimeclockController } from "./timeclock.controller";
import { TimeclockService } from "./timeclock.service";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";

@Module({
  controllers: [TimeclockController],
  providers: [TimeclockService, StoreNetworkGuard],
  exports: [TimeclockService],
})
export class TimeclockModule {}
