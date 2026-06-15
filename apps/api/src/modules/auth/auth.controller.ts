import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
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
import { createHash, randomBytes } from "crypto";
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/roles.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { extractClientIp } from "../../common/utils/store-ip";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { AuthService } from "./auth.service";

/* ------------------------------------------------------------------ */
/*  DTOs                                                              */
/* ------------------------------------------------------------------ */

// At least 8 chars, with at least one letter, one digit, and one special char.
const PASSWORD_POLICY_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include a letter, a number, and a special character.";

const PHONE_CHARS_REGEX = /^[\d\s()+-]+$/;
const PHONE_CHARS_MESSAGE = "Phone number contains invalid characters";
const LOGIN_IDENTIFIER_REGEX = /^[\w@.+\-() ]+$/;
const LOGIN_IDENTIFIER_MESSAGE = "Identifier contains invalid characters";
const FULL_NAME_REGEX = /^[\p{L}\p{M}\s'.-]+$/u;
const FULL_NAME_MESSAGE = "Full name contains invalid characters";
const OTP_CODE_REGEX = /^\d{4,8}$/;
const OTP_CODE_MESSAGE = "Verification code must be 4-8 digits";

class SignupDto {
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Matches(FULL_NAME_REGEX, { message: FULL_NAME_MESSAGE })
  full_name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20)
  @Matches(PHONE_CHARS_REGEX, { message: PHONE_CHARS_MESSAGE })
  phone!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;

  @IsString()
  confirm_password!: string;
}

class SignupVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(OTP_CODE_REGEX, { message: OTP_CODE_MESSAGE })
  otp_code!: string;
}

class PasswordLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @Matches(LOGIN_IDENTIFIER_REGEX, { message: LOGIN_IDENTIFIER_MESSAGE })
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

class PasswordResetRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @Matches(LOGIN_IDENTIFIER_REGEX, { message: LOGIN_IDENTIFIER_MESSAGE })
  identifier!: string;
}

class PasswordResetConfirmDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @Matches(LOGIN_IDENTIFIER_REGEX, { message: LOGIN_IDENTIFIER_MESSAGE })
  identifier!: string;

  @IsString()
  @Matches(OTP_CODE_REGEX, { message: OTP_CODE_MESSAGE })
  otp_code!: string;

  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;

  @IsString()
  confirm_password!: string;
}

class RefreshDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

class ProfileUpdateDto {
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Matches(FULL_NAME_REGEX, { message: FULL_NAME_MESSAGE })
  full_name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class ProfileContactChangeRequestDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  @Matches(PHONE_CHARS_REGEX, { message: PHONE_CHARS_MESSAGE })
  phone?: string;
}

class ProfileContactChangeVerifyDto {
  @IsString()
  @IsIn(["email", "phone"])
  change_type!: "email" | "phone";

  @IsString()
  @Matches(OTP_CODE_REGEX, { message: OTP_CODE_MESSAGE })
  otp_code!: string;
}

class PosLoginDto {
  @IsString()
  @Matches(/^\d{5}$/, { message: "Employee code must be exactly 5 digits" })
  employee_code!: string;

  @IsString()
  location_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;
}

class PosNetworkStatusDto {
  @IsString()
  location_id!: string;
}

class KdsLoginDto {
  @IsString()
  @Matches(/^\d{5}$/, { message: "Employee code must be exactly 5 digits" })
  employee_code!: string;

  @IsString()
  location_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;
}

class KdsNetworkStatusDto {
  @IsString()
  location_id!: string;
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                    */
/* ------------------------------------------------------------------ */

// Web and API can run on different origins in both dev and production
// (localhost:3000 -> localhost:3001, wings4ulondon.ca ->
// wings4uapi-production.up.railway.app). Auth/session fetches are therefore
// cross-site subresource requests, so cookies must be SameSite=None; Secure or
// the browser accepts the login response but immediately appears signed out on
// the next /auth/session check.
const COOKIE_SAMESITE: "none" = "none";
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

const SIGNUP_DEVICE_COOKIE = "w4u_signup_device";
const SIGNUP_DEVICE_HEADER = "x-w4u-signup-device";
const SIGNUP_DEVICE_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const SIGNUP_ACCOUNT_LIMIT = 3;
const SIGNUP_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SIGNUP_DEVICE_COOKIE_BASE = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/api/v1/auth/signup",
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

function readHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

function normalizeSignupDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 16 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function setSignupDeviceCookie(res: Response, deviceId: string): void {
  res.cookie(SIGNUP_DEVICE_COOKIE, deviceId, {
    ...SIGNUP_DEVICE_COOKIE_BASE,
    maxAge: SIGNUP_DEVICE_COOKIE_MAX_AGE_MS,
  });
}

/* ------------------------------------------------------------------ */
/*  Controller                                                        */
/* ------------------------------------------------------------------ */

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Email + password auth                                           */
  /* ---------------------------------------------------------------- */

  /** Signup step 1: create the account + email an OTP to verify the address. */
  @Public()
  @Post("signup")
  @HttpCode(HttpStatus.OK)
  async signup(
    @Body() body: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.password !== body.confirm_password) {
      throw new BadRequestException("Passwords do not match");
    }
    await this.enforceSignupDeviceLimit(req, res);

