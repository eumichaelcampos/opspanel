import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CredentialType, OrgRole } from "@opspanel/database";
import { OperationKeys, onboardingStepPatchSchema, resolveOnboardingSteps, onboardingProgress, serverNeedsOnboarding, isExistingWordOpsServer, serverRebootInputSchema, serverStackInputSchema, serverWordOpsDashboardRecoverInputSchema, WORDOPS_DASHBOARD_TOOLS, WORDOPS_SERVER_MACHINE_CONTROLS, WORDOPS_SERVER_QUICK_ACTIONS, WORDOPS_STACK_ACTIONS, WORDOPS_STACK_COMPONENTS, WORDOPS_STACK_GROUPS, type OnboardingSnapshot } from "@opspanel/contracts";
import { decryptJson, encryptJson, EncryptedPayload } from "@opspanel/security";
import { loadEnv } from "@opspanel/config";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { SessionUser } from "../auth/auth.guard";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";

const createServerSchema = z.object({
  name: z.string().min(2).max(120),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  tags: z.array(z.string()).optional(),
  credential: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ssh_private_key"),
      username: z.string().min(1).max(64),
      privateKey: z.string().min(32),
    }),
    z.object({
      type: z.literal("ssh_password"),
      username: z.string().min(1).max(64),
      password: z.string().min(1),
    }),
  ]),
});

export type ServerCredentialPayload =
  | { type: "ssh_private_key"; username: string; privateKey: string }
  | { type: "ssh_password"; username: string; password: string };

const updateServerConnectionSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

@Injectable()
export class ServersService {
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {
    this.encryptionKey = loadEnv().CREDENTIALS_ENCRYPTION_KEY;
  }

