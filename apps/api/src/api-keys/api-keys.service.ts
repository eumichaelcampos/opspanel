import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import { AuditService } from "../audit/audit.service";
import { SessionUser } from "../auth/auth.service";
import { generateApiKey } from "../auth/api-key.guard";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(user: SessionUser) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }

  async list(user: SessionUser) {
    this.assertAdmin(user);
    const keys = await this.prisma.client.apiKey.findMany({
      where: { organizationId: user.organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true },
    });
    return { keys };
  }

  async create(user: SessionUser, name: string, ip?: string) {
    this.assertAdmin(user);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new ForbiddenException({ error: { code: "VALIDATION_ERROR", message: "Nome da chave inválido." } });
    }

    const { key, prefix, hash } = generateApiKey();
    const record = await this.prisma.client.apiKey.create({
      data: {
        organizationId: user.organizationId,
        name: trimmed,
        keyHash: hash,
        keyPrefix: prefix,
        createdById: user.id,
      },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "api_key.create",
      targetType: "api_key",
      targetId: record.id,
      result: "success",
      ipAddress: ip,
      metadata: { name: trimmed, prefix },
    });

    return { id: record.id, name: record.name, keyPrefix: record.keyPrefix, key, createdAt: record.createdAt };
  }

  async revoke(user: SessionUser, keyId: string, ip?: string) {
    this.assertAdmin(user);
    const record = await this.prisma.client.apiKey.findFirst({
      where: { id: keyId, organizationId: user.organizationId, revokedAt: null },
    });
    if (!record) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Chave não encontrada." } });
    }

    await this.prisma.client.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "api_key.revoke",
      targetType: "api_key",
      targetId: keyId,
      result: "success",
      ipAddress: ip,
    });

    return { ok: true };
  }
}
