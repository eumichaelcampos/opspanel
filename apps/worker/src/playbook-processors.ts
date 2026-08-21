import { JobStatus, Prisma, prisma } from "@opspanel/database";
import {
  getPlaybookById,
  serverPlaybookRunInputSchema,
  type PlaybookStep,
} from "@opspanel/contracts";
import {
  healthCollectProbe,
  maintenanceProbe,
  metricsCollectProbe,
  parseHealthCollectOutput,
  parseMetricsCollectOutput,
  parseSecurityScanOutput,
  securityScanProbe,
  stackActionProbe,
  ufwConfigureProbe,
} from "@opspanel/wordops";
import { appendEvent, appendOutputLogs, claimJob } from "./job-utils.js";
import { loadSshTargetForServer } from "./server-credentials.js";
import { connectSshSession, testSshConnection } from "./ssh-executor.js";
import { notifyOrganization } from "./alerts-notify.js";

function defaultUfwPorts(sshPort: number, extra?: number[]): number[] {
  return [...new Set([sshPort, 22, 80, 443, 22222, ...(extra ?? [])])];
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
        `Verifique credenciais e se o UFW liberou a porta ${target.port}.`,
    );
  }
  try {
    return await session.execProbe(probe);
  } finally {
    session.close();
  }
}

async function runStep(
  jobId: string,
  serverId: string,
  step: PlaybookStep,
  seq: { n: number },
  progressBase: number,
): Promise<void> {
  await appendEvent(jobId, seq.n++, "progress", `Playbook: ${step.label}`, progressBase);

  if (step.operationKey === "server.stack.action") {
    const action = step.stackAction ?? "install";
    const components = step.stackComponents ?? ["fail2ban"];
    const result = await execProbeForServer(serverId, stackActionProbe(action, components, false));
    await appendOutputLogs(jobId, result.stdout + result.stderr, seq.n);
    seq.n += 5;
    if (result.code !== 0 && !step.optional) {
      throw new Error(`Passo "${step.label}" falhou (stack ${action}).`);
    }
    return;
  }

  if (step.operationKey === "server.ufw.configure") {
    const server = await prisma.server.findUnique({ where: { id: serverId }, select: { port: true } });
    const ports = defaultUfwPorts(server?.port ?? 22);
    const result = await execProbeForServer(serverId, ufwConfigureProbe(ports));
    await appendOutputLogs(jobId, result.stdout + result.stderr, seq.n);
    seq.n += 5;
    if (result.code !== 0 && !step.optional) {
      throw new Error(`Passo "${step.label}" falhou (UFW).`);
    }
    return;
  }

  if (step.operationKey === "server.security.scan") {
    const result = await execProbeForServer(serverId, securityScanProbe());
    const full = result.stdout + result.stderr;
    await appendOutputLogs(jobId, full, seq.n);
    seq.n += 5;
    const snapshot = parseSecurityScanOutput(full);
    if (result.code !== 0 && !snapshot.collectedAt && !step.optional) {
      throw new Error(`Passo "${step.label}" falhou (scan).`);
    }
    if (snapshot.collectedAt) {
      await prisma.server.update({
        where: { id: serverId },
        data: {
          securitySnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
          securityObservedAt: new Date(),
          lastConnectedAt: new Date(),
        },
      });
      if (snapshot.ufwActive === false) {
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          select: { organizationId: true, name: true },
        });
        if (server) {
          void notifyOrganization({
            kind: "security_critical",
            organizationId: server.organizationId,
            title: `UFW inativo em ${server.name}`,
            body: "O playbook de auditoria/hardening detectou firewall UFW inativo.",
            metadata: { serverId, playbookStep: step.id },
          });
        }
      }
    }
    return;
  }

  if (step.operationKey === "server.health.collect") {
    const result = await execProbeForServer(serverId, healthCollectProbe());
    const snapshot = parseHealthCollectOutput(result.stdout + result.stderr);
    await prisma.server.update({
      where: { id: serverId },
      data: {
        healthSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        healthObservedAt: new Date(),
        lastConnectedAt: new Date(),
      },
    });
    return;
  }

  if (step.operationKey === "server.metrics.collect") {
    const result = await execProbeForServer(serverId, metricsCollectProbe());
    const snapshot = parseMetricsCollectOutput(result.stdout + result.stderr);
    await prisma.server.update({
      where: { id: serverId },
      data: {
        metricsSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        metricsObservedAt: new Date(),
        lastConnectedAt: new Date(),
      },
    });
    return;
  }

  if (step.operationKey === "server.maintenance.run") {
    const result = await execProbeForServer(serverId, maintenanceProbe());
    await appendOutputLogs(jobId, result.stdout + result.stderr, seq.n);
    seq.n += 5;
    if (result.code !== 0 && !step.optional) {
      throw new Error(`Passo "${step.label}" falhou (manutenção).`);
    }
    return;
  }

  if (step.operationKey === "server.system.update") {
    // Reuse maintenance-style probe if system update not wired here; skip optional
    if (!step.optional) {
      throw new Error(`Passo "${step.label}" não suportado neste MVP.`);
    }
    return;
  }

  throw new Error(`Passo desconhecido: ${step.operationKey}`);
}

export async function processPlaybookRun(jobId: string) {
  const job = await claimJob(jobId);
  if (!job?.serverId) return;

  const parsed = serverPlaybookRunInputSchema.safeParse(job.inputJson);
  if (!parsed.success) throw new Error("Input de playbook inválido");

  const playbook = getPlaybookById(parsed.data.playbookId);
  if (!playbook) throw new Error(`Playbook não encontrado: ${parsed.data.playbookId}`);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.running,
      startedAt: new Date(),
      currentStep: `playbook.${playbook.id}`,
      progress: 5,
    },
  });

  const seq = { n: 1 };
  await appendEvent(jobId, seq.n++, "progress", `Iniciando playbook "${playbook.name}"`, 5);

  const ssh = await testSshConnection(await loadSshTargetForServer(job.serverId));
  if (!ssh.ok) {
    throw new Error(ssh.errorMessage ?? "SSH indisponível para o playbook");
  }

  const total = playbook.steps.length;
  for (let i = 0; i < total; i++) {
    const step = playbook.steps[i]!;
    const progress = Math.min(90, Math.round(((i + 1) / total) * 85) + 5);
    await runStep(jobId, job.serverId, step, seq, progress);
    await prisma.job.update({
      where: { id: jobId },
      data: { progress, currentStep: `playbook.${playbook.id}.${step.id}` },
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      finishedAt: new Date(),
      resultJson: {
        playbookId: playbook.id,
        stepsCompleted: playbook.steps.map((s) => s.id),
      },
    },
  });
  await appendEvent(jobId, seq.n++, "done", `Playbook "${playbook.name}" concluído`, 100);

  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      actorUserId: job.requestedById,
      action: `playbook.${playbook.id}.succeeded`,
      targetType: "server",
      targetId: job.serverId,
      result: "success",
      metadata: { jobId },
    },
  });
}
