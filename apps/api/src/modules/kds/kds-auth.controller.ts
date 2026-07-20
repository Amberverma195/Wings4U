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
import {
  clearSharedCookieVariants,
  withSharedCookieDomain,
} from "../../common/utils/cookie-domain";
import { extractClientIp } from "../../common/utils/store-ip";
import {
  KDS_STATION_COOKIE_NAME,
  KDS_STATION_COOKIE_PATH,
  KdsAuthService,
} from "./kds-auth.service";

class KdsStationLoginDto {
  @IsString()
  @Matches(/^\d{8}$/, { message: "KDS password must be exactly 8 digits" })
  password!: string;

  @IsString()
  location_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;
}

const KDS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: KDS_STATION_COOKIE_PATH,
};

@Controller("kds/auth")
@Public()
export class KdsAuthController {
  constructor(private readonly kdsAuthService: KdsAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: KdsStationLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.kdsAuthService.login(
      body.location_id,
      body.password,
      extractClientIp(req),
      body.device_id,
    );

    clearSharedCookieVariants(res, KDS_STATION_COOKIE_NAME, KDS_COOKIE_OPTIONS, [
      "/api/v1/kds",
    ]);
    res.cookie(KDS_STATION_COOKIE_NAME, `${result.sessionKey}:${result.token}`, {
      ...withSharedCookieDomain(KDS_COOKIE_OPTIONS),
      expires: result.expiresAt,
    });

    return { ok: true, schedule: result.schedule };
  }

  @Get("status")
  @HttpCode(HttpStatus.OK)
  async status(@Req() req: Request, @Query("location_id") locationId?: string) {
    const cookie = req.cookies?.[KDS_STATION_COOKIE_NAME];
    if (!cookie) {
      return { authenticated: false };
    }
    const session = await this.kdsAuthService.validateSession(cookie);
    const resolvedLocationId = locationId
      ? await this.kdsAuthService.resolveLocationId(locationId)
      : null;
    const authenticated =
      !!session && (!locationId || session.locationId === resolvedLocationId);
    return {
      authenticated,
      schedule: authenticated && session
        ? await this.kdsAuthService.getSchedule(session.locationId)
        : null,
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = req.cookies?.[KDS_STATION_COOKIE_NAME];
    if (cookie) {
      const [sessionKey] = cookie.split(":");
      if (sessionKey) {
        await this.kdsAuthService.logout(sessionKey);
      }
    }

    clearSharedCookieVariants(res, KDS_STATION_COOKIE_NAME, KDS_COOKIE_OPTIONS, [
      "/api/v1/kds",
    ]);

    return { logged_out: true };
  }
}
