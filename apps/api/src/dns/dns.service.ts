import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DNS_TEMPLATES, type DnsHubResponse, type DnsDoctorResult } from "@opspanel/contracts";
import { SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { CloudflareService } from "../cloudflare/cloudflare.service";
import { checkSiteDns } from "../sites/dns-check.js";
import { diagnoseDns } from "./dns-doctor.js";

const HUB_LIMIT = 60;
const CONCURRENCY = 6;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return out;
}

@Injectable()
export class DnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudflare: CloudflareService,
  ) {}

  async getHub(user: SessionUser): Promise<DnsHubResponse> {
    const sites = await this.prisma.client.site.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, name: true, host: true } } },
      orderBy: { domain: "asc" },
      take: HUB_LIMIT,
    });

    const checked = await mapPool(sites, CONCURRENCY, async (site) => {
      try {
        const dns = await checkSiteDns(site.domain, site.server.host);
        return {
          siteId: site.id,
          domain: site.domain,
          serverId: site.serverId,
          serverName: site.server.name,
          serverHost: site.server.host,
          apexStatus: dns.status,
          message: dns.message,
          resolvedIps: dns.resolvedIps,
          serverIps: dns.serverIps,
          checkedAt: dns.checkedAt,
        };
      } catch {
        return {
          siteId: site.id,
          domain: site.domain,
          serverId: site.serverId,
          serverName: site.server.name,
          serverHost: site.server.host,
          apexStatus: "unknown" as const,
          message: "Não foi possível verificar o DNS agora.",
          resolvedIps: [] as string[],
          serverIps: [] as string[],
          checkedAt: new Date().toISOString(),
        };
      }
    });

    let ok = 0;
    let cloudflare = 0;
    let problems = 0;
    for (const s of checked) {
      if (s.apexStatus === "ok") ok += 1;
      else if (s.apexStatus === "cloudflare") cloudflare += 1;
      else problems += 1;
    }

    return {
      summary: { sites: checked.length, ok, cloudflare, problems },
      sites: checked,
      templates: DNS_TEMPLATES,
    };
  }

  async doctorForSite(user: SessionUser, siteId: string): Promise<DnsDoctorResult> {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, name: true, host: true } } },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Site não encontrado." } });
    }
    const cfAuth = await this.cloudflare.getAuth(user.id);
    return diagnoseDns({
      domain: site.domain,
      serverHost: site.server.host,
      serverId: site.server.id,
      serverName: site.server.name,
      siteId: site.id,
      cloudflareConnected: Boolean(cfAuth),
    });
  }

  async doctorQuery(
    user: SessionUser,
    query: { domain?: string; serverId?: string; siteId?: string },
  ): Promise<DnsDoctorResult> {
    if (query.siteId) {
      return this.doctorForSite(user, query.siteId);
    }

    const domain = (query.domain ?? "").toLowerCase().trim();
    if (!domain || domain.length < 3) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Informe domain ou siteId." },
      });
    }

    let serverHost: string | undefined;
    let serverId: string | undefined;
    let serverName: string | undefined;
    let siteId: string | undefined;

    if (query.serverId) {
      const server = await this.prisma.client.server.findFirst({
        where: { id: query.serverId, organizationId: user.organizationId, deletedAt: null },
      });
      if (!server) {
        throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Servidor não encontrado." } });
      }
      serverHost = server.host;
      serverId = server.id;
      serverName = server.name;
    }

    const site = await this.prisma.client.site.findFirst({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        domain: { equals: domain, mode: "insensitive" },
        ...(query.serverId ? { serverId: query.serverId } : {}),
      },
      include: { server: { select: { id: true, name: true, host: true } } },
    });

    if (site) {
      siteId = site.id;
      serverHost = site.server.host;
      serverId = site.server.id;
      serverName = site.server.name;
    }

    if (!serverHost) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "Informe serverId ou use um domínio de um site cadastrado.",
        },
      });
    }

    const cfAuth = await this.cloudflare.getAuth(user.id);
    return diagnoseDns({
      domain,
      serverHost,
      serverId,
      serverName,
      siteId,
      cloudflareConnected: Boolean(cfAuth),
    });
  }
}
