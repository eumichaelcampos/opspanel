import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OperationKeys,
  countWpUpdates,
  siteWpInventoryInputSchema,
  siteWpUpdateInputSchema,
  type SiteInfoSnapshot,
  type WpHubResponse,
  type WpSiteDetailResponse,
  type WpSiteHubItem,
  type WpSiteInventory,
} from "@opspanel/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/auth.guard";
import { JobsService } from "../jobs/jobs.service";

function canManage(user: SessionUser) {
  return user.role === "owner" || user.role === "admin" || user.role === "operator";
}

function isWordPressSite(site: {
  siteType?: string | null;
  infoSnapshot?: unknown;
}): boolean {
  const info = site.infoSnapshot as SiteInfoSnapshot | null;
  if (info?.isWordPress) return true;
  if (site.siteType && /^wp/i.test(site.siteType)) return true;
  return false;
}

function inventoryFresh(iso?: string | null, maxMs = 24 * 60 * 60 * 1000): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxMs;
}

@Injectable()
export class WordpressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  private async requireSite(user: SessionUser, siteId: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, name: true } } },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Site não encontrado." } });
    }
    return site;
  }

  private toHubItem(site: {
    id: string;
    domain: string;
    serverId: string;
    siteType: string | null;
    wpInventorySnapshot: unknown;
    wpInventoryObservedAt: Date | null;
    server?: { name: string } | null;
  }): WpSiteHubItem {
    const inventory = (site.wpInventorySnapshot as WpSiteInventory | null) ?? null;
    const lastInventoryAt = site.wpInventoryObservedAt?.toISOString() ?? null;
    return {
      siteId: site.id,
      domain: site.domain,
      serverId: site.serverId,
      serverName: site.server?.name,
      siteType: site.siteType,
      inventory,
      lastInventoryAt,
      needsRefresh: !inventoryFresh(lastInventoryAt),
    };
  }

  async getHub(user: SessionUser): Promise<WpHubResponse> {
    const sites = await this.prisma.client.site.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { name: true } } },
      orderBy: { domain: "asc" },
      take: 500,
    });

    const wpSites = sites
      .filter((s) => isWordPressSite(s) || Boolean(s.wpInventorySnapshot))
      .map((s) => this.toHubItem(s));

    let coreUpdates = 0;
    let pluginUpdates = 0;
    let themeUpdates = 0;
    let withInventory = 0;

    for (const s of wpSites) {
      if (s.inventory) {
        withInventory += 1;
        const c = countWpUpdates(s.inventory);
        coreUpdates += c.core;
        pluginUpdates += c.plugins;
        themeUpdates += c.themes;
      }
    }

    return {
      summary: {
        sites: wpSites.length,
        withInventory,
        coreUpdates,
        pluginUpdates,
        themeUpdates,
      },
      sites: wpSites,
    };
  }

  async getSiteWordpress(user: SessionUser, siteId: string): Promise<WpSiteDetailResponse> {
    const site = await this.requireSite(user, siteId);
    const inventory = (site.wpInventorySnapshot as WpSiteInventory | null) ?? null;
    return {
      siteId: site.id,
      domain: site.domain,
      serverId: site.serverId,
      serverName: site.server?.name,
      siteType: site.siteType,
      isWordPress: isWordPressSite(site),
      inventory,
      lastInventoryAt: site.wpInventoryObservedAt?.toISOString() ?? null,
    };
  }

  async enqueueInventory(user: SessionUser, siteId: string) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const site = await this.requireSite(user, siteId);

    const input = siteWpInventoryInputSchema.parse({ siteId: site.id });
    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteWpInventory,
      input,
      idempotencyKey: `wp-inventory:${site.id}:${Date.now()}`,
    });

    return { jobId: job.id };
  }

  async enqueueUpdate(user: SessionUser, siteId: string, body: unknown) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const site = await this.requireSite(user, siteId);
    const hasInventory = Boolean(site.wpInventorySnapshot);
    if (!isWordPressSite(site) && !hasInventory) {
      throw new BadRequestException({
        error: {
          code: "NOT_WORDPRESS",
          message: "Colete o inventário WordPress antes de atualizar, ou confirme que o site é WP.",
        },
      });
    }

    const parsed = siteWpUpdateInputSchema.safeParse({
      ...(typeof body === "object" && body ? body : {}),
      siteId: site.id,
    });
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: "INVALID_INPUT",
          message: "Alvos de atualização inválidos.",
          details: parsed.error.flatten(),
        },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteWpUpdate,
      input: parsed.data,
      idempotencyKey: `wp-update:${site.id}:${Date.now()}`,
    });

    return { jobId: job.id };
  }
}
