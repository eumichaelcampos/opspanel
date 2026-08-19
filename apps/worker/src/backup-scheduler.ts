import { JobStatus, OrgRole, prisma } from "@opspanel/database";
import { OperationKeys } from "@opspanel/contracts";
import { logger } from "./job-utils.js";
import type { Queue } from "bullmq";

export function startBackupScheduler(queue: Queue) {
  const tick = async () => {
    try {
      const due = await prisma.siteBackupPolicy.findMany({
        where: {
          schedule: { not: "off" },
          nextRunAt: { lte: new Date() },
          site: { deletedAt: null },
        },
        include: {
          site: {
            select: {
              id: true,
              domain: true,
              serverId: true,
              organizationId: true,
              deletedAt: true,
            },
          },
        },
        take: 20,
      });

      for (const policy of due) {
        const site = policy.site;
        if (!site || site.deletedAt) continue;

        const busy = await prisma.job.findMany({
          where: {
            operationKey: OperationKeys.SiteBackup,
            status: { in: [JobStatus.queued, JobStatus.running, JobStatus.validating] },
            serverId: site.serverId,
          },
          select: { inputJson: true },
          take: 30,
        });
        if (busy.some((j) => (j.inputJson as { siteId?: string } | null)?.siteId === site.id)) {
          continue;
        }

        const owner = await prisma.organizationMember.findFirst({
          where: { organizationId: site.organizationId, role: OrgRole.owner },
          select: { userId: true },
        });
        if (!owner) continue;

        const job = await prisma.job.create({
          data: {
            organizationId: site.organizationId,
            requestedById: owner.userId,
            serverId: site.serverId,
            operationKey: OperationKeys.SiteBackup,
            status: JobStatus.queued,
            inputJson: { siteId: site.id, source: "schedule" },
            events: {
              create: {
                sequence: 1,
                type: "progress",
                message: `Backup agendado de ${site.domain}`,
                progress: 0,
              },
            },
          },
        });
        await queue.add("execute", { jobId: job.id }, { removeOnComplete: 100, removeOnFail: 100 });
        logger.info({ jobId: job.id, domain: site.domain }, "Scheduled site backup enqueued");
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "Backup scheduler failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), 5 * 60 * 1000);
}
