import { JobStatus, SiteStatus, prisma } from "@opspanel/database";
import { siteMigrateFtpInputSchema } from "@opspanel/contracts";
import {
  hostnameFromSiteUrl,
  parseSiteInfoOutput,
  parseSiteMigrateMirrorOutput,
  parseSiteMigratePrepareOutput,
  parseWpConfigDbCredentials,
  parseWpConfigMultisite,
  siteInfoProbe,
  siteMigrateDbHealthProbe,
  siteMigrateFtpMirrorProbe,
  siteMigrateFinalizeProbe,
  siteMigrateImportProbe,
  siteMigrateOriginPhpDumpProbe,
  siteMigratePrepareWebrootProbe,
  siteMigrateSearchReplaceProbe,
  type WpMultisiteMode,
} from "@opspanel/wordops";
import { appendEvent, claimJob } from "./job-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession } from "./ssh-executor.js";
import { withDestSftp, writeRemoteBuffer } from "./dest-sftp.js";
import {
  detectRemoteSiteKind,
  downloadRemoteFileStream,
  listRemoteDirectory,
  type RemoteFtpCredentials,
} from "./source-ftp-client.js";

function isRemoteMysqlBlocked(output: string): boolean {
  return /remote_dump_failed|Access denied|1045|1130|not allowed to connect|Host .* is not allowed/i.test(
    output,
  );
}

async function failMigrateJob(
  jobId: string,
  sequence: number,
  errorCode: string,
  message: string,
) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.failed,
      finishedAt: new Date(),
      errorCode,
      errorMessage: message.slice(0, 800),
    },
  });
  await appendEvent(jobId, sequence, "error", message, 100);
}
async function execProbeForServer(serverId: string, probe: readonly string[], timeoutMs?: number) {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  try {
    return await session.execProbe(probe, { timeoutMs, pty: true });
  } finally {
    session.close();
  }
}

async function execProbeStreamingForServer(
  serverId: string,
  probe: readonly string[],
  onChunk: (text: string) => Promise<void> | void,
  timeoutMs = 3_600_000,
) {
  const target = await loadSshTargetForServer(serverId);
  const session = await connectSshSession(target);
  try {
    return await session.execProbeStreaming(
      probe,
      {
        onChunk: (chunk) => {
          void onChunk(chunk);
        },
      },
      timeoutMs,
    );
  } finally {
    session.close();
  }
}

function normalizeDbMode(mode: string): "none" | "hosting_mysql" | "phpmyadmin_export" | "auto_wpconfig" {
  if (mode === "remote") return "hosting_mysql";
  if (mode === "inline_sql") return "phpmyadmin_export";
  return mode as "none" | "hosting_mysql" | "phpmyadmin_export" | "auto_wpconfig";
}

function resolveWebroot(domain: string, siteInfo: ReturnType<typeof parseSiteInfoOutput>, siteType?: string | null): string {
  const isWp = siteInfo.isWordPress || siteType?.startsWith("wp") || siteType === "mysql" || Boolean(siteInfo.dbName);
  const reported = siteInfo.webroot?.replace(/\/+$/, "");
  if (reported) {
    if (isWp && !reported.endsWith("/htdocs")) return `${reported}/htdocs`;
    return reported;
  }
  return isWp ? `/var/www/${domain}/htdocs` : `/var/www/${domain}`;
}

function friendlyTransferError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/^Failure$/i.test(msg.trim())) {
    return "Falha na transferência FTP (timeout/conexão). A migração agora usa espelhamento em lote no servidor; tente novamente.";
  }
  return msg;
}

async function uploadSqlDumpToServer(serverId: string, domain: string, sqlBuffer: Buffer): Promise<string> {
  const remotePath = `/tmp/opspanel-migrate-upload-${domain.replace(/\./g, "-")}.sql`;
  const target = await loadSshTargetForServer(serverId);
  await withDestSftp(target, async (sftp) => {
    await writeRemoteBuffer(sftp, remotePath, sqlBuffer);
  });
  return remotePath;
}

