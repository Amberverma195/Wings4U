import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

interface WriteAuditParams {
  locationId?: string | null;
  actorUserId?: string | null;
  actorRoleSnapshot: string;
  actionKey: string;
  entityType: string;
  entityId?: string | null;
  reasonText?: string | null;
  payloadJson?: Record<string, any>;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write an audit log entry for a critical action (PRD §26.5)
   */
  async logAction(params: WriteAuditParams): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        locationId: params.locationId,
        actorUserId: params.actorUserId,
        actorRoleSnapshot: params.actorRoleSnapshot,
        actionKey: params.actionKey,
        entityType: params.entityType,
        entityId: params.entityId,
        reasonText: params.reasonText,
        payloadJson: params.payloadJson ?? {},
      },
    });
  }

  /**
   * Internal tx-aware helper if executing inside a Prisma transaction
   */
  async logActionTx(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    params: WriteAuditParams
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        locationId: params.locationId,
        actorUserId: params.actorUserId,
        actorRoleSnapshot: params.actorRoleSnapshot,
        actionKey: params.actionKey,
        entityType: params.entityType,
        entityId: params.entityId,
        reasonText: params.reasonText,
        payloadJson: params.payloadJson ?? {},
      },
    });
  }

  async getRecentLogs(locationId: string, limit = 50) {
    return this.prisma.adminAuditLog.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actor: {
          select: { displayName: true, firstName: true, lastName: true },
        },
      },
    });
  }
}
