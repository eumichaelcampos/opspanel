import { JobStatus, SiteStatus, prisma, type Prisma } from "@opspanel/database";
import { siteCreateInputSchema, siteFtpUserCreateInputSchema, siteFtpUserDeleteInputSchema, siteBackupInputSchema, siteRestoreInputSchema, siteCloneInputSchema, siteRollbackInputSchema, siteDeleteInputSchema, siteUpdateDomainInputSchema, siteManageInputSchema, pickPreferredPhpVersion, SITE_MANAGE_ACTION_LABELS, buildSiteManageResultSummary, siteManageStateFromInfo, computeNextBackupRun, backupContentsLabel, DEFAULT_BACKUP_POLICY, type BackupContents } from "@opspanel/contracts";
import {
  ftpUserCreateProbe,
  ftpUserDeleteProbe,
  proftpdEnsureProbe,
  parseProftpdEnsureOutput,
  parseSiteBackupOutput,
  parseSiteBackupListOutput,
  parseSiteRestoreOutput,
  parseSiteCloneOutput,
  parseSiteCreateOutput,
  parseSiteInfoOutput,
  estimateSiteCreateProgress,
  estimateSiteCloneProgress,
  siteBackupProbe,
  siteBackupPruneProbe,
  siteBackupListProbe,
  siteRestoreProbe,
  siteCloneProbe,
  siteCreateProbe,
  siteDeleteProbe,
  siteInfoProbe,
  siteManageProbe,
  siteUpdateDomainProbe,
  type SiteDbCredentials,
  type SiteBackupContents,
  type SiteCloneType,
} from "@opspanel/wordops";
import { encryptJson } from "@opspanel/security";
import { loadEnv } from "@opspanel/config";
import { randomBytes } from "node:crypto";
import { appendEvent, appendOutputLogs, claimJob } from "./job-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession } from "./ssh-executor.js";
import { withDestSftp } from "./dest-sftp.js";
import { downloadDriveFolderToRemote, uploadBackupToDrive } from "./google-drive.js";

async function execProbeForServer(serverId: string, probe: readonly string[], timeoutMs?: number) {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  try {
    return await session.execProbe(probe, { timeoutMs, pty: true });
  } finally {
    session.close();
  }
}

async function execSiteCreateStreaming(
  serverId: string,
  jobId: string,
  probe: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  let logSeq = 10;
  let lastProgress = 8;
  const pendingLogs: Promise<void>[] = [];

  try {
    return await session.execProbeStreaming(
      probe,
      {
        onLine: (line) => {
          logSeq += 1;
          const seq = logSeq;
          const est = estimateSiteCreateProgress(line);
          if (est > lastProgress) lastProgress = est;
          pendingLogs.push(
            appendEvent(jobId, seq, "log", line.slice(0, 2000), lastProgress).then(() => {
              void prisma.job.update({ where: { id: jobId }, data: { progress: lastProgress } });
            }),
          );
        },
      },
      900_000,
    );
  } finally {
    session.close();
    await Promise.all(pendingLogs);
  }
}

async function loadSite(siteId: string) {
  return prisma.site.findUnique({
    where: { id: siteId },
    include: { server: true },
  });
}

async function persistSiteInfo(siteId: string, parsed: ReturnType<typeof parseSiteInfoOutput>) {
  await prisma.site.update({
    where: { id: siteId },
    data: {
      siteType: parsed.siteType ?? undefined,
      phpVersion: parsed.phpVersion ?? undefined,
      cacheBackend: parsed.cacheBackend ?? undefined,
      isEnabled: parsed.isEnabled ?? undefined,
      infoSnapshot: parsed as object,
      status: SiteStatus.active,
      lastObservedAt: new Date(),
    },
  });
}

async function refreshSiteFromInfo(siteId: string, domain: string, serverId: string) {
  const result = await execProbeForServer(serverId, siteInfoProbe(domain));
  const parsed = parseSiteInfoOutput(result.stdout + result.stderr);
  await persistSiteInfo(siteId, parsed);
  return parsed;
}

async function loadServerStackComponents(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { healthSnapshot: true },
  });
  const health = server?.healthSnapshot as {
    stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[];
  } | null;
  return health?.stackComponents ?? [];
}

