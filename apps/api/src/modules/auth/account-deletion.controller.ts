import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { IsBoolean, IsIn, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { Public, Roles } from "../../common/decorators/roles.decorator";
import { extractClientIp } from "../../common/utils/store-ip";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { clearAuthCookies } from "./auth.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { clearGuestTokenCookie } from "../saved-cart/guest-cart-cookie";

class DeletionVerificationDto {
  @IsString() @MinLength(1) @MaxLength(128)
  password!: string;
}
class DeleteAccountDto {
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/)
  authorization!: string;
  @IsUUID("4")
  request_id!: string;
  @IsIn(["DELETE"])
  confirmation!: string;
  @IsBoolean()
  forfeit_rewards!: boolean;
}
class DeletionReceiptDto {
  @IsUUID("4") request_id!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) authorization!: string;
}

@Controller("auth")
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService, private readonly limits: RateLimiterService) {}

  @Public()
  @Get("account-deletion/config")
  config(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return this.deletion.config();
  }

  @Roles("CUSTOMER")
  @Get("account-deletion")
  async status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = this.customer(req);
    res.setHeader("Cache-Control", "no-store");
    await this.limit(`status:${user.userId}`, 30, res);
    return this.deletion.status(user);
  }

  @Public()
  @Post("account-deletion/receipt")
  @HttpCode(HttpStatus.OK)
  async receipt(@Body() body: DeletionReceiptDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    await this.limit(`receipt:ip:${extractClientIp(req)}`, 20, res);
    const result = await this.deletion.receipt(body);
    if (result.status === "completed") { clearAuthCookies(res); clearGuestTokenCookie(res); }
    return result;
  }

  @Roles("CUSTOMER")
  @Post("account-deletion/verify")
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: DeletionVerificationDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = this.customer(req);
    res.setHeader("Cache-Control", "no-store");
    await this.limit(`verify:user:${user.userId}`, 5, res);
    await this.limit(`verify:ip:${extractClientIp(req)}`, 20, res);
    return this.deletion.verify(user, body.password);
  }

  @Roles("CUSTOMER")
  @Delete("account")
  @HttpCode(HttpStatus.OK)
  async remove(@Body() body: DeleteAccountDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = this.customer(req);
    res.setHeader("Cache-Control", "no-store");
    await this.limit(`delete:${user.userId}`, 5, res);
    const result = await this.deletion.remove(user, body);
    if (result.status === "completed") { clearAuthCookies(res); clearGuestTokenCookie(res); }
    return result;
  }

  private customer(req: Request): NonNullable<Request["user"]> {
    if (!req.user?.sessionId) throw new UnauthorizedException("Sign in to manage your account.");
    if (req.user.role !== "CUSTOMER") throw new ForbiddenException("Only customer accounts can use account deletion.");
    return req.user;
  }

  private async limit(key: string, count: number, res: Response) {
    const limit = await this.limits.check(`auth:account-deletion:${key}`, count, 15 * 60_000);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((limit.resetAtMs - Date.now()) / 1000))));
      throw new HttpException("Too many attempts. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
