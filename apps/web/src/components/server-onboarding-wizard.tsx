"use client";

import type { OnboardingOperation, OnboardingStepId, ResolvedOnboardingStep, StackInventoryItem } from "@opspanel/contracts";
import { resolveExistingServerInventory } from "@opspanel/contracts";
import { apiFetch } from "@/lib/api";
import { importExistingWordOps, type BootstrapStep } from "@/lib/server-bootstrap";
import { JobTracker } from "@/components/job-tracker";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  GripVertical,
  Loader2,
  Lock,
  Package,
  Play,
  Rocket,
  SkipForward,
  Sparkles,
  Zap,
} from "lucide-react";
import { StackInventorySummary } from "@/components/stack-inventory-summary";
import { OperationTerminal } from "@/components/operation-terminal";
import { SshConsolePanel } from "@/components/ssh-console-panel";
import { cn } from "@/lib/utils";

type OnboardingState = {
  needsOnboarding: boolean;
  progress: number;
  detectedExisting?: boolean;
  steps: ResolvedOnboardingStep[];
};

type Props = {
  serverId: string;
  host: string;
  port: number;
  credentialConfigured: boolean;
  onboarding: OnboardingState;
  wordopsVersion?: string | null;
  wordopsDashboard?: { url?: string; username?: string; password?: string; capturedAt?: string } | null;
  siteCount?: number;
  lastSyncedAt?: string | null;
  stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[];
  activeJobId: string | null;
  activeStepId?: OnboardingStepId | null;
  jobFinishTick: number;
  lastJobStatus: string | null;
  onJobStarted: (jobId: string, stepId: OnboardingStepId | null) => void;
  onJobComplete: (status: string) => void;
  onRefresh: () => void;
};

function collapseStorageKey(serverId: string) {
  return `opspanel:server-panel-collapsed:${serverId}`;
}

function usePanelCollapsed(serverId: string, defaultCollapsed: boolean) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(collapseStorageKey(serverId));
      if (stored === "true") setCollapsed(true);
      else if (stored === "false") setCollapsed(false);
      else setCollapsed(defaultCollapsed);
    } catch {
      setCollapsed(defaultCollapsed);
    }
  }, [serverId, defaultCollapsed]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapseStorageKey(serverId), String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return { collapsed, toggle };
}

function CollapsiblePanel({
  title,
  summary,
  icon,
  tone = "default",
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  icon: ReactNode;
  tone?: "default" | "success" | "accent";
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-gradient-to-br from-success/10 via-white/70 to-white/50"
      : tone === "accent"
        ? "border-accent/20 bg-gradient-to-br from-accent/5 via-white/60 to-white/40"
        : "border-white/80 bg-white/60";

  return (
    <section className={cn("wizard-enter rounded-shell border shadow-glass", toneClass)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-white/40"
        aria-expanded={!collapsed}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="truncate text-sm text-muted">{summary}</p>
        </div>
        {collapsed ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        ) : (
          <ChevronUp className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        )}
      </button>
      {!collapsed ? <div className="border-t border-white/60 px-5 pb-5 pt-4">{children}</div> : null}
    </section>
  );
}

function statusIcon(status: ResolvedOnboardingStep["status"]) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === "skipped") return <SkipForward className="h-5 w-5 text-muted" />;
  if (status === "running") return <Loader2 className="h-5 w-5 animate-spin text-accent" />;
  if (status === "blocked") return <Lock className="h-5 w-5 text-muted/60" />;
  return <Circle className="h-5 w-5 text-muted/50" />;
}

function InventoryChip({ item, variant }: { item: StackInventoryItem; variant: "installed" | "available" }) {
  if (variant === "installed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          item.running ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning",
        )}
      >
        <span className="font-medium">{item.label}</span>
        <span className="text-[10px] opacity-80">{item.running ? "rodando" : item.status}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-xs text-muted">
      {item.label}
    </span>
  );
}

