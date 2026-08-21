import { JobStatus, Prisma, ServerStatus, prisma } from "@opspanel/database";
import {
  serverHealthCollectInputSchema,
  serverMaintenanceInputSchema,
  serverMetricsCollectInputSchema,
  serverRebootInputSchema,
  serverStackInputSchema,
  serverStackMigrateInputSchema,
  serverSystemUpdateInputSchema,
  serverUfwConfigureInputSchema,
  serverWordOpsDashboardRecoverInputSchema,
  serverWordOpsInstallInputSchema,
  serverSecurityScanInputSchema,
} from "@opspanel/contracts";
import {
  healthCollectProbe,
  maintenanceProbe,
  metricsCollectProbe,
  parseHealthCollectOutput,
  parseMetricsCollectOutput,
  parseSecurityScanOutput,
  parseWordOpsDashboardCredentials,
  parseWordOpsVersion,
  securityScanProbe,
  serverRebootProbe,
  serverStackRestartProbe,
  stackActionProbe,
  stackMigrateProbe,
  systemUpdateProbe,
  ufwAllowPortsProbe,
  ufwConfigureProbe,
  wordOpsDashboardRecoverProbe,
  wordOpsInstallProbe,
  wordOpsVerifyProbe,
} from "@opspanel/wordops";
import { appendEvent, appendOutputLogs, claimJob } from "./job-utils.js";
import { mergeOnboardingStep, saveWordOpsDashboard } from "./onboarding-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession, testSshConnection } from "./ssh-executor.js";

function defaultUfwPorts(sshPort: number, extra?: number[]): number[] {
  return [...new Set([sshPort, 22, 80, 443, 22222, ...(extra ?? [])])];
}

async function ufwPortsForServer(serverId: string, extra?: number[]): Promise<number[]> {
  const server = await prisma.server.findUnique({ where: { id: serverId }, select: { port: true } });
  return defaultUfwPorts(server?.port ?? 22, extra);
}

async function verifySshOrThrow(serverId: string): Promise<{ host: string; port: number }> {
  const target = await loadSshTargetForServer(serverId);
  const result = await testSshConnection(target);
  if (!result.ok) {
    throw new Error(
      `SSH indisponível em ${target.host}:${target.port}. ` +
        `Confirme host, porta (ex.: HostGator usa 22022), senha e se o firewall liberou a porta ${target.port}. ` +
        (result.errorMessage ?? "Timed out while waiting for handshake"),
    );
  }
  return { host: target.host, port: target.port };
}

