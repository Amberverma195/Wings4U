import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
import { LocationSettingsService } from "./location-settings.service";


/**
 * Locations, hours, busy mode, tax flags, and location-scoped settings.
 */
@Module({
  controllers: [LocationsController],
  providers: [LocationSettingsService],
  exports: [LocationSettingsService],
})
export class LocationsModule {}
