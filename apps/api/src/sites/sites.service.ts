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
  buildPhpVersionOptionsForServer,
  installedPhpVersionsFromStack,
  pickPreferredPhpVersion,
  siteCreateInputSchema,
  siteBackupInputSchema,
  siteRestoreInputSchema,
  siteCloneInputSchema,
  siteRollbackInputSchema,
  siteBackupPolicyPatchSchema,
  DEFAULT_BACKUP_POLICY,
  computeNextBackupRun,
  siteDeleteInputSchema,
  siteUpdateDomainInputSchema,
  siteFtpUserCreateInputSchema,
  siteFtpUserDeleteInputSchema,
  siteManageInputSchema,
  siteMigrateFtpInputSchema,
  siteMigrateSourceProbeSchema,
  siteMigrateDraftFromJobInput,
  type SiteInfoSnapshot,
  defaultSiteWebroot,
  wordOpsDashboardUrl,
  isWordPressSiteType,
} from "@opspanel/contracts";
import type { WordOpsSiteTypeId } from "@opspanel/contracts";

import { AuditService } from "../audit/audit.service";

import { SessionUser } from "../auth/auth.guard";

import { JobsService } from "../jobs/jobs.service";

import { QuotasService } from "../license/quotas.service";

import { PrismaService } from "../prisma/prisma.service";

import { ServersService } from "../servers/servers.service";
import { GoogleDriveService } from "../google-drive/google-drive.service";
import { browseSourceDirectory, testSourceConnection } from "./source-ftp.util";
import { loadEnv } from "@opspanel/config";
import { decryptJson, type EncryptedPayload } from "@opspanel/security";

import {
  formatRemoteCommand,
  parseSiteBackupListOutput,
  parseSiteWpAutologinOutput,
  siteBackupListProbe,
  siteWpAutologinProbe,
} from "@opspanel/wordops";

import { execSshCommand, formatSshError } from "../ssh/ssh-shell.js";

import { checkSiteDns } from "./dns-check.js";



@Injectable()

export class SitesService {

  constructor(

    private readonly prisma: PrismaService,

    private readonly jobs: JobsService,

    private readonly audit: AuditService,

    private readonly quotas: QuotasService,

    private readonly servers: ServersService,

    private readonly drive: GoogleDriveService,

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

        server: { deletedAt: null },

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
      where: {
        id: siteId,
        organizationId: user.organizationId,
        deletedAt: null,
        server: { deletedAt: null },
      },
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

    let ftpUsers: { id: string; username: string; homePath: string; createdAt: Date; hasPassword: boolean }[] = [];
    try {
      const rows = await this.prisma.client.siteFtpUser.findMany({
        where: { siteId },
        select: { id: true, username: true, homePath: true, createdAt: true, passwordEnc: true },
        orderBy: { createdAt: "desc" },
      });
      ftpUsers = rows.map((u) => ({
        id: u.id,
        username: u.username,
        homePath: u.homePath,
        createdAt: u.createdAt,
        hasPassword: Boolean(u.passwordEnc),
      }));
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

  getCreateOptions(user: SessionUser, serverId?: string) {
    const base = {
      siteTypes: WORDOPS_SITE_TYPES,
      multisite: WORDOPS_MULTISITE,
      sslModes: WORDOPS_SSL_MODES,
      extraFlags: WORDOPS_EXTRA_FLAGS,
      updateActions: WORDOPS_SITE_UPDATE_ACTIONS,
      docsUrl: "https://docs.wordops.net/commands/site/",
    };

    if (!serverId) {
      return {
        ...base,
        phpVersions: WORDOPS_PHP_VERSIONS.map((p) => ({ ...p, available: true, installed: false })),
        installedPhpVersions: [] as string[],
        serverStackKnown: false,
      };
    }

    return this.prisma.client.server
      .findFirst({
        where: { id: serverId, organizationId: user.organizationId, deletedAt: null },
        select: { healthSnapshot: true, healthObservedAt: true, name: true },
      })
      .then((server) => {
        if (!server) {
          return {
            ...base,
            phpVersions: WORDOPS_PHP_VERSIONS.map((p) => ({ ...p, available: true, installed: false })),
            installedPhpVersions: [] as string[],
            serverStackKnown: false,
          };
        }

        const health = server.healthSnapshot as {
          stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[];
        } | null;
        const stackComponents = health?.stackComponents ?? [];
        const installedPhpVersions = installedPhpVersionsFromStack(stackComponents);
        const phpVersions = buildPhpVersionOptionsForServer(stackComponents);
        const preferred = pickPreferredPhpVersion("84", stackComponents);

        return {
          ...base,
          phpVersions,
          installedPhpVersions,
          preferredPhpVersion: preferred.phpVersion,
          serverStackKnown: stackComponents.length > 0,
          serverName: server.name,
          healthObservedAt: server.healthObservedAt,
        };
      });
  }

  async getMigrateTargets(user: SessionUser) {
    if (!this.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }

    const sites = await this.prisma.client.site.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        server: { deletedAt: null },
      },
      orderBy: { domain: "asc" },
      include: {
        server: { select: { id: true, name: true, host: true } },
      },
    });