async function execProbeForServer(serverId: string, probe: readonly string[]) {
  const target = await loadSshTargetForServer(serverId);
  let session;
  try {
    session = await connectSshSession(target);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SSH ${target.host}:${target.port} falhou (${detail}). ` +
        `Verifique credenciais e se o UFW liberou a porta ${target.port} (não apenas 22).`,
    );
  }
  try {
    return await session.execProbe(probe);
  } finally {
    session.close();
  }
}

async function refreshServerHealthFromServer(serverId: string) {
  const result = await execProbeForServer(serverId, healthCollectProbe());
  const snapshot = parseHealthCollectOutput(result.stdout + result.stderr);
  const hasData =
    Boolean(snapshot.stackComponents?.length) ||
    Boolean(snapshot.stackServices?.length) ||
    snapshot.uptimeSeconds != null ||
    Boolean(snapshot.wordopsVersion) ||
    snapshot.memoryUsedPct != null;

  if (!hasData) return snapshot;

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  const prev = (server?.healthSnapshot as Record<string, unknown> | null) ?? {};
  const merged = {
    ...prev,
    ...snapshot,
    collectedAt: snapshot.collectedAt ?? new Date().toISOString(),
  };

  const observedAt = new Date();
  await prisma.server.update({
    where: { id: serverId },
    data: {
      healthSnapshot: JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonValue,
      healthObservedAt: observedAt,
      lastConnectedAt: observedAt,
      ...(snapshot.wordopsVersion ? { wordopsVersion: snapshot.wordopsVersion } : {}),
    },
  });
  return snapshot;
}

export { refreshServerHealthFromServer };

function stackInstallsWeb(components: string[]): boolean {
  return components.includes("web") || (components.includes("nginx") && components.includes("mysql"));
}

export async function processServerHealthCollect(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverHealthCollectInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid health collect input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "health.collect", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Verificando conexão SSH…", 8);
  try {
    await verifySshOrThrow(parsed.data.serverId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "SSH indisponível";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "SSH_CONNECTION_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }
  await appendEvent(jobId, 3, "progress", "Coletando métricas do sistema e status WordOps", 15);

  const result = await execProbeForServer(parsed.data.serverId, healthCollectProbe());
  const snapshot = parseHealthCollectOutput(result.stdout + result.stderr);

  if (result.code !== 0 && !snapshot.uptimeSeconds) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Falha ao coletar saúde";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "HEALTH_COLLECT_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  const observedAt = new Date();
    await prisma.server.update({
      where: { id: parsed.data.serverId },
      data: {
        healthSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        healthObservedAt: observedAt,
        status: ServerStatus.healthy,
        lastConnectedAt: observedAt,
        ...(snapshot.wordopsVersion ? { wordopsVersion: snapshot.wordopsVersion } : {}),
      },
    });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: snapshot as object,
    },
  });
  await appendEvent(jobId, 2, "done", "Saúde do servidor atualizada", 100);
}

export async function processServerStackAction(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverStackInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid stack action input");

  const { action, components, force } = parsed.data;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: `stack.${action}`, progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", `Executando wo stack ${action} (${components.join(", ")})`, 5);

  if (action === "install" && components.includes("ufw")) {
    await appendEvent(jobId, 2, "progress", "Preparando regras UFW (SSH/HTTP/HTTPS) antes da instalação…", 8);
    const ports = await ufwPortsForServer(job.serverId);
    const preUfw = await execProbeForServer(job.serverId, ufwAllowPortsProbe(ports));
    await appendOutputLogs(jobId, preUfw.stdout + preUfw.stderr, 3);
  }

  const result = await execProbeForServer(job.serverId, stackActionProbe(action, components, force));
  const fullOutput = result.stdout + result.stderr;
  const output = fullOutput.slice(0, 8000);
  await appendOutputLogs(jobId, fullOutput, 2);

  if (result.code !== 0) {
    const errMsg = output.slice(0, 500) || "Operação de stack falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "STACK_ACTION_FAILED",
        errorMessage: errMsg,
        resultJson: { action, components, outputFull: fullOutput.slice(0, 12000) },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  const dashboard = parseWordOpsDashboardCredentials(fullOutput);
  if (dashboard) {
    await saveWordOpsDashboard(job.serverId, dashboard);
    await appendEvent(
      jobId,
      895,
      "progress",
      `Dashboard WordOps detectado${dashboard.url ? `: ${dashboard.url}` : ""}`,
      85,
    );
  }

  if (action === "status") {
    const stackPart = parseHealthCollectOutput(`===OPS_STACK===\n${fullOutput}`);
    const server = await prisma.server.findUnique({ where: { id: job.serverId } });
    const prev = (server?.healthSnapshot as Record<string, unknown> | null) ?? {};
    await prisma.server.update({
      where: { id: job.serverId },
      data: {
        healthSnapshot: {
          ...prev,
          stackServices: stackPart.stackServices,
          stackComponents: stackPart.stackComponents,
          rawStackStatus: stackPart.rawStackStatus,
          collectedAt: new Date().toISOString(),
        },
        healthObservedAt: new Date(),
      } as Record<string, unknown>,
    });
    await mergeOnboardingStep(job.serverId, "stack_verify");
  }

  if (action === "install") {
    if (stackInstallsWeb(components)) {
      await mergeOnboardingStep(job.serverId, "stack_install");
    }
    if (components.includes("ufw")) {
      await appendEvent(jobId, 870, "progress", "Liberando portas SSH/HTTP/HTTPS no UFW antes de ativar…", 72);
      const ports = await ufwPortsForServer(job.serverId);
      const ufwResult = await execProbeForServer(job.serverId, ufwAllowPortsProbe(ports));
      const ufwOutput = ufwResult.stdout + ufwResult.stderr;
      await appendOutputLogs(jobId, ufwOutput, 871);
      if (ufwResult.code !== 0) {
        const errMsg = ufwOutput.slice(0, 500) || "Falha ao liberar portas no UFW";
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.failed,
            finishedAt: new Date(),
            errorCode: "UFW_PORTS_FAILED",
            errorMessage: errMsg,
            resultJson: { action, components, outputFull: fullOutput.slice(0, 12000) },
          },
        });
        await appendEvent(jobId, 899, "error", errMsg, 100);
        return;
      }
    }
    if (
      components.some((c) => ["fail2ban", "ngxblocker", "ufw"].includes(c)) ||
      components.includes("admin")
    ) {
      await mergeOnboardingStep(job.serverId, "security_stack");
    }
    if (components.some((c) => ["netdata", "dashboard"].includes(c))) {
      await mergeOnboardingStep(job.serverId, "monitoring");
    }
    await appendEvent(jobId, 885, "progress", "Atualizando inventário da stack (wo stack status)…", 88);
    await refreshServerHealthFromServer(job.serverId);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        action,
        components,
        outputPreview: output.slice(0, 1500),
        outputFull: fullOutput.slice(0, 12000),
        dashboardCaptured: Boolean(dashboard),
      },
    },
  });
  await appendEvent(jobId, 900, "done", `Stack ${action} concluída`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: `server.stack.${action}.succeeded`,
      targetType: "server",
      targetId: job.serverId,
      result: "success",
      metadata: { components },
    },
  });
}

export async function processServerMaintenance(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverMaintenanceInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid maintenance input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "maintenance", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", "Executando wo maintenance (apt update/upgrade)", 5);

  const result = await execProbeForServer(job.serverId, maintenanceProbe());
  const output = (result.stdout + result.stderr).slice(0, 4000);

  if (result.code !== 0) {
    const errMsg = output.slice(0, 500) || "Manutenção falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "MAINTENANCE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { outputPreview: output.slice(0, 1500) },
    },
  });
  await appendEvent(jobId, 2, "done", "Manutenção concluída", 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "server.maintenance.succeeded",
      targetType: "server",
      targetId: job.serverId,
      result: "success",
    },
  });
}

export async function processServerSystemUpdate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverSystemUpdateInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid system update input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "system.update", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", "Executando apt update/upgrade (sem WordOps)", 5);

  const result = await execProbeForServer(job.serverId, systemUpdateProbe());
  const output = (result.stdout + result.stderr).slice(0, 4000);

  if (result.code !== 0 || !/OPS_SYSTEM_UPDATE_OK=1/.test(output)) {
    const errMsg = output.slice(0, 500) || "Atualização do sistema falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SYSTEM_UPDATE_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { outputPreview: output.slice(0, 1500) },
    },
  });
  await appendEvent(jobId, 2, "done", "Sistema atualizado", 100);
  await mergeOnboardingStep(job.serverId, "system_update");

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: "server.system_update.succeeded",
      targetType: "server",
      targetId: job.serverId,
      result: "success",
    },
  });
}

export async function processServerMetricsCollect(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverMetricsCollectInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid metrics collect input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "metrics.collect", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Coletando métricas Netdata e Nginx", 10);

  const result = await execProbeForServer(parsed.data.serverId, metricsCollectProbe());
  const snapshot = parseMetricsCollectOutput(result.stdout + result.stderr);

  if (result.code !== 0 && !snapshot.netdataAvailable && !snapshot.stubStatus) {
    const errMsg = (result.stdout + result.stderr).slice(0, 500) || "Falha ao coletar métricas";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "METRICS_COLLECT_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  const observedAt = new Date();
  const targetServerId = job.serverId ?? parsed.data.serverId;
  await prisma.server.update({
    where: { id: targetServerId },
    data: {
      metricsSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
      metricsObservedAt: observedAt,
      lastConnectedAt: observedAt,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: snapshot as object,
    },
  });
  await appendEvent(jobId, 2, "done", "Métricas atualizadas", 100);
}

export async function processServerWordOpsInstall(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverWordOpsInstallInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid WordOps install input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "wordops.install", progress: 5 },
  });
  await appendEvent(jobId, 1, "progress", "Instalando WordOps (wops.cc)… pode levar alguns minutos", 5);

  const result = await execProbeForServer(
    parsed.data.serverId,
    wordOpsInstallProbe(parsed.data.adminEmail),
  );
  const fullOutput = result.stdout + result.stderr;
  await appendOutputLogs(jobId, fullOutput, 2);

  let wordopsVersion = parseWordOpsVersion(fullOutput);
  let verifyOutput = "";

  if (!wordopsVersion || !/OPS_WORDOPS_INSTALL_DONE=1/.test(fullOutput)) {
    await appendEvent(jobId, 850, "progress", "Verificando instalação com wo version…", 70);
    const verify = await execProbeForServer(parsed.data.serverId, wordOpsVerifyProbe());
    verifyOutput = verify.stdout + verify.stderr;
    await appendOutputLogs(jobId, verifyOutput, 860);
    wordopsVersion = parseWordOpsVersion(verifyOutput) ?? wordopsVersion;
  }

  const verified = Boolean(wordopsVersion) && /OPS_WORDOPS_VERIFY_DONE=1|WordOps v/i.test(verifyOutput || fullOutput);

  if (!wordopsVersion) {
    const errMsg = (fullOutput + verifyOutput).slice(0, 500) || "WordOps não detectado após instalação (wo version vazio)";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "WORDOPS_INSTALL_FAILED",
        errorMessage: errMsg,
        resultJson: { outputFull: (fullOutput + verifyOutput).slice(0, 12000), verified: false },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  await prisma.server.update({
    where: { id: parsed.data.serverId },
    data: {
      wordopsVersion,
      lastConnectedAt: new Date(),
      status: ServerStatus.healthy,
    },
  });
  await mergeOnboardingStep(parsed.data.serverId, "wordops_install");

  const dashboard = parseWordOpsDashboardCredentials(fullOutput + verifyOutput);
  if (dashboard) {
    await saveWordOpsDashboard(parsed.data.serverId, dashboard);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        wordopsVersion,
        verified,
        verifyCommand: "wo version",
        outputPreview: fullOutput.slice(0, 1500),
        outputFull: (fullOutput + verifyOutput).slice(0, 12000),
        dashboardCaptured: Boolean(dashboard),
      },
    },
  });
  await appendEvent(
    jobId,
    900,
    "done",
    `WordOps instalado e verificado v${wordopsVersion}${verified ? "" : " (verificação parcial)"}`,
    100,
  );
}

export async function processServerWordOpsDashboardRecover(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverWordOpsDashboardRecoverInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid WordOps dashboard recover input");

  const server = await prisma.server.findUnique({ where: { id: parsed.data.serverId } });
  if (!server) throw new Error("Server not found");

  const mode = parsed.data.mode ?? "reset";
  const stepLabel =
    mode === "reset"
      ? "Recuperando acesso admin (wo secure --auth)…"
      : "Capturando credenciais do dashboard (wo stack install --dashboard)…";

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.running,
      startedAt: new Date(),
      currentStep: "wordops.dashboard.recover",
      progress: 10,
    },
  });
  await appendEvent(jobId, 1, "progress", stepLabel, 10);

  const result = await execProbeForServer(
    parsed.data.serverId,
    wordOpsDashboardRecoverProbe({
      host: server.host,
      mode,
      username: parsed.data.username,
      password: parsed.data.password,
    }),
  );
  const fullOutput = result.stdout + result.stderr;
  await appendOutputLogs(jobId, fullOutput, 2);

  const parsedCreds = parseWordOpsDashboardCredentials(fullOutput);
  let dashboard = parsedCreds;
  if (!dashboard && mode === "reset" && parsed.data.username && parsed.data.password) {
    dashboard = {
      url: `https://${server.host}:22222`,
      username: parsed.data.username,
      password: parsed.data.password,
      capturedAt: new Date().toISOString(),
    };
  }

  if (dashboard?.username && dashboard.password) {
    await saveWordOpsDashboard(parsed.data.serverId, {
      url: dashboard.url ?? `https://${server.host}:22222`,
      username: dashboard.username,
      password: dashboard.password,
      capturedAt: dashboard.capturedAt ?? new Date().toISOString(),
    });
    await mergeOnboardingStep(parsed.data.serverId, "monitoring");
  }

  if (result.code !== 0 || !/OPS_DASHBOARD_RECOVER_DONE=1/.test(fullOutput)) {
    const errMsg =
      fullOutput.slice(0, 500) ||
      (mode === "reset"
        ? "Falha ao executar wo secure --auth no servidor"
        : "Falha ao capturar credenciais do dashboard");
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "WORDOPS_DASHBOARD_RECOVER_FAILED",
        errorMessage: errMsg,
        resultJson: { mode, outputFull: fullOutput.slice(0, 12000) },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  if (!dashboard?.username || !dashboard?.password) {
    const errMsg = "Comando concluiu, mas usuário/senha HTTP não foram detectados na saída.";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "WORDOPS_DASHBOARD_PARSE_FAILED",
        errorMessage: errMsg,
        resultJson: { mode, outputFull: fullOutput.slice(0, 12000) },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        mode,
        username: dashboard.username,
        url: dashboard.url ?? `https://${server.host}:22222`,
        dashboardCaptured: true,
        outputPreview: fullOutput.slice(0, 1500),
        outputFull: fullOutput.slice(0, 12000),
      },
    },
  });
  await appendEvent(
    jobId,
    901,
    "done",
    mode === "reset"
      ? `Acesso admin recuperado (usuário ${dashboard.username})`
      : "Credenciais do dashboard capturadas",
    100,
  );
}