async function ensureSiteSslAfterCreate(
  jobId: string,
  siteId: string,
  domain: string,
  serverId: string,
  input: {
    sslMode?: string;
    cloudflareApiKey?: string;
    cloudflareEmail?: string;
  },
  info: ReturnType<typeof parseSiteInfoOutput>,
): Promise<ReturnType<typeof parseSiteInfoOutput>> {
  if (!input.sslMode || input.sslMode === "none" || info.sslEnabled) return info;

  await appendEvent(jobId, 892, "progress", "SSL não detectado após criação. Tentando ativar Let's Encrypt…", 94);

  const sslAction =
    input.sslMode === "letsencrypt_dns_cf" || input.sslMode === "letsencrypt_wildcard_cf"
      ? ("letsencrypt_dns_cf" as const)
      : ("letsencrypt" as const);

  try {
    const probe = siteManageProbe(domain, sslAction, {
      apiKey: input.cloudflareApiKey,
      email: input.cloudflareEmail,
    });
    await execProbeForServer(serverId, probe, 600_000);
    return await refreshSiteFromInfo(siteId, domain, serverId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao ativar SSL";
    await appendEvent(jobId, 893, "log", `Aviso SSL: ${msg.slice(0, 500)}`, 94);
    return info;
  }
}

function dbCredentialsFromSite(site: { infoSnapshot: unknown }): SiteDbCredentials | undefined {
  const info = site.infoSnapshot as { dbName?: string; dbUser?: string; dbPass?: string; dbHost?: string } | null;
  if (!info?.dbName || !info?.dbUser || !info?.dbPass) return undefined;
  return { name: info.dbName, user: info.dbUser, pass: info.dbPass, host: info.dbHost ?? "localhost" };
}

async function executeSiteBackup(
  jobId: string,
  site: { id: string; domain: string; serverId: string; infoSnapshot: unknown },
  stepLabel: string,
  options?: { contents?: SiteBackupContents; skipDrive?: boolean; skipPrune?: boolean },
): Promise<ReturnType<typeof parseSiteBackupOutput>> {
  const contents = options?.contents ?? "files_and_database";
  await appendEvent(jobId, 1, "progress", `${stepLabel}: ${backupContentsLabel(contents as BackupContents)} de ${site.domain}`, 20);
  const db = dbCredentialsFromSite(site);
  const result = await execProbeForServer(site.serverId, siteBackupProbe(site.domain, db, contents), 900_000);
  const combined = `${result.stdout}\n${result.stderr}`;
  const backup = parseSiteBackupOutput(combined);
  // Markers are authoritative. Exit code 1 is common when live files change during tar.
  if (!backup.ok) {
    const snippet = combined
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-12)
      .join(" | ")
      .slice(0, 400);
    throw new Error(
      backup.error ??
        `Falha ao criar backup de recuperação (exit=${result.code}${snippet ? `: ${snippet}` : ""})`,
    );
  }
  await prisma.site.update({
    where: { id: site.id },
    data: {
      infoSnapshot: {
        ...((site.infoSnapshot as object | null) ?? {}),
        lastBackup: {
          path: backup.backupPath,
          filesArchive: backup.filesArchive,
          databaseArchive: backup.databaseArchive,
          createdAt: new Date().toISOString(),
        },
      },
    },
  });
  await appendEvent(
    jobId,
    2,
    "progress",
    `Backup salvo em ${backup.backupPath}${backup.databaseArchive ? " (arquivos + banco)" : " (arquivos)"}`,
    50,
  );
  return backup;
}

export async function processSiteInfo(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const siteId = (job.inputJson as { siteId?: string })?.siteId;
  if (!siteId) throw new Error("siteId missing");

  const site = await loadSite(siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.info", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", `Consultando WordOps: ${site.domain}`, 10);

  const result = await execProbeForServer(site.serverId, siteInfoProbe(site.domain));
  if (result.code !== 0) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_INFO_FAILED",
        errorMessage: "Não foi possível obter informações do site.",
      },
    });
    await appendEvent(jobId, 2, "error", "Falha ao executar wo site info", 100);
    return;
  }

  const parsed = parseSiteInfoOutput(result.stdout + result.stderr);
  await persistSiteInfo(siteId, parsed);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: parsed as object,
    },
  });
  await appendEvent(jobId, 2, "done", "Informações do site atualizadas", 100);
}

