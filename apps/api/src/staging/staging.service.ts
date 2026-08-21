import { Injectable } from "@nestjs/common";
import {
  isStagingDomain,
  suggestStagingDomain,
  type SiteInfoSnapshot,
  type StagingCloneCandidate,
  type StagingHubResponse,
  type StagingHubSite,
} from "@opspanel/contracts";
import { SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";

function isWordPressSite(site: { siteType?: string | null; infoSnapshot?: unknown }): boolean {
  const info = site.infoSnapshot as SiteInfoSnapshot | null;
  if (info?.isWordPress) return true;
  if (site.siteType && /^wp/i.test(site.siteType)) return true;
  return false;
}

@Injectable()
export class StagingService {
  constructor(private readonly prisma: PrismaService) {}

  async getHub(user: SessionUser): Promise<StagingHubResponse> {
    const sites = await this.prisma.client.site.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, name: true } } },
      orderBy: { domain: "asc" },
      take: 500,
    });

    const stagingSites: StagingHubSite[] = [];
    const candidates: StagingCloneCandidate[] = [];

    for (const site of sites) {
      const info = site.infoSnapshot as (SiteInfoSnapshot & {
        isStaging?: boolean;
        stagingOf?: string;
        clonedFrom?: string;
      }) | null;
      const clonedFrom = info?.clonedFrom ?? info?.stagingOf ?? null;
      const staging =
        Boolean(info?.isStaging) || Boolean(clonedFrom) || isStagingDomain(site.domain);

      if (staging) {
        stagingSites.push({
          siteId: site.id,
          domain: site.domain,
          serverId: site.serverId,
          serverName: site.server?.name,
          siteType: site.siteType,
          status: site.status,
          clonedFrom,
          isStaging: true,
          isWordPress: isWordPressSite(site),
          createdAt: site.createdAt?.toISOString() ?? null,
        });
      }

      const type = (site.siteType ?? "").toLowerCase();
      if (type === "proxy" || type === "alias") continue;
      if (staging) continue;

      candidates.push({
        siteId: site.id,
        domain: site.domain,
        serverId: site.serverId,
        serverName: site.server?.name,
        siteType: site.siteType,
        suggestedTarget: suggestStagingDomain(site.domain),
        isWordPress: isWordPressSite(site),
      });
    }

    return {
      summary: {
        stagingSites: stagingSites.length,
        cloneCandidates: candidates.length,
      },
      stagingSites,
      candidates,
    };
  }
}