    const result = await this.authService.signupWithPassword({
      fullName: body.full_name,
      phone: body.phone,
      email: body.email,
      password: body.password,
    });
    return {
      otp_sent: result.otpSent,
      email: result.email,
      expires_in_seconds: result.expiresInSeconds,
    };
  }

  private async enforceSignupDeviceLimit(
    req: Request,
    res: Response,
  ): Promise<void> {
    const deviceKey = this.resolveSignupDeviceKey(req, res);
    const result = await this.rateLimiter.check(
      `auth:signup:create:${deviceKey}`,
      SIGNUP_ACCOUNT_LIMIT,
      SIGNUP_ACCOUNT_WINDOW_MS,
    );

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetAtMs - Date.now()) / 1000),
      );
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      throw new HttpException(
        "Too many accounts created from this device. Please wait before creating another account.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private resolveSignupDeviceKey(req: Request, res: Response): string {
    const headerDeviceId = normalizeSignupDeviceId(readHeader(req, SIGNUP_DEVICE_HEADER));
    const cookieDeviceId = normalizeSignupDeviceId(req.cookies?.[SIGNUP_DEVICE_COOKIE]);
    const deviceId = headerDeviceId ?? cookieDeviceId;

    if (deviceId) {
      if (cookieDeviceId !== deviceId) {
        setSignupDeviceCookie(res, deviceId);
      }
      return `device:${sha256Hex(deviceId)}`;
    }

    const mintedDeviceId = randomBytes(32).toString("hex");
    setSignupDeviceCookie(res, mintedDeviceId);

    const userAgent = readHeader(req, "user-agent") ?? "unknown";
    const fallback = `${extractClientIp(req)}:${userAgent}`;
    return `fallback:${sha256Hex(fallback)}`;
  }

  /** Signup step 2: verify the email OTP and start a session. */
  @Public()
  @Post("signup/verify")
  @HttpCode(HttpStatus.OK)
  async verifySignup(
    @Body() body: SignupVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyEmailOtp(body.email, body.otp_code);
    setAuthCookies(res, result.accessToken, result.refreshToken, result.csrfToken);
    return {
      user: result.user,
      profile_complete: result.profileComplete,
      needs_profile_completion: result.needsProfileCompletion,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    };
  }

  /** Password login by phone OR email. */
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: PasswordLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithPassword(
      body.identifier,
      body.password,
    );
    // Correct password but the account's email isn't verified yet: do NOT
    // issue a session. A fresh verification code has been emailed; the client
    // routes the user to the email-verification step.
    if (result.kind === "email_unverified") {
      return { needs_email_verification: true, email: result.email };
    }
    const bundle = result.bundle;
    setAuthCookies(res, bundle.accessToken, bundle.refreshToken, bundle.csrfToken);
    return {
      user: bundle.user,
      profile_complete: bundle.profileComplete,
      needs_profile_completion: bundle.needsProfileCompletion,
      access_token: bundle.accessToken,
      refresh_token: bundle.refreshToken,
    };
  }

  /** Re-send the signup email-verification code (uniform, no enumeration). */
  @Public()
  @Post("signup/resend")
  @HttpCode(HttpStatus.OK)
  async resendSignupVerification(@Body() body: ResendVerificationDto) {
    await this.authService.resendEmailVerification(body.email);
    return { otp_sent: true };
  }

  /** Password reset step 1: email an OTP if the account (and its email) exist. */
  @Public()
  @Post("password-reset/request")
  @HttpCode(HttpStatus.OK)
  async passwordResetRequest(@Body() body: PasswordResetRequestDto) {
    const result = await this.authService.requestPasswordReset(body.identifier);
    return {
      otp_sent: result.otpSent,
      expires_in_seconds: result.expiresInSeconds,
    };
  }

  /** Password reset step 2: verify OTP, set the new password, auto-login. */
  @Public()
  @Post("password-reset/confirm")
  @HttpCode(HttpStatus.OK)
  async passwordResetConfirm(
    @Body() body: PasswordResetConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.new_password !== body.confirm_password) {
      throw new BadRequestException("Passwords do not match");
    }
    const result = await this.authService.resetPassword(
      body.identifier,
      body.otp_code,
      body.new_password,
    );
    setAuthCookies(res, result.accessToken, result.refreshToken, result.csrfToken);
    return {
      user: result.user,
      profile_complete: result.profileComplete,
      needs_profile_completion: result.needsProfileCompletion,
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
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Web clients use the httpOnly cookie; native mobile clients send the
    // refresh token explicitly because they do not have browser cookie storage.
    const refreshToken: string | undefined =
      req.cookies?.refresh_token ?? body.refresh_token;
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
      return {
        refreshed: true,
        // Native mobile clients cannot read httpOnly cookies, so they need the
        // rotated tokens in the response body.
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      };
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

  @Roles("CUSTOMER")
  @Post("profile/contact-change/request")
  @HttpCode(HttpStatus.OK)
  async requestProfileContactChange(
    @Body() body: ProfileContactChangeRequestDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.authService.requestProfileContactChange(user.userId, {
      email: body.email,
      phone: body.phone,
    });
  }

  @Roles("CUSTOMER")
  @Post("profile/contact-change/verify")
  @HttpCode(HttpStatus.OK)
  async verifyProfileContactChange(
    @Body() body: ProfileContactChangeVerifyDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.authService.verifyProfileContactChange(
      user.userId,
      body.change_type,
      body.otp_code,
    );
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