export async function processServerStackMigrate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverStackMigrateInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid stack migrate input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "stack.migrate", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Migrando stack para MariaDB…", 10);

  const result = await execProbeForServer(parsed.data.serverId, stackMigrateProbe(parsed.data.target));
  const output = (result.stdout + result.stderr).slice(0, 4000);

  if (result.code !== 0) {
    const errMsg = output.slice(0, 500) || "Migração MariaDB falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "STACK_MIGRATE_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await mergeOnboardingStep(parsed.data.serverId, "mariadb_migrate");

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { target: parsed.data.target, outputPreview: output.slice(0, 1500) },
    },
  });
  await appendEvent(jobId, 2, "done", "Migração MariaDB concluída", 100);
}

export async function processServerUfwConfigure(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverUfwConfigureInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid UFW configure input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "ufw.configure", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Verificando conexão SSH…", 8);
  try {
    await verifySshOrThrow(parsed.data.serverId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "SSH indisponível";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "SSH_CONNECTION_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  const ufwPorts = await ufwPortsForServer(parsed.data.serverId, parsed.data.ports);
  await appendEvent(jobId, 3, "progress", `Configurando UFW (portas: ${ufwPorts.join(", ")})…`, 12);

  const result = await execProbeForServer(
    parsed.data.serverId,
    ufwConfigureProbe(ufwPorts),
  );
  const fullOutput = result.stdout + result.stderr;
  const output = fullOutput.slice(0, 8000);
  await appendOutputLogs(jobId, fullOutput, 2);

  if (result.code !== 0) {
    const errMsg = output.slice(0, 500) || "Configuração UFW falhou";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "UFW_CONFIGURE_FAILED",
        errorMessage: errMsg,
        resultJson: { ports: ufwPorts, outputFull: fullOutput.slice(0, 12000) },
      },
    });
    await appendEvent(jobId, 900, "error", errMsg, 100);
    return;
  }

  await mergeOnboardingStep(parsed.data.serverId, "ufw_ports");

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        ports: ufwPorts,
        outputPreview: output.slice(0, 1500),
        outputFull: fullOutput.slice(0, 12000),
      },
    },
  });
  await appendEvent(jobId, 901, "done", "Firewall configurado", 100);
}

