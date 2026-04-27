import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { WalletsModule } from "../wallets/wallets.module";
import { RefundModule } from "../refunds/refund.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminMenuController } from "./admin-menu.controller";
import { AdminMenuService } from "./admin-menu.service";
import { AdminStaffController } from "./admin-staff.controller";
import { AdminStaffService } from "./admin-staff.service";
import { AdminPromosController } from "./admin-promos.controller";
import { AdminPromosService } from "./admin-promos.service";

@Module({
  imports: [ChatModule, WalletsModule, RefundModule],
  controllers: [AdminController, AdminMenuController, AdminStaffController, AdminPromosController],
  providers: [AdminService, AdminMenuService, AdminStaffService, AdminPromosService],
  exports: [AdminService],
})
export class AdminModule {}
