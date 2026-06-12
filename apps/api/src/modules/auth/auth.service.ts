import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";
import { getJwtSecret } from "../../common/utils/jwt-secret";
import { signJwt } from "../../common/utils/jwt";
import { isAllowedStoreIp } from "../../common/utils/store-ip";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { createOtpSender, OtpSender } from "./otp-sender";

const JWT_SECRET = getJwtSecret();
const ACCESS_TOKEN_TTL = 900; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;
const OTP_TTL_SECONDS = 300; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60; // minimum gap between OTP requests per phone
const MAX_ACTIVE_OTP_CODES = 3; // max unconsumed/unexpired codes per phone
const INFOBIP_PIN_HASH_PREFIX = "infobip:pin:";

// Email OTP purposes (stored in AuthOtpCode.purpose).
const EMAIL_VERIFY_PURPOSE = "EMAIL_VERIFY";
const PASSWORD_RESET_PURPOSE = "PASSWORD_RESET";

// At least 8 chars, with at least one letter and one digit.
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Mask an email for UI display, e.g. "ja***@example.com". */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${local.length > 2 ? "***" : ""}@${domain}`;
}

/**
 * Normalize user input to E.164.
 * - Accepts `+country` with digits/spaces/punctuation.
 * - 10-digit NANP (US/Canada) without `+` → `+1` + digits.
 * - 11-digit starting with 1 (NANP) without `+` → `+` + digits.
 */
function normalizePhone(phone: string): string {
  const trimmed = phone.trim();

  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  
  // The frontend already formats this as an E.164 string with +1, giving 11 digits total.
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  throw new UnauthorizedException("Please Enter a valid 10 digit Phone Number");
}

function generateOtp(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

interface TokenBundle {
  user: {
    id: string;
    role: string;
    displayName: string;
    phone?: string;
  };
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  employeeRole?: string;
  locationId?: string;
  profileComplete?: boolean;
  needsProfileCompletion?: boolean;
}

/** A profile is complete only after the profile form/admin tooling has stored a real name. */
function isProfileComplete(user: {
  role: string;
  displayName: string;
  firstName?: string | null;
}): boolean {
  const displayName = user.displayName.trim();
  const firstName = user.firstName?.trim();
  return (
    displayName.length >= 4 &&
    !/^\+[1-9]\d{1,14}$/.test(displayName) &&
    Boolean(firstName)
  );
}

interface SessionInfo {
  authenticated: boolean;
  user?: {
    id: string;
    role: string;
    /**
     * Present only for STAFF users. Exposed so the web middleware and
     * server layouts can evaluate KDS surface policies without
     * re-decoding the JWT — the API is the source of truth for the
     * current employee role (JWT claims can be stale after a refresh).
     */
    employeeRole?: string;
    displayName: string;
    phone?: string;
    email?: string;
  };
  is_pos_session: boolean;
  station_location_id?: string;
  profile_complete: boolean;
  needs_profile_completion: boolean;
}

interface ProfileUpdateResult {
  user: { id: string; displayName: string; firstName: string | null; lastName: string | null };
  profile_complete: boolean;
}

@Injectable()
export class AuthService {
  private readonly otpSender: OtpSender;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {
    this.otpSender = createOtpSender();
  }

  /* ------------------------------------------------------------------ */
  /*  OTP request                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Pre-signup eligibility check. Called from the signup form before
   * requesting an OTP so the user gets immediate, specific feedback.
   */
  async checkSignupEligibility(
    phone: string,
    email?: string,
  ): Promise<{ phone_exists: boolean; email_taken: boolean }> {
    const phoneE164 = normalizePhone(phone);

    const phoneIdentity = await this.prisma.userIdentity.findUnique({
      where: { phoneE164 },
      include: { user: { select: { role: true, displayName: true, firstName: true } } },
    });

    // Phone "exists" only when the user behind it has completed the profile
    // form. POS-created/walk-in customer rows can have a display name but no
    // firstName, so those still re-enter signup profile completion.
    const phoneExists =
      !!phoneIdentity && isProfileComplete(phoneIdentity.user);

    let emailTaken = false;
    if (email) {
      const normalizedEmail = email.trim().toLowerCase();
      const dup = await this.prisma.userIdentity.findFirst({
        where: { emailNormalized: normalizedEmail, provider: "EMAIL" },
      });
      emailTaken = !!dup;
    }

    return { phone_exists: phoneExists, email_taken: emailTaken };
  }

  async requestOtp(phone: string): Promise<{ otpSent: true; expiresInSeconds: number }> {
    const phoneE164 = normalizePhone(phone);

    const identity = await this.prisma.$transaction(async (tx) => {
      let ident = await tx.userIdentity.findUnique({
        where: { phoneE164 },
      });

      if (!ident) {
        const user = await tx.user.create({
          data: {
            role: "CUSTOMER",
            displayName: phoneE164,
          },
        });

        ident = await tx.userIdentity.create({
          data: {
            userId: user.id,
            provider: "PHONE_OTP",
            phoneE164,
            isPrimary: true,
          },
        });
      }

      return ident;
    });

    // Throttle: per-phone resend cooldown
    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - OTP_RESEND_COOLDOWN_SECONDS * 1000);
    const recentCode = await this.prisma.authOtpCode.findFirst({
      where: {
        userIdentityId: identity.id,
        purpose: "LOGIN",
        createdAt: { gt: cooldownCutoff },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recentCode) {
      const waitSeconds = Math.ceil(
        (recentCode.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
      );
      throw new UnauthorizedException(
        `Please wait ${waitSeconds} seconds before requesting another code`,
      );
    }

    // Throttle: max active (unconsumed + unexpired) codes
    const activeCount = await this.prisma.authOtpCode.count({
      where: {
        userIdentityId: identity.id,
        purpose: "LOGIN",
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (activeCount >= MAX_ACTIVE_OTP_CODES) {
      throw new UnauthorizedException(
        "Too many active codes — please wait for the current code to expire or verify it",
      );
    }

    const otp = generateOtp();
    const delivery = await this.otpSender.send(phoneE164, otp);
    const otpHash =
      delivery.provider === "infobip-2fa"
        ? `${INFOBIP_PIN_HASH_PREFIX}${delivery.verificationRef}`
        : sha256(otp);

    await this.prisma.authOtpCode.create({
      data: {
        userIdentityId: identity.id,
        otpHash,
        purpose: "LOGIN",
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });

    return { otpSent: true, expiresInSeconds: OTP_TTL_SECONDS };
  }

  /* ------------------------------------------------------------------ */
  /*  OTP verify                                                        */
  /* ------------------------------------------------------------------ */

  async verifyOtp(phone: string, otpCode: string): Promise<TokenBundle> {
    const phoneE164 = normalizePhone(phone);

    const identity = await this.prisma.userIdentity.findUnique({
      where: { phoneE164 },
      include: { user: true },
    });

    // ──────────────────────────────────────────────────────────────────
    // DEV ONLY — REMOVE BEFORE PRODUCTION
    // "781498" is a universal dev bypass OTP. It skips the OTP record
    // lookup entirely so you don't even need to call otp/request first.
    // Just enter any valid phone number + "781498" to log in instantly.
    // ──────────────────────────────────────────────────────────────────
    const isDevBypassOtp = otpCode === "781498";

    if (!identity && isDevBypassOtp) {
      // Auto-create the user + identity for dev convenience
      const user = await this.prisma.user.create({
        data: { role: "CUSTOMER", displayName: phoneE164 },
      });
      const newIdent = await this.prisma.userIdentity.create({
        data: {
          userId: user.id,
          provider: "PHONE_OTP",
          phoneE164,
          isPrimary: true,
          isVerified: true,
          verifiedAt: new Date(),
        },
      });
      const bundle = await this.createSessionTokens(user, phoneE164);
      const complete = isProfileComplete(user);
      bundle.profileComplete = complete;
      bundle.needsProfileCompletion = !complete;
      return bundle;
    }

    if (!identity) {
      throw new UnauthorizedException("Unknown phone number — request an OTP first");
    }

    if (isDevBypassOtp) {
      // DEV ONLY — skip OTP record check, just mark identity verified and issue tokens
      await this.prisma.userIdentity.update({
        where: { id: identity.id },
        data: { isVerified: true, verifiedAt: new Date() },
      });
      const bundle = await this.createSessionTokens(identity.user, phoneE164);
      const complete = isProfileComplete(identity.user);
      bundle.profileComplete = complete;
      bundle.needsProfileCompletion = !complete;
      return bundle;
    }
    // ──────────────────────────────────────────────────────────────────
    // END DEV BYPASS
    // ──────────────────────────────────────────────────────────────────

    const now = new Date();

    const otpRecord = await this.prisma.authOtpCode.findFirst({
      where: {
        userIdentityId: identity.id,
        purpose: "LOGIN",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new UnauthorizedException("No valid OTP found — it may have expired");
    }

    if (otpRecord.attemptCount >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException("Too many attempts — request a new OTP");
    }

    const isInfobipPin = otpRecord.otpHash.startsWith(INFOBIP_PIN_HASH_PREFIX);
    const isVerified = isInfobipPin
      ? await this.verifyInfobipPin(otpRecord.otpHash, otpCode)
      : sha256(otpCode) === otpRecord.otpHash;

    if (!isVerified) {
      await this.prisma.authOtpCode.update({
        where: { id: otpRecord.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new UnauthorizedException("Invalid OTP code");
    }

    await this.prisma.$transaction([
      this.prisma.authOtpCode.update({
        where: { id: otpRecord.id },
        data: { consumedAt: now },
      }),
      this.prisma.userIdentity.update({
        where: { id: identity.id },
        data: { isVerified: true, verifiedAt: now },
      }),
    ]);

    const bundle = await this.createSessionTokens(identity.user, phoneE164);
    const complete = isProfileComplete(identity.user);
    bundle.profileComplete = complete;
    bundle.needsProfileCompletion = !complete;
    return bundle;
  }

  /* ------------------------------------------------------------------ */
  /*  Email + password auth (signup / login / reset)                    */
  /* ------------------------------------------------------------------ */

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private validatePassword(password: string): void {
    if (!PASSWORD_POLICY.test(password)) {
      throw new UnauthorizedException(
        "Password must be at least 8 characters and include a letter and a number.",
      );
    }
  }

  /** Resolve the primary phone (E.164) for a user, for the token bundle. */
  private async findPrimaryPhone(userId: string): Promise<string | undefined> {
    const phoneIdentity = await this.prisma.userIdentity.findFirst({
      where: { userId, provider: "PHONE_OTP", isPrimary: true },
      select: { phoneE164: true },
    });
    return phoneIdentity?.phoneE164 ?? undefined;
  }

  /**
   * Create an email OTP for an identity+purpose, enforcing the same resend
   * cooldown / active-code limits as phone OTP, then email the code.
   */
  private async issueEmailOtp(
    userIdentityId: string,
    purpose: string,
    email: string,
  ): Promise<number> {
    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - OTP_RESEND_COOLDOWN_SECONDS * 1000);

    const recentCode = await this.prisma.authOtpCode.findFirst({
      where: { userIdentityId, purpose, createdAt: { gt: cooldownCutoff } },
      orderBy: { createdAt: "desc" },
    });
    if (recentCode) {
      const waitSeconds = Math.ceil(
        (recentCode.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
      );
      throw new UnauthorizedException(
        `Please wait ${waitSeconds} seconds before requesting another code`,
      );
    }

    const activeCount = await this.prisma.authOtpCode.count({
      where: { userIdentityId, purpose, consumedAt: null, expiresAt: { gt: now } },
    });
    if (activeCount >= MAX_ACTIVE_OTP_CODES) {
      throw new UnauthorizedException(
        "Too many active codes — please wait for the current code to expire",
      );
    }

    const otp = generateOtp();
    await this.otpSender.send(email, otp);

    await this.prisma.authOtpCode.create({
      data: {
        userIdentityId,
        otpHash: sha256(otp),
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });

    return OTP_TTL_SECONDS;
  }

  /** Verify and consume an email OTP for an identity+purpose. */
  private async consumeEmailOtp(
    userIdentityId: string,
    purpose: string,
    otpCode: string,
  ): Promise<void> {
    const now = new Date();
    const record = await this.prisma.authOtpCode.findFirst({
      where: { userIdentityId, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      throw new UnauthorizedException("No valid code found — it may have expired");
    }
    if (record.attemptCount >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException("Too many attempts — request a new code");
    }
    if (sha256(otpCode) !== record.otpHash) {
      await this.prisma.authOtpCode.update({
        where: { id: record.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new UnauthorizedException("Invalid code");
    }

    await this.prisma.authOtpCode.update({
      where: { id: record.id },
      data: { consumedAt: now },
    });
  }

  /**
   * Step 1 of signup: create (or finish) the account with a hashed password,
   * then email an OTP to verify the address. The account is not usable until
   * the email is verified in step 2.
   */
  async signupWithPassword(input: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
  }): Promise<{ otpSent: true; email: string; expiresInSeconds: number }> {
    const fullName = input.fullName.trim();
    if (fullName.length < 4) {
      throw new UnauthorizedException("Full name must be at least 4 characters");
    }
    const phoneE164 = normalizePhone(input.phone);
    const email = this.normalizeEmail(input.email);
    if (!EMAIL_RE.test(email)) {
      throw new UnauthorizedException("Please enter a valid email address");
    }
    this.validatePassword(input.password);

    const phoneIdentity = await this.prisma.userIdentity.findUnique({
      where: { phoneE164 },
      include: { user: true },
    });
    if (phoneIdentity && isProfileComplete(phoneIdentity.user)) {
      throw new ConflictException(
        "An account already exists with this phone number. Try signing in.",
      );
    }

    const emailIdentity = await this.prisma.userIdentity.findFirst({
      where: { emailNormalized: email, provider: "EMAIL" },
    });
    if (emailIdentity && emailIdentity.userId !== phoneIdentity?.userId) {
      throw new ConflictException("This email is already in use by another account.");
    }

    const parts = fullName.split(/\s+/);
    const firstName = parts[0]!;
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
    const passwordHash = await bcrypt.hash(input.password, 10);

    const emailIdentityId = await this.prisma.$transaction(async (tx) => {
      let userId: string;
      if (phoneIdentity) {
        const user = await tx.user.update({
          where: { id: phoneIdentity.userId },
          data: { displayName: fullName, firstName, lastName, passwordHash },
        });
        userId = user.id;
      } else {
        const user = await tx.user.create({
          data: { role: "CUSTOMER", displayName: fullName, firstName, lastName, passwordHash },
        });
        userId = user.id;
        await tx.userIdentity.create({
          data: { userId, provider: "PHONE_OTP", phoneE164, isPrimary: true },
        });
      }

      const existingEmail = await tx.userIdentity.findFirst({
        where: { userId, provider: "EMAIL" },
      });
      if (existingEmail) {
        const updated = await tx.userIdentity.update({
          where: { id: existingEmail.id },
          data: {
            emailNormalized: email,
            providerSubject: email,
            isVerified: false,
            verifiedAt: null,
          },
        });
        return updated.id;
      }

      const created = await tx.userIdentity.create({
        data: {
          userId,
          provider: "EMAIL",
          providerSubject: email,
          emailNormalized: email,
          isPrimary: false,
        },
      });
      return created.id;
    });

    const expiresInSeconds = await this.issueEmailOtp(
      emailIdentityId,
      EMAIL_VERIFY_PURPOSE,
      email,
    );
    return { otpSent: true, email, expiresInSeconds };
  }

  /** Step 2 of signup: verify the email OTP and issue session tokens. */
  async verifyEmailOtp(emailRaw: string, otpCode: string): Promise<TokenBundle> {
    const email = this.normalizeEmail(emailRaw);
    const identity = await this.prisma.userIdentity.findFirst({
      where: { emailNormalized: email, provider: "EMAIL" },
      include: { user: true },
    });
    if (!identity) {
      throw new UnauthorizedException("Unknown email — start sign up first");
    }

    await this.consumeEmailOtp(identity.id, EMAIL_VERIFY_PURPOSE, otpCode);

    await this.prisma.userIdentity.update({
      where: { id: identity.id },
      data: { isVerified: true, verifiedAt: new Date() },
    });

    const phone = await this.findPrimaryPhone(identity.userId);
    const bundle = await this.createSessionTokens(identity.user, phone);
    const complete = isProfileComplete(identity.user);
    bundle.profileComplete = complete;
    bundle.needsProfileCompletion = !complete;
    return bundle;
  }

  /** Password login by phone OR email identifier. */
  async loginWithPassword(
    identifierRaw: string,
    password: string,
  ): Promise<TokenBundle> {
    const identifier = identifierRaw.trim();
    const identity = identifier.includes("@")
      ? await this.prisma.userIdentity.findFirst({
          where: { emailNormalized: this.normalizeEmail(identifier), provider: "EMAIL" },
          include: { user: true },
        })
      : await this.prisma.userIdentity.findUnique({
          where: { phoneE164: normalizePhone(identifier) },
          include: { user: true },
        });

    if (!identity?.user) {
      throw new UnauthorizedException("Invalid phone/email or password");
    }
    const user = identity.user;
    if (!user.isActive) {
      throw new UnauthorizedException("This account has been deactivated");
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "No password set for this account. Use \"Forgot password\" to set one.",
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid phone/email or password");
    }

    const phone = await this.findPrimaryPhone(user.id);
    const bundle = await this.createSessionTokens(user, phone);
    const complete = isProfileComplete(user);
    bundle.profileComplete = complete;
    bundle.needsProfileCompletion = !complete;
    return bundle;
  }

  /** Resolve a user + their email identity from a phone/email identifier. */
  private async resolveUserByIdentifier(identifierRaw: string): Promise<{
    userId: string;
    emailIdentity: { id: string; emailNormalized: string | null } | null;
  } | null> {
    const identifier = identifierRaw.trim();
    const identity = identifier.includes("@")
      ? await this.prisma.userIdentity.findFirst({
          where: { emailNormalized: this.normalizeEmail(identifier), provider: "EMAIL" },
        })
      : await this.prisma.userIdentity.findUnique({
          where: { phoneE164: normalizePhone(identifier) },
        });

    if (!identity) return null;

    const emailIdentity = await this.prisma.userIdentity.findFirst({
      where: { userId: identity.userId, provider: "EMAIL" },
      select: { id: true, emailNormalized: true },
    });
    return { userId: identity.userId, emailIdentity };
  }

  /** Step 1 of password reset: email an OTP if the account (and its email) exist. */
  async requestPasswordReset(
    identifierRaw: string,
  ): Promise<{ otpSent: true; emailMasked: string; expiresInSeconds: number }> {
    const resolved = await this.resolveUserByIdentifier(identifierRaw);
    if (!resolved) {
      throw new UnauthorizedException("No account found with that phone or email.");
    }
    const { emailIdentity } = resolved;
    if (!emailIdentity?.emailNormalized) {
      throw new UnauthorizedException(
        "No email on file for this account. Please contact support to reset your password.",
      );
    }

    const expiresInSeconds = await this.issueEmailOtp(
      emailIdentity.id,
      PASSWORD_RESET_PURPOSE,
      emailIdentity.emailNormalized,
    );
    return {
      otpSent: true,
      emailMasked: maskEmail(emailIdentity.emailNormalized),
      expiresInSeconds,
    };
  }

  /** Step 2 of password reset: verify OTP, set the new password, auto-login. */
  async resetPassword(
    identifierRaw: string,
    otpCode: string,
    newPassword: string,
  ): Promise<TokenBundle> {
    this.validatePassword(newPassword);

    const resolved = await this.resolveUserByIdentifier(identifierRaw);
    if (!resolved) {
      throw new UnauthorizedException("No account found with that phone or email.");
    }
    const { userId, emailIdentity } = resolved;
    if (!emailIdentity?.emailNormalized) {
      throw new UnauthorizedException(
        "No email on file for this account. Please contact support.",
      );
    }

    await this.consumeEmailOtp(emailIdentity.id, PASSWORD_RESET_PURPOSE, otpCode);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.userIdentity.update({
        where: { id: emailIdentity.id },
        data: { isVerified: true, verifiedAt: now },
      }),
      // Invalidate any existing sessions — a password reset should log out
      // every other device.
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedByUserId: userId },
      }),
    ]);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const phone = await this.findPrimaryPhone(userId);
    const bundle = await this.createSessionTokens(user, phone);
    const complete = isProfileComplete(user);
    bundle.profileComplete = complete;
    bundle.needsProfileCompletion = !complete;
    return bundle;
  }

  /* ------------------------------------------------------------------ */
  /*  Refresh                                                           */
  /* ------------------------------------------------------------------ */

  async refresh(refreshTokenRaw: string): Promise<Omit<TokenBundle, "user">> {
    const hash = sha256(refreshTokenRaw);
    const now = new Date();

    const session = await this.prisma.authSession.findFirst({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: {
          include: {
            employeeProfile: { select: { role: true } },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Fail closed for deactivated users. `SessionValidator` already blocks
    // inactive users on every HTTP/WS request, and POS login refuses them,
    // but refresh used to silently mint a new access token for them — so a
    // deactivated user could keep rotating tokens and stay logged in until
    // their refresh cookie expired weeks later. Revoke the row here so the
    // cookie is also unusable going forward, then let the controller clear
    // cookies on the thrown failure.
    if (!session.user.isActive) {
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, revokedByUserId: session.userId },
      });
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const newRefresh = generateRefreshToken();

    const [, newSession] = await this.prisma.$transaction([
      this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now, revokedByUserId: session.userId },
      }),
      this.prisma.authSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: sha256(newRefresh),
          deviceInfo: session.deviceInfo,
          ipAddress: session.ipAddress,
          locationId: session.locationId,
          isPosSession: session.isPosSession,
          expiresAt: refreshTokenExpiresAt(),
        },
      }),
    ]);

    // Rebuild the access token from the CURRENT user record, not from the
    // partial shape carried by the previous refresh. This is what keeps
    // `employeeRole` on the refreshed token for KDS staff so
    // middleware decisions don't flip to 403 after a silent refresh.
    // Role/employeeRole here are also what the Edge JWT prefilter reads
    // until the authoritative server-side session check runs.
    const currentRole = session.user.role;
    const currentEmployeeRole =
      currentRole === "STAFF"
        ? session.user.employeeProfile?.role ?? undefined
        : undefined;

    const accessToken = signJwt(
      {
        sub: session.userId,
        role: currentRole,
        ...(currentEmployeeRole ? { employeeRole: currentEmployeeRole } : {}),
        sessionId: newSession.id,
      },
      JWT_SECRET,
      ACCESS_TOKEN_TTL,
    );

    // Reissue the CSRF token alongside the rotated refresh token.
    //
    // Previously refresh only wrote `access_token` + `refresh_token`, so a
    // long-lived session whose csrf cookie had expired (the csrf cookie
    // has its own 30-day TTL) would start failing every authenticated
    // mutation because the double-submit check had nothing to compare
    // against. Rotating it here keeps cookie lifetimes consistent across
    // the full login -> refresh -> refresh ... chain.
    const csrfToken = randomBytes(32).toString("hex");

    this.realtime.disconnectSession(session.id, "Session refreshed");

    return { accessToken, refreshToken: newRefresh, csrfToken };
  }

  /* ------------------------------------------------------------------ */
  /*  Logout                                                            */
  /* ------------------------------------------------------------------ */

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: userId },
    });
    this.realtime.disconnectSession(sessionId, "Logged out");
  }

  /* ------------------------------------------------------------------ */
  /*  Shared station login (POS + KDS)                                   */
  /* ------------------------------------------------------------------ */

  private static readonly STATION_MAX_ATTEMPTS = 5;
  private static readonly STATION_LOCKOUT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly STATION_CODE_REUSE_COOLDOWN_DAYS = 30;

  /**
   * Shared employee-station-login helper used by both POS and KDS.
   *
   * Validates the employee PIN against the IP allowlist, enforces rate
   * limiting, checks account status, handles code-reuse cooldowns, and
   * creates an authenticated session + JWT token bundle.
   *
   * @param surface  - "POS" or "KDS" — used for error messages + audit keys
   * @param opts.employeeCode       - the 5-digit employee PIN
   * @param opts.locationId         - target location UUID
   * @param opts.clientIp           - caller IP for allowlist + audit
   * @param opts.deviceId           - optional device fingerprint
   * @param opts.isPosSession       - whether to mark the session as POS
   */
  private async stationLogin(
    surface: "POS" | "KDS",
    opts: {
      employeeCode: string;
      locationId: string;
      clientIp: string;
      deviceId?: string;
      isPosSession: boolean;
    },
  ): Promise<TokenBundle> {
    const { employeeCode, locationId, clientIp, deviceId, isPosSession } = opts;
    const surfaceLabel = surface === "POS" ? "POS" : "KDS";

    // 1. IP allowlist check
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { trustedIpRanges: true },
    });

    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      throw new ForbiddenException(
        `${surfaceLabel} access is restricted to in-store network only`,
      );
    }

    // 2. IP/device-based rate limiting (works even when no employee matches)
    const lockoutWindowStart = new Date(
      Date.now() - AuthService.STATION_LOCKOUT_WINDOW_MS,
    );
    const recentFailedAttempts = await this.prisma.posLoginAttempt.count({
      where: {
        locationId,
        clientIp,
        ...(deviceId ? { deviceFingerprint: deviceId } : {}),
        wasSuccessful: false,
        attemptedAt: { gte: lockoutWindowStart },
      },
    });

    if (recentFailedAttempts >= AuthService.STATION_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        "Too many failed attempts from this device. Please wait 10 minutes.",
      );
    }

    // 3. Find employee by PIN — bcrypt first, SHA-256 legacy fallback
    const allActiveEmployees = await this.prisma.employeeProfile.findMany({
      where: {
        locationId,
        isActiveEmployee: true,
        employeePinHash: { not: null },
      },
      include: { user: true },
    });

    let employee = null;
    for (const emp of allActiveEmployees) {
      if (!emp.employeePinHash) continue;

      // Bcrypt hashes always start with $2a$ or $2b$
      const isBcryptHash = emp.employeePinHash.startsWith("$2");

      if (isBcryptHash) {
        const match = await bcrypt.compare(employeeCode, emp.employeePinHash);
        if (match) {
          employee = emp;
          break;
        }
      } else {
        // Legacy SHA-256 comparison
        if (sha256(employeeCode) === emp.employeePinHash) {
          employee = emp;
          break;
        }
      }
    }

    if (!employee) {
      // No match — record failed attempt and reject
      await this.recordStationLoginAttempt(locationId, clientIp, deviceId, false);
      await this.logStationLoginAudit(surface, locationId, clientIp, deviceId, null);
      throw new UnauthorizedException("Invalid employee code or location");
    }

    // 4. User account active check
    if (!employee.user.isActive) {
      await this.recordStationLoginAttempt(locationId, clientIp, deviceId, false);
      await this.logStationLoginAudit(surface, locationId, clientIp, deviceId, employee.userId);
      throw new ForbiddenException("User account is deactivated");
    }

    // 5. Code reuse cooldown — reject if code was deactivated within cooldown window
    if (employee.posCodeDeactivatedAt) {
      const cooldownEnd = new Date(
        employee.posCodeDeactivatedAt.getTime() +
          AuthService.STATION_CODE_REUSE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      if (new Date() < cooldownEnd) {
        await this.recordStationLoginAttempt(locationId, clientIp, deviceId, false);
        await this.logStationLoginAudit(surface, locationId, clientIp, deviceId, employee.userId);
        throw new ForbiddenException(
          "This employee code was recently deactivated. Please use a new code.",
        );
      }
    }

    // 6. Record successful attempt and create session
    await this.recordStationLoginAttempt(locationId, clientIp, deviceId, true);

    const refreshRaw = generateRefreshToken();
    const csrfToken = randomBytes(32).toString("hex");

    const session = await this.prisma.authSession.create({
      data: {
        userId: employee.userId,
        refreshTokenHash: sha256(refreshRaw),
        ipAddress: clientIp,
        locationId,
        isPosSession,
        expiresAt: refreshTokenExpiresAt(),
      },
    });

    const accessToken = signJwt(
      {
        sub: employee.userId,
        role: employee.user.role,
        employeeRole: employee.role,
        sessionId: session.id,
      },
      JWT_SECRET,
      ACCESS_TOKEN_TTL,
    );

    return {
      user: {
        id: employee.userId,
        role: employee.user.role,
        displayName: employee.user.displayName,
      },
      accessToken,
      refreshToken: refreshRaw,
      csrfToken,
      employeeRole: employee.role,
      locationId,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  POS login                                                         */
  /* ------------------------------------------------------------------ */

  async posLogin(
    employeeCode: string,
    locationId: string,
    clientIp: string,
    deviceId?: string,
  ): Promise<TokenBundle> {
    return this.stationLogin("POS", {
      employeeCode,
      locationId,
      clientIp,
      deviceId,
      isPosSession: true,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  KDS login                                                         */
  /* ------------------------------------------------------------------ */

  async kdsLogin(
    employeeCode: string,
    locationId: string,
    clientIp: string,
    deviceId?: string,
  ): Promise<TokenBundle> {
    return this.stationLogin("KDS", {
      employeeCode,
      locationId,
      clientIp,
      deviceId,
      isPosSession: false,
    });
  }

  /**
   * Record a station login attempt in the rate-limit table.
   * Reuses the POS login attempt model for both POS and KDS.
   * Works regardless of whether an employee was matched.
   */
  private async recordStationLoginAttempt(
    locationId: string,
    clientIp: string,
    deviceId: string | undefined,
    success: boolean,
  ): Promise<void> {
    await this.prisma.posLoginAttempt.create({
      data: {
        locationId,
        clientIp,
        deviceFingerprint: deviceId ?? null,
        wasSuccessful: success,
      },
    });
  }

  /**
   * Write audit log entry for station login failure (POS or KDS).
   */
  private async logStationLoginAudit(
    surface: "POS" | "KDS",
    locationId: string,
    clientIp: string,
    deviceId: string | undefined,
    actorUserId: string | null,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        locationId,
        actorUserId,
        actorRoleSnapshot: actorUserId ? "STAFF" : "UNKNOWN",
        actionKey: `${surface}_LOGIN_FAIL`,
        entityType: `${surface}_SESSION`,
        reasonText: `Failed ${surface} login attempt`,
        payloadJson: {
          client_ip: clientIp,
          device_id: deviceId ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Hash a 5-digit POS code with bcrypt for storage.
   * Use this when setting/resetting an employee PIN.
   */
  static async hashPosCode(code: string): Promise<string> {
    return bcrypt.hash(code, 10);
  }

  /* ------------------------------------------------------------------ */
  /*  Session                                                           */
  /* ------------------------------------------------------------------ */

  async getSession(
    authUser?: {
      userId: string;
      role: string;
      employeeRole?: string;
      stationLocationId?: string;
      isPosSession?: boolean;
    },
  ): Promise<SessionInfo> {
    if (!authUser?.userId) {
      return {
        authenticated: false,
        is_pos_session: false,
        profile_complete: false,
        needs_profile_completion: false,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      include: {
        identities: true,
      },
    });

    if (!user) {
      return {
        authenticated: false,
        is_pos_session: false,
        profile_complete: false,
        needs_profile_completion: false,
      };
    }

    const phone = user.identities.find((i) => i.provider === "PHONE_OTP" && i.isPrimary)?.phoneE164;
    const email = user.identities.find((i) => i.provider === "EMAIL")?.emailNormalized;

    const complete = isProfileComplete(user);

    // Source role + employeeRole from the already-authoritative request user
    // (populated by `AuthGuard` through `SessionValidator`, which reads the
    // current DB state). This is what the web middleware / server layouts
    // must see so that KDS access decisions use the current role,
    // not a stale JWT claim from before a demotion.
    const role = authUser.role ?? user.role;
    const employeeRole =
      role === "STAFF" ? authUser.employeeRole ?? undefined : undefined;

    return {
      authenticated: true,
      user: {
        id: user.id,
        role,
        employeeRole,
        displayName: user.displayName,
        phone: phone ?? undefined,
        email: email ?? undefined,
      },
      is_pos_session: authUser.isPosSession === true,
      station_location_id: authUser.stationLocationId,
      profile_complete: complete,
      needs_profile_completion: !complete,
    };
  }

  async getPosNetworkStatus(
    locationId: string,
    clientIp: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.getStationNetworkStatus("POS", locationId, clientIp);
  }

  async getKdsNetworkStatus(
    locationId: string,
    clientIp: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.getStationNetworkStatus("KDS", locationId, clientIp);
  }

  /**
   * Shared network-status check for POS and KDS surfaces.
   * Returns whether the client IP is inside the store's trusted IP ranges.
   */
  private async getStationNetworkStatus(
    surface: "POS" | "KDS",
    locationId: string,
    clientIp: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { trustedIpRanges: true },
    });

    if (isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `${surface} access is restricted to in-store network only`,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Profile completion                                                */
  /* ------------------------------------------------------------------ */

  async updateProfile(
    userId: string,
    fullName: string,
    email?: string,
  ): Promise<ProfileUpdateResult> {
    const trimmedName = fullName.trim();
    if (!trimmedName || trimmedName.length < 4) {
      throw new UnauthorizedException("Full name must be at least 4 characters");
    }

    // Best-effort split into first/last
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0]!;
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: trimmedName,
        firstName,
        lastName,
      },
    });

    // Upsert optional email as a UserIdentity (unverified in v1)
    if (email) {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await this.prisma.userIdentity.findFirst({
        where: { userId, provider: "EMAIL" },
      });

      if (existing) {
        await this.prisma.userIdentity.update({
          where: { id: existing.id },
          data: { emailNormalized: normalizedEmail, providerSubject: normalizedEmail },
        });
      } else {
        // Check for duplicate email across other users
        const duplicate = await this.prisma.userIdentity.findFirst({
          where: { emailNormalized: normalizedEmail, provider: "EMAIL", userId: { not: userId } },
        });
        if (duplicate) {
          throw new ConflictException("This email is already in use by another account");
        }
        await this.prisma.userIdentity.create({
          data: {
            userId,
            provider: "EMAIL",
            providerSubject: normalizedEmail,
            emailNormalized: normalizedEmail,
            isPrimary: false,
          },
        });
      }
    }

    return {
      user: { id: user.id, displayName: user.displayName, firstName: user.firstName, lastName: user.lastName },
      profile_complete: isProfileComplete(user),
    };
  }

  /** Check if a customer user has a complete profile (for checkout gating). */
  async isCustomerProfileComplete(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, displayName: true, firstName: true },
    });
    if (!user) return false;
    return isProfileComplete(user);
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  private async verifyInfobipPin(otpHash: string, otpCode: string): Promise<boolean> {
    const pinId = otpHash.slice(INFOBIP_PIN_HASH_PREFIX.length);
    if (!pinId || !this.otpSender.verify) {
      throw new UnauthorizedException("OTP provider is not configured for verification");
    }

    return this.otpSender.verify(pinId, otpCode);
  }

  private async createSessionTokens(
    user: { id: string; role: string; displayName: string },
    phone?: string,
  ): Promise<TokenBundle> {
    const refreshRaw = generateRefreshToken();
    const csrfToken = randomBytes(32).toString("hex");

    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshRaw),
        expiresAt: refreshTokenExpiresAt(),
      },
    });

    const accessToken = signJwt(
      { sub: user.id, role: user.role, sessionId: session.id },
      JWT_SECRET,
      ACCESS_TOKEN_TTL,
    );

    return {
      user: { id: user.id, role: user.role, displayName: user.displayName, phone },
      accessToken,
      refreshToken: refreshRaw,
      csrfToken,
    };
  }
}