async function runStepOperation(serverId: string, step: ResolvedOnboardingStep): Promise<{ jobId: string }> {
  switch (step.operation as OnboardingOperation) {
    case "test-connection":
      return apiFetch(`/servers/${serverId}/test-connection`, { method: "POST" });
    case "system-update":
      return apiFetch(`/servers/${serverId}/system/update`, { method: "POST" });
    case "maintenance":
      return apiFetch(`/servers/${serverId}/maintenance`, { method: "POST" });
    case "wordops-install":
      return apiFetch(`/servers/${serverId}/wordops/install`, { method: "POST", body: "{}" });
    case "stack-install-web":
      return apiFetch(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({ action: "install", components: ["web"], force: true }),
      });
    case "stack-migrate-mariadb":
      return apiFetch(`/servers/${serverId}/stack/migrate`, {
        method: "POST",
        body: JSON.stringify({ target: "mariadb" }),
      });
    case "stack-status":
      return apiFetch(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({ action: "status", components: ["all"], force: true }),
      });
    case "stack-install-security":
      return apiFetch(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({
          action: "install",
          components: ["fail2ban", "ngxblocker", "ufw"],
          force: true,
        }),
      });
    case "ufw-configure":
      return apiFetch(`/servers/${serverId}/ufw/configure`, { method: "POST", body: "{}" });
    case "stack-install-monitoring":
      return apiFetch(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({
          action: "install",
          components: ["netdata", "dashboard"],
          force: true,
        }),
      });
    case "sync-inventory":
      return apiFetch(`/servers/${serverId}/sync`, { method: "POST" });
    default:
      throw new Error("Etapa sem ação automática");
  }
}

function pipelineSteps(steps: ResolvedOnboardingStep[]): ResolvedOnboardingStep[] {
  return steps.filter(
    (s) =>
      s.operation !== "none" &&
      s.id !== "ready" &&
      s.status !== "done" &&
      s.status !== "skipped",
  );
}

