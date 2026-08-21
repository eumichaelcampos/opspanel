import { JobStatus, prisma, type Prisma } from "@opspanel/database";
import { siteWpInventoryInputSchema, siteWpUpdateInputSchema } from "@opspanel/contracts";
import {
  parseWpInventoryOutput,
  parseWpUpdateOutput,
  wpInventoryProbe,
  wpUpdateProbe,
} from "@opspanel/wordops";
import { appendEvent, claimJob } from "./job-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession } from "./ssh-executor.js";

async function execProbeForServer(serverId: string, probe: readonly string[], timeoutMs?: number) {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  try {
    return await session.execProbe(probe, { timeoutMs, pty: true });
  } finally {
    session.close();
  }
}

async function loadSite(siteId: string) {
  return prisma.site.findUnique({
    where: { id: siteId },
    include: { server: true },
  });
}

export async function processSiteWpInventory(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteWpInventoryInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid WP inventory input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.wp.inventory", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", `Coletando inventário WordPress: ${site.domain}`, 10);

  const result = await execProbeForServer(site.serverId, wpInventoryProbe(site.domain), 300_000);
  const combined = `${result.stdout}\n${result.stderr}`;
  const inventory = parseWpInventoryOutput(combined);

  if (inventory.error === "not_wordpress" || inventory.error === "wp_cli_missing") {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: inventory.error === "wp_cli_missing" ? "WP_CLI_MISSING" : "NOT_WORDPRESS",
        errorMessage:
          inventory.error === "wp_cli_missing"
            ? "WP-CLI não encontrado no servidor."
            : "Site não parece ser WordPress.",
        resultJson: inventory as object,
      },
    });
    await appendEvent(jobId, 2, "error", inventory.error, 100);
    return;
  }

  const observedAt = new Date(inventory.collectedAt);
  await prisma.site.update({
    where: { id: site.id },
    data: {
      wpInventorySnapshot: JSON.parse(JSON.stringify(inventory)) as Prisma.InputJsonValue,
      wpInventoryObservedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: inventory as object,
    },
  });
  await appendEvent(
    jobId,
    2,
    "done",
    `Inventário OK · core ${inventory.coreVersion ?? "?"} · ${inventory.pluginUpdates} plugins · ${inventory.themeUpdates} temas`,
    100,
  );
}

export async function processSiteWpUpdate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteWpUpdateInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid WP update input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.wp.update", progress: 10 },
  });
  await appendEvent(
    jobId,
    1,
    "progress",
    `Atualizando WordPress em ${site.domain}: ${parsed.data.targets.join(", ")}`,
    10,
  );

  const result = await execProbeForServer(
    site.serverId,
    wpUpdateProbe(site.domain, parsed.data.targets),
    900_000,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  const updateResult = parseWpUpdateOutput(combined);

  if (!updateResult.ok) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "WP_UPDATE_FAILED",
        errorMessage: updateResult.error ?? "Falha ao atualizar WordPress.",
        resultJson: { outputPreview: combined.slice(-2000) },
      },
    });
    await appendEvent(jobId, 2, "error", updateResult.error ?? "Falha na atualização", 100);
    return;
  }

  await appendEvent(jobId, 2, "progress", "Atualização concluída. Recoletando inventário…", 70);

  const invResult = await execProbeForServer(site.serverId, wpInventoryProbe(site.domain), 300_000);
  const inventory = parseWpInventoryOutput(`${invResult.stdout}\n${invResult.stderr}`);
  if (!inventory.error) {
    const observedAt = new Date(inventory.collectedAt);
    await prisma.site.update({
      where: { id: site.id },
      data: {
        wpInventorySnapshot: JSON.parse(JSON.stringify(inventory)) as Prisma.InputJsonValue,
        wpInventoryObservedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
      },
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        targets: parsed.data.targets,
        inventory: inventory.error ? undefined : inventory,
        outputPreview: combined.slice(-1500),
      },
    },
  });
  await appendEvent(jobId, 3, "done", "WordPress atualizado", 100);
}
