import { Module } from "@nestjs/common";
import { AdminAuditService } from "./admin-audit.service";

/**
 * Append-only audit logging for sensitive actions.
 */
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