export async function processSiteCreate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = siteCreateInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site create input");

  const input = parsed.data;
  const stackComponents = await loadServerStackComponents(input.serverId);
  const phpPick = pickPreferredPhpVersion(input.phpVersion ?? "84", stackComponents);
  const resolvedPhp = phpPick.phpVersion;

  if (phpPick.fallbackApplied) {
    await appendEvent(
      jobId,
      3,
      "log",
      `PHP ${phpPick.requested} indisponível no servidor. Usando PHP ${resolvedPhp}.`,
      8,
    );
  }

  const probe = siteCreateProbe({
    domain: input.domain,
    siteType: input.siteType,
    multisite: input.multisite,
    phpVersion: resolvedPhp,
    sslMode: input.sslMode,
    hsts: input.hsts,
    ngxblocker: input.ngxblocker,
    vhostOnly: input.vhostOnly,
    proxyTarget: input.proxyTarget,
    aliasTarget: input.aliasTarget,
    cloudflareApiKey: input.cloudflareApiKey,
    cloudflareEmail: input.cloudflareEmail,
    wpUser: input.wpUser,
    wpPass: input.wpPass,
    wpEmail: input.wpEmail,
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.create", progress: 5 },
  });
  await appendEvent(
    jobId,
    1,
    "progress",
    `Criando site ${input.domain} (${input.siteType}) no WordOps… pode levar alguns minutos`,
    5,
  );
  await appendEvent(jobId, 2, "progress", "Conectando via SSH e executando wo site create", 8);

  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await execSiteCreateStreaming(input.serverId, jobId, probe);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha na conexão SSH durante criação do site";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_CREATE_SSH_FAILED",
        errorMessage: msg,
      },
    });
    await appendEvent(jobId, 900, "error", msg, 100);
    return;
  }

  const fullOutput = result.stdout + result.stderr;
  const parsedOutput = parseSiteCreateOutput(fullOutput);
  await appendOutputLogs(jobId, fullOutput, 500);

  let siteVerified = false;
  if (result.code !== 0 || !parsedOutput.done) {
    await appendEvent(jobId, 880, "progress", "Verificando se o site foi criado no servidor…", 90);
    try {
      const verifyResult = await execProbeForServer(input.serverId, siteInfoProbe(input.domain.toLowerCase()));
      const info = parseSiteInfoOutput(verifyResult.stdout + verifyResult.stderr);
      siteVerified = verifyResult.code === 0 && Boolean(info.domain ?? info.webroot);
    } catch {
      siteVerified = false;
    }
  }

  const succeeded = parsedOutput.done || siteVerified;

  if (!succeeded) {
    const errMsg =
      parsedOutput.errorHint?.slice(0, 500) ||
      fullOutput.slice(-500) ||
      "Falha ao criar site (WordOps retornou erro durante instalação)";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_CREATE_FAILED",
        errorMessage: errMsg,
        resultJson: { outputFull: fullOutput.slice(0, 12000), exitCode: result.code },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  if (siteVerified && !parsedOutput.done) {
    await appendEvent(
      jobId,
      885,
      "log",
      "WordOps reportou erro parcial, mas o site existe no servidor. Registrando no inventário.",
      92,
    );
  }

  await appendEvent(jobId, 890, "progress", "Site criado, registrando no inventário", 93);

  const site = await prisma.site.upsert({
    where: {
      organizationId_domain: {
        organizationId: job.organizationId,
        domain: input.domain.toLowerCase(),
      },
    },
    create: {
      organizationId: job.organizationId,
      serverId: input.serverId,
      domain: input.domain.toLowerCase(),
      siteType: input.siteType,
      status: SiteStatus.provisioning,
    },
    update: {
      serverId: input.serverId,
      siteType: input.siteType,
      status: SiteStatus.provisioning,
      deletedAt: null,
    },
  });

  let infoParsed: ReturnType<typeof parseSiteInfoOutput> = {};
  try {
    infoParsed = await refreshSiteFromInfo(site.id, site.domain, input.serverId);
    infoParsed = await ensureSiteSslAfterCreate(jobId, site.id, site.domain, input.serverId, input, infoParsed);
  } catch {
    await prisma.site.update({
      where: { id: site.id },
      data: { status: SiteStatus.active, lastObservedAt: new Date() },
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        siteId: site.id,
        domain: site.domain,
        outputFull: fullOutput.slice(0, 12000),
        recoveredAfterError: siteVerified && !parsedOutput.done,
        phpVersionRequested: input.phpVersion,
        phpVersionApplied: resolvedPhp,
        phpFallbackApplied: phpPick.fallbackApplied,
        sslMode: input.sslMode,
        sslEnabledAfterCreate: infoParsed.sslEnabled ?? false,
        ...infoParsed,
      },
    },
  });
  await appendEvent(jobId, 900, "done", `Site ${site.domain} criado com sucesso`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "site.create.succeeded",
      targetType: "site",
      targetId: site.id,
      result: "success",
      metadata: { domain: site.domain, siteType: input.siteType },
    },
  });
}

