import { Module } from "@nestjs/common";
import { KdsAuthService } from "./kds-auth.service";
import { KdsOperatingHoursService } from "./kds-operating-hours.service";

@Module({
  providers: [KdsAuthService, KdsOperatingHoursService],
  exports: [KdsAuthService, KdsOperatingHoursService],
})
export class KdsStationAccessModule {}