function ExistingServerPanel({
  serverId,
  inventory,
  activeJobId,
  onJobStarted,
  onRefresh,
}: {
  serverId: string;
  inventory: ReturnType<typeof resolveExistingServerInventory>;
  activeJobId: string | null;
  onJobStarted: (jobId: string, stepId: OnboardingStepId | null) => void;
  onRefresh: () => void;
}) {
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncAllBusy, setSyncAllBusy] = useState(false);
  const [syncAllStep, setSyncAllStep] = useState<BootstrapStep | null>(null);

  async function runSyncEverything() {
    setError(null);
    setSyncAllBusy(true);
    setSyncAllStep({ key: "start", label: "Sincronizando servidor, stack e sites…" });
    try {
      await importExistingWordOps(serverId, (step) => {
        setSyncAllStep(step);
        if (step.jobId) onJobStarted(step.jobId, step.key === "sync" ? "sync_inventory" : null);
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar tudo");
    } finally {
      setSyncAllBusy(false);
    }
  }

  async function runHealthCollect() {
    setError(null);
    try {
      const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/health`, { method: "POST" });
      onJobStarted(result.jobId, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao escanear stack");
    }
  }

  async function runSyncSites() {
    setError(null);
    try {
      const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/sync`, { method: "POST" });
      onJobStarted(result.jobId, "sync_inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar sites");
    }
  }

  async function installComponent(componentId: string) {
    setError(null);
    setInstallingId(componentId);
    try {
      const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/stack`, {
        method: "POST",
        body: JSON.stringify({ action: "install", components: [componentId], force: true }),
      });
      onJobStarted(result.jobId, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao instalar componente");
    } finally {
      setInstallingId(null);
    }
  }

  const groupedAvailable = useMemo(() => {
    const groups = new Map<string, StackInventoryItem[]>();
    for (const item of inventory.available) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return groups;
  }, [inventory.available]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {inventory.wordopsVersion ? (
          <span className="rounded-full bg-accent/10 px-3 py-1 font-medium text-accent">
            WordOps {inventory.wordopsVersion}
          </span>
        ) : null}
        <span className="text-muted">
          {inventory.installed.length} instalados · {inventory.available.length} disponíveis · {inventory.siteCount}{" "}
          sites
        </span>
        <Link
          href={`/sites/new?serverId=${serverId}`}
          className="ml-auto rounded-card bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
        >
          Criar site
        </Link>
      </div>

      <div className="rounded-card border border-accent/30 bg-accent/5 px-4 py-3">
        <p className="font-medium text-ink">Reconhecer este servidor no painel</p>
        <p className="mt-1 text-sm text-muted">
          Atualiza a stack, importa os sites existentes e deixa o servidor visível em Servidores e Sites.
        </p>
        <button
          type="button"
          disabled={Boolean(activeJobId) || syncAllBusy}
          onClick={() => void runSyncEverything()}
          className="mt-3 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncAllBusy ? "Sincronizando…" : "Sincronizar tudo"}
        </button>
        {syncAllBusy && syncAllStep ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted">{syncAllStep.label}</p>
            {syncAllStep.jobId ? <JobTracker jobId={syncAllStep.jobId} /> : null}
          </div>
        ) : null}
      </div>

      {inventory.needsHealthScan ? (
        <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-ink">Inventário da stack pendente</p>
          <p className="mt-1 text-muted">
            WordOps detectado, mas ainda não sabemos quais componentes estão instalados. Escaneie a stack uma vez.
          </p>
          <button
            type="button"
            disabled={Boolean(activeJobId)}
            onClick={() => void runHealthCollect()}
            className="mt-3 rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Escanear stack
          </button>
        </div>
      ) : null}

      {!inventory.lastSyncedAt && inventory.siteCount === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-white/80 bg-white/70 px-4 py-3 text-sm">
          <p className="text-muted">Sites ainda não inventariados neste painel.</p>
          <button
            type="button"
            disabled={Boolean(activeJobId)}
            onClick={() => void runSyncSites()}
            className="rounded-card border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent disabled:opacity-50"
          >
            Sincronizar sites
          </button>
        </div>
      ) : null}

      {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

      {inventory.installed.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Instalados</h3>
          <div className="flex flex-wrap gap-2">
            {inventory.installed.map((item) => (
              <InventoryChip key={item.id} item={item} variant="installed" />
            ))}
          </div>
        </div>
      ) : null}

      {inventory.available.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Disponível para instalar</h3>
          {[...groupedAvailable.entries()].map(([category, items]) => (
            <div key={category} className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted">{category}</p>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-white/80 bg-white/80 px-3 py-2"
                  >
                    <InventoryChip item={item} variant="available" />
                    <button
                      type="button"
                      disabled={Boolean(activeJobId) || installingId === item.id}
                      onClick={() => void installComponent(item.id)}
                      className="rounded-card bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {installingId === item.id ? "Instalando…" : "Instalar"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Todos os componentes do catálogo já estão instalados.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-white/60 pt-4">
        <button
          type="button"
          disabled={Boolean(activeJobId)}
          onClick={() => void runHealthCollect()}
          className="rounded-card border border-white/80 bg-white px-3 py-1.5 text-sm text-muted hover:bg-white/90 disabled:opacity-50"
        >
          Atualizar inventário
        </button>
        <button
          type="button"
          disabled={Boolean(activeJobId)}
          onClick={() => {
            void runSyncSites();
            onRefresh();
          }}
          className="rounded-card border border-white/80 bg-white px-3 py-1.5 text-sm text-muted hover:bg-white/90 disabled:opacity-50"
        >
          Sincronizar sites
        </button>
      </div>
    </div>
  );
}

function ProvisioningWizard({
  serverId,
  host,
  port,
  credentialConfigured,
  onboarding,
  wordopsVersion,
  siteCount,
  lastSyncedAt,
  stackComponents,
  activeJobId,
  activeStepId,
  jobFinishTick,
  lastJobStatus,
  onJobStarted,
  onJobComplete,
  onRefresh,
}: Props) {
  const [autoContinue, setAutoContinue] = useState(true);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [runningStepId, setRunningStepId] = useState<OnboardingStepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<OnboardingStepId | null>(null);
  const pipelineHandledTick = useRef(0);

  const reorderableSteps = useMemo(
    () => onboarding.steps.filter((s) => s.reorderable && s.id !== "ready"),
    [onboarding.steps],
  );

  const executeStep = useCallback(
    async (step: ResolvedOnboardingStep) => {
      if (step.status === "done" || step.id === "ready") return null;
      if (step.status === "blocked") {
        setError(`Etapa bloqueada: conclua as etapas anteriores antes de "${step.label}".`);
        return null;
      }
      if (activeJobId) {
        setError("Aguarde a operação em andamento no terminal abaixo terminar.");
        return null;
      }
      setError(null);
      setRunningStepId(step.id);
      try {
        const result = await runStepOperation(serverId, step);
        onJobStarted(result.jobId, step.id);
        return result.jobId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao iniciar etapa");
        setPipelineRunning(false);
        return null;
      } finally {
        setRunningStepId(null);
      }
    },
    [activeJobId, onJobStarted, serverId],
  );

  async function startPipeline() {
    setPipelineRunning(true);
    setAutoContinue(true);
    setError(null);
    const first = pipelineSteps(onboarding.steps)[0];
    if (first) await executeStep(first);
    else setPipelineRunning(false);
  }

  function stopPipeline() {
    setPipelineRunning(false);
  }

  useEffect(() => {
    if (!pipelineRunning || activeJobId || runningStepId) return;
    if (jobFinishTick === 0 || pipelineHandledTick.current === jobFinishTick) return;
    pipelineHandledTick.current = jobFinishTick;

    if (lastJobStatus && lastJobStatus !== "succeeded") {
      setPipelineRunning(false);
      setError("Pipeline interrompido: a etapa anterior falhou. Corrija e execute novamente.");
      return;
    }

    const remaining = pipelineSteps(onboarding.steps);
    if (remaining.length === 0) {
      setPipelineRunning(false);
      return;
    }

    void executeStep(remaining[0]!);
  }, [
    pipelineRunning,
    activeJobId,
    runningStepId,
    jobFinishTick,
    lastJobStatus,
    onboarding.steps,
    executeStep,
  ]);

  async function skipStep(stepId: OnboardingStepId) {
    await apiFetch(`/servers/${serverId}/onboarding`, {
      method: "PATCH",
      body: JSON.stringify({ skippedSteps: [stepId] }),
    });
    onRefresh();
  }

  async function persistStepOrder(order: OnboardingStepId[]) {
    await apiFetch(`/servers/${serverId}/onboarding`, {
      method: "PATCH",
      body: JSON.stringify({ stepOrder: order }),
    });
    onRefresh();
  }

  function onDrop(targetId: OnboardingStepId) {
    if (!dragId || dragId === targetId) return;
    const ids = reorderableSteps.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    void persistStepOrder(next);
    setDragId(null);
  }

  const nextPending = onboarding.steps.find(
    (s) => s.status === "pending" && s.id !== "ready" && s.operation !== "none",
  );

  const remainingPipeline = pipelineSteps(onboarding.steps).length;

  const connectStep = onboarding.steps.find((s) => s.id === "connect");
  const showSshConsole =
    credentialConfigured &&
    connectStep &&
    connectStep.status !== "done" &&
    (activeStepId === "connect" || connectStep.status === "pending" || connectStep.status === "running");

  return (
    <div className="space-y-5">
      {showSshConsole ? (
        <div className="rounded-card border border-accent/20 bg-accent/5 p-4">
          <p className="mb-2 text-sm font-medium text-ink">Verificar acesso SSH</p>
          <p className="mb-3 text-xs text-muted">
            Console disponível nesta etapa para validar login antes de executar &quot;Conectar SSH&quot;.
          </p>
          <SshConsolePanel serverId={serverId} enabled={credentialConfigured} host={host} port={port} />
        </div>
      ) : null}

      {activeJobId ? <OperationTerminal jobId={activeJobId} onComplete={onJobComplete} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          Configure o servidor passo a passo ou use o pipeline automático. Sites são criados depois, em Sites.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {pipelineRunning ? (
            <button
              type="button"
              onClick={stopPipeline}
              className="rounded-card border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm text-danger"
            >
              Parar pipeline
            </button>
          ) : (
            <button
              type="button"
              disabled={Boolean(activeJobId) || remainingPipeline === 0}
              onClick={() => void startPipeline()}
              className="flex items-center gap-1.5 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:scale-[1.02] hover:opacity-95 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              Executar tudo ({remainingPipeline} etapas)
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={autoContinue}
              onChange={(e) => setAutoContinue(e.target.checked)}
              className="accent-accent"
            />
            Auto-continuar
          </label>
        </div>
      </div>

      {pipelineRunning ? (
        <div className="flex items-center gap-2 rounded-card border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent">
          <Loader2 className="h-4 w-4 animate-spin" />
          Pipeline em execução… aguarde cada job concluir antes da próxima etapa.
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Progresso</span>
          <span>{onboarding.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/80">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-all duration-700 ease-out"
            style={{ width: `${onboarding.progress}%` }}
          />
        </div>
      </div>

      {wordopsVersion ? (
        <div className="glass-card space-y-2 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Stack instalada</p>
          <StackInventorySummary
            wordopsVersion={wordopsVersion}
            siteCount={siteCount}
            lastSyncedAt={lastSyncedAt}
            stackComponents={stackComponents}
          />
        </div>
      ) : null}

      {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

      <ol className="space-y-3">
        {onboarding.steps.map((step, index) => (
          <li
            key={step.id}
            draggable={step.reorderable && !activeJobId && !pipelineRunning}
            onDragStart={() => step.reorderable && setDragId(step.id)}
            onDragOver={(e) => step.reorderable && e.preventDefault()}
            onDrop={() => step.reorderable && onDrop(step.id)}
            className={cn(
              "group rounded-card border bg-white/80 p-4 transition-all duration-300",
              step.status === "running" || runningStepId === step.id || (pipelineRunning && activeJobId)
                ? "border-accent/50 shadow-md ring-2 ring-accent/20"
                : "border-white/90 hover:border-accent/30 hover:shadow-sm",
              step.status === "done" && "border-success/30 bg-success/5",
              dragId === step.id && "opacity-50",
            )}
          >
            <div className="flex flex-wrap items-start gap-3">
              {step.reorderable ? (
                <GripVertical className="mt-0.5 h-4 w-4 cursor-grab text-muted/40 group-hover:text-muted" />
              ) : (
                <span className="mt-0.5 w-4 text-center text-xs font-medium text-muted">{index + 1}</span>
              )}
              {statusIcon(
                runningStepId === step.id || (activeJobId && activeStepId === step.id) ? "running" : step.status,
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{step.label}</p>
                  {step.id === "wordops_install" && wordopsVersion ? (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                      Verificado v{wordopsVersion}
                    </span>
                  ) : step.id === "wordops_install" && step.status === "done" && !wordopsVersion ? (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                      Concluído (versão não detectada)
                    </span>
                  ) : null}
                  {!step.required ? (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-muted">opcional</span>
                  ) : null}
                  {step.estimatedMinutes ? (
                    <span className="text-[10px] text-muted">~{step.estimatedMinutes} min</span>
                  ) : null}
                </div>
                <p className="text-sm text-muted">{step.description}</p>
                {step.woCommand ? (
                  <code className="block truncate rounded bg-black/5 px-2 py-1 font-mono text-[10px] text-ink/80">
                    {step.woCommand}
                  </code>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {step.id === "ready" ? (
                  <Link
                    href={`/sites/new?serverId=${serverId}`}
                    className={cn(
                      "rounded-card px-3 py-1.5 text-sm font-medium transition",
                      step.status === "done"
                        ? "bg-accent text-white hover:opacity-95"
                        : "cursor-not-allowed bg-white/60 text-muted",
                    )}
                  >
                    Ir para Sites
                  </Link>
                ) : step.status === "blocked" ? (
                  <span className="rounded-full bg-white px-3 py-1 text-xs text-muted">Aguardando etapa anterior</span>
                ) : step.status === "pending" ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(activeJobId) || pipelineRunning || runningStepId !== null}
                      onClick={() => void executeStep(step)}
                      className="flex items-center gap-1.5 rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:scale-[1.02] disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Executar
                    </button>
                    {!step.required ? (
                      <button
                        type="button"
                        disabled={Boolean(activeJobId) || pipelineRunning}
                        onClick={() => void skipStep(step.id)}
                        className="rounded-card border border-white/80 px-3 py-1.5 text-sm text-muted hover:bg-white"
                      >
                        Pular
                      </button>
                    ) : null}
                  </>
                ) : step.status === "done" ? (
                  <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                    Concluído
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {autoContinue && !pipelineRunning && nextPending && !activeJobId ? (
        <button
          type="button"
          onClick={() => void executeStep(nextPending)}
          className="w-full rounded-card border border-accent/40 bg-accent/10 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/15"
        >
          Executar próxima etapa: {nextPending.label}
        </button>
      ) : null}
    </div>
  );
}

export function ServerOnboardingWizard({
  serverId,
  host,
  port,
  credentialConfigured,
  onboarding,
  wordopsVersion,
  wordopsDashboard,
  siteCount,
  lastSyncedAt,
  stackComponents,
  activeJobId,
  activeStepId,
  jobFinishTick,
  lastJobStatus,
  onJobStarted,
  onJobComplete,
  onRefresh,
}: Props) {
  const isExisting = Boolean(onboarding.detectedExisting);
  const showProvisioning = onboarding.needsOnboarding && !isExisting;

  const inventory = useMemo(
    () =>
      resolveExistingServerInventory({
        credentialConfigured: true,
        status: "healthy",
        wordopsVersion: wordopsVersion ?? null,
        lastSyncedAt: lastSyncedAt ?? null,
        siteCount: siteCount ?? 0,
        stackComponents,
      }),
    [wordopsVersion, lastSyncedAt, siteCount, stackComponents],
  );

  const { collapsed, toggle } = usePanelCollapsed(serverId, isExisting || !showProvisioning);

  if (isExisting) {
    const summary = `${inventory.installed.length} instalados · ${inventory.available.length} disponíveis · ${inventory.siteCount} sites`;
    return (
      <CollapsiblePanel
        title="Servidor WordOps reconhecido"
        summary={summary}
        icon={<Package className="h-6 w-6 shrink-0 text-success" />}
        tone="success"
        collapsed={collapsed}
        onToggle={toggle}
      >
        <ExistingServerPanel
          serverId={serverId}
          inventory={inventory}
          activeJobId={activeJobId}
          onJobStarted={onJobStarted}
          onRefresh={onRefresh}
        />
      </CollapsiblePanel>
    );
  }

  if (!showProvisioning) {
    return (
      <CollapsiblePanel
        title="Servidor provisionado"
        summary="WordOps pronto. Crie sites em Sites → Novo site."
        icon={<Rocket className="h-6 w-6 shrink-0 text-success" />}
        tone="success"
        collapsed={collapsed}
        onToggle={toggle}
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Provisionamento concluído neste painel.</p>
          <Link
            href={`/sites/new?serverId=${serverId}`}
            className="ml-auto rounded-card bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
          >
            Criar site
          </Link>
        </div>
      </CollapsiblePanel>
    );
  }

  const remaining = pipelineSteps(onboarding.steps).length;
  const summary = `${onboarding.progress}% concluído · ${remaining} etapas restantes`;

  return (
    <CollapsiblePanel
      title="Provisionamento WordOps"
      summary={summary}
      icon={<Sparkles className="h-6 w-6 shrink-0 text-accent" />}
      tone="accent"
      collapsed={collapsed}
      onToggle={toggle}
    >
      <ProvisioningWizard
        serverId={serverId}
        host={host}
        port={port}
        credentialConfigured={credentialConfigured}
        onboarding={onboarding}
        wordopsVersion={wordopsVersion}
        wordopsDashboard={wordopsDashboard}
        siteCount={siteCount}
        lastSyncedAt={lastSyncedAt}
        stackComponents={stackComponents}
        activeJobId={activeJobId}
        activeStepId={activeStepId}
        jobFinishTick={jobFinishTick}
        lastJobStatus={lastJobStatus}
        onJobStarted={onJobStarted}
        onJobComplete={onJobComplete}
        onRefresh={onRefresh}
      />
    </CollapsiblePanel>
  );
}
