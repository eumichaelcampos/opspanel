import { Injectable } from "@nestjs/common";
import { JobStatus, SiteStatus } from "@opspanel/database";
import { jobOperationLabel } from "@opspanel/contracts";
import { SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

type AttentionItem = {
  id: string;
  kind: "job_failed" | "server" | "site";
  severity: "critical" | "warning";
  title: string;
  subtitle?: string;
  href: string;
};

function domainFromJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const domain = record.domain ?? record.newDomain;
  return typeof domain === "string" && domain.trim() ? domain.trim() : undefined;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async getOverview(user: SessionUser): Promise<{
    stats: {
      servers: number;
      serversHealthy: number;
      serversOffline: number;
      serversWarning: number;
      sites: number;
      sitesFailed: number;
      sitesProvisioning: number;
      jobsRunning: number;
      jobsFailed24h: number;
    };
    platform: { database: string; queue: string };
    attention: AttentionItem[];
    servers: Array<{
      id: string;
      name: string;
      host: string;
      status: string;
      wordopsVersion: string | null;
      siteCount: number;
      healthSnapshot: unknown;
      healthObservedAt: Date | null;
      metricsSnapshot: unknown;
      metricsObservedAt: Date | null;
      lastConnectedAt: Date | null;
    }>;
    recentJobs: Array<{
      id: string;
      operationKey: string;
      label: string;
      status: string;
      progress: number;
      createdAt: Date;
      serverId: string | null;
      serverName: string | null;
      domain: string | null;
      errorMessage: string | null;
    }>;
  }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orgId = user.organizationId;

    const [servers, siteCount, sitesFailed, sitesProvisioning, jobsRunning, jobsFailed24h, recentJobs, failedJobs, problemSites] =
      await Promise.all([
        this.prisma.client.server.findMany({
          where: { organizationId: orgId, deletedAt: null },
          orderBy: { name: "asc" },
          include: { _count: { select: { sites: { where: { deletedAt: null } } } } },
        }),
        this.prisma.client.site.count({
          where: { organizationId: orgId, deletedAt: null, server: { deletedAt: null } },
        }),
        this.prisma.client.site.count({
          where: {
            organizationId: orgId,
            deletedAt: null,
            status: SiteStatus.failed,
            server: { deletedAt: null },
          },
        }),
        this.prisma.client.site.count({
          where: {
            organizationId: orgId,
            deletedAt: null,
            status: SiteStatus.provisioning,
            server: { deletedAt: null },
          },
        }),
        this.prisma.client.job.count({
          where: {
            organizationId: orgId,
            status: { in: [JobStatus.queued, JobStatus.validating, JobStatus.running, JobStatus.verifying] },
          },
        }),
        this.prisma.client.job.count({
          where: {
            organizationId: orgId,
            status: JobStatus.failed,
            createdAt: { gte: since24h },
          },
        }),
        this.prisma.client.job.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            operationKey: true,
            status: true,
            progress: true,
            createdAt: true,
            serverId: true,
            errorMessage: true,
            inputJson: true,
            resultJson: true,
            server: { select: { id: true, name: true } },
          },
        }),
        this.prisma.client.job.findMany({
          where: {
            organizationId: orgId,
            status: JobStatus.failed,
            createdAt: { gte: since24h },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            operationKey: true,
            errorMessage: true,
            inputJson: true,
            resultJson: true,
            server: { select: { name: true } },
          },
        }),
        this.prisma.client.site.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            status: { in: [SiteStatus.failed, SiteStatus.provisioning] },
            server: { deletedAt: null },
          },
          orderBy: { updatedAt: "desc" },
          take: 6,
          select: {
            id: true,
            domain: true,
            status: true,
            server: { select: { name: true } },
          },
        }),
      ]);

    let platform = { database: "unknown" as string, queue: "unknown" as string };
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      platform.database = "ok";
    } catch {
      platform.database = "error";
    }
    try {
      await this.queue.operationsQueue.getJobCounts();
      platform.queue = "ok";
    } catch {
      platform.queue = "error";
    }

    const healthy = servers.filter((s) => s.status === "healthy").length;
    const offline = servers.filter((s) => s.status === "offline" || s.status === "critical").length;
    const warning = servers.filter((s) => s.status === "warning").length;

    const attention: AttentionItem[] = [];

    for (const s of servers) {
      if (s.status === "offline" || s.status === "critical") {
        attention.push({
          id: `server-${s.id}`,
          kind: "server",
          severity: "critical",
          title: `Servidor ${s.name} ${s.status === "offline" ? "offline" : "crítico"}`,
          subtitle: s.host,
          href: `/servers/${s.id}`,
        });
      } else if (s.status === "warning") {
        attention.push({
          id: `server-warn-${s.id}`,
          kind: "server",
          severity: "warning",
          title: `Servidor ${s.name} com alerta`,
          subtitle: s.host,
          href: `/servers/${s.id}`,
        });
      }
    }

    for (const site of problemSites) {
      attention.push({
        id: `site-${site.id}`,
        kind: "site",
        severity: site.status === "failed" ? "critical" : "warning",
        title:
          site.status === "failed"
            ? `Site ${site.domain} com falha`
            : `Site ${site.domain} em provisionamento`,
        subtitle: site.server.name,
        href: `/sites/${site.id}`,
      });
    }

    for (const job of failedJobs) {
      const domain = domainFromJson(job.inputJson) ?? domainFromJson(job.resultJson);
      const label = jobOperationLabel(job.operationKey);
      attention.push({
        id: `job-${job.id}`,
        kind: "job_failed",
        severity: "warning",
        title: `${label} falhou`,
        subtitle: [domain, job.server?.name, job.errorMessage?.slice(0, 120)].filter(Boolean).join(" · "),
        href: `/jobs/${job.id}`,
      });
    }

    // critical first, then warning; cap list
    attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
    const attentionCapped = attention.slice(0, 8);

    return {
      stats: {
        servers: servers.length,
        serversHealthy: healthy,
        serversOffline: offline,
        serversWarning: warning,
        sites: siteCount,
        sitesFailed,
        sitesProvisioning,
        jobsRunning,
        jobsFailed24h,
      },
      platform,
      attention: attentionCapped,
      servers: servers.map((s) => {
        const ext = s as typeof s & {
          healthSnapshot?: unknown;
          healthObservedAt?: Date | null;
          metricsSnapshot?: unknown;
          metricsObservedAt?: Date | null;
        };
        return {
          id: s.id,
          name: s.name,
          host: s.host,
          status: s.status,
          wordopsVersion: s.wordopsVersion,
          siteCount: s._count.sites,
          healthSnapshot: ext.healthSnapshot ?? null,
          healthObservedAt: ext.healthObservedAt ?? null,
          metricsSnapshot: ext.metricsSnapshot ?? null,
          metricsObservedAt: ext.metricsObservedAt ?? null,
          lastConnectedAt: s.lastConnectedAt,
        };
      }),
      recentJobs: recentJobs.map((job) => {
        const domain = domainFromJson(job.inputJson) ?? domainFromJson(job.resultJson);
        return {
          id: job.id,
          operationKey: job.operationKey,
          label: jobOperationLabel(job.operationKey),
          status: job.status,
          progress: job.progress,
          createdAt: job.createdAt,
          serverId: job.serverId,
          serverName: job.server?.name ?? null,
          domain: domain ?? null,
          errorMessage: job.errorMessage?.slice(0, 160) ?? null,
        };
      }),
    };
  }
}
