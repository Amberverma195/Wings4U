import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { WalletsModule } from "../wallets/wallets.module";
import { RefundModule } from "../refunds/refund.module";
import { SupportModule } from "../support/support.module";
import { CatalogModule } from "../catalog/catalog.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminMenuController } from "./admin-menu.controller";
import { AdminMenuService } from "./admin-menu.service";
import { AdminStaffController } from "./admin-staff.controller";
import { AdminStaffService } from "./admin-staff.service";
import { AdminPromosController } from "./admin-promos.controller";
import { AdminPromosService } from "./admin-promos.service";
import { AdminCustomersService } from "./admin-customers.service";
import { AdminAuditModule } from "../admin-audit/admin-audit.module";
import { AdminStampGrantsController } from "./admin-stamp-grants.controller";
import { AdminStampGrantsService } from "./admin-stamp-grants.service";

@Module({
  imports: [
    ChatModule,
    WalletsModule,
    RefundModule,
    SupportModule,
    CatalogModule,
    NotificationsModule,
    AdminAuditModule,
  ],
  controllers: [AdminController, AdminMenuController, AdminStaffController, AdminPromosController, AdminStampGrantsController],
  providers: [AdminService, AdminMenuService, AdminStaffService, AdminPromosService, AdminCustomersService, AdminStampGrantsService],
  exports: [AdminService],
})
export class AdminModule {}
