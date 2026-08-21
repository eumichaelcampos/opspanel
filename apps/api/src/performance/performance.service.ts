import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OperationKeys,
  buildServerPerformanceRecommendations,
  buildSitePerformanceRecommendations,
  siteManageActionSchema,
  serverStackActionKindSchema,
  serverStackComponentSchema,
  summarizePerformance,
  type PerformanceAdvisorResponse,
  type PerformanceApplyKind,
  type ServerHealthSnapshot,
  type ServerMetricsSnapshot,
  type SiteInfoSnapshot,
} from "@opspanel/contracts";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/auth.guard";
import { JobsService } from "../jobs/jobs.service";

function canManage(user: SessionUser) {
  return user.role === "owner" || user.role === "admin" || user.role === "operator";
}

const applyBodySchema = z.object({
  recommendationId: z.string().min(1).max(200),
  targetType: z.enum(["site", "server"]),
  targetId: z.string().uuid(),
  actionKey: z.string().min(1).max(80),
  applyKind: z.enum([
    "site.manage",
    "site.info",
    "server.stack.action",
    "server.metrics.collect",
    "server.health.collect",
    "none",
  ]),
  siteManageAction: siteManageActionSchema.optional(),
  stackAction: serverStackActionKindSchema.optional(),
  stackComponents: z.array(serverStackComponentSchema).optional(),
});

async function measureTtfbMs(domain: string): Promise<number | null> {
  const urls = [`https://${domain}`, `http://${domain}`];
  for (const url of urls) {
    try {
      const start = Date.now();
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
      });
      void res;
      return Date.now() - start;
    } catch {
      /* try next */
    }
  }
  return null;
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async getAdvisor(user: SessionUser, opts?: { ttfb?: boolean }): Promise<PerformanceAdvisorResponse> {
    const [servers, sites] = await Promise.all([
      this.prisma.client.server.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        orderBy: { name: "asc" },
      }),
      this.prisma.client.site.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        include: { server: { select: { name: true } } },
        orderBy: { domain: "asc" },
        take: 200,
      }),
    ]);

    const serverReports = servers.map((s) =>
      buildServerPerformanceRecommendations({
        serverId: s.id,
        serverName: s.name,
        host: s.host,
        status: s.status,
        health: s.healthSnapshot as ServerHealthSnapshot | null,
        metrics: s.metricsSnapshot as ServerMetricsSnapshot | null,
        healthAt: s.healthObservedAt?.toISOString() ?? null,
        metricsAt: s.metricsObservedAt?.toISOString() ?? null,
      }),
    );

    const ttfbEnabled = Boolean(opts?.ttfb);
    const ttfbTargets = ttfbEnabled ? sites.slice(0, 8) : [];
    const ttfbMap = new Map<string, number | null>();
    if (ttfbTargets.length) {
      const results = await Promise.all(
        ttfbTargets.map(async (s) => [s.id, await measureTtfbMs(s.domain)] as const),
      );
      for (const [id, ms] of results) ttfbMap.set(id, ms);
    }

    const siteReports = sites.map((s) => {
      const info = s.infoSnapshot as SiteInfoSnapshot | null;
      return buildSitePerformanceRecommendations({
        siteId: s.id,
        domain: s.domain,
        serverId: s.serverId,
        serverName: s.server?.name,
        info,
        phpVersion: s.phpVersion,
        cacheBackend: s.cacheBackend,
        ttfbMs: ttfbMap.has(s.id) ? ttfbMap.get(s.id)! : null,
      });
    });

    return {
      summary: summarizePerformance(serverReports, siteReports),
      servers: serverReports,
      sites: siteReports,
    };
  }

  async applyRecommendation(user: SessionUser, body: unknown) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }

    const parsed = applyBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Pedido inválido.", details: parsed.error.flatten() },
      });
    }

    const data = parsed.data;
    const kind = data.applyKind as PerformanceApplyKind;
    if (kind === "none") {
      throw new BadRequestException({
        error: { code: "NO_ACTION", message: "Esta recomendação não tem ação automática." },
      });
    }

    if (data.targetType === "site") {
      const site = await this.prisma.client.site.findFirst({
        where: { id: data.targetId, organizationId: user.organizationId, deletedAt: null },
      });
      if (!site) {
        throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Site não encontrado." } });
      }

      if (kind === "site.info") {
        const job = await this.jobs.createOperationJob({
          organizationId: user.organizationId,
          requestedById: user.id,
          serverId: site.serverId,
          operationKey: OperationKeys.SiteInfo,
          input: { siteId: site.id },
          idempotencyKey: `perf-info:${site.id}:${Date.now()}`,
        });
        return { jobId: job.id };
      }

      if (kind === "site.manage") {
        if (!data.siteManageAction) {
          throw new BadRequestException({
            error: { code: "VALIDATION_ERROR", message: "siteManageAction obrigatório." },
          });
        }
        const job = await this.jobs.createOperationJob({
          organizationId: user.organizationId,
          requestedById: user.id,
          serverId: site.serverId,
          operationKey: OperationKeys.SiteManage,
          input: { siteId: site.id, action: data.siteManageAction },
          idempotencyKey: `perf-manage:${site.id}:${data.siteManageAction}:${Date.now()}`,
        });
        return { jobId: job.id };
      }
    }

    if (data.targetType === "server") {
      const server = await this.prisma.client.server.findFirst({
        where: { id: data.targetId, organizationId: user.organizationId, deletedAt: null },
      });
      if (!server) {
        throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Servidor não encontrado." } });
      }

      if (kind === "server.metrics.collect") {
        const job = await this.jobs.createOperationJob({
          organizationId: user.organizationId,
          requestedById: user.id,
          serverId: server.id,
          operationKey: OperationKeys.ServerMetricsCollect,
          input: { serverId: server.id },
          idempotencyKey: `perf-metrics:${server.id}:${Date.now()}`,
        });
        return { jobId: job.id };
      }

      if (kind === "server.health.collect") {
        const job = await this.jobs.createOperationJob({
          organizationId: user.organizationId,
          requestedById: user.id,
          serverId: server.id,
          operationKey: OperationKeys.ServerHealthCollect,
          input: { serverId: server.id },
          idempotencyKey: `perf-health:${server.id}:${Date.now()}`,
        });
        return { jobId: job.id };
      }

      if (kind === "server.stack.action") {
        const stackAction = data.stackAction ?? "install";
        const components = data.stackComponents?.length ? data.stackComponents : ["netdata"];
        const job = await this.jobs.createOperationJob({
          organizationId: user.organizationId,
          requestedById: user.id,
          serverId: server.id,
          operationKey: OperationKeys.ServerStackAction,
          input: { serverId: server.id, action: stackAction, components },
          idempotencyKey: `perf-stack:${server.id}:${stackAction}:${Date.now()}`,
        });
        return { jobId: job.id };
      }
    }

    throw new BadRequestException({
      error: { code: "UNSUPPORTED", message: "Combinação de ação não suportada." },
    });
  }
}
