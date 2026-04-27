import { Module } from "@nestjs/common";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";

@Module({
  controllers: [PosController],
  providers: [PosService, StoreNetworkGuard],
  exports: [PosService],
})
export class PosModule {}
