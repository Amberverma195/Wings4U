import { Global, Module } from "@nestjs/common";
import { RateLimiterService } from "./rate-limit.service";

@Global()
@Module({
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