export async function processSiteManage(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteManageInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site manage input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  const actionLabels: Record<string, string> = {
    ...SITE_MANAGE_ACTION_LABELS,
  };

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: parsed.data.action, progress: 10 },
  });
  await appendEvent(
    jobId,
    1,
    "progress",
    `${actionLabels[parsed.data.action] ?? parsed.data.action}: ${site.domain}`,
    10,
  );

  const result = await execProbeForServer(
    site.serverId,
    siteManageProbe(site.domain, parsed.data.action, {
      apiKey: parsed.data.cloudflareApiKey,
      email: parsed.data.cloudflareEmail,
    }),
    600_000,
  );

  const fullOutput = result.stdout + result.stderr;
  await appendOutputLogs(jobId, fullOutput, 20);

  if (result.code !== 0) {
    const errMsg = fullOutput.slice(-500) || "Operação falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_MANAGE_FAILED",
        errorMessage: errMsg,
        resultJson: { action: parsed.data.action, outputFull: fullOutput.slice(0, 8000) },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  let infoAfter: ReturnType<typeof parseSiteInfoOutput> = {};
  if (parsed.data.action === "enable") {
    await prisma.site.update({ where: { id: site.id }, data: { isEnabled: true, status: SiteStatus.active } });
    infoAfter = { isEnabled: true };
  } else if (parsed.data.action === "disable") {
    await prisma.site.update({ where: { id: site.id }, data: { isEnabled: false, status: SiteStatus.disabled } });
    infoAfter = { isEnabled: false };
  } else {
    infoAfter = await refreshSiteFromInfo(site.id, site.domain, site.serverId);
  }

  const siteState = siteManageStateFromInfo(infoAfter);
  const summary = buildSiteManageResultSummary(parsed.data.action, siteState);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        action: parsed.data.action,
        actionLabel: actionLabels[parsed.data.action] ?? parsed.data.action,
        summary,
        siteState,
        verified: true,
        outputFull: fullOutput.slice(0, 8000),
      } as object,
    },
  });
  await appendEvent(jobId, 900, "done", summary, 100);
}

export async function processSiteBackup(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteBackupInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site backup input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.backup", progress: 5 },
  });

  try {
    const policy = await prisma.siteBackupPolicy.findUnique({ where: { siteId: site.id } });
    const contents = (parsed.data.contents ?? policy?.contents ?? DEFAULT_BACKUP_POLICY.contents) as SiteBackupContents;
    const source = parsed.data.source ?? "manual";
    const isSafety = source === "safety";
    const backup = await executeSiteBackup(jobId, site, source === "schedule" ? "Backup agendado" : "Backup", {
      contents,
      skipDrive: isSafety,
      skipPrune: isSafety,
    });

    let driveFolderId: string | undefined;
    if (!isSafety && (policy?.uploadToDrive ?? false) && backup.backupPath) {
      await appendEvent(jobId, 3, "progress", "Enviando backup para o Google Drive", 70);
      try {
        const target = await loadSshTargetForServer(site.serverId);
        await withDestSftp(target, async (sftp) => {
          const uploaded = await uploadBackupToDrive({
            userId: job.requestedById,
            sftp,
            domain: site.domain,
            backupPath: backup.backupPath!,
            filesArchive: backup.filesArchive,
            databaseArchive: backup.databaseArchive,
          });
          driveFolderId = uploaded.folderId;
        });
        await appendEvent(jobId, 4, "progress", "Backup copiado para o Google Drive", 82);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha no Google Drive";
        await appendEvent(jobId, 4, "log", `Google Drive: ${msg}`, 82);
      }
    }

    const keepLocal = policy?.keepLocal ?? DEFAULT_BACKUP_POLICY.keepLocal;
    if (!isSafety) {
      await appendEvent(jobId, 5, "progress", `Aplicando retenção local (${keepLocal} no servidor)`, 88);
      await execProbeForServer(site.serverId, siteBackupPruneProbe(site.domain, keepLocal), 120_000);
    }

    if (policy && !isSafety) {
      await prisma.siteBackupPolicy.update({
        where: { id: policy.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: computeNextBackupRun(policy.schedule, policy.scheduleHour),
        },
      });
    }

    const summary = backup.backupPath
      ? `Backup salvo em ${backup.backupPath}${driveFolderId ? " e enviado ao Google Drive" : ""}.`
      : "Backup concluído.";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: {
          ...backup,
          actionLabel: "Backup do site",
          summary,
          path: backup.backupPath,
          driveFolderId,
          verified: true,
        },
      },
    });
    await appendEvent(jobId, 900, "done", summary, 100);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Backup falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_BACKUP_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 3, "error", errMsg, 100);
  }
}

