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
  Max,
  Min,
  IsDateString,
} from "class-validator";
import type { Request } from "express";
import { KdsStationGuard } from "../../common/guards/kds-station.guard";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { BusyModeService } from "./busy-mode.service";
import { DeliveryPinService } from "./delivery-pin.service";
import { KdsHeartbeatService } from "./kds-heartbeat.service";
import { KdsService } from "./kds.service";

class KdsOrdersQueryDto {
  @IsOptional()
  @IsString()
  statuses?: string;
}

const KDS_HISTORY_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "PICKED_UP",
  "DELIVERED",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
  "CANCELLED",
] as const;

class KdsHistoryQueryDto {
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsIn(KDS_HISTORY_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
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
@Public()
@UseGuards(LocationScopeGuard, StoreNetworkGuard, KdsStationGuard)
export class KdsController {
  constructor(
    private readonly kdsService: KdsService,
    private readonly heartbeatService: KdsHeartbeatService,
    private readonly busyMode: BusyModeService,
    private readonly deliveryPin: DeliveryPinService,
  ) {}

  // PRD §11.2: busy mode status + toggle + history.
  @Get("busy-mode")
  async getBusyMode(@Req() req: Request) {
    return this.busyMode.getCurrent(req.locationId!);
  }

  @Post("busy-mode")
  async setBusyMode(@Body() body: BusyModeSetDto, @Req() req: Request) {
    return this.busyMode.setState(
      req.locationId!,
      (req.user?.userId ?? null),
      body.enabled,
      body.prep_minutes,
      body.note,
    );
  }

  @Get("busy-mode/history")
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
  async heartbeat(@Body() body: HeartbeatDto, @Req() req: Request) {
    return this.heartbeatService.recordHeartbeat({
      locationId: req.locationId!,
      sessionKey: body.session_key,
      deviceId: body.device_id,
    });
  }

  @Get("orders/history")
  async getOrderHistory(
    @Query() query: KdsHistoryQueryDto,
    @Req() req: Request,
  ) {
    return this.kdsService.getOrderHistory(
      req.locationId!,
      query.start_date,
      query.end_date,
      query.status,
      query.limit,
      query.cursor,
    );
  }

  @Get("orders/:id")
  async getOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.getKdsOrder(req.locationId!, id);
  }

  @Get("orders")
  async getOrders(@Query() query: KdsOrdersQueryDto, @Req() req: Request) {
    const statuses = query.statuses
      ? query.statuses.split(",").map((s) => s.trim())
      : undefined;
    return this.kdsService.getKdsOrders(req.locationId!, statuses);
  }

  @Post("orders/:id/accept")
  async acceptOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.acceptOrder(id, (req.user?.userId ?? null), req.locationId!);
  }

  @Post("orders/:id/status")
  async updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStatusDto,
    @Req() req: Request,
  ) {
    return this.kdsService.updateOrderStatus(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.status,
      body.reason,
    );
  }

  // PRD §7.5: post-accept cancellation is a REQUEST that Admin approves, not
  // a direct state change. KDS pre-accept rejection still uses /status.
  @Post("orders/:id/request-cancellation")
  async requestCancellation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RequestCancellationDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestCancellation(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.reason,
    );
  }

  // PRD §12.3: chat-initiated cancellation request. Body includes the
  // order_conversation id so the cancellation_request is linked back to the
  // chat thread for admin traceability.
  @Post("orders/:id/request-chat-cancellation")
  async requestChatCancellation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RequestChatCancellationDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestChatCancellation(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.reason,
      body.conversation_id,
    );
  }

  @Post("orders/:id/cancel-request")
  async handleCancelRequest(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: HandleCancelRequestDto,
    @Req() req: Request,
  ) {
    return this.kdsService.handleCancelRequest(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.action,
      body.admin_notes,
    );
  }

  @Post("orders/:id/assign-driver")
  async assignDriver(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AssignDriverDto,
    @Req() req: Request,
  ) {
    return this.kdsService.assignDriver(
      id,
      body.driver_user_id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.busy_override ?? false,
    );
  }

  @Post("orders/:id/start-delivery")
  async startDelivery(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.startDelivery(id, (req.user?.userId ?? null), req.locationId!);
  }

  @Post("orders/:id/complete-delivery")
  async completeDelivery(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CompleteDeliveryDto,
    @Req() req: Request,
  ) {
    return this.kdsService.completeDelivery(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.pin,
    );
  }

  // PRD §7.8.5: read the current PIN state for the KDS modal.
  @Get("orders/:id/pin-status")
  async pinStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.deliveryPin.statusForStaff(id, req.locationId!);
  }

  // PRD §7.8.5: structured PIN check. Returns an explicit `{ ok, locked }`
  // shape instead of throwing on mismatch so the KDS modal can render the
  // inline retry state without reverse-engineering a 422 error body.
  @Post("orders/:id/verify-pin")
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
      actorUserId: (req.user?.userId ?? null),
      driverUserId: order.assignedDriverUserId ?? (req.user?.userId ?? null),
      pin: body.pin,
    });
    if (result.ok) {
      return { ok: true, locked: false };
    }
    return {
      ok: false,
      reason: result.reason,
      locked: false,
    };
  }

  // Legacy/admin path for manually closing an already locked PIN record as
  // NO_PIN_DELIVERY (distinct from DELIVERED) so ops keeps an audit trail.
  @Post("orders/:id/complete-delivery-without-pin")
  async completeDeliveryWithoutPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kdsService.completeDeliveryWithoutPin(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
    );
  }

  // PRD §7.8.5: admin-only bypass (e.g., customer lost PIN). Records
  // bypass_by and bypass_reason; subsequent complete-delivery succeeds.
  @Post("orders/:id/pin/bypass")
  async bypassPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: PinBypassDto,
    @Req() req: Request,
  ) {
    const order = await this.kdsService.requireOrderForLocation(id, req.locationId!);
    await this.deliveryPin.bypass({
      orderId: id,
      locationId: req.locationId!,
      actorUserId: (req.user?.userId ?? null),
      driverUserId: order.assignedDriverUserId ?? (req.user?.userId ?? null),
      reason: body.reason,
    });
    return { ok: true };
  }

  // PRD §7.8.5: regenerate PIN (e.g., after lockout). With phone-derived
  // PINs this resets attempts and returns the same last-four code.
  @Post("orders/:id/pin/regenerate")
  async regeneratePin(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.deliveryPin.regenerate({
      orderId: id,
      locationId: req.locationId!,
      actorUserId: (req.user?.userId ?? null),
    });
  }

  @Post("orders/:id/eta")
  async updateEta(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateEtaDto,
    @Req() req: Request,
  ) {
    return this.kdsService.updateEta(
      id,
      (req.user?.userId ?? null),
      body.estimated_minutes,
      body.source,
    );
  }

  @Post("orders/:id/eta-delta")
  async adjustEtaDelta(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: EtaDeltaDto,
    @Req() req: Request,
  ) {
    return this.kdsService.adjustEtaDelta(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.delta_minutes,
    );
  }

  @Post("orders/:id/refund-request")
  async requestRefund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RefundRequestDto,
    @Req() req: Request,
  ) {
    return this.kdsService.requestRefund(
      id,
      (req.user?.userId ?? null),
      req.locationId!,
      body.amount_cents,
      body.reason,
    );
  }
}
