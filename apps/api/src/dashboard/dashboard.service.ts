import { Injectable } from "@nestjs/common";
import { JobStatus } from "@opspanel/database";
import { SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

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
      sites: number;
      jobsRunning: number;
      jobsFailed24h: number;
    };
    platform: { database: string; queue: string };
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
      status: string;
      progress: number;
      createdAt: Date;
      serverId: string | null;
    }>;
  }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [servers, siteCount, jobsRunning, jobsFailed24h, recentJobs] = await Promise.all([
      this.prisma.client.server.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        orderBy: { name: "asc" },
        include: { _count: { select: { sites: { where: { deletedAt: null } } } } },
      }),
      this.prisma.client.site.count({
        where: { organizationId: user.organizationId, deletedAt: null },
      }),
      this.prisma.client.job.count({
        where: {
          organizationId: user.organizationId,
          status: { in: [JobStatus.queued, JobStatus.validating, JobStatus.running, JobStatus.verifying] },
        },
      }),
      this.prisma.client.job.count({
        where: {
          organizationId: user.organizationId,
          status: JobStatus.failed,
          createdAt: { gte: since24h },
        },
      }),
      this.prisma.client.job.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          operationKey: true,
          status: true,
          progress: true,
          createdAt: true,
          serverId: true,
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

    return {
      stats: {
        servers: servers.length,
        serversHealthy: healthy,
        serversOffline: offline,
        sites: siteCount,
        jobsRunning,
        jobsFailed24h,
      },
      platform,
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
      recentJobs,
    };
  }
}
