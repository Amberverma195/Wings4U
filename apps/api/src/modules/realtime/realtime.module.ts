import { Global, Module } from "@nestjs/common";
import { KdsAuthService } from "../kds/kds-auth.service";
import { PosAuthService } from "../pos/pos-auth.service";
import { RealtimeGateway } from "./realtime.gateway";

@Global()
@Module({
  providers: [RealtimeGateway, KdsAuthService, PosAuthService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