async function loadSiteForJob(siteId: string, organizationId: string) {
  return prisma.site.findFirst({
    where: { id: siteId, organizationId, deletedAt: null, server: { deletedAt: null } },
    include: { server: true },
  });
}

export async function processSiteMigrateFtp(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;

  const parsed = siteMigrateFtpInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid site migrate input");

  const input = parsed.data;
  const dbMode = normalizeDbMode(input.dbMode ?? "hosting_mysql");

  const site = await loadSiteForJob(input.siteId, job.organizationId);
  if (!site) throw new Error("Site not found");

  const domain = site.domain.toLowerCase();
  const serverId = site.serverId;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.running,
      startedAt: new Date(),
      currentStep: "site.migrate.context",
      progress: 2,
      serverId,
    },
  });

  await appendEvent(jobId, 1, "progress", `Carregando site destino: ${domain}`, 5);

  const infoResult = await execProbeForServer(serverId, siteInfoProbe(domain));
  const siteInfo = parseSiteInfoOutput(infoResult.stdout + infoResult.stderr);
  const destWebroot = resolveWebroot(domain, siteInfo, site.siteType);
  const isWordPress = siteInfo.isWordPress || site.siteType?.startsWith("wp") || false;

  await appendEvent(
    jobId,
    2,
    "progress",
    `Destino: ${destWebroot}${siteInfo.dbName ? ` · MariaDB: ${siteInfo.dbName}` : ""}`,
    10,
  );

  const sourceCreds: RemoteFtpCredentials = {
    protocol: input.sourceProtocol,
    host: input.sourceHost,
    port: input.sourcePort,
    username: input.sourceUsername,
    password: input.sourcePassword,
  };

  await appendEvent(jobId, 3, "progress", "Conectando na origem FTP/SFTP...", 12);

  let detected;
  try {
    detected = await detectRemoteSiteKind(sourceCreds, input.sourcePath ?? "/");
  } catch (err) {
    let msg = err instanceof Error ? err.message : "Falha ao conectar na origem";
    if (/ENOTFOUND/i.test(msg)) {
      msg = `Host FTP não encontrado (DNS): ${input.sourceHost}. Confira o endereço no painel da hospedagem.`;
    } else if (/ECONNREFUSED/i.test(msg)) {
      msg = `Conexão recusada em ${input.sourceHost}. Verifique porta e protocolo (FTP/FTPS/SFTP).`;
    } else if (/530|Login incorrect|authentication/i.test(msg)) {
      msg = `Usuário ou senha FTP inválidos para ${input.sourceHost}.`;
    }
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "SOURCE_CONNECT_FAILED", errorMessage: msg },
    });
    await appendEvent(jobId, 4, "error", msg, 100);
    return;
  }

  await appendEvent(
    jobId,
    4,
    "progress",
    `Origem detectada: ${detected.kind}${detected.wpConfigPath ? " (wp-config.php)" : ""} · pasta ${detected.contentRoot}`,
    18,
  );
  if (detected.pathNote) {
    await appendEvent(jobId, 4, "log", detected.pathNote, 19);
  }

  // Validação leve (sem inventário recursivo de dezenas de milhares de arquivos)
  try {
    const top = await listRemoteDirectory(sourceCreds, detected.contentRoot);
    if (top.length === 0) {
      throw new Error(
        "Origem sem arquivos. Em HostGator addon domain use `/` (a conta FTP já abre no site).",
      );
    }
    await appendEvent(
      jobId,
      5,
      "progress",
      `Origem validada (${top.length} itens no nível raiz). Espelhamento em lote no servidor destino...`,
      22,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao validar origem";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "SOURCE_EMPTY", errorMessage: msg },
    });
    await appendEvent(jobId, 5, "error", msg, 100);
    return;
  }

  await appendEvent(jobId, 6, "progress", `Preparando pasta destino ${destWebroot}...`, 24);
  const prepareResult = await execProbeForServer(serverId, siteMigratePrepareWebrootProbe(domain, destWebroot));
  const prepareOut = prepareResult.stdout + prepareResult.stderr;
  const prepared = parseSiteMigratePrepareOutput(prepareOut);
  if (!prepared.ok || !prepared.webroot) {
    const errMsg =
      prepared.error ??
      `Preparação do webroot incompleta: ${(prepareOut || "").replace(/\r/g, "").slice(-300)}`;
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "WEBROOT_PREPARE_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 6, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({ where: { id: jobId }, data: { currentStep: "site.migrate.transfer", progress: 28 } });
  await appendEvent(
    jobId,
    7,
    "progress",
    "Espelhando arquivos via lftp no servidor WordOps (pode levar vários minutos)...",
    30,
  );

  let mirrorLog = "";
  let lastProgressAt = 0;
  let mirrorLines = 0;
  try {
    const mirrorProbe = siteMigrateFtpMirrorProbe({
      protocol: sourceCreds.protocol,
      host: sourceCreds.host,
      port: sourceCreds.port,
      username: sourceCreds.username,
      password: sourceCreds.password,
      sourcePath: detected.contentRoot,
      destWebroot: prepared.webroot,
    });

    const mirrorResult = await execProbeStreamingForServer(
      serverId,
      mirrorProbe,
      async (chunk) => {
        mirrorLog += chunk;
        if (mirrorLog.length > 200_000) mirrorLog = mirrorLog.slice(-120_000);
        const lines = chunk.split("\n").filter((l) => l.trim());
        mirrorLines += lines.length;
        const now = Date.now();
        if (now - lastProgressAt > 4000) {
          lastProgressAt = now;
          const pct = Math.min(72, 30 + Math.floor(mirrorLines / 40));
          await prisma.job.update({ where: { id: jobId }, data: { progress: pct } });
          const preview = lines[lines.length - 1]?.slice(0, 160) ?? "Espelhando...";
          await appendEvent(jobId, 8, "progress", preview, pct);
        }
      },
      3_600_000,
    );

    const combinedMirrorOut = `${mirrorLog}\n${mirrorResult.stdout}\n${mirrorResult.stderr}`;
    const parsedMirror = parseSiteMigrateMirrorOutput(combinedMirrorOut);
    if (mirrorResult.code !== 0 || !parsedMirror.ok) {
      const tail = combinedMirrorOut.replace(/\r/g, "").trim().split("\n").slice(-8).join(" | ");
      const detail = parsedMirror.error ?? friendlyTransferError(new Error("Failure"));
      throw new Error(tail ? `${detail} · ${tail.slice(0, 400)}` : detail);
    }
    await appendEvent(
      jobId,
      9,
      "progress",
      `Arquivos espelhados com sucesso (${parsedMirror.fileCount ?? "?"} arquivos no destino)`,
      75,
    );
  } catch (err) {
    const msg = friendlyTransferError(err);
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "FILE_TRANSFER_FAILED", errorMessage: msg },
    });
    await appendEvent(jobId, 8, "error", msg, 100);
    return;
  }

  let wpDbFromConfig: ReturnType<typeof parseWpConfigDbCredentials> | null = null;
  let sourceMultisite: ReturnType<typeof parseWpConfigMultisite> = { mode: "none" };
  if (detected.wpConfigPath) {
    try {
      const wpConfigBuf = await downloadRemoteFileStream(sourceCreds, detected.wpConfigPath);
      const wpConfigText = wpConfigBuf.toString("utf8");
      wpDbFromConfig = parseWpConfigDbCredentials(wpConfigText);
      sourceMultisite = parseWpConfigMultisite(wpConfigText);
    } catch {
      /* ignore */
    }
  }

  const destMultisiteRaw = siteInfo.multisite;
  const destMultisiteMode: WpMultisiteMode =
    destMultisiteRaw === "subdir" || destMultisiteRaw === "subdomain"
      ? destMultisiteRaw
      : destMultisiteRaw === "multisite"
        ? "subdir"
        : "none";

  // Preferência: Multisite da origem (conteúdo migrado). Destino WordOps com --wpsubdir garante Nginx.
  const effectiveMultisite: WpMultisiteMode =
    sourceMultisite.mode !== "none" ? sourceMultisite.mode : destMultisiteMode;

  if (sourceMultisite.mode !== "none") {
    await appendEvent(
      jobId,
      9,
      "progress",
      `Origem Multisite detectada (${sourceMultisite.mode === "subdir" ? "subpastas" : "subdomínios"}${
        sourceMultisite.domainCurrentSite ? ` · ${sourceMultisite.domainCurrentSite}` : ""
      })`,
      74,
    );
    if (destMultisiteMode === "none") {
      await appendEvent(
        jobId,
        9,
        "log",
        "Aviso: o destino não foi criado como Multisite no WordOps. Crie o site com rede em subpastas (--wpsubdir) para o Nginx mapear /site1, /site2 corretamente.",
        74,
      );
    } else if (destMultisiteMode !== sourceMultisite.mode) {
      await appendEvent(
        jobId,
        9,
        "log",
        `Aviso: origem é Multisite ${sourceMultisite.mode} e o destino WordOps é ${destMultisiteMode}. A migração ajusta o wp-config para o modo da origem.`,
        74,
      );
    }
  }

  const destDb =
    siteInfo.dbName && siteInfo.dbUser && siteInfo.dbPass
      ? { name: siteInfo.dbName, user: siteInfo.dbUser, pass: siteInfo.dbPass, host: siteInfo.dbHost ?? "localhost" }
      : undefined;

  if (destDb && isWordPress) {
    await appendEvent(jobId, 9, "progress", "Ajustando wp-config e limpando resíduos da hospedagem antiga...", 76);
    const finalizeResult = await execProbeForServer(
      serverId,
      siteMigrateFinalizeProbe({
        domain,
        destDb,
        multisiteMode: effectiveMultisite,
        pathCurrentSite: effectiveMultisite === "subdir" ? "/" : sourceMultisite.pathCurrentSite || "/",
      }),
      120_000,
    );
    if (finalizeResult.code !== 0 || !/OPS_MIGRATE_FINALIZE_OK=1/.test(finalizeResult.stdout + finalizeResult.stderr)) {
      const msg = (finalizeResult.stdout + finalizeResult.stderr).slice(0, 400) || "Falha ao finalizar wp-config";
      await failMigrateJob(
        jobId,
        9,
        "MIGRATE_FINALIZE_FAILED",
        `Não foi possível ajustar o wp-config para o MariaDB do WordOps: ${msg}`,
      );
      return;
    }
    await appendEvent(
      jobId,
      9,
      "progress",
      effectiveMultisite !== "none"
        ? `wp-config: MariaDB WordOps + Multisite (${effectiveMultisite})`
        : "wp-config apontando para MariaDB do WordOps",
      77,
    );
  }

  const shouldImportDb =
    dbMode !== "none" && (isWordPress || dbMode === "hosting_mysql" || dbMode === "phpmyadmin_export" || dbMode === "auto_wpconfig");

  if (shouldImportDb) {
    await prisma.job.update({ where: { id: jobId }, data: { currentStep: "site.migrate.database", progress: 78 } });
    await appendEvent(
      jobId,
      10,
      "progress",
      "Importando MySQL da hospedagem para MariaDB (compatibilidade automática)...",
      80,
    );

    const vpsIp = (await loadSshTargetForServer(serverId)).host;
    const dbHelp = `Como resolver: 1) No cPanel da hospedagem, Remote MySQL, libere o IP ${vpsIp}. 2) Ou exporte o banco no phpMyAdmin (SQL) e rode a migração de novo escolhendo "Arquivo .sql".`;

    if (!destDb) {
      await failMigrateJob(
        jobId,
        11,
        "MIGRATE_DB_DEST_MISSING",
        `Banco MariaDB do destino não foi detectado. Crie o site no WordOps com WordPress/MySQL antes de migrar. ${dbHelp}`,
      );
      return;
    }

    let remoteDb: { host: string; port?: number; name: string; user: string; password: string } | undefined;
    let sqlDumpPath: string | undefined;

    if (dbMode === "phpmyadmin_export" && input.sqlDumpBase64) {
      const sqlBuffer = Buffer.from(input.sqlDumpBase64, "base64");
      sqlDumpPath = await uploadSqlDumpToServer(serverId, domain, sqlBuffer);
      await appendEvent(jobId, 11, "log", "Arquivo exportado do phpMyAdmin recebido", 82);
    } else if (dbMode === "hosting_mysql" && input.dbHost && input.dbName && input.dbUser && input.dbPassword) {
      remoteDb = {
        host: input.dbHost,
        port: input.dbPort,
        name: input.dbName,
        user: input.dbUser,
        password: input.dbPassword,
      };
    } else if (dbMode === "auto_wpconfig" && wpDbFromConfig) {
      const [hostPart, portPart] = wpDbFromConfig.dbHost.split(":");
      const rawHost = (hostPart ?? "localhost").trim().toLowerCase();
      const remoteHost =
        !rawHost || rawHost === "localhost" || rawHost === "127.0.0.1" ? sourceCreds.host : hostPart!;
      remoteDb = {
        host: remoteHost,
        port: portPart ? Number.parseInt(portPart, 10) : undefined,
        name: wpDbFromConfig.dbName,
        user: wpDbFromConfig.dbUser,
        password: wpDbFromConfig.dbPassword,
      };
    }

    if (!remoteDb && !sqlDumpPath) {
      await failMigrateJob(
        jobId,
        12,
        "MIGRATE_DB_SOURCE_MISSING",
        `Não foi possível obter o banco da origem (credenciais/wp-config/arquivo SQL ausentes). ${dbHelp}`,
      );
      return;
    }

    const runImport = async (opts: {
      remoteDb?: typeof remoteDb;
      sqlDumpPath?: string;
    }) =>
      execProbeForServer(
        serverId,
        siteMigrateImportProbe({
          domain,
          destDb,
          remoteDb: opts.remoteDb,
          sqlDumpPath: opts.sqlDumpPath,
          oldUrl: input.oldUrl,
          multisiteMode: effectiveMultisite,
          oldPath: sourceMultisite.pathCurrentSite,
        }),
        900_000,
      );

    let importResult = await runImport({ remoteDb, sqlDumpPath });
    let importOut = importResult.stdout + importResult.stderr;

    if (
      (importResult.code !== 0 || !/OPS_MIGRATE_OK=1/.test(importOut)) &&
      remoteDb &&
      !sqlDumpPath &&
      isRemoteMysqlBlocked(importOut) &&
      (sourceCreds.protocol === "ftp" || sourceCreds.protocol === "ftps")
    ) {
      await appendEvent(
        jobId,
        11,
        "progress",
        `Remote MySQL bloqueou o IP ${vpsIp}. Tentando exportar o banco pela origem via FTP (automático)...`,
        83,
      );
      try {
        const dumpResult = await execProbeForServer(
          serverId,
          siteMigrateOriginPhpDumpProbe({
            domain,
            ftp: sourceCreds,
            remoteDb,
            httpHost: hostnameFromSiteUrl(input.oldUrl || "") || domain,
          }),
          1_200_000,
        );
        const dumpOut = dumpResult.stdout + dumpResult.stderr;
        if (dumpResult.code === 0 && /OPS_MIGRATE_FTP_PHP_DUMP_OK=1/.test(dumpOut)) {
          await appendEvent(jobId, 11, "log", "Dump via FTP concluído. Importando no MariaDB...", 85);
          importResult = await runImport({
            sqlDumpPath: `/tmp/opspanel-migrate-${domain}.sql`,
          });
          importOut = importResult.stdout + importResult.stderr;
        } else {
          importOut = `${importOut}\n${dumpOut}`.slice(0, 1200);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        importOut = `${importOut}\nftp_php_fallback_error=${msg}`.slice(0, 1200);
      }
    }

    if (importResult.code !== 0 || !/OPS_MIGRATE_OK=1/.test(importOut)) {
      const errMsg = importOut.slice(0, 500) || "Falha ao importar banco";
      await failMigrateJob(
        jobId,
        12,
        "MIGRATE_DB_IMPORT_FAILED",
        `Falha ao importar o banco da hospedagem: ${errMsg}. ${dbHelp}`,
      );
      return;
    }

    await appendEvent(jobId, 12, "progress", "Banco convertido MySQL → MariaDB e importado", 88);

    const health = await execProbeForServer(serverId, siteMigrateDbHealthProbe(domain), 120_000);
    const healthOut = health.stdout + health.stderr;
    if (health.code !== 0 || !/OPS_MIGRATE_DB_HEALTH_OK=1/.test(healthOut)) {
      await failMigrateJob(
        jobId,
        12,
        "MIGRATE_DB_HEALTH_FAILED",
        `O banco foi importado, mas o site ainda não responde corretamente (${healthOut.slice(0, 300)}). ${dbHelp}`,
      );
      return;
    }
    await appendEvent(jobId, 12, "log", "Checagem do banco OK (tabelas do prefixo + HTTP)", 90);
  }

  const oldUrlForReplace =
    input.oldUrl?.trim() ||
    (sourceMultisite.domainCurrentSite ? `https://${sourceMultisite.domainCurrentSite}` : undefined);

  if (oldUrlForReplace && isWordPress) {
    await appendEvent(
      jobId,
      13,
      "progress",
      effectiveMultisite !== "none"
        ? "Atualizando URLs da rede Multisite (domínios e paths)..."
        : "Atualizando URLs no WordPress...",
      92,
    );
    await execProbeForServer(
      serverId,
      siteMigrateSearchReplaceProbe(domain, oldUrlForReplace, {
        multisiteMode: effectiveMultisite,
        oldPath: sourceMultisite.pathCurrentSite,
      }),
    );
  } else if (effectiveMultisite !== "none" && !oldUrlForReplace) {
    await appendEvent(
      jobId,
      13,
      "log",
      "Multisite sem URL antiga informada. DOMAIN_CURRENT_SITE já foi ajustado; revise links em wp_blogs se necessário.",
      92,
    );
  }

  let infoParsed = siteInfo;
  try {
    const refreshResult = await execProbeForServer(serverId, siteInfoProbe(domain));
    infoParsed = parseSiteInfoOutput(refreshResult.stdout + refreshResult.stderr);
    await prisma.site.update({
      where: { id: site.id },
      data: {
        siteType: infoParsed.siteType ?? site.siteType,
        phpVersion: infoParsed.phpVersion,
        cacheBackend: infoParsed.cacheBackend,
        isEnabled: infoParsed.isEnabled,
        infoSnapshot: infoParsed as object,
        status: SiteStatus.active,
        lastObservedAt: new Date(),
      },
    });
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
        domain,
        webroot: prepared.webroot,
        detectedKind: detected.kind,
        dbEngine: "mariadb",
        ...infoParsed,
      },
    },
  });
  await appendEvent(jobId, 14, "done", `Migração de ${domain} concluída`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "site.migrate.ftp.succeeded",
      targetType: "site",
      targetId: site.id,
      result: "success",
      metadata: { domain, sourceHost: input.sourceHost, detectedKind: detected.kind, webroot: prepared.webroot },
    },
  });
}
