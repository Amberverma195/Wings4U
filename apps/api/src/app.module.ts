import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RefundModule } from "./modules/refunds/refund.module";
import { AuthGuard } from "./common/guards/auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { IdentitiesModule } from "./modules/identities/identities.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { CartModule } from "./modules/cart/cart.module";
import { SavedCartModule } from "./modules/saved-cart/saved-cart.module";
import { CheckoutModule } from "./modules/checkout/checkout.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { OrderChangesModule } from "./modules/order-changes/order-changes.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { WalletsModule } from "./modules/wallets/wallets.module";
import { RewardsModule } from "./modules/rewards/rewards.module";
import { PromotionsModule } from "./modules/promotions/promotions.module";
import { KdsModule } from "./modules/kds/kds.module";
import { DriversModule } from "./modules/drivers/drivers.module";
import { SupportModule } from "./modules/support/support.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { CateringModule } from "./modules/catering/catering.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { EmployeesModule } from "./modules/employees/employees.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { PosModule } from "./modules/pos/pos.module";
import { TimeclockModule } from "./modules/timeclock/timeclock.module";
import { RegisterModule } from "./modules/register/register.module";
import { DevicesModule } from "./modules/devices/devices.module";
import { MediaModule } from "./modules/media/media.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AdminAuditModule } from "./modules/admin-audit/admin-audit.module";
import { AdminModule } from "./modules/admin/admin.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { SessionModule } from "./common/session/session.module";

@Module({
  imports: [
    DatabaseModule,
    SessionModule,
    RateLimitModule,
    HealthModule,
    AuthModule,
    IdentitiesModule,
    LocationsModule,
    CatalogModule,
    CartModule,
    SavedCartModule,
    CheckoutModule,
    OrdersModule,
    OrderChangesModule,
    PaymentsModule,
    WalletsModule,
    RewardsModule,
    PromotionsModule,
    KdsModule,
    DriversModule,
    SupportModule,
    ChatModule,
    ReviewsModule,
    InventoryModule,
    CateringModule,
    CustomersModule,
    EmployeesModule,
    ReportsModule,
    PosModule,
    TimeclockModule,
    RegisterModule,
    DevicesModule,
    MediaModule,
    NotificationsModule,
    AdminAuditModule,
    AdminModule,
    RealtimeModule,
    RefundModule,
    JobsModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

