import { Module } from "@nestjs/common";
import { SavedCartController } from "./saved-cart.controller";
import { SavedCartService } from "./saved-cart.service";
import { DbCartStore } from "./db-cart-store";
import { CART_STORE } from "./cart-store.interface";

/**
 * Saved-cart persistence. The CART_STORE provider is bound to DbCartStore
 * today; a future Redis implementation would be slotted in here (e.g. via
 * CART_CACHE_DRIVER env) without touching SavedCartService or the controller.
 */
@Module({
  controllers: [SavedCartController],
  providers: [
    SavedCartService,
    { provide: CART_STORE, useClass: DbCartStore },
  ],
  exports: [SavedCartService],
})
export class SavedCartModule {}
