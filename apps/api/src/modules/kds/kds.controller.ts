import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { KDS_STAFF, Roles } from "../../common/decorators/roles.decorator";
import { BusyModeService } from "./busy-mode.service";
import { DeliveryPinService } from "./delivery-pin.service";
import { KdsHeartbeatService } from "./kds-heartbeat.service";
import { KdsService } from "./kds.service";

const DEFAULT_PIN_EXPIRY_MINUTES = 240;

class KdsOrdersQueryDto {
  @IsOptional()
  @IsString()
  statuses?: string;
}

class UpdateStatusDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class HandleCancelRequestDto {
  @IsIn(["APPROVE", "DENY"])
  action!: "APPROVE" | "DENY";

  @IsOptional()
  @IsString()
  admin_notes?: string;
}

class RequestCancellationDto {
  @IsString()
  reason!: string;
}

class RequestChatCancellationDto {
  @IsString()
  reason!: string;

  @IsUUID()
  conversation_id!: string;
}

class AssignDriverDto {
  @IsUUID()
  driver_user_id!: string;

  @IsOptional()
  @IsBoolean()
  busy_override?: boolean;
}

class UpdateEtaDto {
  @IsInt()
  @Min(1)
  estimated_minutes!: number;

  @IsString()
  source!: string;
}

class EtaDeltaDto {
  // PRD §11.3: ±5 / ±10 / ±15 / −5 are the documented buttons, but the server
  // only enforces that the delta is a non-zero integer — admin tooling may
  // expose finer adjustments later.
  @IsInt()
  delta_minutes!: number;
}

class RefundRequestDto {
  @IsInt()
  @Min(1)
  amount_cents!: number;

  @IsString()
  reason!: string;
}

class HeartbeatDto {
  @IsString()
  session_key!: string;

  @IsOptional()
  @IsUUID()
  device_id?: string;
}

class CompleteDeliveryDto {
  @IsOptional()
  @IsString()
  pin?: string;
}

class VerifyPinDto {
  @IsString()
  pin!: string;
}

class PinBypassDto {
  @IsString()
  reason!: string;
}

class BusyModeSetDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  prep_minutes?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class BusyModeHistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller("kds")
@UseGuards(LocationScopeGuard, StoreNetworkGuard)
export class KdsController {
  constructor(
    private readonly kdsService: KdsService,
    private readonly heartbeatService: KdsHeartbeatService,
    private readonly busyMode: BusyModeService,
    private readonly deliveryPin: DeliveryPinService,
  ) {}

  // PRD §11.2: busy mode status + toggle + history.
  @Get("busy-mode")
  @Roles(KDS_STAFF, "ADMIN")
  async getBusyMode(@Req() req: Request) {
    return this.busyMode.getCurrent(req.locationId!);
  }

  @Post("busy-mode")
  @Roles(KDS_STAFF, "ADMIN")
  async setBusyMode(@Body() body: BusyModeSetDto, @Req() req: Request) {
    return this.busyMode.setState(
      req.locationId!,
      req.user!.userId,
      body.enabled,
      body.prep_minutes,
      body.note,
    );
  }

  @Get("busy-mode/history")
  @Roles(KDS_STAFF, "ADMIN")
  async getBusyModeHistory(
    @Query() query: BusyModeHistoryQueryDto,
    @Req() req: Request,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.busyMode.listHistory(
      req.locationId!,
      Number.isFinite(limit) ? limit : undefined,
      query.cursor,
    );
  }

  // PRD §11.1B: KDS posts a heartbeat periodically so the auto-accept worker
  // can decide whether to auto-accept or flag manual-review at timeout.
  @Post("heartbeat")
  @Roles(KDS_STAFF, "ADMIN")
  async heartbeat(@Body() body: HeartbeatDto, @Req() req: Request) {
    return this.heartbeatService.recordHeartbeat({
      locationId: req.locationId!,
      sessionKey: body.session_key,
      deviceId: body.device_id,
    });
  }

  @Get("orders")
  @Roles(KDS_STAFF, "ADMIN")
  async getOrders(@Query() query: KdsOrdersQueryDto, @Req() req: Request) {
    const statuses = query.statuses
      ? query.statuses.split(",").map((s) => s.trim())
      : undefined;
    return this.kdsService.getKdsOrders(req.locationId!, statuses);
  }

