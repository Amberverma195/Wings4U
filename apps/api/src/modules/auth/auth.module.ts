import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { AccountDeletionController } from "./account-deletion.controller";
import { AccountDeletionService } from "./account-deletion.service";

@Module({
  imports: [RealtimeModule],
  controllers: [AuthController, AccountDeletionController],
  providers: [AuthService, AccountDeletionService],
  exports: [AuthService],
})
export class AuthModule {}
