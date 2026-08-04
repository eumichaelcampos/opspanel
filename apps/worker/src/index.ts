import { config } from "dotenv";

import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });



import { Worker } from "bullmq";

import { Redis } from "ioredis";

import { JobStatus, ServerStatus, SiteStatus, prisma } from "@opspanel/database";

import { OperationKeys } from "@opspanel/contracts";

import { loadEnv } from "@opspanel/config";

import { redactSecrets } from "@opspanel/security";

import { OPERATIONS_QUEUE } from "./constants.js";

import { appendEvent, claimJob, logger, markJobFailed } from "./job-utils.js";

import { mergeOnboardingStep } from "./onboarding-utils.js";

import { loadSshTargetForServer } from "./server-credentials.js";

import { fetchSiteList, testSshConnection } from "./ssh-executor.js";

import {
  processSiteCreate,
  processSiteFtpUserCreate,
  processSiteInfo,
  processSiteManage,
  processSiteBackup,
  processSiteDelete,
  processSiteUpdateDomain,
} from "./site-processors.js";
import {
  processServerHealthCollect,
  processServerMaintenance,
  processServerMetricsCollect,
  processServerSystemUpdate,
  processServerStackAction,
  processServerStackMigrate,
  processServerUfwConfigure,
  processServerWordOpsInstall,
  processServerWordOpsDashboardRecover,
  processServerReboot,
  processServerStackRestart,
  refreshServerHealthFromServer,
} from "./server-processors.js";
async function processConnectionTest(jobId: string) {

  const job = await claimJob(jobId);

  if (!job?.serverId) return;



  const target = await loadSshTargetForServer(job.serverId);



  await prisma.job.update({

    where: { id: jobId },

    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "connecting", progress: 10 },

  });

  await appendEvent(jobId, 1, "progress", "Iniciando teste de conexão SSH", 10);



  const result = await testSshConnection(target);



  await appendEvent(

    jobId,

    2,

    result.ok ? "progress" : "error",

    redactSecrets(result.errorMessage ?? "Conexão estabelecida"),

    result.ok ? 80 : 100,

  );



  if (result.ok) {

    await prisma.job.update({

      where: { id: jobId },

      data: {

        status: JobStatus.succeeded,

        progress: 100,

        currentStep: "completed",

        finishedAt: new Date(),

        resultJson: {

          latencyMs: result.latencyMs,

          osRelease: result.osRelease,

          wordopsVersion: result.wordopsVersion,

        },

      },

    });

    const existing = await prisma.server.findUnique({ where: { id: job.serverId } });
    const prevHealth = (existing?.healthSnapshot as Record<string, unknown> | null) ?? {};

    await prisma.server.update({

      where: { id: job.serverId },

      data: {

        status: ServerStatus.healthy,

        lastConnectedAt: new Date(),

        osRelease: result.osRelease,

        wordopsVersion: result.wordopsVersion,

        ...(result.healthHint
          ? {
              healthSnapshot: {
                ...prevHealth,
                stackComponents: result.healthHint.stackComponents ?? prevHealth.stackComponents,
                uptimeSeconds: result.healthHint.uptimeSeconds ?? prevHealth.uptimeSeconds,
                collectedAt: result.healthHint.collectedAt ?? new Date().toISOString(),
              },
              healthObservedAt: new Date(),
            }
          : {}),

      },

    });

    await mergeOnboardingStep(job.serverId, "connect");

    await appendEvent(jobId, 3, "done", "Teste de conexão concluído com sucesso", 100);



    await prisma.auditLog.create({

      data: {

        organizationId: job.organizationId,

        actorUserId: job.requestedById,

        action: "server.test_connection.succeeded",

        targetType: "server",

        targetId: job.serverId,

        result: "success",

        metadata: {

          latencyMs: result.latencyMs,

          wordopsVersion: result.wordopsVersion,

        },

      },

    });

  } else {

    await prisma.job.update({

      where: { id: jobId },

      data: {

        status: JobStatus.failed,

        progress: 100,

        currentStep: "failed",

        finishedAt: new Date(),

        errorCode: result.errorCode,

        errorMessage: result.errorMessage,

      },

    });

    await appendEvent(jobId, 3, "error", result.errorMessage ?? "Falha na conexão", 100);

    await prisma.server.update({

      where: { id: job.serverId },

      data: { status: ServerStatus.offline },

    });

    await prisma.auditLog.create({

      data: {

        organizationId: job.organizationId,

        actorUserId: job.requestedById,

        action: "server.test_connection.failed",

        targetType: "server",

        targetId: job.serverId,

        result: "failure",

        metadata: { errorCode: result.errorCode },

      },

    });

  }

}



