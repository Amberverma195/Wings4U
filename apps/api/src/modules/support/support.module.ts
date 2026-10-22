import { Module } from "@nestjs/common";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";

// Imported explicitly so standalone contexts (the overdue-delivery cron) can
// resolve the limiter without the full AppModule.
@Module({
  imports: [RateLimitModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