    const canWrite: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator, OrgRole.developer];
    const lastDraftBySite = new Map<string, NonNullable<ReturnType<typeof siteMigrateDraftFromJobInput>>>();
    if (canWrite.includes(user.role)) {
      const lastJobs = await this.prisma.client.job.findMany({
        where: {
          organizationId: user.organizationId,
          operationKey: OperationKeys.SiteMigrateFtp,
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: { inputJson: true },
      });
      for (const job of lastJobs) {
        const input = (job.inputJson ?? null) as Record<string, unknown> | null;
        const siteId = typeof input?.siteId === "string" ? input.siteId : "";
        if (!siteId || lastDraftBySite.has(siteId)) continue;
        const draft = siteMigrateDraftFromJobInput(input);
        if (draft) lastDraftBySite.set(siteId, draft);
      }
    }

    return {
      sites: sites.map((s) => {
        const info = s.infoSnapshot as SiteInfoSnapshot | null;
        const host = s.server.host;
        const isWordPress =
          info?.isWordPress ??
          (s.siteType ? isWordPressSiteType(s.siteType as WordOpsSiteTypeId) : false);
        const webroot = info?.webroot ?? defaultSiteWebroot(s.domain, s.siteType);
        return {
          id: s.id,
          domain: s.domain,
          siteType: s.siteType,
          status: s.status,
          server: s.server,
          webroot,
          isWordPress,
          multisite: info?.multisite ?? "none",
          destDatabase: info?.dbName
            ? {
                host: info.dbHost ?? "localhost",
                name: info.dbName,
                user: info.dbUser ?? "",
                hasPassword: Boolean(info.dbPass),
              }
            : null,
          phpMyAdminUrl: wordOpsDashboardUrl(host, "/db/pma/"),
          adminerUrl: wordOpsDashboardUrl(host, "/db/adminer/"),
          lastDraft: lastDraftBySite.get(s.id) ?? null,
        };
      }),
      help: {
        requirement:
          "O site deve estar criado no WordOps antes de migrar. Para Multisite em subpastas, crie o destino com rede Multisite (subpastas).",
        mysqlMariaDb:
          "Hospedagens usam MySQL; o WordOps usa MariaDB. Se o Remote MySQL bloquear o IP do servidor, o OpsPanel tenta exportar o banco via FTP automaticamente. Se ainda falhar, libere o IP no cPanel ou envie um arquivo .sql.",
        phpMyAdmin:
          "Alternativa fácil: exporte o banco no phpMyAdmin da hospedagem (SQL) e na migração escolha Arquivo .sql.",
        multisite:
          "Multisite em subpastas: crie o site com Multisite → subpastas, migre arquivos+banco e informe a URL antiga da rede. O OpsPanel ajusta DOMAIN_CURRENT_SITE, PATH_CURRENT_SITE e wp_blogs.",
      },
    };
  }



  async create(user: SessionUser, body: unknown, ip?: string) {

    this.assertWrite(user);

    await this.quotas.assertCanCreateSite();

    const parsed = siteCreateInputSchema.safeParse(body);

    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldMsgs = Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
        (msgs ?? []).map((msg) => `${field}: ${msg}`),
      );
      const message = fieldMsgs[0] ?? flat.formErrors[0] ?? "Dados inválidos.";
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message, details: flat },
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

  async migrateFtp(user: SessionUser, body: unknown, ip?: string) {
    this.assertWrite(user);

    const parsed = siteMigrateFtpInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados de migração inválidos.", details: parsed.error.flatten() },
      });
    }

    if (parsed.data.sqlDumpBase64) {
      const approxBytes = Math.ceil((parsed.data.sqlDumpBase64.length * 3) / 4);
      if (approxBytes > 52_428_800) {
        throw new BadRequestException({
          error: { code: "SQL_TOO_LARGE", message: "Arquivo SQL excede 50 MB." },
        });
      }
    }

    const site = await this.prisma.client.site.findFirst({
      where: {
        id: parsed.data.siteId,
        organizationId: user.organizationId,
        deletedAt: null,
        server: { deletedAt: null },
      },
      include: { server: { select: { id: true, host: true } } },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site de destino não encontrado." } });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteMigrateFtp,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.migrate.ftp.requested",
      targetType: "site",
      targetId: site.id,
      result: "success",
      ipAddress: ip,
      metadata: {
        jobId: job.id,
        domain: site.domain,
        sourceHost: parsed.data.sourceHost,
        sourceProtocol: parsed.data.sourceProtocol,
        dbMode: parsed.data.dbMode,
      },
    });

    return { jobId: job.id, status: job.status, siteId: site.id, domain: site.domain };
  }

  async testMigrateSource(user: SessionUser, body: unknown) {
    this.assertWrite(user);
    const parsed = siteMigrateSourceProbeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados FTP inválidos.", details: parsed.error.flatten() },
      });
    }
    const input = parsed.data;
    try {
      return await testSourceConnection(
        {
          protocol: input.sourceProtocol,
          host: input.sourceHost.trim(),
          port: input.sourcePort,
          username: input.sourceUsername.trim(),
          password: input.sourcePassword,
        },
        input.sourcePath ?? "/",
      );
    } catch (err) {
      throw new BadRequestException({
        error: {
          code: "SOURCE_FTP_TEST_FAILED",
          message: err instanceof Error ? err.message : "Falha ao testar conexão FTP.",
        },
      });
    }
  }

  async browseMigrateSource(user: SessionUser, body: unknown) {
    this.assertWrite(user);
    const parsed = siteMigrateSourceProbeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados FTP inválidos.", details: parsed.error.flatten() },
      });
    }
    const input = parsed.data;
    try {
      return await browseSourceDirectory(
        {
          protocol: input.sourceProtocol,
          host: input.sourceHost.trim(),
          port: input.sourcePort,
          username: input.sourceUsername.trim(),
          password: input.sourcePassword,
        },
        input.sourcePath ?? "/",
      );
    } catch (err) {
      throw new BadRequestException({
        error: {
          code: "SOURCE_FTP_BROWSE_FAILED",
          message: err instanceof Error ? err.message : "Falha ao listar pasta FTP.",
        },
      });
    }
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

  async deleteFtpUser(user: SessionUser, siteId: string, ftpUserId: string, ip?: string) {
    this.assertWrite(user);
    await this.findSiteOrThrow(user, siteId);

    const ftpUser = await this.prisma.client.siteFtpUser.findFirst({
      where: { id: ftpUserId, siteId },
    });
    if (!ftpUser) {
      throw new NotFoundException({ error: { code: "FTP_USER_NOT_FOUND", message: "Usuário FTP não encontrado." } });
    }

    const parsed = siteFtpUserDeleteInputSchema.safeParse({
      siteId,
      ftpUserId,
      username: ftpUser.username,
    });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() },
      });
    }

    const site = await this.findSiteOrThrow(user, siteId);
    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteFtpUserDelete,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.ftp.user.delete.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, username: ftpUser.username },
    });

    return { jobId: job.id, status: job.status };
  }

  async getFtpUserPassword(user: SessionUser, siteId: string, ftpUserId: string) {
    this.assertWrite(user);
    await this.findSiteOrThrow(user, siteId);

    const ftpUser = await this.prisma.client.siteFtpUser.findFirst({
      where: { id: ftpUserId, siteId },
      select: { passwordEnc: true, username: true },
    });
    if (!ftpUser?.passwordEnc) {
      throw new NotFoundException({
        error: { code: "FTP_PASSWORD_UNAVAILABLE", message: "Senha não disponível para este usuário." },
      });
    }

    const env = loadEnv();
    if (!env.CREDENTIALS_ENCRYPTION_KEY) {
      throw new BadRequestException({
        error: { code: "ENCRYPTION_NOT_CONFIGURED", message: "Chave de criptografia não configurada." },
      });
    }

    const decoded = decryptJson<{ password: string }>(
      ftpUser.passwordEnc as unknown as EncryptedPayload,
      env.CREDENTIALS_ENCRYPTION_KEY,
    );

    return { username: ftpUser.username, password: decoded.password };
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

  async listBackups(user: SessionUser, siteId: string) {
    const site = await this.findSiteOrThrow(user, siteId);
    const target = await this.servers.getSshTarget(user, site.serverId);
    const command = formatRemoteCommand(siteBackupListProbe(site.domain));

    let result: { stdout: string; stderr: string; code: number };
    try {
      result = await execSshCommand(target, command, { timeoutMs: 60_000 });
    } catch (err) {
      throw new BadRequestException({
        error: { code: "SSH_FAILED", message: formatSshError(err, target) },
      });
    }

    const backups = parseSiteBackupListOutput(`${result.stdout}\n${result.stderr}`).map((entry) => ({
      ...entry,
      hasFiles: entry.hasFiles,
      integrity: entry.integrity,
      location: "local" as "local" | "drive" | "both",
    }));

    const driveBackups = await this.drive.listSiteBackups(user.id, site.domain);
    const byTs = new Map<string, (typeof backups)[number] & { driveFolderId?: string }>();
    for (const local of backups) {
      byTs.set(local.timestamp, local);
    }
    for (const remote of driveBackups) {
      const existing = byTs.get(remote.timestamp);
      if (existing) {
        byTs.set(remote.timestamp, {
          ...existing,
          hasDatabase: existing.hasDatabase || remote.hasDatabase,
          hasFiles: existing.hasFiles || remote.hasFiles,
          location: "both",
          driveFolderId: remote.folderId,
        });
      } else {
        byTs.set(remote.timestamp, {
          path: "",
          timestamp: remote.timestamp,
          hasDatabase: remote.hasDatabase,
          hasFiles: remote.hasFiles,
          filesSizeBytes: remote.filesSizeBytes,
          integrity: "unknown" as const,
          location: "drive",
          driveFolderId: remote.folderId,
        });
      }
    }

    const merged = [...byTs.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const policy = await this.getBackupPolicy(user, siteId);
    return { domain: site.domain, backups: merged, policy };
  }

  async getBackupPolicy(user: SessionUser, siteId: string) {
    const site = await this.findSiteOrThrow(user, siteId);
    const row = await this.prisma.client.siteBackupPolicy.findUnique({ where: { siteId: site.id } });
    const drive = await this.drive.getStatus(user.id);
    if (!row) {
      return { ...DEFAULT_BACKUP_POLICY, lastRunAt: null, nextRunAt: null, driveConnected: drive.connected };
    }
    return {
      contents: row.contents,
      keepLocal: row.keepLocal,
      schedule: row.schedule,
      scheduleHour: row.scheduleHour,
      uploadToDrive: row.uploadToDrive,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      driveConnected: drive.connected,
    };
  }

  async updateBackupPolicy(user: SessionUser, siteId: string, body: unknown) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);
    const parsed = siteBackupPolicyPatchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Política de backup inválida." },
      });
    }
    const current = await this.prisma.client.siteBackupPolicy.findUnique({ where: { siteId: site.id } });
    const next = {
      contents: parsed.data.contents ?? current?.contents ?? DEFAULT_BACKUP_POLICY.contents,
      keepLocal: parsed.data.keepLocal ?? current?.keepLocal ?? DEFAULT_BACKUP_POLICY.keepLocal,
      schedule: parsed.data.schedule ?? current?.schedule ?? DEFAULT_BACKUP_POLICY.schedule,
      scheduleHour: parsed.data.scheduleHour ?? current?.scheduleHour ?? DEFAULT_BACKUP_POLICY.scheduleHour,
      uploadToDrive: parsed.data.uploadToDrive ?? current?.uploadToDrive ?? DEFAULT_BACKUP_POLICY.uploadToDrive,
    };
    const nextRunAt = computeNextBackupRun(next.schedule, next.scheduleHour);
    await this.prisma.client.siteBackupPolicy.upsert({
      where: { siteId: site.id },
      create: { siteId: site.id, ...next, nextRunAt },
      update: { ...next, nextRunAt },
    });
    return this.getBackupPolicy(user, siteId);
  }

  async restore(user: SessionUser, siteId: string, body: unknown, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteRestoreInputSchema.safeParse({ ...(body as object), siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Backup inválido.", details: parsed.error.flatten() },
      });
    }

    const expectedPrefix = `/var/backups/opspanel/${site.domain.toLowerCase()}/`;
    if (parsed.data.backupPath && !parsed.data.backupPath.startsWith(expectedPrefix)) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Este backup não pertence ao site." },
      });
    }
    if (!parsed.data.backupPath && !parsed.data.driveFolderId) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Informe o backup a restaurar." },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteRestore,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.restore.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: {
        jobId: job.id,
        domain: site.domain,
        backupPath: parsed.data.backupPath,
        mode: parsed.data.mode ?? "full",
      },
    });

    return { jobId: job.id, status: job.status };
  }

  async clone(user: SessionUser, siteId: string, body: unknown, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteCloneInputSchema.safeParse({ ...(body as object), siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados de clone inválidos.", details: parsed.error.flatten() },
      });
    }

    const targetDomain = parsed.data.targetDomain.toLowerCase();
    if (targetDomain === site.domain.toLowerCase()) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "O domínio de destino deve ser diferente do atual." },
      });
    }

    const siteType = (site.siteType ?? "").toLowerCase();
    if (siteType === "proxy" || siteType === "alias") {
      throw new BadRequestException({
        error: {
          code: "UNSUPPORTED_SITE_TYPE",
          message: "Clone de sites proxy/alias não é suportado neste MVP.",
        },
      });
    }

    const conflict = await this.prisma.client.site.findFirst({
      where: {
        organizationId: user.organizationId,
        domain: targetDomain,
        deletedAt: null,
      },
    });
    if (conflict) {
      throw new BadRequestException({
        error: { code: "DOMAIN_CONFLICT", message: "Este domínio já está cadastrado no painel." },
      });
    }

    await this.quotas.assertCanCreateSite();

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteClone,
      input: { ...parsed.data, targetDomain },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.clone.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: {
        jobId: job.id,
        sourceDomain: site.domain,
        targetDomain,
        asStaging: parsed.data.asStaging ?? true,
      },
    });

    return { jobId: job.id, status: job.status };
  }

  /**
   * Rollback: atalho sobre restore full do backup mais recente (ou caminho informado).
   * Cria job SiteRollback; o worker resolve o snapshot se necessário.
   */
  async rollback(user: SessionUser, siteId: string, body: unknown, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);

    const parsed = siteRollbackInputSchema.safeParse({ ...(body as object), siteId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Rollback inválido.", details: parsed.error.flatten() },
      });
    }

    let backupPath = parsed.data.backupPath;
    if (backupPath) {
      const expectedPrefix = `/var/backups/opspanel/${site.domain.toLowerCase()}/`;
      if (!backupPath.startsWith(expectedPrefix)) {
        throw new BadRequestException({
          error: { code: "VALIDATION_ERROR", message: "Este backup não pertence ao site." },
        });
      }
    } else {
      const listed = await this.listBackups(user, siteId);
      const local = listed.backups.find(
        (b) => b.path && b.path.startsWith(`/var/backups/opspanel/${site.domain.toLowerCase()}/`),
      );
      if (!local?.path) {
        throw new BadRequestException({
          error: {
            code: "NO_BACKUP",
            message: "Nenhum backup local encontrado. Crie um backup antes do rollback.",
          },
        });
      }
      backupPath = local.path;
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteRollback,
      input: { siteId, backupPath },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.rollback.requested",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, domain: site.domain, backupPath },
    });

    return { jobId: job.id, status: job.status, backupPath };
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

  async checkDns(user: SessionUser, siteId: string) {
    if (!this.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }

    const site = await this.prisma.client.site.findFirst({
      where: {
        id: siteId,
        organizationId: user.organizationId,
        deletedAt: null,
        server: { deletedAt: null },
      },
      include: {
        server: { select: { host: true } },
      },
    });

    if (!site) {
      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });
    }

    return checkSiteDns(site.domain, site.server.host);
  }

  async wpAutologin(user: SessionUser, siteId: string, ip?: string) {
    this.assertWrite(user);
    const site = await this.findSiteOrThrow(user, siteId);
    const info = (site.infoSnapshot ?? null) as SiteInfoSnapshot | null;
    const isWp =
      info?.isWordPress === true ||
      (site.siteType != null && /^wp/i.test(site.siteType));

    if (!isWp) {
      throw new BadRequestException({
        error: { code: "NOT_WORDPRESS", message: "Este site não é WordPress." },
      });
    }

    const target = await this.servers.getSshTarget(user, site.serverId);
    const webrootHint = info?.webroot ?? defaultSiteWebroot(site.domain, site.siteType);
    const command = formatRemoteCommand(siteWpAutologinProbe(site.domain, undefined, webrootHint));

    let result: { stdout: string; stderr: string; code: number };
    try {
      result = await execSshCommand(target, command, { timeoutMs: 90_000 });
    } catch (err) {
      throw new BadRequestException({
        error: {
          code: "SSH_FAILED",
          message: formatSshError(err, target),
        },
      });
    }

    const parsed = parseSiteWpAutologinOutput(`${result.stdout}\n${result.stderr}`);
    if (!parsed.url) {
      const messages: Record<string, string> = {
        no_wp: "WordPress não encontrado no webroot do site.",
        no_admin: "Nenhum usuário administrador encontrado no WordPress.",
        failed: "Não foi possível gerar link de acesso automático.",
        unknown: "Falha ao gerar link de acesso ao WordPress.",
      };
      throw new BadRequestException({
        error: {
          code: "WP_LOGIN_FAILED",
          message: messages[parsed.error ?? "unknown"] ?? messages.unknown,
        },
      });
    }

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.wp.autologin",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { domain: site.domain },
    });

    return { url: parsed.url };
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


