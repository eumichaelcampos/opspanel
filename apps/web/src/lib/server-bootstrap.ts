import { apiFetch } from "@/lib/api";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export type JobWaitResult = {
  id: string;
  status: string;
  progress: number;
  errorMessage?: string | null;
  resultJson?: {
    wordopsVersion?: string | null;
    latencyMs?: number;
    osRelease?: string | null;
  } | null;
};

export async function waitForJob(jobId: string, signal?: { cancelled: boolean }): Promise<JobWaitResult> {
  for (;;) {
    if (signal?.cancelled) throw new Error("Operação cancelada.");
    const job = await apiFetch<JobWaitResult>(`/jobs/${jobId}`);
    if (TERMINAL.has(job.status)) {
      if (job.status !== "succeeded") {
        throw new Error(job.errorMessage || "A operação no servidor não concluiu.");
      }
      return job;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function startJob(path: string, body?: string): Promise<string> {
  const result = await apiFetch<{ jobId: string }>(path, {
    method: "POST",
    body: body ?? "{}",
  });
  if (!result.jobId) throw new Error("Não foi possível iniciar a operação.");
  return result.jobId;
}

export type BootstrapStep = { key: string; label: string; jobId?: string };

export async function importExistingWordOps(
  serverId: string,
  onStep: (step: BootstrapStep) => void,
  signal?: { cancelled: boolean },
): Promise<{ wordopsVersion?: string | null; jobIds: string[] }> {
  const jobIds: string[] = [];

  onStep({ key: "connect", label: "Conectando no servidor…" });
  const connectId = await startJob(`/servers/${serverId}/test-connection`);
  jobIds.push(connectId);
  onStep({ key: "connect", label: "Conectando no servidor…", jobId: connectId });
  const connect = await waitForJob(connectId, signal);
  const server = await apiFetch<{ wordopsVersion?: string | null }>(`/servers/${serverId}`);
  const wordopsVersion = server.wordopsVersion ?? connect.resultJson?.wordopsVersion ?? null;
  if (!wordopsVersion) {
    return { wordopsVersion: null, jobIds };
  }

  onStep({ key: "health", label: "Reconhecendo programas instalados…" });
  const healthId = await startJob(`/servers/${serverId}/health`);
  jobIds.push(healthId);
  onStep({ key: "health", label: "Reconhecendo programas instalados…", jobId: healthId });
  await waitForJob(healthId, signal);

  onStep({ key: "sync", label: "Importando sites para o painel…" });
  const syncId = await startJob(`/servers/${serverId}/sync`);
  jobIds.push(syncId);
  onStep({ key: "sync", label: "Importando sites para o painel…", jobId: syncId });
  await waitForJob(syncId, signal);

  return { wordopsVersion, jobIds };
}

export async function provisionNewWordOps(
  serverId: string,
  onStep: (step: BootstrapStep) => void,
  signal?: { cancelled: boolean },
): Promise<{ jobIds: string[] }> {
  const jobIds: string[] = [];

  onStep({ key: "connect", label: "Conectando no servidor…" });
  const connectId = await startJob(`/servers/${serverId}/test-connection`);
  jobIds.push(connectId);
  onStep({ key: "connect", label: "Conectando no servidor…", jobId: connectId });
  await waitForJob(connectId, signal);

  const server = await apiFetch<{ wordopsVersion?: string | null }>(`/servers/${serverId}`);
  if (server.wordopsVersion) {
    onStep({ key: "health", label: `WordOps ${server.wordopsVersion} já estava instalado. Reconhecendo o servidor…` });
    const healthId = await startJob(`/servers/${serverId}/health`);
    jobIds.push(healthId);
    onStep({
      key: "health",
      label: `WordOps ${server.wordopsVersion} já estava instalado. Reconhecendo o servidor…`,
      jobId: healthId,
    });
    await waitForJob(healthId, signal);

    onStep({ key: "sync", label: "Importando sites para o painel…" });
    const syncId = await startJob(`/servers/${serverId}/sync`);
    jobIds.push(syncId);
    onStep({ key: "sync", label: "Importando sites para o painel…", jobId: syncId });
    await waitForJob(syncId, signal);
    return { jobIds };
  }

  onStep({ key: "wordops", label: "Instalando WordOps. Isso pode levar vários minutos…" });
  const woId = await startJob(`/servers/${serverId}/wordops/install`);
  jobIds.push(woId);
  onStep({ key: "wordops", label: "Instalando WordOps. Isso pode levar vários minutos…", jobId: woId });
  await waitForJob(woId, signal);

  onStep({ key: "stack", label: "Instalando Nginx, PHP e banco de dados…" });
  const stackId = await startJob(
    `/servers/${serverId}/stack`,
    JSON.stringify({ action: "install", components: ["web"], force: true }),
  );
  jobIds.push(stackId);
  onStep({ key: "stack", label: "Instalando Nginx, PHP e banco de dados…", jobId: stackId });
  await waitForJob(stackId, signal);

  onStep({ key: "sync", label: "Atualizando o painel com o que foi instalado…" });
  const syncId = await startJob(`/servers/${serverId}/sync`);
  jobIds.push(syncId);
  onStep({ key: "sync", label: "Atualizando o painel com o que foi instalado…", jobId: syncId });
  await waitForJob(syncId, signal);

  return { jobIds };
}
