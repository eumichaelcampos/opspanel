"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { MetricBar } from "@/components/metric-bar";
import { ServerDetailTabs, type ServerDetailTab } from "@/components/server-detail-tabs";
import { StackInventorySummary } from "@/components/stack-inventory-summary";
import { ServerAccessPanel } from "@/components/server-access-panel";
import { ServerMonitoringPanel, type ServerMetrics } from "@/components/server-monitoring-panel";
import { WordOpsAdminPanel } from "@/components/wordops-admin-panel";
import { ServerOnboardingWizard } from "@/components/server-onboarding-wizard";
import { StatusBadge } from "@/components/status-badge";
import type { OnboardingStepId, ResolvedOnboardingStep } from "@opspanel/contracts";
import { apiFetch } from "@/lib/api";
import { formatObservedAt, SYNC_INTERVALS } from "@/lib/auto-sync";
import { useAutoServerSync } from "@/lib/use-auto-server-sync";
import { formatUptime, type HealthSnapshot, type StackComponentState } from "@/lib/server-health";

type WordOpsDashboard = {
  url?: string;
  username?: string;
  password?: string;
  capturedAt?: string;
};

type ServerDetail = {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
  osRelease?: string;
  wordopsVersion?: string;
  wordopsDashboard?: WordOpsDashboard | null;
  lastSyncedAt?: string;
  lastConnectedAt?: string;
  siteCount?: number;
  healthSnapshot?: HealthSnapshot | null;
  healthObservedAt?: string;
  metricsSnapshot?: ServerMetrics | null;
  metricsObservedAt?: string;
  credentialConfigured: boolean;
  onboarding?: {
    needsOnboarding: boolean;
    progress: number;
    detectedExisting?: boolean;
    steps: ResolvedOnboardingStep[];
  };
};

type OpsOptions = {
  stackComponents: { id: string; label: string; flag: string; category: string }[];
  stackActions: { id: string; label: string; wo: string; destructive?: boolean }[];
  quickActions: {
    id: string;
    label: string;
    desc: string;
    wo?: string;
    components?: string[];
    action?: string;
  }[];
  dashboardTools?: {
    monitoring: { id: string; label: string; path: string; desc: string }[];
    database: { id: string; label: string; path: string; desc: string }[];
    cache: { id: string; label: string; path: string; desc: string }[];
    php: { id: string; label: string; path: string; desc: string }[];
  };
  machineControls?: {
    id: string;
    label: string;
    desc: string;
    wo: string;
    destructive?: boolean;
    operation: string;
    components?: readonly string[];
    action?: string;
  }[];
  docsUrl: string;
};

type SiteRow = { id: string; domain: string; status: string; siteType?: string | null };