  assertRole(user: SessionUser, allowed: OrgRole[]) {
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "Permissão insuficiente." },
      });
    }
  }

  async list(user: SessionUser) {
    const servers = await this.prisma.client.server.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { credential: { select: { type: true, username: true } } },
    });
    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      status: s.status,
      tags: s.tags,
      osRelease: s.osRelease,
      wordopsVersion: s.wordopsVersion,
      lastConnectedAt: s.lastConnectedAt,
      credential: s.credential
        ? { type: s.credential.type, username: s.credential.username, configured: true }
        : { configured: false },
    }));
  }

  async create(user: SessionUser, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    const parsed = createServerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados do servidor inválidos.", details: parsed.error.flatten() },
      });
    }

    const { credential, ...data } = parsed.data;
    const encrypted = encryptJson(credential, this.encryptionKey);
    const credType =
      credential.type === "ssh_private_key" ? CredentialType.ssh_private_key : CredentialType.ssh_password;

    const server = await this.prisma.client.server.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        host: data.host,
        port: data.port,
        tags: data.tags ?? [],
        credential: {
          create: {
            type: credType,
            username: credential.username,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
          },
        },
      },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.create",
      targetType: "server",
      targetId: server.id,
      result: "success",
      ipAddress: ip,
      metadata: { host: server.host, port: server.port },
    });

    return { id: server.id, name: server.name, host: server.host, port: server.port, status: server.status };
  }

  async get(user: SessionUser, serverId: string): Promise<{
    id: string;
    name: string;
    host: string;
    port: number;
    status: string;
    tags: string[];
    osRelease: string | null;
    wordopsVersion: string | null;
    lastConnectedAt: Date | null;
    lastSyncedAt: Date | null;
    wordopsDashboard: unknown;
    healthSnapshot: unknown;
    healthObservedAt: Date | null;
    metricsSnapshot: unknown;
    metricsObservedAt: Date | null;
    onboardingSnapshot: unknown;
    onboardingCompletedAt: Date | null;
    siteCount: number;
    credentialConfigured: boolean;
    onboarding: {
      needsOnboarding: boolean;
      progress: number;
      detectedExisting: boolean;
      steps: ReturnType<typeof resolveOnboardingSteps>;
    };
  }> {
    const server = await this.findServerOrThrow(user, serverId);
    const siteCount = await this.prisma.client.site.count({
      where: { serverId, organizationId: user.organizationId, deletedAt: null },
    });
    const extended = server as typeof server & {
      healthSnapshot?: unknown;
      healthObservedAt?: Date | null;
      metricsSnapshot?: unknown;
      metricsObservedAt?: Date | null;
      onboardingSnapshot?: unknown;
      onboardingCompletedAt?: Date | null;
    };
    const health = extended.healthSnapshot as { stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[] } | null;
    const onboardingCtx = {
      credentialConfigured: Boolean(server.credential),
      status: server.status,
      lastConnectedAt: server.lastConnectedAt?.toISOString() ?? null,
      wordopsVersion: server.wordopsVersion,
      lastSyncedAt: server.lastSyncedAt?.toISOString() ?? null,
      siteCount,
      stackComponents: health?.stackComponents,
      onboardingSnapshot: extended.onboardingSnapshot as OnboardingSnapshot | null,
      onboardingCompletedAt: extended.onboardingCompletedAt?.toISOString() ?? null,
    };
    const steps = resolveOnboardingSteps(onboardingCtx);
    const needsOnboarding = serverNeedsOnboarding(onboardingCtx);
    const detectedExisting = isExistingWordOpsServer(onboardingCtx);

    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      status: server.status,
      tags: server.tags,
      osRelease: server.osRelease,
      wordopsVersion: server.wordopsVersion,
      lastConnectedAt: server.lastConnectedAt,
      lastSyncedAt: server.lastSyncedAt,
      wordopsDashboard: server.wordopsDashboard ?? null,
      healthSnapshot: extended.healthSnapshot ?? null,
      healthObservedAt: extended.healthObservedAt ?? null,
      metricsSnapshot: extended.metricsSnapshot ?? null,
      metricsObservedAt: extended.metricsObservedAt ?? null,
      onboardingSnapshot: extended.onboardingSnapshot ?? null,
      onboardingCompletedAt: extended.onboardingCompletedAt ?? null,
      siteCount,
      credentialConfigured: Boolean(server.credential),
      onboarding: {
        needsOnboarding,
        progress: onboardingProgress(steps),
        detectedExisting,
        steps,
      },
    };
  }

  getOperationsOptions() {
    return {
      stackGroups: WORDOPS_STACK_GROUPS,
      stackComponents: WORDOPS_STACK_COMPONENTS,
      stackActions: WORDOPS_STACK_ACTIONS,
      quickActions: WORDOPS_SERVER_QUICK_ACTIONS,
      machineControls: WORDOPS_SERVER_MACHINE_CONTROLS,
      dashboardTools: WORDOPS_DASHBOARD_TOOLS,
      docsUrl: "https://docs.wordops.net/commands/stack/",
      netdataDocs: "https://github.com/WordOps/wordops-dashboard",
    };
  }

  async collectMetrics(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerMetricsCollect,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.metrics.collect.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async collectHealth(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerHealthCollect,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.health.collect.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async stackAction(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const parsed = serverStackInputSchema.safeParse({ ...(body as object), serverId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Ação de stack inválida.", details: parsed.error.flatten() },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerStackAction,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: `server.stack.${parsed.data.action}.requested`,
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, components: parsed.data.components },
    });

    return { jobId: job.id, status: job.status };
  }

  async runMaintenance(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerMaintenanceRun,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.maintenance.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async runSystemUpdate(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerSystemUpdate,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.system_update.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async testConnection(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerConnectionTest,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.test_connection.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async syncInventory(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerSyncInventory,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.inventory.sync.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async installWordOps(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);
    const adminEmail = typeof body === "object" && body && "adminEmail" in body ? (body as { adminEmail?: string }).adminEmail : undefined;

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerWordOpsInstall,
      input: { serverId, adminEmail },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.wordops.install.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async recoverWordOpsDashboard(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const parsed = serverWordOpsDashboardRecoverInputSchema.safeParse({
      ...(typeof body === "object" && body ? body : {}),
      serverId,
    });
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "Parâmetros de recuperação inválidos.",
          details: parsed.error.flatten(),
        },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerWordOpsDashboardRecover,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.wordops.dashboard.recover.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, mode: parsed.data.mode },
    });

    return { jobId: job.id, status: job.status };
  }

  async migrateStack(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);
    const target =
      typeof body === "object" && body && "target" in body && (body as { target?: string }).target === "mariadb"
        ? "mariadb"
        : "mariadb";

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerStackMigrate,
      input: { serverId, target },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.stack.migrate.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, target },
    });

    return { jobId: job.id, status: job.status };
  }

  async configureUfw(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    const server = await this.findServerOrThrow(user, serverId);
    const extraPorts =
      typeof body === "object" && body && Array.isArray((body as { ports?: number[] }).ports)
        ? (body as { ports: number[] }).ports
        : undefined;
    const ports = [...new Set([server.port, 22, 80, 443, 22222, ...(extraPorts ?? [])])];

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerUfwConfigure,
      input: { serverId, ports },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.ufw.configure.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async updateConnection(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);
    const parsed = updateServerConnectionSchema.safeParse(body);
    if (!parsed.success || (!parsed.data.host && parsed.data.port == null)) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Informe host e/ou porta SSH para atualizar." },
      });
    }

    const server = await this.prisma.client.server.update({
      where: { id: serverId },
      data: {
        ...(parsed.data.host ? { host: parsed.data.host } : {}),
        ...(parsed.data.port != null ? { port: parsed.data.port } : {}),
      },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.connection.update",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { host: server.host, port: server.port },
    });

    return { id: server.id, host: server.host, port: server.port };
  }

  async patchOnboarding(user: SessionUser, serverId: string, body: unknown) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    const server = await this.findServerOrThrow(user, serverId);
    const parsed = onboardingStepPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Payload de onboarding inválido.", details: parsed.error.flatten() },
      });
    }

    const prev = (server.onboardingSnapshot as OnboardingSnapshot | null) ?? {};
    const completed = new Set(prev.completedSteps ?? []);
    for (const id of parsed.data.completedSteps ?? []) {
      completed.add(id as NonNullable<OnboardingSnapshot["completedSteps"]>[number]);
    }
    const skipped = new Set(prev.skippedSteps ?? []);
    for (const id of parsed.data.skippedSteps ?? []) {
      skipped.add(id as NonNullable<OnboardingSnapshot["skippedSteps"]>[number]);
    }

    const next: OnboardingSnapshot = {
      ...prev,
      completedSteps: [...completed],
      skippedSteps: [...skipped],
      ...(parsed.data.stepOrder ? { stepOrder: parsed.data.stepOrder as OnboardingSnapshot["stepOrder"] } : {}),
    };

    await this.prisma.client.server.update({
      where: { id: serverId },
      data: { onboardingSnapshot: next as object },
    });

    return { ok: true, onboardingSnapshot: next };
  }

  async remove(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin]);
    const server = await this.findServerOrThrow(user, serverId);

    await this.prisma.client.server.update({
      where: { id: serverId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.delete",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { name: server.name, host: server.host },
    });

    return { ok: true };
  }

  async reboot(user: SessionUser, serverId: string, body: unknown, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin]);
    const parsed = serverRebootInputSchema.safeParse({ ...(body as object), serverId });
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Confirmação de reinício inválida.", details: parsed.error.flatten() },
      });
    }
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerReboot,
      input: parsed.data,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.reboot.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async restartStack(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    await this.findServerOrThrow(user, serverId);

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId,
      operationKey: OperationKeys.ServerStackRestart,
      input: { serverId },
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.stack.restart.requested",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id },
    });

    return { jobId: job.id, status: job.status };
  }

  async getSshTarget(user: SessionUser, serverId: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    const server = await this.findServerOrThrow(user, serverId);
    if (!server.credential) {
      throw new NotFoundException({
        error: { code: "CREDENTIAL_NOT_FOUND", message: "Credencial SSH não configurada." },
      });
    }
    const cred = await this.getDecryptedCredential(serverId, user.organizationId);
    return {
      host: server.host,
      port: server.port,
      username: cred.username,
      privateKey: cred.type === "ssh_private_key" ? cred.privateKey : undefined,
      password: cred.type === "ssh_password" ? cred.password : undefined,
    };
  }

  async getCredential(user: SessionUser, serverId: string, ip?: string) {
    this.assertRole(user, [OrgRole.owner, OrgRole.admin, OrgRole.operator]);
    const server = await this.findServerOrThrow(user, serverId);
    if (!server.credential) {
      throw new NotFoundException({
        error: { code: "CREDENTIAL_NOT_FOUND", message: "Credencial SSH não configurada." },
      });
    }

    const decrypted = await this.getDecryptedCredential(serverId, user.organizationId);

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.credential.view",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: ip,
    });

    return {
      host: server.host,
      port: server.port,
      username: decrypted.username,
      type: decrypted.type,
      password: decrypted.type === "ssh_password" ? decrypted.password : undefined,
      privateKey: decrypted.type === "ssh_private_key" ? decrypted.privateKey : undefined,
    };
  }

  async getDecryptedCredential(serverId: string, organizationId: string): Promise<ServerCredentialPayload> {
    const server = await this.prisma.client.server.findFirst({
      where: { id: serverId, organizationId, deletedAt: null },
      include: { credential: true },
    });
    if (!server?.credential) {
      throw new NotFoundException({ error: { code: "SERVER_NOT_FOUND", message: "Servidor não encontrado." } });
    }
    const payload: EncryptedPayload = {
      ciphertext: server.credential.ciphertext,
      iv: server.credential.iv,
      authTag: server.credential.authTag,
      keyVersion: server.credential.keyVersion,
    };
    return decryptJson<ServerCredentialPayload>(payload, this.encryptionKey);
  }

  private async findServerOrThrow(user: SessionUser, serverId: string) {
    const server = await this.prisma.client.server.findFirst({
      where: { id: serverId, organizationId: user.organizationId, deletedAt: null },
      include: { credential: true },
    });
    if (!server) {
      throw new NotFoundException({ error: { code: "SERVER_NOT_FOUND", message: "Servidor não encontrado." } });
    }
    return server;
  }
}