async function processServerInventorySync(jobId: string) {

  const job = await claimJob(jobId);

  if (!job?.serverId) return;



  const target = await loadSshTargetForServer(job.serverId);



  await prisma.job.update({

    where: { id: jobId },

    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "inventory", progress: 5 },

  });

  await appendEvent(jobId, 1, "progress", "Conectando ao servidor para inventário", 5);



  const list = await fetchSiteList(target);

  if (!list.ok || !list.domains) {

    await prisma.job.update({

      where: { id: jobId },

      data: {

        status: JobStatus.failed,

        progress: 100,

        finishedAt: new Date(),

        errorCode: "INVENTORY_SYNC_FAILED",

        errorMessage: list.errorMessage,

      },

    });

    await appendEvent(jobId, 2, "error", list.errorMessage ?? "Falha na sincronização", 100);

    return;

  }



  await appendEvent(jobId, 2, "progress", `${list.domains.length} domínio(s) detectado(s)`, 40);



  const now = new Date();

  let upserted = 0;

  for (const domain of list.domains) {

    await prisma.site.upsert({

      where: {

        organizationId_domain: {

          organizationId: target.server.organizationId,

          domain,

        },

      },

      create: {

        organizationId: target.server.organizationId,

        serverId: job.serverId,

        domain,

        status: SiteStatus.active,

        lastObservedAt: now,

      },

      update: {

        serverId: job.serverId,

        status: SiteStatus.active,

        lastObservedAt: now,

        deletedAt: null,

      },

    });

    upserted += 1;

  }



  await prisma.server.update({

    where: { id: job.serverId },

    data: { lastSyncedAt: now, status: ServerStatus.healthy },

  });



  await prisma.job.update({

    where: { id: jobId },

    data: {

      status: JobStatus.succeeded,

      progress: 100,

      currentStep: "completed",

      finishedAt: new Date(),

      resultJson: { sitesObserved: upserted, rawPreview: list.rawPreview },

    },

  });

  await appendEvent(jobId, 3, "done", `Inventário sincronizado (${upserted} sites)`, 100);

  await mergeOnboardingStep(job.serverId, "sync_inventory");

  await appendEvent(jobId, 4, "progress", "Escaneando stack instalada (inventário final)…", 95);
  try {
    await refreshServerHealthFromServer(job.serverId);
  } catch {
    /* inventário de sites já concluído; health pode ser repetido depois */
  }

  await prisma.auditLog.create({

    data: {

      organizationId: job.organizationId,

      actorUserId: job.requestedById,

      action: "server.inventory.sync.succeeded",

      targetType: "server",

      targetId: job.serverId,

      result: "success",

      metadata: { sitesObserved: upserted },

    },

  });

}



async function main() {

  const env = loadEnv();

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });



  const worker = new Worker(

    OPERATIONS_QUEUE,

    async (bullJob) => {

      const jobId = bullJob.data.jobId as string;

      const record = await prisma.job.findUnique({ where: { id: jobId } });

      if (!record) return;



      logger.info({ jobId, operationKey: record.operationKey, bullId: bullJob.id }, "Processing job");



      try {

        if (record.operationKey === OperationKeys.ServerConnectionTest) {

          await processConnectionTest(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerSyncInventory) {

          await processServerInventorySync(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerHealthCollect) {

          await processServerHealthCollect(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerStackAction) {

          await processServerStackAction(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerMaintenanceRun) {

          await processServerMaintenance(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerSystemUpdate) {

          await processServerSystemUpdate(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerMetricsCollect) {

          await processServerMetricsCollect(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerWordOpsInstall) {

          await processServerWordOpsInstall(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerWordOpsDashboardRecover) {

          await processServerWordOpsDashboardRecover(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerStackMigrate) {

          await processServerStackMigrate(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerUfwConfigure) {

          await processServerUfwConfigure(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerReboot) {

          await processServerReboot(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.ServerStackRestart) {

          await processServerStackRestart(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteInfo) {

          await processSiteInfo(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteCreate) {

          await processSiteCreate(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteManage) {

          await processSiteManage(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteBackup) {

          await processSiteBackup(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteDelete) {

          await processSiteDelete(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteUpdateDomain) {

          await processSiteUpdateDomain(jobId);

          return;

        }

        if (record.operationKey === OperationKeys.SiteFtpUserCreate) {

          await processSiteFtpUserCreate(jobId);

          return;

        }



        await prisma.job.update({

          where: { id: jobId },

          data: {

            status: JobStatus.failed,

            errorCode: "UNSUPPORTED_OPERATION",

            errorMessage: "Operação não suportada nesta versão.",

            finishedAt: new Date(),

          },

        });

      } catch (err) {

        await markJobFailed(jobId, err);

        throw err;

      }

    },

    { connection, concurrency: 1 },

  );



  worker.on("failed", (job, err) => {

    logger.error({ bullId: job?.id, err: err.message }, "BullMQ delivery failed");

  });



  logger.info("Worker started");

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


