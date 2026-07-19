import { Global, Module } from "@nestjs/common";
import { KdsAuthService } from "../kds/kds-auth.service";
import { KdsPresenceService } from "../kds/kds-presence.service";
import { PosAuthService } from "../pos/pos-auth.service";
import { RealtimeGateway } from "./realtime.gateway";

@Global()
@Module({
  providers: [RealtimeGateway, KdsAuthService, KdsPresenceService, PosAuthService],
  exports: [RealtimeGateway, KdsPresenceService],
})
export class RealtimeModule {}
