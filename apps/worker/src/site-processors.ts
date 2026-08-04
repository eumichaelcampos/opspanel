import { JobStatus, SiteStatus, prisma } from "@opspanel/database";
import { siteCreateInputSchema, siteFtpUserCreateInputSchema, siteBackupInputSchema, siteDeleteInputSchema, siteUpdateDomainInputSchema, siteManageInputSchema } from "@opspanel/contracts";
import {
  ftpUserCreateProbe,
  parseSiteBackupOutput,
  parseSiteInfoOutput,
  siteBackupProbe,
  siteCreateProbe,
  siteDeleteProbe,
  siteInfoProbe,
  siteManageProbe,
  siteUpdateDomainProbe,
  type SiteDbCredentials,
} from "@opspanel/wordops";
import { randomBytes } from "node:crypto";
import { appendEvent, claimJob } from "./job-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession } from "./ssh-executor.js";

async function execProbeForServer(serverId: string, probe: readonly string[]) {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  try {
    return await session.execProbe(probe);
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

function dbCredentialsFromSite(site: { infoSnapshot: unknown }): SiteDbCredentials | undefined {
  const info = site.infoSnapshot as { dbName?: string; dbUser?: string; dbPass?: string; dbHost?: string } | null;
  if (!info?.dbName || !info?.dbUser || !info?.dbPass) return undefined;
  return { name: info.dbName, user: info.dbUser, pass: info.dbPass, host: info.dbHost ?? "localhost" };
}

async function executeSiteBackup(
  jobId: string,
  site: { id: string; domain: string; serverId: string; infoSnapshot: unknown },
  stepLabel: string,
): Promise<ReturnType<typeof parseSiteBackupOutput>> {
  await appendEvent(jobId, 1, "progress", `${stepLabel}: arquivos e banco de ${site.domain}`, 20);
  const db = dbCredentialsFromSite(site);
  const result = await execProbeForServer(site.serverId, siteBackupProbe(site.domain, db));
  const backup = parseSiteBackupOutput(result.stdout + result.stderr);
  if (result.code !== 0 || !backup.ok) {
    throw new Error(backup.error ?? "Falha ao criar backup de recuperação");
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

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "site.create", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Criando site ${input.domain} (${input.siteType})`, 5);

  const result = await execProbeForServer(input.serverId, siteCreateProbe({
    domain: input.domain,
    siteType: input.siteType,
    multisite: input.multisite,
    phpVersion: input.phpVersion,
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
  }));
  if (result.code !== 0) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Falha ao criar site";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_CREATE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await appendEvent(jobId, 2, "progress", "Site criado, registrando no inventário", 60);

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

  let infoParsed = {};
  try {
    infoParsed = await refreshSiteFromInfo(site.id, site.domain, input.serverId);
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
      resultJson: { siteId: site.id, domain: site.domain, ...infoParsed },
    },
  });
  await appendEvent(jobId, 3, "done", `Site ${site.domain} criado com sucesso`, 100);

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
    enable: "Ativando site",
    disable: "Desativando site",
    letsencrypt: "Configurando SSL Let's Encrypt",
    letsencrypt_dns_cf: "Configurando SSL via Cloudflare DNS",
    update_wpfc: "Migrando para WP + FastCGI cache",
    update_wpredis: "Migrando para WP + Redis",
    update_wprocket: "Migrando para WP + WP Rocket",
    update_wpsc: "Migrando para WP + Super Cache",
    update_wpce: "Migrando para WP + Cache Enabler",
    update_php81: "Alterando PHP para 8.1",
    update_php82: "Alterando PHP para 8.2",
    update_php83: "Alterando PHP para 8.3",
  };

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: parsed.data.action, progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", `${actionLabels[parsed.data.action] ?? parsed.data.action}: ${site.domain}`, 10);

  const result = await execProbeForServer(
    site.serverId,
    siteManageProbe(site.domain, parsed.data.action, {
      apiKey: parsed.data.cloudflareApiKey,
      email: parsed.data.cloudflareEmail,
    }),
  );
  if (result.code !== 0) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Operação falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SITE_MANAGE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  if (parsed.data.action === "enable") {
    await prisma.site.update({ where: { id: site.id }, data: { isEnabled: true, status: SiteStatus.active } });
  } else if (parsed.data.action === "disable") {
    await prisma.site.update({ where: { id: site.id }, data: { isEnabled: false, status: SiteStatus.disabled } });
  } else {
    await refreshSiteFromInfo(site.id, site.domain, site.serverId);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.succeeded, progress: 100, finishedAt: new Date() },
  });
  await appendEvent(jobId, 2, "done", "Operação concluída", 100);
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
    const backup = await executeSiteBackup(jobId, site, "Backup manual");
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        finishedAt: new Date(),
        resultJson: backup as object,
      },
    });
    await appendEvent(jobId, 3, "done", "Backup concluído", 100);
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

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "ftp.create", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", `Criando usuário FTP ${parsed.data.username}`, 10);

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
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  const homePath = `/var/www/${site.domain}/htdocs`;
  await prisma.siteFtpUser.upsert({
    where: { siteId_username: { siteId: site.id, username: parsed.data.username } },
    create: { siteId: site.id, username: parsed.data.username, homePath },
    update: { homePath },
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
      },
    },
  });
  await appendEvent(jobId, 2, "done", `Usuário FTP ${parsed.data.username} criado`, 100);

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