export async function processSiteRestore(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteRestoreInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site restore input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  const expectedPrefix = `/var/backups/opspanel/${site.domain.toLowerCase()}/`;
  if (parsed.data.backupPath && !parsed.data.backupPath.startsWith(expectedPrefix)) {
    throw new Error("Backup path does not belong to this site");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.restore", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Preparando restauração de ${site.domain}`, 5);

  try {
    await appendEvent(jobId, 2, "progress", "Criando backup de segurança antes da restauração", 10);
    await executeSiteBackup(jobId, site, "Backup de segurança");

    let restorePath = parsed.data.backupPath;
    if (!restorePath && parsed.data.driveFolderId) {
      await appendEvent(jobId, 3, "progress", "Baixando backup do Google Drive para o servidor", 30);
      const target = await loadSshTargetForServer(site.serverId);
      restorePath = await withDestSftp(target, (sftp) =>
        downloadDriveFolderToRemote({
          userId: job.requestedById,
          sftp,
          domain: site.domain,
          folderId: parsed.data.driveFolderId!,
        }),
      );
    }
    if (!restorePath) throw new Error("Backup não informado.");

    await appendEvent(jobId, 4, "progress", `Restaurando de ${restorePath}`, 45);
    const restoreMode = parsed.data.mode ?? "full";
    await appendEvent(
      jobId,
      5,
      "progress",
      `Modo de restauração: ${restoreMode}`,
      50,
    );
    const result = await execProbeForServer(
      site.serverId,
      siteRestoreProbe(site.domain, restorePath, restoreMode),
      900_000,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    const restored = parseSiteRestoreOutput(combined);
    if (!restored.ok) {
      throw new Error(restored.error ?? `Falha ao restaurar backup (exit=${result.code})`);
    }

    await refreshSiteFromInfo(site.id, site.domain, site.serverId).catch(() => undefined);

    const modeLabel =
      restoreMode === "db"
        ? "somente banco"
        : restoreMode === "files"
          ? "somente arquivos"
          : restoreMode === "wp-content"
            ? "somente wp-content"
            : "completo";
    const summary = `Site restaurado (${modeLabel}) a partir de ${restorePath}.`;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: {
          ...restored,
          mode: restoreMode,
          actionLabel: "Restaurar backup",
          summary,
          backupPath: restorePath,
          verified: true,
        },
      },
    });
    await appendEvent(jobId, 900, "done", summary, 100);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Restauração falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_RESTORE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 3, "error", errMsg, 100);
  }
}

function resolveCloneSiteType(site: {
  siteType?: string | null;
  infoSnapshot?: unknown;
}): SiteCloneType {
  const raw = (site.siteType ?? "").toLowerCase();
  const allowed: SiteCloneType[] = [
    "html",
    "php",
    "mysql",
    "wp",
    "wpfc",
    "wpredis",
    "wpsc",
    "wprocket",
    "wpce",
  ];
  if (allowed.includes(raw as SiteCloneType)) return raw as SiteCloneType;
  const info = site.infoSnapshot as { isWordPress?: boolean; siteType?: string } | null;
  if (info?.siteType && allowed.includes(info.siteType.toLowerCase() as SiteCloneType)) {
    return info.siteType.toLowerCase() as SiteCloneType;
  }
  if (info?.isWordPress || /^wp/i.test(raw)) return "wp";
  return "html";
}

