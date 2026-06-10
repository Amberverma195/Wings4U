import { Global, Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { RateLimiterService } from "./rate-limit.service";

@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
