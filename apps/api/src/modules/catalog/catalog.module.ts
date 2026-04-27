import { Module } from "@nestjs/common";
import { MenuController } from "./menu.controller";
import { CatalogService } from "./catalog.service";

@Module({
  controllers: [MenuController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