async function execSiteCloneStreaming(
  serverId: string,
  jobId: string,
  probe: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  let logSeq = 10;
  let lastProgress = 10;
  const pendingLogs: Promise<void>[] = [];
  try {
    return await session.execProbeStreaming(
      probe,
      {
        onLine: (line) => {
          logSeq += 1;
          const seq = logSeq;
          const est = estimateSiteCloneProgress(line);
          if (est > lastProgress) lastProgress = est;
          pendingLogs.push(
            appendEvent(jobId, seq, "log", line.slice(0, 2000), lastProgress).then(() => {
              void prisma.job.update({ where: { id: jobId }, data: { progress: lastProgress } });
            }),
          );
        },
      },
      1_200_000,
    );
  } finally {
    session.close();
    await Promise.all(pendingLogs);
  }
}

export async function processSiteClone(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteCloneInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site clone input");

  const source = await loadSite(parsed.data.siteId);
  if (!source) throw new Error("Site not found");

  const targetDomain = parsed.data.targetDomain.toLowerCase();
  const asStaging = parsed.data.asStaging ?? true;
  const siteType = resolveCloneSiteType(source);

  if (siteType === ("proxy" as string) || siteType === ("alias" as string)) {
    throw new Error("Clone de proxy/alias não é suportado");
  }

  const phpRaw = (source.phpVersion ?? "default").replace(/^php/, "");
  const phpVersion = (
    ["74", "80", "81", "82", "83", "84"].includes(phpRaw) ? phpRaw : "default"
  ) as "default" | "74" | "80" | "81" | "82" | "83" | "84";

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.clone", progress: 5 },
  });
  await appendEvent(
    jobId,
    1,
    "progress",
    `Clonando ${source.domain} → ${targetDomain} (${siteType}${asStaging ? ", staging" : ""})`,
    5,
  );

  const probe = siteCloneProbe({
    sourceDomain: source.domain,
    targetDomain,
    siteType,
    phpVersion,
    asStaging,
  });

  try {
    const result = await execSiteCloneStreaming(source.serverId, jobId, probe);
    const fullOutput = `${result.stdout}\n${result.stderr}`;
    await appendOutputLogs(jobId, fullOutput, 500);
    const cloned = parseSiteCloneOutput(fullOutput);
    if (!cloned.ok) {
      throw new Error(cloned.error ?? `Falha ao clonar site (exit=${result.code})`);
    }

    await appendEvent(jobId, 890, "progress", "Registrando site clonado no inventário", 92);

    const newSite = await prisma.site.upsert({
      where: {
        organizationId_domain: {
          organizationId: job.organizationId,
          domain: targetDomain,
        },
      },
      create: {
        organizationId: job.organizationId,
        serverId: source.serverId,
        domain: targetDomain,
        siteType,
        phpVersion: source.phpVersion,
        status: SiteStatus.provisioning,
        infoSnapshot: {
          isStaging: asStaging || targetDomain.startsWith("staging."),
          stagingOf: source.domain,
          clonedFrom: source.domain,
        },
      },
      update: {
        serverId: source.serverId,
        siteType,
        phpVersion: source.phpVersion,
        status: SiteStatus.provisioning,
        deletedAt: null,
        infoSnapshot: {
          isStaging: asStaging || targetDomain.startsWith("staging."),
          stagingOf: source.domain,
          clonedFrom: source.domain,
        },
      },
    });

    let info = await refreshSiteFromInfo(newSite.id, targetDomain, source.serverId).catch(() => null);
    if (info) {
      await prisma.site.update({
        where: { id: newSite.id },
        data: {
          infoSnapshot: {
            ...info,
            isStaging: asStaging || targetDomain.startsWith("staging."),
            stagingOf: source.domain,
            clonedFrom: source.domain,
          } as object,
        },
      });
    }

    const summary = `Site clonado para ${targetDomain}.`;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: {
          ...cloned,
          actionLabel: "Clonar site (staging)",
          summary,
          sourceSiteId: source.id,
          targetSiteId: newSite.id,
          targetDomain,
          asStaging,
          verified: true,
        },
      },
    });
    await appendEvent(jobId, 900, "done", summary, 100);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Clone falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_CLONE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
  }
}