export async function processServerReboot(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverRebootInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid reboot input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "server.reboot", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Agendando reinicialização do servidor em 1 minuto", 10);

  const result = await execProbeForServer(parsed.data.serverId, serverRebootProbe());
  const output = result.stdout + result.stderr;

  if (result.code !== 0 || !/OPS_REBOOT_SCHEDULED=1/.test(output)) {
    const errMsg = output.slice(0, 500) || "Falha ao agendar reinicialização";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "SERVER_REBOOT_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { scheduledInSeconds: 60 },
    },
  });
  await appendEvent(jobId, 2, "done", "Servidor reiniciará em aproximadamente 1 minuto", 100);
}

export async function processServerStackRestart(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const serverId = (job.inputJson as { serverId?: string })?.serverId ?? job.serverId;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "stack.restart", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Reiniciando stack WordOps (nginx, PHP, MariaDB…)", 10);

  const result = await execProbeForServer(serverId, serverStackRestartProbe());
  const output = (result.stdout + result.stderr).slice(0, 4000);

  if (result.code !== 0) {
    const errMsg = output.slice(0, 500) || "Falha ao reiniciar stack";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.failed, finishedAt: new Date(), errorCode: "STACK_RESTART_FAILED", errorMessage: errMsg },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: { outputPreview: output.slice(0, 1500) },
    },
  });
  await appendEvent(jobId, 2, "done", "Stack WordOps reiniciada", 100);
}

