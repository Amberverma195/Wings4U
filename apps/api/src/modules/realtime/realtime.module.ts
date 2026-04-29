import { Global, Module } from "@nestjs/common";
import { KdsAuthService } from "../kds/kds-auth.service";
import { RealtimeGateway } from "./realtime.gateway";

@Global()
@Module({
  providers: [RealtimeGateway, KdsAuthService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
