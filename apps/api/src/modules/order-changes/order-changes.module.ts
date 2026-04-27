import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrderChangesController } from "./order-changes.controller";
import { OrderChangesService } from "./order-changes.service";

/**
 * PRD §13 — post-order add-item change requests + approval workflow.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [OrderChangesController],
  providers: [OrderChangesService],
  exports: [OrderChangesService],
})
export class OrderChangesModule {}