/** Rollback: restore full do backup escolhido (ou o mais recente listado no servidor). */
export async function processSiteRollback(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteRollbackInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site rollback input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.rollback", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Preparando rollback de ${site.domain}`, 5);

  try {
    let restorePath = parsed.data.backupPath;
    if (!restorePath) {
      await appendEvent(jobId, 2, "progress", "Localizando backup mais recente", 12);
      const listed = await execProbeForServer(site.serverId, siteBackupListProbe(site.domain), 60_000);
      const entries = parseSiteBackupListOutput(`${listed.stdout}\n${listed.stderr}`);
      const best =
        entries.find((e) => e.path && e.integrity !== "warning" && (e.hasFiles || e.hasDatabase)) ??
        entries.find((e) => e.path);
      if (!best?.path) throw new Error("Nenhum backup local encontrado para rollback.");
      restorePath = best.path;
    }

    const expectedPrefix = `/var/backups/opspanel/${site.domain.toLowerCase()}/`;
    if (!restorePath.startsWith(expectedPrefix)) {
      throw new Error("Backup path does not belong to this site");
    }

    await appendEvent(jobId, 3, "progress", "Criando backup de segurança antes do rollback", 18);
    await executeSiteBackup(jobId, site, "Backup de segurança (pré-rollback)", {
      contents: "files_and_database",
      skipDrive: true,
      skipPrune: true,
    });

    await appendEvent(jobId, 4, "progress", `Restaurando (full) de ${restorePath}`, 45);
    const result = await execProbeForServer(
      site.serverId,
      siteRestoreProbe(site.domain, restorePath, "full"),
      900_000,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    const restored = parseSiteRestoreOutput(combined);
    if (!restored.ok) {
      throw new Error(restored.error ?? `Falha no rollback (exit=${result.code})`);
    }

    await refreshSiteFromInfo(site.id, site.domain, site.serverId).catch(() => undefined);

    const summary = `Rollback concluído a partir de ${restorePath}.`;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: {
          ...restored,
          mode: "full",
          actionLabel: "Rollback do site",
          summary,
          backupPath: restorePath,
          verified: true,
        },
      },
    });
    await appendEvent(jobId, 900, "done", summary, 100);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Rollback falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_ROLLBACK_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
  }
}

export async function processSiteDelete(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteDeleteInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site delete input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  if (parsed.data.confirmDomain.toLowerCase() !== site.domain.toLowerCase()) {
    throw new Error("Confirmação de domínio não confere");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.delete", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Preparando exclusão de ${site.domain}`, 5);

  try {
    await refreshSiteFromInfo(site.id, site.domain, site.serverId).catch(() => undefined);
    const fresh = await loadSite(site.id);
    const backup = await executeSiteBackup(jobId, fresh ?? site, "Backup antes de excluir");

    await appendEvent(jobId, 3, "progress", "Removendo site do servidor WordOps", 70);
    const delResult = await execProbeForServer(site.serverId, siteDeleteProbe(site.domain));
    if (delResult.code !== 0) {
      throw new Error((delResult.stdout + delResult.stderr).slice(0, 500) || "Falha ao excluir site no servidor");
    }

    await prisma.site.update({
      where: { id: site.id },
      data: { deletedAt: new Date(), status: SiteStatus.failed },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: { backup: backup as object, domain: site.domain },
      },
    });
    await appendEvent(jobId, 4, "done", `Site ${site.domain} excluído. Backup em ${backup.backupPath}`, 100);

    await prisma.auditLog.create({
      data: {
        organizationId: job.organizationId,
        actorUserId: job.requestedById,
        action: "site.delete.succeeded",
        targetType: "site",
        targetId: site.id,
        result: "success",
        metadata: { domain: site.domain, backupPath: backup.backupPath },
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Exclusão falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_DELETE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 4, "error", errMsg, 100);
  }
}

export async function processSiteUpdateDomain(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteUpdateDomainInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site update domain input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  const oldDomain = site.domain;
  const newDomain = parsed.data.newDomain.toLowerCase();

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.update.domain", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Trocando domínio ${oldDomain} → ${newDomain}`, 5);

  try {
    await refreshSiteFromInfo(site.id, oldDomain, site.serverId).catch(() => undefined);
    const fresh = await loadSite(site.id);
    const backup = await executeSiteBackup(jobId, fresh ?? site, "Backup antes de trocar domínio");

    await appendEvent(jobId, 3, "progress", "Aplicando novo domínio no servidor", 65);
    const result = await execProbeForServer(site.serverId, siteUpdateDomainProbe(oldDomain, newDomain));
    const output = result.stdout + result.stderr;
    if (result.code !== 0 || !/OPS_DOMAIN_UPDATED=1/.test(output)) {
      throw new Error(output.slice(0, 500) || "Falha ao trocar domínio no servidor");
    }

    await prisma.site.update({
      where: { id: site.id },
      data: {
        domain: newDomain,
        lastObservedAt: new Date(),
      },
    });

    try {
      await refreshSiteFromInfo(site.id, newDomain, site.serverId);
    } catch {
      /* info opcional após troca */
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: { backup: backup as object, oldDomain, newDomain },
      },
    });
    await appendEvent(jobId, 4, "done", `Domínio atualizado para ${newDomain}`, 100);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Troca de domínio falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_DOMAIN_UPDATE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 4, "error", errMsg, 100);
  }
}

