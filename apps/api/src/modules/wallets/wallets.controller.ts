import { Controller, Get, Query } from "@nestjs/common";
import type { Request } from "express";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { WalletsService } from "./wallets.service";

@Controller("wallets")
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get("me")
  @Roles("CUSTOMER")
  async getMyBalance(@CurrentUser() user: NonNullable<Request["user"]>) {
    const wallet = await this.walletsService.getBalance(user.userId);

    return {
      customer_user_id: wallet.customerUserId,
      balance_cents: wallet.balanceCents,
      lifetime_credit_cents: wallet.lifetimeCreditCents,
      updated_at: wallet.updatedAt,
    };
  }

  @Get("me/ledger")
  @Roles("CUSTOMER")
  async getMyLedger(
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const result = await this.walletsService.getLedger(
      user.userId,
      cursor,
      parsedLimit,
    );

    return {
      entries: result.entries.map((e) => ({
        id: e.id,
        amount_cents: e.amountCents,
        balance_after_cents: e.balanceAfterCents,
        entry_type: e.entryType,
        reason_text: e.reasonText,
        order_id: e.orderId,
        refund_request_id: e.refundRequestId,
        created_at: e.createdAt,
      })),
      next_cursor: result.next_cursor,
    };
  }
}