export async function processServerSecurityScan(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverSecurityScanInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Invalid security scan input");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "security.scan", progress: 10 },
  });
  await appendEvent(jobId, 1, "progress", "Verificando conexão SSH…", 8);

  try {
    await verifySshOrThrow(parsed.data.serverId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "SSH indisponível";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SSH_CONNECTION_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 2, "error", errMsg, 100);
    return;
  }

  await appendEvent(jobId, 3, "progress", "Coletando UFW, fail2ban, portas e SSHD…", 25);
  const result = await execProbeForServer(parsed.data.serverId, securityScanProbe());
  const full = result.stdout + result.stderr;
  await appendOutputLogs(jobId, full, 4);
  const snapshot = parseSecurityScanOutput(full);

  if (result.code !== 0 && !snapshot.collectedAt) {
    const errMsg = full.slice(0, 500) || "Falha no scan de segurança";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        finishedAt: new Date(),
        errorCode: "SECURITY_SCAN_FAILED",
        errorMessage: errMsg,
      },
    });
    await appendEvent(jobId, 5, "error", errMsg, 100);
    return;
  }

  const observedAt = new Date();
  await prisma.server.update({
    where: { id: parsed.data.serverId },
    data: {
      securitySnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
      securityObservedAt: observedAt,
      lastConnectedAt: observedAt,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: snapshot as object,
    },
  });
  await appendEvent(jobId, 6, "done", "Scan de segurança concluído", 100);
}
