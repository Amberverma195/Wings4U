import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  GoneException,
} from "@nestjs/common";
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/roles.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { extractClientIp } from "../../common/utils/store-ip";
import { AuthService } from "./auth.service";

/* ------------------------------------------------------------------ */
/*  DTOs                                                              */
/* ------------------------------------------------------------------ */

class OtpRequestDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;
}

class OtpVerifyDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;

  @IsString()
  @Length(4, 8)
  otp_code!: string;
}

class ProfileUpdateDto {
  @IsString()
  @MinLength(4)
  full_name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class CheckSignupDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class PosLoginDto {
  @IsString()
  @Matches(/^\d{5}$/, { message: "Employee code must be exactly 5 digits" })
  employee_code!: string;

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

class PosNetworkStatusDto {
  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  location_id!: string;
}

class KdsLoginDto {
  @IsString()
  @Matches(/^\d{5}$/, { message: "Employee code must be exactly 5 digits" })
  employee_code!: string;

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

class KdsNetworkStatusDto {
  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  location_id!: string;
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                    */
/* ------------------------------------------------------------------ */

const IS_PROD = process.env.NODE_ENV === "production";
// Dev: web runs on localhost:3000, API may run on 127.0.0.1:3001 (cross-site).
// SameSite=Lax would block cookies on cross-site fetch; use None+Secure instead.
// Browsers treat localhost/127.0.0.1 as secure contexts, so Secure works over HTTP there.
const COOKIE_SAMESITE: "lax" | "none" = IS_PROD ? "lax" : "none";
const COOKIE_SECURE = true;

// Browsers (especially Chrome and Safari) only consider a "clear" Set-Cookie
// to match the original cookie when every attribute matches — path, secure,
// sameSite, httpOnly, and domain. If any attribute differs, the browser treats
// it as a new cookie, silently drops it (e.g. SameSite=None without Secure is
// rejected), and leaves the real cookie in place. Logout then appears to work
// server-side but the browser keeps sending the stale JWT until it expires,
// which is exactly the symptom of "I logged out, reloaded, and got logged
// back in as the same user." Keep every non-lifetime attribute in sync
// between set and clear.
const ACCESS_COOKIE_BASE = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/",
} as const;

const REFRESH_COOKIE_BASE = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api/v1/auth/refresh",
} as const;

// csrf_token is the double-submit cookie. It MUST be readable by client JS
// (httpOnly: false) so `apiFetch` can copy it into the X-CSRF-Token header on
// mutating requests. Path MUST be "/" — not "/api" — because `document.cookie`
// only exposes cookies whose Path is a prefix of the current page's pathname.
// With Path=/api the cookie is invisible to pages like /kds, /admin/*, /cart,
// /account/*, /checkout, so JS reads nothing, no header is sent, and the
// CSRF middleware rejects every authenticated mutation from those pages with
// 403 "CSRF validation failed" (observed first on KDS Accept / Mark Ready).
// Double-submit integrity is unaffected by the broader path: a cross-origin
// attacker still cannot read the cookie value (same-origin policy) and still
// cannot guess it (32 random bytes).
const CSRF_COOKIE_BASE = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/",
} as const;

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  csrfToken: string,
): void {
  // Migration on every successful sign-in: earlier builds issued access_token
  // and csrf_token at Path=/api. Browsers that logged in under that config
  // still have those cookies, and a new Set-Cookie at Path=/ does NOT replace
  // them (different path == different cookie identity). The result is two
  // cookies with the same name; `cookie-parser` keeps the first value (the
  // more-specific /api one), JS reads the new Path=/ value via document.cookie,
  // and CSRF double-submit fails with 403. Emitting these cleanups alongside
  // the fresh cookies evicts the legacy pair on the very next login, so the
  // user doesn't have to hand-clear cookies. Safe as a no-op when the legacy
  // cookie was never present.
  res.clearCookie("access_token", { ...ACCESS_COOKIE_BASE, path: "/api" });
  res.clearCookie("csrf_token", { ...CSRF_COOKIE_BASE, path: "/api" });

  // access_token uses path "/" so Next middleware and server components on any
  // route (e.g. /admin/*) can read and verify it for page-level gating. The
  // cookie stays httpOnly; only signed/verified access still reaches handlers.
  res.cookie("access_token", accessToken, {
    ...ACCESS_COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });

  // refresh_token stays scoped to the refresh endpoint so it is never sent on
  // normal API calls or page navigations.
  res.cookie("refresh_token", refreshToken, {
    ...REFRESH_COOKIE_BASE,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.cookie("csrf_token", csrfToken, {
    ...CSRF_COOKIE_BASE,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response): void {
  // Pass the full attribute set so the browser actually overwrites / evicts
  // the cookie instead of silently dropping a mismatched Set-Cookie.
  res.clearCookie("access_token", ACCESS_COOKIE_BASE);
  res.clearCookie("refresh_token", REFRESH_COOKIE_BASE);
  res.clearCookie("csrf_token", CSRF_COOKIE_BASE);

  // Migration: earlier builds issued access_token and csrf_token at Path=/api.
  // Those cookies are still live in browsers that logged in before the path
  // changed to "/", and would otherwise survive logout (clearCookie at Path=/
  // does not match a cookie set at Path=/api — browsers treat them as two
  // distinct cookies). Clear the legacy path too. Safe to keep — clearing a
  // non-existent cookie is a no-op.
  res.clearCookie("access_token", {
    ...ACCESS_COOKIE_BASE,
    path: "/api",
  });
  res.clearCookie("csrf_token", {
    ...CSRF_COOKIE_BASE,
    path: "/api",
  });
}

/* ------------------------------------------------------------------ */
/*  Controller                                                        */
/* ------------------------------------------------------------------ */

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("check-signup")
  @HttpCode(HttpStatus.OK)
  async checkSignup(@Body() body: CheckSignupDto) {
    return this.authService.checkSignupEligibility(body.phone, body.email);
  }

  @Public()
  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: OtpRequestDto) {
    const result = await this.authService.requestOtp(body.phone);
    return { otp_sent: result.otpSent, expires_in_seconds: result.expiresInSeconds };
  }

  @Public()
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(body.phone, body.otp_code);

    setAuthCookies(res, result.accessToken, result.refreshToken, result.csrfToken);

    return {
      user: result.user,
      profile_complete: result.profileComplete,
      needs_profile_completion: result.needsProfileCompletion,
      // Mobile clients read tokens from the body (no cookies on native).
      // Web clients ignore these and use the httpOnly cookies set above.
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    };
  }

  /**
   * Silent-refresh endpoint.
   *
   * Success path: rotate the refresh token, mint a new access token from
   * the current DB role/employeeRole, and reissue `csrf_token` alongside
   * them through the shared `setAuthCookies` helper so all three cookies
   * stay aligned on attributes and lifetime.
   *
   * Failure path for expected auth failures — missing cookie, revoked row,
   * expired row, replayed token, deactivated user — always call
   * `clearAuthCookies(res)` and respond with `{ refreshed: false }`.
   * Unexpected server faults must still surface as 500s; otherwise a
   * transient DB/runtime error looks like a real logout and the browser
   * loses a perfectly valid session.
   */
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken: string | undefined = req.cookies?.refresh_token;
    if (!refreshToken) {
      clearAuthCookies(res);
      return { refreshed: false };
    }

    try {
      const result = await this.authService.refresh(refreshToken);
      setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken,
        result.csrfToken,
      );
      return { refreshed: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        clearAuthCookies(res);
        return { refreshed: false };
      }
      throw error;
    }
  }

  /**
   * Logout is intentionally public and best-effort:
   *
   * - Clients reach this endpoint with an access token that may already be
   *   expired or invalid (browsers naturally reload after the 15-minute TTL,
   *   and the reported "logged out, reloaded, signed back in" regression is
   *   exactly that case). If we required a valid session here, the browser
   *   would keep the stale cookie because the server never cleared it.
   * - Always call `clearAuthCookies(res)` first so the response tells the
   *   browser to evict every auth cookie, regardless of whether the server
   *   could identify the session.
   * - If the access token *was* valid, the auth guard has already populated
   *   `req.user`. In that case, revoke the specific `auth_sessions` row so
   *   a copy of the cookie stolen earlier cannot be replayed until JWT
   *   expiry.
   * - CSRF protection still applies (the mutating-path CSRF middleware
   *   enforces header+cookie match), so this endpoint cannot be abused
   *   cross-site to forcibly log users out.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    clearAuthCookies(res);
    if (req.user?.sessionId) {
      await this.authService.logout(req.user.sessionId, req.user.userId);
    }
    return { logged_out: true };
  }

  @Public()
  @Get("session")
  async session(@Req() req: Request) {
    return this.authService.getSession(req.user);
  }

  @Public()
  @Get("pos/network-status")
  async posNetworkStatus(
    @Query() query: PosNetworkStatusDto,
    @Req() req: Request,
  ) {
    return this.authService.getPosNetworkStatus(
      query.location_id,
      extractClientIp(req),
    );
  }

  @Roles("CUSTOMER")
  @Put("profile")
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body() body: ProfileUpdateDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.authService.updateProfile(user.userId, body.full_name, body.email);
  }

  @Public()
  @Post("pos/login")
  @HttpCode(HttpStatus.OK)
  async posLogin(
    @Body() body: PosLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.posLogin(
      body.employee_code,
      body.location_id,
      extractClientIp(req),
      body.device_id,
    );

    setAuthCookies(res, result.accessToken, result.refreshToken, result.csrfToken);

    return {
      user: result.user,
      employee: {
        role: result.employeeRole,
        location_id: result.locationId,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  KDS station endpoints                                              */
  /* ------------------------------------------------------------------ */

  @Public()
  @Get("kds/network-status")
  async kdsNetworkStatus(
    @Query() query: KdsNetworkStatusDto,
    @Req() req: Request,
  ) {
    return this.authService.getKdsNetworkStatus(
      query.location_id,
      extractClientIp(req),
    );
  }

  @Public()
  @Post("kds/login")
  @HttpCode(HttpStatus.OK)
  async kdsLogin(
    @Body() _body: KdsLoginDto,
    @Req() _req: Request,
    @Res({ passthrough: true }) _res: Response,
  ) {
    throw new GoneException(
      "KDS now uses station password login at /api/v1/kds/auth/login",
    );
  }
}
