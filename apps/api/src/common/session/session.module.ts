import { Global, Module } from "@nestjs/common";
import { SessionValidator } from "./session-validator.service";

/**
 * Globally provides {@link SessionValidator} so every module (auth guard,
 * websocket gateway, feature modules that need to re-verify the caller)
 * can inject it without duplicating wiring.
 */
@Global()
@Module({
  providers: [SessionValidator],
  exports: [SessionValidator],
})
export class SessionModule {}
