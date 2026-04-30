import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Req,
  Res,
  Query,
} from "@nestjs/common";
import { IsString, Matches, MaxLength, IsOptional } from "class-validator";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/roles.decorator";
import { extractClientIp } from "../../common/utils/store-ip";
import {
  POS_STATION_COOKIE_NAME,
  POS_STATION_COOKIE_PATH,
  PosAuthService,
} from "./pos-auth.service";

class PosStationLoginDto {
  @IsString()
  @Matches(/^\d{8}$/, { message: "POS station password must be exactly 8 digits" })
  password!: string;

  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  location_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;
}

const POS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: POS_STATION_COOKIE_PATH,
};

@Controller("pos/auth")
@Public()
export class PosAuthController {
  constructor(private readonly posAuthService: PosAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: PosStationLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.posAuthService.login(
      body.location_id,
      body.password,
      extractClientIp(req),
      body.device_id,
    );

    // Defensive: clear any historical cookie variant scoped to /api/v1/pos
    // before issuing the canonical Path=/ cookie so we never end up with two
    // cookies of the same name (different Path = different cookie identity).
    res.clearCookie(POS_STATION_COOKIE_NAME, {
      ...POS_COOKIE_OPTIONS,
      path: "/api/v1/pos",
    });
    res.cookie(POS_STATION_COOKIE_NAME, `${result.sessionKey}:${result.token}`, {
      ...POS_COOKIE_OPTIONS,
      expires: result.expiresAt,
    });

    return { ok: true };
  }

  @Get("status")
  @HttpCode(HttpStatus.OK)
  async status(@Req() req: Request, @Query("location_id") locationId?: string) {
    const cookie = req.cookies?.[POS_STATION_COOKIE_NAME];
    if (!cookie) {
      return { authenticated: false };
    }
    const session = await this.posAuthService.validateSession(cookie);
    return {
      authenticated:
        !!session && (!locationId || session.locationId === locationId),
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = req.cookies?.[POS_STATION_COOKIE_NAME];
    if (cookie) {
      const [sessionKey] = cookie.split(":");
      if (sessionKey) {
        await this.posAuthService.logout(sessionKey);
      }
    }

    res.clearCookie(POS_STATION_COOKIE_NAME, POS_COOKIE_OPTIONS);
    res.clearCookie(POS_STATION_COOKIE_NAME, {
      ...POS_COOKIE_OPTIONS,
      path: "/api/v1/pos",
    });

    return { logged_out: true };
  }
}
