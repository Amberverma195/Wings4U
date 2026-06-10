import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { MenuController } from "./menu.controller";
import { CatalogCacheService } from "./catalog-cache.service";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [RedisModule],
  controllers: [MenuController],
  providers: [CatalogService, CatalogCacheService],
  exports: [CatalogService, CatalogCacheService],
})
export class CatalogModule {}
