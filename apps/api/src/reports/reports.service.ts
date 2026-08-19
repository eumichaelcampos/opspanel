import { Injectable } from "@nestjs/common";
import { JobStatus } from "@opspanel/database";
import { SessionUser } from "../auth/auth.guard";
import { DashboardService } from "../dashboard/dashboard.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  async getSummary(user: SessionUser) {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [overview, jobsByStatus, jobsLast7d, auditRecent, topActions, sitesByServer] = await Promise.all([
      this.dashboard.getOverview(user),
      this.prisma.client.job.groupBy({
        by: ["status"],
        where: { organizationId: user.organizationId, createdAt: { gte: since30d } },
        _count: true,
      }),
      this.prisma.client.job.findMany({
        where: { organizationId: user.organizationId, createdAt: { gte: since7d } },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.client.auditLog.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          result: true,
          createdAt: true,
        },
      }),
      this.prisma.client.auditLog.groupBy({
        by: ["action"],
        where: { organizationId: user.organizationId, createdAt: { gte: since30d } },
        _count: true,
        orderBy: { _count: { action: "desc" } },
        take: 10,
      }),
      this.prisma.client.site.groupBy({
        by: ["serverId"],
        where: {
          organizationId: user.organizationId,
          deletedAt: null,
          server: { deletedAt: null },
        },
        _count: true,
      }),
    ]);

    const serverNames = await this.prisma.client.server.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    const serverMap = new Map(serverNames.map((s) => [s.id, s.name]));

    const dailyJobs: Record<string, { total: number; failed: number; succeeded: number }> = {};
    for (const job of jobsLast7d) {
      const day = job.createdAt.toISOString().slice(0, 10);
      dailyJobs[day] ??= { total: 0, failed: 0, succeeded: 0 };
      dailyJobs[day].total += 1;
      if (job.status === JobStatus.failed) dailyJobs[day].failed += 1;
      if (job.status === JobStatus.succeeded) dailyJobs[day].succeeded += 1;
    }

    return {
      overview: overview.stats,
      platform: overview.platform,
      jobsByStatus: jobsByStatus.map((r) => ({ status: r.status, count: r._count })),
      dailyJobs: Object.entries(dailyJobs).map(([date, counts]) => ({ date, ...counts })),
      topActions: topActions.map((r) => ({ action: r.action, count: r._count })),
      sitesByServer: sitesByServer.map((r) => ({
        serverId: r.serverId,
        serverName: serverMap.get(r.serverId) ?? "Desconhecido",
        count: r._count,
      })),
      recentAudit: auditRecent,
    };
  }
}
