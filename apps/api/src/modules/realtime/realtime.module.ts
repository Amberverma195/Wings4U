import { Global, Module } from "@nestjs/common";
import { KdsPresenceService } from "../kds/kds-presence.service";
import { PosAuthService } from "../pos/pos-auth.service";
import { RealtimeGateway } from "./realtime.gateway";
import { KdsStationAccessModule } from "../kds/kds-station-access.module";

@Global()
@Module({
  imports: [KdsStationAccessModule],
  providers: [
    RealtimeGateway,
    KdsPresenceService,
    PosAuthService,
  ],
  exports: [RealtimeGateway, KdsPresenceService],
})
export class RealtimeModule {}
