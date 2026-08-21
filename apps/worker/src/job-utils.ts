import { JobStatus, Prisma } from "@opspanel/database";
import { prisma } from "@opspanel/database";
import { createLogger } from "@opspanel/observability";

const logger = createLogger("worker");

const TERMINAL: JobStatus[] = [
  JobStatus.succeeded,
  JobStatus.failed,
  JobStatus.cancelled,
  JobStatus.timed_out,
];

export async function appendEvent(
  jobId: string,
  sequence: number,
  type: string,
  message: string,
  progress?: number,
) {
  await prisma.jobEvent.upsert({
    where: { jobId_sequence: { jobId, sequence } },
    create: { jobId, sequence, type, message, progress },
    update: { type, message, progress },
  });
  await prisma.job.update({
    where: { id: jobId },
    data: { progress: progress ?? undefined },
  });
}

export async function claimJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.warn({ jobId }, "Job record not found");
    return null;
  }

  if (TERMINAL.includes(job.status)) {
    logger.info({ jobId, status: job.status }, "Job already finished, skipping");
    return null;
  }

  if (job.status === JobStatus.running && job.startedAt) {
    const staleMs = Date.now() - job.startedAt.getTime();
    const staleLimitMs = 20 * 60 * 1000;
    if (staleMs < staleLimitMs) {
      logger.info({ jobId }, "Job already running, skipping duplicate delivery");
      return null;
    }
    logger.warn({ jobId, staleMs }, "Recovering stale running job");
  }

  return job;
}

export async function markJobFailed(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado no worker.";
  logger.error({ jobId, err: message }, "Job failed");

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.failed,
      progress: 100,
      currentStep: "failed",
      finishedAt: new Date(),
      errorCode: "WORKER_ERROR",
      errorMessage: message,
    },
  });

  const lastEvent = await prisma.jobEvent.findFirst({
    where: { jobId },
    orderBy: { sequence: "desc" },
  });
  const nextSequence = (lastEvent?.sequence ?? 0) + 1;
  await appendEvent(jobId, nextSequence, "error", message, 100);

  const { notifyJobFailed } = await import("./alerts-notify.js");
  void notifyJobFailed(jobId, message);
}

export async function updateJobResult(jobId: string, resultJson: Prisma.InputJsonValue) {
  await prisma.job.update({
    where: { id: jobId },
    data: { resultJson },
  });
}

/** Grava linhas de stdout/stderr como eventos de terminal (tipo log). */
export async function appendOutputLogs(jobId: string, output: string, startSequence = 10): Promise<number> {
  const lines = output
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trimEnd())
    .filter((line) => line.length > 0);

  let seq = startSequence;
  const maxLines = 250;
  for (const line of lines.slice(0, maxLines)) {
    await appendEvent(jobId, seq++, "log", line.slice(0, 2000));
  }
  if (lines.length > maxLines) {
    await appendEvent(jobId, seq++, "log", `… ${lines.length - maxLines} linhas omitidas`);
  }
  return seq;
}

export { logger };
