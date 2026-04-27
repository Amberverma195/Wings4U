import { Controller, Get, Query } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RewardsService, STAMPS_PER_REWARD } from "./rewards.service";

@Controller("rewards")
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get("me")
  @Roles("CUSTOMER")
  async getMySummary(@CurrentUser() user: NonNullable<Request["user"]>) {
    const summary = await this.rewardsService.getSummary(user.userId);

    return {
      customer_user_id: summary.customerUserId,
      available_stamps: summary.availableStamps,
      lifetime_stamps: summary.lifetimeStamps,
      lifetime_redemptions: summary.lifetimeRedemptions,
      stamps_per_reward: STAMPS_PER_REWARD,
      updated_at: summary.updatedAt,
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
    const result = await this.rewardsService.getLedger(
      user.userId,
      cursor,
      parsedLimit,
    );

    return {
      entries: result.entries.map((e) => ({
        id: e.id,
        entry_type: e.entryType,
        delta_stamps: e.deltaStamps,
        balance_after_stamps: e.balanceAfterStamps,
        pounds_awarded:
          e.poundsAwarded === null ? null : Number(e.poundsAwarded),
        reason_text: e.reasonText,
        order_id: e.orderId,
        order_number: e.order ? e.order.orderNumber.toString() : null,
        order_fulfillment_type: e.order?.fulfillmentType ?? null,
        created_at: e.createdAt,
      })),
      next_cursor: result.next_cursor,
    };
  }
}