  @Post("orders/:id/accept")
  @Roles(KDS_STAFF, "ADMIN")
  async acceptOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.acceptOrder(id, req.user!.userId, req.locationId!);
  }

  @Post("orders/:id/status")
  @Roles(KDS_STAFF, "ADMIN")
  async updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStatusDto,
    @Req() req: Request,
  ) {
    return this.kdsService.updateOrderStatus(
      id,
      req.user!.userId,
      req.locationId!,
      body.status,
      body.reason,
    );
  }

  // PRD §7.5: post-accept cancellation is a REQUEST that Admin approves, not
  // a direct state change. KDS pre-accept rejection still uses /status.
  @Post("orders/:id/request-cancellation")
  @Roles(KDS_STAFF, "ADMIN")
  async requestCancellation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RequestCancellationDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestCancellation(
      id,
      req.user!.userId,
      req.locationId!,
      body.reason,
    );
  }

  // PRD §12.3: chat-initiated cancellation request. Body includes the
  // order_conversation id so the cancellation_request is linked back to the
  // chat thread for admin traceability.
  @Post("orders/:id/request-chat-cancellation")
  @Roles(KDS_STAFF, "ADMIN")
  async requestChatCancellation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RequestChatCancellationDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestChatCancellation(
      id,
      req.user!.userId,
      req.locationId!,
      body.reason,
      body.conversation_id,
    );
  }

  @Post("orders/:id/cancel-request")
  @Roles(KDS_STAFF, "ADMIN")
  async handleCancelRequest(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: HandleCancelRequestDto,
    @Req() req: Request,
  ) {
    return this.kdsService.handleCancelRequest(
      id,
      req.user!.userId,
      req.locationId!,
      body.action,
      body.admin_notes,
    );
  }

  @Post("orders/:id/assign-driver")
  @Roles(KDS_STAFF, "ADMIN")
  async assignDriver(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AssignDriverDto,
    @Req() req: Request,
  ) {
    return this.kdsService.assignDriver(
      id,
      body.driver_user_id,
      req.user!.userId,
      req.locationId!,
      body.busy_override ?? false,
    );
  }

  @Post("orders/:id/start-delivery")
  @Roles(KDS_STAFF, "ADMIN")
  async startDelivery(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.startDelivery(id, req.user!.userId, req.locationId!);
  }

  @Post("orders/:id/complete-delivery")
  @Roles(KDS_STAFF, "ADMIN")
  async completeDelivery(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CompleteDeliveryDto,
    @Req() req: Request,
  ) {
    return this.kdsService.completeDelivery(
      id,
      req.user!.userId,
      req.locationId!,
      body.pin,
    );
  }

  // PRD §7.8.5: read the current PIN state for the KDS modal. Lets the UI
  // restore the "locked" view after a close/reopen or a page reload, and
  // hints the correct "N attempts left" count for the first submit even
  // when an older session already burned some attempts on this order.
  @Get("orders/:id/pin-status")
  @Roles(KDS_STAFF, "ADMIN")
  async pinStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.deliveryPin.statusForStaff(id, req.locationId!);
  }

  // PRD §7.8.5: structured PIN check. Returns an explicit `{ ok, remaining_attempts, locked }`
  // shape instead of throwing on mismatch so the KDS modal can render the
  // "You have N attempts left" copy inline without having to reverse-engineer
  // a 422 error body. Expired PINs auto-renew in the backend; `renewed: true`
  // tells the client to ask the customer for the fresh PIN instead of
  // pretending the challenge is locked out.
  @Post("orders/:id/verify-pin")
  @Roles(KDS_STAFF, "ADMIN")
  async verifyPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: VerifyPinDto,
    @Req() req: Request,
  ) {
    const order = await this.kdsService.requireOrderForLocation(
      id,
      req.locationId!,
    );
    const result = await this.deliveryPin.verify({
      orderId: id,
      locationId: req.locationId!,
      actorUserId: req.user!.userId,
      driverUserId: order.assignedDriverUserId ?? req.user!.userId,
      pin: body.pin,
    });
    if (result.ok) {
      return { ok: true, locked: false };
    }
    return {
      ok: false,
      reason: result.reason,
      remaining_attempts: result.remaining_attempts ?? 0,
      locked: result.reason === "LOCKED",
      renewed: result.renewed === true,
    };
  }

  // PRD §7.8.5: after `PIN_MAX_FAILED_ATTEMPTS` wrong PIN entries, the driver
  // can still hand off the food but the delivery is closed as
  // NO_PIN_DELIVERY (distinct from DELIVERED) so ops keeps an audit trail.
  @Post("orders/:id/complete-delivery-without-pin")
  @Roles(KDS_STAFF, "ADMIN")
  async completeDeliveryWithoutPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.completeDeliveryWithoutPin(
      id,
      req.user!.userId,
      req.locationId!,
    );
  }

  // PRD §7.8.5: admin-only bypass (e.g., customer lost PIN). Records
  // bypass_by and bypass_reason; subsequent complete-delivery succeeds.
  @Post("orders/:id/pin/bypass")
  @Roles("ADMIN")
  async bypassPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: PinBypassDto,
    @Req() req: Request,
  ) {
    const order = await this.kdsService.requireOrderForLocation(id, req.locationId!);
    await this.deliveryPin.bypass({
      orderId: id,
      locationId: req.locationId!,
      actorUserId: req.user!.userId,
      driverUserId: order.assignedDriverUserId ?? req.user!.userId,
      reason: body.reason,
    });
    return { ok: true };
  }

  // PRD §7.8.5: regenerate PIN (e.g., after lockout). Resets attempts and
  // returns the new plaintext to the caller so the customer can be notified.
  @Post("orders/:id/pin/regenerate")
  @Roles("ADMIN")
  async regeneratePin(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const expiry = await this.kdsService.getPinExpiryMinutes(req.locationId!);
    return this.deliveryPin.regenerate({
      orderId: id,
      locationId: req.locationId!,
      actorUserId: req.user!.userId,
      expiryMinutes: expiry ?? DEFAULT_PIN_EXPIRY_MINUTES,
    });
  }

  @Post("orders/:id/eta")
  @Roles(KDS_STAFF, "ADMIN")
  async updateEta(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateEtaDto,
    @Req() req: Request,
  ) {
    return this.kdsService.updateEta(
      id,
      req.user!.userId,
      body.estimated_minutes,
      body.source,
    );
  }

  @Post("orders/:id/eta-delta")
  @Roles(KDS_STAFF, "ADMIN")
  async adjustEtaDelta(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: EtaDeltaDto,
    @Req() req: Request,
  ) {
    return this.kdsService.adjustEtaDelta(
      id,
      req.user!.userId,
      req.locationId!,
      body.delta_minutes,
    );
  }

  @Post("orders/:id/refund-request")
  @Roles(KDS_STAFF, "ADMIN")
  async requestRefund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RefundRequestDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestRefund(
      id,
      req.user!.userId,
      req.locationId!,
      body.amount_cents,
      body.reason,
    );
  }
}
