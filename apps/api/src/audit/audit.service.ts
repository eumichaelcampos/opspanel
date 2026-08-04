import { Injectable } from "@nestjs/common";
import { Prisma } from "@opspanel/database";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    organizationId: string;
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    result: "success" | "failure";
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.client.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        result: params.result,
        ipAddress: params.ipAddress,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