export async function processSiteFtpUserCreate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteFtpUserCreateInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid FTP input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  const password = parsed.data.password ?? randomBytes(12).toString("base64url");
  const env = loadEnv();

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "ftp.proftpd", progress: 5 },
  });

  if (parsed.data.ensureProftpd !== false) {
    await appendEvent(jobId, 1, "progress", "Verificando e iniciando ProFTPd…", 5);
    const proftpdResult = await execProbeForServer(site.serverId, proftpdEnsureProbe());
    if (proftpdResult.code !== 0) {
      const raw = `${proftpdResult.stdout}\n${proftpdResult.stderr}`;
      const errMsg =
        parseProftpdEnsureOutput(raw) ||
        raw.replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim().slice(0, 500) ||
        "Falha ao ativar ProFTPd";
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.failed,
          finishedAt: new Date(),
          errorCode: "FTP_PROFTPD_FAILED",
          errorMessage: errMsg,
        },
      });
      await appendEvent(jobId, 2, "error", errMsg, 100);
      return;
    }
    await appendEvent(jobId, 2, "progress", "ProFTPd ativo", 20);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { currentStep: "ftp.create", progress: 30 },
  });
  await appendEvent(jobId, 3, "progress", `Criando usuário FTP ${parsed.data.username}`, 30);

  const result = await execProbeForServer(
    site.serverId,
    ftpUserCreateProbe(site.domain, parsed.data.username, password),
  );

  if (result.code !== 0) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Falha ao criar usuário FTP";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "FTP_CREATE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 4, "error", errMsg, 100);
    return;
  }

  const homePath = `/var/www/${site.domain}/htdocs`;
  const passwordEnc = env.CREDENTIALS_ENCRYPTION_KEY
    ? (encryptJson({ password }, env.CREDENTIALS_ENCRYPTION_KEY) as unknown as Prisma.InputJsonValue)
    : null;

  await prisma.siteFtpUser.upsert({
    where: { siteId_username: { siteId: site.id, username: parsed.data.username } },
    create: {
      siteId: site.id,
      username: parsed.data.username,
      homePath,
      ...(passwordEnc ? { passwordEnc } : {}),
    },
    update: { homePath, ...(passwordEnc ? { passwordEnc } : {}) },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        username: parsed.data.username,
        password,
        homePath,
        host: site.server.host,
        proftpdEnsured: parsed.data.ensureProftpd !== false,
      },
    },
  });
  await appendEvent(jobId, 5, "done", `Usuário FTP ${parsed.data.username} criado com sucesso`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "site.ftp.user.create.succeeded",
      targetType: "site",
      targetId: site.id,
      result: "success",
      metadata: { username: parsed.data.username },
    },
  });
}

export async function processSiteFtpUserDelete(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteFtpUserDeleteInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid FTP delete input");

  const site = await loadSite(parsed.data.siteId);
  if (!site) throw new Error("Site not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "ftp.delete", progress: 20 },
  });
  await appendEvent(jobId, 1, "progress", `Removendo usuário FTP ${parsed.data.username}`, 20);

  const result = await execProbeForServer(site.serverId, ftpUserDeleteProbe(parsed.data.username));

  if (result.code !== 0) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Falha ao excluir usuário FTP";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "FTP_DELETE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await prisma.siteFtpUser.deleteMany({
    where: { id: parsed.data.ftpUserId, siteId: site.id },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { username: parsed.data.username, deleted: true },
    },
  });
  await appendEvent(jobId, 2, "done", `Usuário FTP ${parsed.data.username} excluído`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "site.ftp.user.delete.succeeded",
      targetType: "site",
      targetId: site.id,
      result: "success",
      metadata: { username: parsed.data.username },
    },
  });
}
