import { Module } from "@nestjs/common";
import { CustomerAddressesController } from "./customer-addresses.controller";
import { CustomerAddressesService } from "./customer-addresses.service";

/**
 * Customer profile reads, no-show state, wallet-facing admin tools, and the
 * persisted address book (so signed-in customers see saved addresses across
 * devices).
 */
@Module({
  controllers: [CustomerAddressesController],
  providers: [CustomerAddressesService],
  exports: [CustomerAddressesService],
})
export class CustomersModule {}
