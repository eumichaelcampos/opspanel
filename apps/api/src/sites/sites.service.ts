import {

  BadRequestException,

  ForbiddenException,

  Injectable,

  NotFoundException,

} from "@nestjs/common";

import { OrgRole } from "@opspanel/database";

import {
  OperationKeys,
  WORDOPS_EXTRA_FLAGS,
  WORDOPS_MULTISITE,
  WORDOPS_PHP_VERSIONS,
  WORDOPS_SITE_TYPES,
  WORDOPS_SITE_UPDATE_ACTIONS,
  WORDOPS_SSL_MODES,
  siteCreateInputSchema,
  siteBackupInputSchema,
  siteDeleteInputSchema,
  siteUpdateDomainInputSchema,
  siteFtpUserCreateInputSchema,
  siteManageInputSchema,
  type SiteInfoSnapshot,
} from "@opspanel/contracts";

import { AuditService } from "../audit/audit.service";

import { SessionUser } from "../auth/auth.guard";

import { JobsService } from "../jobs/jobs.service";

import { PrismaService } from "../prisma/prisma.service";



@Injectable()

export class SitesService {

  constructor(

    private readonly prisma: PrismaService,

    private readonly jobs: JobsService,

    private readonly audit: AuditService,

  ) {}



  canRead(user: SessionUser) {

    const allowed: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator, OrgRole.developer, OrgRole.viewer];

