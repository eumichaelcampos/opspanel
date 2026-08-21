import { Injectable } from "@nestjs/common";
import {
  DEFAULT_BACKUP_POLICY,
  type BackupHubEntry,
  type BackupHubResponse,
  type BackupSiteSummary,
} from "@opspanel/contracts";
import { SessionUser } from "../auth/auth.guard";
import { SitesService } from "../sites/sites.service";
import { PrismaService } from "../prisma/prisma.service";

const HUB_SITE_LIMIT = 40;
const CONCURRENCY = 4;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sites: SitesService,
  ) {}

  async getHub(user: SessionUser): Promise<BackupHubResponse> {
    const sites = await this.prisma.client.site.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: {
        server: { select: { id: true, name: true } },
        backupPolicy: true,
      },
      orderBy: { domain: "asc" },
      take: HUB_SITE_LIMIT,
    });

    const listed = await mapPool(sites, CONCURRENCY, async (site) => {
      try {
        const result = await this.sites.listBackups(user, site.id);
        return { site, result, error: null as string | null };
      } catch (err) {
        return {
          site,
          result: null,
          error: err instanceof Error ? err.message : "Falha ao listar backups",
        };
      }
    });

    const recent: BackupHubEntry[] = [];
    const siteSummaries: BackupSiteSummary[] = [];
    let driveCopies = 0;
    let integrityWarnings = 0;
    let withSchedule = 0;

    for (const row of listed) {
      const policy = row.site.backupPolicy;
      const contents = policy?.contents ?? DEFAULT_BACKUP_POLICY.contents;
      const schedule = policy?.schedule ?? DEFAULT_BACKUP_POLICY.schedule;
      if (schedule !== "off") withSchedule += 1;

      const backups = row.result?.backups ?? [];
      for (const b of backups) {
        if (b.location === "drive" || b.location === "both") driveCopies += 1;
        if (b.integrity === "warning") integrityWarnings += 1;
        recent.push({
          siteId: row.site.id,
          domain: row.site.domain,
          serverId: row.site.serverId,
          serverName: row.site.server?.name,
          path: b.path,
          timestamp: b.timestamp,
          hasDatabase: b.hasDatabase,
          hasFiles: b.hasFiles !== false,
          filesSizeBytes: b.filesSizeBytes,
          location: b.location ?? "local",
          driveFolderId: b.driveFolderId,
          integrity: b.integrity ?? "unknown",
        });
      }

      const latest = backups[0];
      siteSummaries.push({
        siteId: row.site.id,
        domain: row.site.domain,
        serverId: row.site.serverId,
        serverName: row.site.server?.name,
        contents,
        schedule,
        keepLocal: policy?.keepLocal ?? DEFAULT_BACKUP_POLICY.keepLocal,
        uploadToDrive: policy?.uploadToDrive ?? DEFAULT_BACKUP_POLICY.uploadToDrive,
        lastRunAt: policy?.lastRunAt?.toISOString() ?? null,
        nextRunAt: policy?.nextRunAt?.toISOString() ?? null,
        backupCount: backups.length,
        latestTimestamp: latest?.timestamp ?? null,
        latestSizeBytes: latest?.filesSizeBytes ?? null,
        listError: row.error,
      });
    }

    recent.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      summary: {
        sites: sites.length,
        withSchedule,
        totalBackups: recent.length,
        driveCopies,
        integrityWarnings,
      },
      recent: recent.slice(0, 50),
      sites: siteSummaries,
    };
  }
}
