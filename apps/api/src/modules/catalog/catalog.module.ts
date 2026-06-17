import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { MenuController } from "./menu.controller";
import { CatalogCacheService } from "./catalog-cache.service";
import { CatalogService } from "./catalog.service";
import { WebCatalogRevalidationService } from "./web-catalog-revalidation.service";

@Module({
  imports: [RedisModule],
  controllers: [MenuController],
  providers: [CatalogService, CatalogCacheService, WebCatalogRevalidationService],
  exports: [CatalogService, CatalogCacheService, WebCatalogRevalidationService],
})
export class CatalogModule {}
