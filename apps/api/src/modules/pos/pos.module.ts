import { Module } from "@nestjs/common";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";
import { PosAuthController } from "./pos-auth.controller";
import { PosAuthService } from "./pos-auth.service";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { PosStationGuard } from "../../common/guards/pos-station.guard";

@Module({
  controllers: [PosController, PosAuthController],
  providers: [
    PosService,
    PosAuthService,
    StoreNetworkGuard,
    PosStationGuard,
  ],
  exports: [PosService, PosAuthService],
})
export class PosModule {}