    return allowed.includes(user.role);

  }



  assertWrite(user: SessionUser) {
    const allowed: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator, OrgRole.developer];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }



  async list(user: SessionUser, params?: { serverId?: string }) {

    const sites = await this.prisma.client.site.findMany({

      where: {

        organizationId: user.organizationId,

        deletedAt: null,

        ...(params?.serverId ? { serverId: params.serverId } : {}),

      },

      orderBy: { domain: "asc" },

      include: {

        server: { select: { id: true, name: true, host: true } },

      },

    });

    return sites.map((s) => ({

      id: s.id,

      domain: s.domain,

      status: s.status,

      siteType: s.siteType,

      phpVersion: s.phpVersion,

      cacheBackend: s.cacheBackend,

      isEnabled: s.isEnabled,

      lastObservedAt: s.lastObservedAt,

      server: s.server,

    }));

  }



  async get(user: SessionUser, siteId: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            host: true,
            port: true,
            healthSnapshot: true,
            healthObservedAt: true,
          },
        },
      },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });
    }

    let ftpUsers: { id: string; username: string; homePath: string; createdAt: Date }[] = [];
    try {
      const client = this.prisma.client as { siteFtpUser?: { findMany: (args: unknown) => Promise<typeof ftpUsers> } };
      if (client.siteFtpUser) {
        ftpUsers = await client.siteFtpUser.findMany({
          where: { siteId },
          select: { id: true, username: true, homePath: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
      }
    } catch {
      ftpUsers = [];
    }

    const health = site.server.healthSnapshot as {
      stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[];
    } | null;

    return {
      id: site.id,
      domain: site.domain,
      status: site.status,
      siteType: site.siteType,
      phpVersion: site.phpVersion,
      cacheBackend: site.cacheBackend,
      isEnabled: site.isEnabled,
      infoSnapshot: site.infoSnapshot as SiteInfoSnapshot | null,
      lastObservedAt: site.lastObservedAt,
      server: {
        id: site.server.id,
        name: site.server.name,
        host: site.server.host,
        port: site.server.port,
        stackComponents: health?.stackComponents ?? [],
        healthObservedAt: site.server.healthObservedAt,
      },
      ftpUsers,
    };
  }

  getCreateOptions() {
    return {
      siteTypes: WORDOPS_SITE_TYPES,
      phpVersions: WORDOPS_PHP_VERSIONS,
      multisite: WORDOPS_MULTISITE,
      sslModes: WORDOPS_SSL_MODES,
      extraFlags: WORDOPS_EXTRA_FLAGS,
      updateActions: WORDOPS_SITE_UPDATE_ACTIONS,
      docsUrl: "https://docs.wordops.net/commands/site/",
    };
  }



  async create(user: SessionUser, body: unknown, ip?: string) {

    this.assertWrite(user);

    const parsed = siteCreateInputSchema.safeParse(body);

    if (!parsed.success) {

      throw new BadRequestException({

        error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() },

      });

    }



    const server = await this.prisma.client.server.findFirst({

      where: { id: parsed.data.serverId, organizationId: user.organizationId, deletedAt: null },

    });

    if (!server) {

      throw new NotFoundException({ error: { code: "SERVER_NOT_FOUND", message: "Servidor não encontrado." } });

    }



    const job = await this.jobs.createOperationJob({

      organizationId: user.organizationId,

      requestedById: user.id,

      serverId: parsed.data.serverId,

      operationKey: OperationKeys.SiteCreate,

      input: parsed.data,

    });



    await this.audit.log({

      organizationId: user.organizationId,

      actorUserId: user.id,

      action: "site.create.requested",

      targetType: "server",

      targetId: parsed.data.serverId,

      result: "success",

      ipAddress: ip,

      metadata: { jobId: job.id, domain: parsed.data.domain, siteType: parsed.data.siteType },

    });



    return { jobId: job.id, status: job.status };

  }



  async refreshInfo(user: SessionUser, siteId: string, ip?: string) {

    this.assertWrite(user);

    const site = await this.findSiteOrThrow(user, siteId);



    const job = await this.jobs.createOperationJob({

      organizationId: user.organizationId,

      requestedById: user.id,

      serverId: site.serverId,

      operationKey: OperationKeys.SiteInfo,

      input: { siteId },

    });



    await this.audit.log({

      organizationId: user.organizationId,

      actorUserId: user.id,

      action: "site.info.requested",

      targetType: "site",

      targetId: siteId,

      result: "success",

      ipAddress: ip,

      metadata: { jobId: job.id },

    });



    return { jobId: job.id, status: job.status };

  }



  async manage(user: SessionUser, siteId: string, body: unknown, ip?: string) {

    this.assertWrite(user);

    await this.findSiteOrThrow(user, siteId);



    const parsed = siteManageInputSchema.safeParse({ ...(body as object), siteId });

    if (!parsed.success) {

      throw new BadRequestException({

        error: { code: "VALIDATION_ERROR", message: "Ação inválida.", details: parsed.error.flatten() },

      });

    }



    const site = await this.findSiteOrThrow(user, siteId);

    const job = await this.jobs.createOperationJob({

      organizationId: user.organizationId,

      requestedById: user.id,

      serverId: site.serverId,

      operationKey: OperationKeys.SiteManage,

      input: parsed.data,

    });



    await this.audit.log({

      organizationId: user.organizationId,

      actorUserId: user.id,

      action: `site.manage.${parsed.data.action}.requested`,

      targetType: "site",

      targetId: siteId,

      result: "success",

      ipAddress: ip,

      metadata: { jobId: job.id, action: parsed.data.action },

    });



    return { jobId: job.id, status: job.status };

  }



  async createFtpUser(user: SessionUser, siteId: string, body: unknown, ip?: string) {

    this.assertWrite(user);

    await this.findSiteOrThrow(user, siteId);



    const parsed = siteFtpUserCreateInputSchema.safeParse({ ...(body as object), siteId });

    if (!parsed.success) {

      throw new BadRequestException({

        error: { code: "VALIDATION_ERROR", message: "Dados FTP inválidos.", details: parsed.error.flatten() },

      });

    }



    const site = await this.findSiteOrThrow(user, siteId);

    const job = await this.jobs.createOperationJob({

      organizationId: user.organizationId,

      requestedById: user.id,

      serverId: site.serverId,

      operationKey: OperationKeys.SiteFtpUserCreate,

      input: parsed.data,

    });



    await this.audit.log({

      organizationId: user.organizationId,

      actorUserId: user.id,

      action: "site.ftp.user.create.requested",

      targetType: "site",

      targetId: siteId,

      result: "success",

      ipAddress: ip,

      metadata: { jobId: job.id, username: parsed.data.username },

    });



    return { jobId: job.id, status: job.status };

  }

  async backup(user: SessionUser, siteId: string, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteBackupInputSchema.safeParse({ siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Payload inválido.", details: parsed.error.flatten() },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteBackup,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.backup.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, domain: site.domain },
    });

    return { jobId: job.id, status: job.status };
  }

  async deleteSite(user: SessionUser, siteId: string, body: unknown, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteDeleteInputSchema.safeParse({ ...(body as object), siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Confirmação de exclusão inválida.", details: parsed.error.flatten() },
      });
    }

    if (parsed.data.confirmDomain.toLowerCase() !== site.domain.toLowerCase()) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Digite o domínio exato para confirmar a exclusão." },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteDelete,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.delete.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, domain: site.domain },
    });

    return { jobId: job.id, status: job.status };
  }

  async updateDomain(user: SessionUser, siteId: string, body: unknown, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteUpdateDomainInputSchema.safeParse({ ...(body as object), siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Novo domínio inválido.", details: parsed.error.flatten() },
      });
    }

    if (parsed.data.newDomain.toLowerCase() === site.domain.toLowerCase()) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "O novo domínio deve ser diferente do atual." },
      });
    }

    const conflict = await this.prisma.client.site.findFirst({
      where: {
        organizationId: user.organizationId,
        domain: parsed.data.newDomain.toLowerCase(),
        deletedAt: null,
        id: { not: siteId },
      },
    });
    if (conflict) {
      throw new BadRequestException({
        error: { code: "DOMAIN_CONFLICT", message: "Este domínio já está cadastrado no painel." },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteUpdateDomain,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.update.domain.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, from: site.domain, to: parsed.data.newDomain },
    });

    return { jobId: job.id, status: job.status };
  }



  private async findSiteOrThrow(user: SessionUser, siteId: string) {

    const site = await this.prisma.client.site.findFirst({

      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },

    });

    if (!site) {

      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });

    }

    return site;

  }

}


