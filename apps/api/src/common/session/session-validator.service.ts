import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { verifyJwt } from "../utils/jwt";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type UserRole = "CUSTOMER" | "STAFF" | "ADMIN";
export type EmployeeRole = "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";

/**
 * Normalized, DB-authoritative session. Any consumer (HTTP guard, websocket
 * gateway, server-rendered page via the session endpoint) must treat this
 * shape — not the raw JWT claims — as the source of truth for role checks.
 *
 * `role` / `employeeRole` come from the current database row, NOT the JWT,
 * so role demotion (STAFF -> CUSTOMER, MANAGER -> CASHIER) is enforced
 * immediately on the next request without waiting for the 15-minute JWT TTL.
 */
export interface AuthorizedSession {
  userId: string;
  role: UserRole;
  employeeRole?: EmployeeRole;
  locationId?: string;
  isPosSession: boolean;
  sessionId: string;
}

interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  employeeRole?: EmployeeRole;
  sessionId: string;
}

/**
 * Why this exists:
 *
 * The original `AuthGuard` decoded the JWT and called it done. That means a
 * session that has been logged-out-revoked in `auth_sessions`, or a user who
 * has been demoted from ADMIN to CUSTOMER, still appears fully authorized
 * to the API until the 15-minute JWT expiry. That is exactly how the
 * "logged out as non-admin, reloaded, signed back in as the same user" bug
 * surfaced: the DB had no session, but the JWT was still valid.
 *
 * `SessionValidator.resolve(token)`:
 *   1. Verifies JWT signature + `exp`.
 *   2. Looks up `auth_sessions` by `id = sessionId` AND `userId = sub`,
 *      requiring `revokedAt IS NULL` and `expiresAt > now`.
 *   3. Loads current `user.role` and `user.isActive`; loads
 *      `employeeProfile.role` for STAFF users.
 *   4. Returns the current authoritative shape — JWT claim fields are
 *      discarded after the DB lookup.
 *
 * Any lookup failure returns `null` so callers can respond with 401 and
 * force a re-login.
 */
@Injectable()
export class SessionValidator {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(accessToken: string | undefined): Promise<AuthorizedSession | null> {
    if (!accessToken) return null;

    const claims = verifyJwt<AccessTokenClaims>(accessToken, JWT_SECRET);
    if (!claims?.sub || !claims?.sessionId) return null;

    const now = new Date();

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: {
          include: {
            employeeProfile: { select: { role: true, locationId: true } },
          },
        },
      },
    });

    if (!session || !session.user) return null;
    if (!session.user.isActive) return null;

    const dbRole = session.user.role as UserRole;
    const dbEmployeeRole = session.user.employeeProfile?.role as
      | EmployeeRole
      | undefined;

    return {
      userId: session.userId,
      role: dbRole,
      employeeRole: dbRole === "STAFF" ? dbEmployeeRole : undefined,
      locationId:
        dbRole === "STAFF" ? session.user.employeeProfile?.locationId : undefined,
      isPosSession: session.isPosSession === true,
      sessionId: session.id,
    };
  }
}
