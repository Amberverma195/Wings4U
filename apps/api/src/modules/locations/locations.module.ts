import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { LocationsController } from "./locations.controller";
import { LocationSettingsService } from "./location-settings.service";


/**
 * Locations, hours, busy mode, tax flags, and location-scoped settings.
 */
@Module({
  imports: [CatalogModule],
  controllers: [LocationsController],
  providers: [LocationSettingsService],
  exports: [LocationSettingsService],
})
export class LocationsModule {}