export default function ServerDetailPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const autoSetupStarted = useRef(false);
  const stackSelectionInitialized = useRef(false);
  const serverId = params.id;
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<OnboardingStepId | null>(null);
  const [jobFinishTick, setJobFinishTick] = useState(0);
  const [lastJobStatus, setLastJobStatus] = useState<string | null>(null);
  const [stackAction, setStackAction] = useState("install");
  const [selectedComponents, setSelectedComponents] = useState<string[]>(["fail2ban"]);
  const [activeTab, setActiveTab] = useState<ServerDetailTab>("overview");

  const { data: server, isPending, isError, error } = useQuery({
    queryKey: ["server", serverId],
    queryFn: () => apiFetch<ServerDetail>(`/servers/${serverId}`),
    enabled: Boolean(serverId),
    refetchInterval: activeJobId ? 2000 : SYNC_INTERVALS.queryPollMs,
  });

  const { data: options } = useQuery({
    queryKey: ["server-ops-options"],
    queryFn: () => apiFetch<OpsOptions>("/servers/operations-options"),
  });

  const { data: sitesData } = useQuery({
    queryKey: ["sites", serverId],
    queryFn: () => apiFetch<{ sites: SiteRow[] }>(`/sites?serverId=${serverId}`),
    enabled: Boolean(serverId),
  });

  const health = server?.healthSnapshot ?? undefined;

  const runJob = useMutation({
    mutationFn: (fn: () => Promise<{ jobId: string }>) => fn(),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const { mutate: runTest, isPending: testPending, error: testError } = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/servers/${serverId}/test-connection`, { method: "POST" }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const { mutate: runSync, isPending: syncPending, error: syncError } = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/servers/${serverId}/sync`, { method: "POST" }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  useEffect(() => {
    if (!server || autoSetupStarted.current) return;
    if (searchParams.get("setup") !== "1") return;
    if (!server.credentialConfigured || testPending) return;
    autoSetupStarted.current = true;
    setActiveStepId("connect");
    runTest();
    router.replace(`/servers/${serverId}`);
  }, [server, searchParams, testPending, runTest, router, serverId]);

  useAutoServerSync({
    serverId,
    enabled: Boolean(server?.credentialConfigured),
    needsStackScan: Boolean(server?.wordopsVersion) && !(health?.stackComponents?.length),
    healthObservedAt: server?.healthObservedAt,
    metricsObservedAt: server?.metricsObservedAt,
    activeJobId,
  });

  useEffect(() => {
    if (stackSelectionInitialized.current || !health?.stackComponents?.length) return;
    stackSelectionInitialized.current = true;
    const installed = health.stackComponents.filter((c) => c.installed).map((c) => c.id);
    if (installed.length > 0) setSelectedComponents(installed);
  }, [health?.stackComponents]);

  const onJobComplete = useCallback(
    async (status: string) => {
      setActiveJobId(null);
      setActiveStepId(null);
      setLastJobStatus(status);
      await qc.refetchQueries({ queryKey: ["server", serverId] });
      void qc.invalidateQueries({ queryKey: ["servers"] });
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      setJobFinishTick((t) => t + 1);
    },
    [qc, serverId],
  );

  function startJob(jobId: string) {
    setActiveJobId(jobId);
  }

  function toggleComponent(id: string) {
    setSelectedComponents((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function runStack(components: string[], action: string, destructive?: boolean) {
    if (destructive && !window.confirm(`Confirma ${action} em ${components.join(", ")}?`)) return;
    runJob.mutate(() =>
      apiFetch(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({ action, components, force: true }),
      }),
    );
  }

  function runQuickAction(qa: OpsOptions["quickActions"][number]) {
    if (qa.id === "maintenance") {
      if (!window.confirm("Executar wo maintenance (apt update/upgrade)?")) return;
      runJob.mutate(() => apiFetch(`/servers/${serverId}/maintenance`, { method: "POST" }));
      return;
    }
    if (qa.components && qa.action) {
      const destructive = qa.action === "purge" || qa.action === "remove";
      runStack([...qa.components], qa.action, destructive);
    }
  }

  function runMachineControl(control: NonNullable<OpsOptions["machineControls"]>[number]) {
    if (control.destructive) {
      if (
        !window.confirm(
          `${control.label}: ${control.desc}\n\nEsta ação afeta o servidor inteiro. Deseja continuar?`,
        )
      ) {
        return;
      }
    }
    if (control.operation === "reboot") {
      runJob.mutate(() =>
        apiFetch(`/servers/${serverId}/reboot`, {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        }),
      );
      return;
    }
    if (control.operation === "stack-restart") {
      runJob.mutate(() => apiFetch(`/servers/${serverId}/stack/restart`, { method: "POST" }));
      return;
    }
    if (control.operation === "stack-action" && control.components && control.action) {
      runStack([...control.components], control.action, false);
    }
  }

  const removeServerMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/servers/${serverId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["servers"] });
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      router.push("/servers");
    },
  });

  function handleRemoveServer() {
    if (
      !window.confirm(
        `Remover "${server?.name}" do painel?\n\nO servidor físico/VPS não será apagado. Os sites vinculados a ele também saem da listagem do painel.`,
      )
    ) {
      return;
    }
    removeServerMutation.mutate();
  }

  const actionsDisabled = !server?.credentialConfigured || testPending || syncPending || Boolean(activeJobId);
  const componentsByCategory = {
    web: options?.stackComponents.filter((c) => c.category === "web") ?? [],
    admin: options?.stackComponents.filter((c) => c.category === "admin") ?? [],
    security: options?.stackComponents.filter((c) => c.category === "security") ?? [],
  };

  const stackStateMap = new Map<string, StackComponentState>(
    (health?.stackComponents ?? []).map((c) => [c.id, c]),
  );

  function componentButtonClass(id: string, selected: boolean): string {
    const state = stackStateMap.get(id);
    if (selected) {
      return state?.installed
        ? state.running
          ? "border-success bg-success/10 text-success"
          : "border-warning bg-warning/10 text-warning"
        : "border-accent bg-accent/10 text-accent";
    }
    if (state?.installed) {
      return state.running
        ? "border-success/50 bg-success/5 text-ink"
        : "border-warning/50 bg-warning/5 text-ink";
    }
    if (state && !state.installed) {
      return "border-white/60 bg-white/50 text-muted line-through opacity-70";
    }
    return "border-white/80 bg-white/90";
  }

  function componentStatusLabel(id: string): string | null {
    const state = stackStateMap.get(id);
    if (!state) return null;
    if (!state.installed) return "não instalado";
    if (state.running) return "rodando";
    return state.status;
  }

  const showMonitoring = Boolean(server?.wordopsVersion);

  return (
    <AppShell title={server?.name ?? "Servidor"}>
      {isPending ? <p className="text-muted">Carregando...</p> : null}
      {isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {(error as Error).message}
        </div>
      ) : null}
      {server ? (
        <div className="space-y-8">
          {!server.credentialConfigured ? (
            <div className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              Credencial SSH não configurada.
            </div>
          ) : null}

          {activeJobId && !server.onboarding?.needsOnboarding ? (
            <JobTracker jobId={activeJobId} onComplete={onJobComplete} />
          ) : null}

          {server.onboarding ? (
            <ServerOnboardingWizard
              serverId={server.id}
              host={server.host}
              port={server.port}
              credentialConfigured={server.credentialConfigured}
              onboarding={server.onboarding}
              wordopsVersion={server.wordopsVersion}
              wordopsDashboard={server.wordopsDashboard}
              siteCount={server.siteCount}
              lastSyncedAt={server.lastSyncedAt}
              stackComponents={health?.stackComponents}
              activeJobId={activeJobId}
              activeStepId={activeStepId}
              jobFinishTick={jobFinishTick}
              lastJobStatus={lastJobStatus}
              onJobStarted={(jobId, stepId) => {
                startJob(jobId);
                setActiveStepId(stepId);
                setLastJobStatus(null);
              }}
              onJobComplete={onJobComplete}
              onRefresh={() => void qc.invalidateQueries({ queryKey: ["server", serverId] })}
            />
          ) : null}

          <header className="glass-card space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold">{server.name}</h1>
                  <StatusBadge status={server.status} />
                </div>
                <p className="font-mono text-sm text-muted">
                  {server.host}:{server.port}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {server.wordopsVersion ? (
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    WordOps {server.wordopsVersion}
                  </span>
                ) : null}
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-muted">
                  {server.siteCount ?? 0} sites
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-white/60 bg-white/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Uptime</p>
                <p className="text-sm font-semibold">{formatUptime(health?.uptimeSeconds)}</p>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Stack</p>
                <p className="text-sm font-semibold">
                  {health?.stackComponents?.filter((c) => c.installed).length ?? 0} instalados
                </p>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Sistema</p>
                <p className="truncate text-sm font-semibold">{server.osRelease ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Última sync</p>
                <p className="text-sm font-semibold">
                  {server.lastSyncedAt ? formatObservedAt(server.lastSyncedAt) : "Nunca"}
                </p>
              </div>
            </div>

            {server.wordopsVersion ? (
              <StackInventorySummary
                wordopsVersion={server.wordopsVersion}
                siteCount={server.siteCount}
                lastSyncedAt={server.lastSyncedAt}
                stackComponents={health?.stackComponents}
                compact
              />
            ) : null}
          </header>

          <ServerDetailTabs active={activeTab} onChange={setActiveTab} siteCount={server.siteCount} />

          {activeTab === "overview" ? (
            <>
              {showMonitoring ? (
                <ServerMonitoringPanel
                  host={server.host}
                  metrics={server.metricsSnapshot}
                  metricsObservedAt={server.metricsObservedAt}
                  stackComponents={health?.stackComponents}
                  tools={options?.dashboardTools}
                  syncing={Boolean(activeJobId)}
                />
              ) : null}

              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Recursos</h2>
                  <span className="text-xs text-muted">
                    {activeJobId ? "Sincronizando…" : `Atualizado: ${formatObservedAt(server.healthObservedAt)}`}
                  </span>
                </div>
                {health ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="glass-card space-y-4 p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted">Load avg</p>
                          <p className="text-lg font-semibold">
                            {health.loadAvg ? health.loadAvg.map((n) => n.toFixed(2)).join(" / ") : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted">CPUs</p>
                          <p className="text-lg font-semibold">{health.cpuCount ?? "—"}</p>
                        </div>
                      </div>
                      <MetricBar
                        label="Memória"
                        pct={health.memoryUsedPct}
                        detail={
                          health.memoryUsedMb != null && health.memoryTotalMb != null
                            ? `${health.memoryUsedMb} / ${health.memoryTotalMb} MB`
                            : undefined
                        }
                      />
                      <MetricBar
                        label="Disco (/)"
                        pct={health.diskUsedPct}
                        detail={
                          health.diskUsedGb != null && health.diskTotalGb != null
                            ? `${health.diskUsedGb} / ${health.diskTotalGb} GB`
                            : undefined
                        }
                      />
                    </div>
                    <div className="glass-card p-4">
                      <p className="mb-2 text-sm font-medium text-muted">Processos (CPU)</p>
                      {health.topProcesses && health.topProcesses.length > 0 ? (
                        <ul className="space-y-1 text-xs font-mono">
                          {health.topProcesses.map((p) => (
                            <li key={p.pid} className="truncate rounded bg-white/70 px-2 py-1">
                              {p.cpu}% {p.mem}% {p.command}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted">Coleta em andamento…</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Aguardando primeira coleta de saúde do servidor.</p>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Ações rápidas</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {options?.quickActions.map((qa) => (
                    <button
                      key={qa.id}
                      type="button"
                      disabled={actionsDisabled || runJob.isPending}
                      onClick={() => runQuickAction(qa)}
                      className="rounded-card border border-white/80 bg-white/90 px-4 py-3 text-left hover:bg-white disabled:opacity-60"
                    >
                      <p className="font-medium">{qa.label}</p>
                      <p className="text-xs text-muted">{qa.desc}</p>
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => runTest()}
                    className="rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-left disabled:opacity-60"
                  >
                    <p className="font-medium">Testar conexão</p>
                    <p className="text-xs text-muted">SSH + wo version</p>
                  </button>
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => runSync()}
                    className="rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-left disabled:opacity-60"
                  >
                    <p className="font-medium">Sincronizar sites</p>
                    <p className="text-xs text-muted">wo site list</p>
                  </button>
                </div>
              </section>
            </>
          ) : null}

          {activeTab === "stack" ? (
            <>
              <section className="glass-card space-y-4 p-4">
                <h2 className="text-lg font-semibold">Inventário WordOps</h2>
                <StackInventorySummary
                  wordopsVersion={server.wordopsVersion}
                  siteCount={server.siteCount}
                  lastSyncedAt={server.lastSyncedAt}
                  stackComponents={health?.stackComponents}
                />
              </section>

              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">Gerenciar stack</h2>
                    {options?.docsUrl ? (
                      <a href={options.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                        Documentação WordOps
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {options?.stackActions.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setStackAction(a.id)}
                      className={`rounded-card border px-3 py-1.5 text-sm ${
                        stackAction === a.id
                          ? a.destructive
                            ? "border-danger bg-danger/10"
                            : "border-accent bg-accent/10"
                          : "border-white/80 bg-white/90"
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                {(["web", "admin", "security"] as const).map((cat) =>
                  componentsByCategory[cat].length > 0 ? (
                    <div key={cat}>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        {cat === "web" ? "Web" : cat === "admin" ? "Admin" : "Segurança"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {componentsByCategory[cat].map((c) => {
                          const statusLabel = componentStatusLabel(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleComponent(c.id)}
                              className={`rounded-full border px-3 py-1 text-xs ${componentButtonClass(
                                c.id,
                                selectedComponents.includes(c.id),
                              )}`}
                              title={statusLabel ?? "Status desconhecido"}
                            >
                              {c.label}
                              {statusLabel ? <span className="ml-1 opacity-70">({statusLabel})</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null,
                )}
                <button
                  type="button"
                  disabled={actionsDisabled || selectedComponents.length === 0 || runJob.isPending}
                  onClick={() => {
                    const act = options?.stackActions.find((a) => a.id === stackAction);
                    runStack(selectedComponents, stackAction, act?.destructive);
                  }}
                  className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Executar wo stack {stackAction}
                </button>
              </section>

              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Controle da máquina</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(options?.machineControls ?? []).map((control) => (
                    <button
                      key={control.id}
                      type="button"
                      disabled={actionsDisabled || runJob.isPending}
                      onClick={() => runMachineControl(control)}
                      className={`rounded-card border px-4 py-3 text-left transition disabled:opacity-60 ${
                        control.destructive
                          ? "border-danger/40 bg-danger/5 hover:bg-danger/10"
                          : "border-white/80 bg-white/90 hover:bg-white"
                      }`}
                    >
                      <p className="font-medium">{control.label}</p>
                      <p className="text-xs text-muted">{control.desc}</p>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {activeTab === "access" ? (
            <>
              <ServerAccessPanel serverId={server.id} enabled={server.credentialConfigured} />
              {server.wordopsVersion ? (
                <WordOpsAdminPanel
                  serverId={server.id}
                  host={server.host}
                  dashboard={server.wordopsDashboard}
                  tools={options?.dashboardTools}
                  onJobStarted={startJob}
                />
              ) : null}
            </>
          ) : null}

          {activeTab === "sites" ? (
            <section className="glass-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Sites neste servidor</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/sites?serverId=${server.id}`} className="btn-secondary btn-sm">
                    Ver listagem
                  </Link>
                  <Link href={`/sites/new?serverId=${server.id}`} className="btn-primary btn-sm">
                    Criar site
                  </Link>
                </div>
              </div>
              {sitesData?.sites.length ? (
                <ul className="space-y-2">
                  {sitesData.sites.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white/80 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.domain}</p>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Link href={`/sites/${s.id}`} className="btn-primary btn-sm">
                          Ver
                        </Link>
                        <Link href={`/sites/${s.id}?tab=ops`} className="btn-secondary btn-sm">
                          Editar
                        </Link>
                        <a
                          href={`https://${s.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-accent-outline btn-sm"
                        >
                          Abrir
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nenhum site. Sincronize ou crie um novo.</p>
              )}
            </section>
          ) : null}

          {(testError || syncError || runJob.error) && (
            <p className="text-sm text-danger">{((testError ?? syncError ?? runJob.error) as Error).message}</p>
          )}

          <section className="rounded-shell border border-danger/30 bg-danger/5 p-5">
            <h2 className="text-lg font-semibold text-danger">Remover do painel</h2>
            <p className="mt-1 text-sm text-muted">
              Remove este servidor da listagem do OpsPanel. Não apaga a VPS nem desinstala o WordOps no servidor.
            </p>
            <button
              type="button"
              disabled={removeServerMutation.isPending}
              onClick={handleRemoveServer}
              className="mt-3 rounded-card border border-danger/50 bg-danger/10 px-4 py-2 text-sm font-medium text-danger disabled:opacity-60"
            >
              {removeServerMutation.isPending ? "Removendo…" : "Remover servidor da listagem"}
            </button>
            {removeServerMutation.error ? (
              <p className="mt-2 text-sm text-danger">{(removeServerMutation.error as Error).message}</p>
            ) : null}
          </section>

          <Link href="/servers" className="block text-sm text-muted hover:text-ink">
            Voltar para lista
          </Link>
        </div>
      ) : null}
    </AppShell>
  );
}
