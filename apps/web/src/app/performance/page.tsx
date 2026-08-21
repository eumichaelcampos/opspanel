"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Info,
  Loader2,
  RefreshCw,
  ServerCrash,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AutomationSubNav } from "@/components/automation-sub-nav";
import { JobTracker } from "@/components/job-tracker";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  PerformanceAdvisorResponse,
  PerformanceRecommendation,
  PerformanceSeverity,
} from "@opspanel/contracts";

function severityIcon(severity: PerformanceSeverity) {
  if (severity === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (severity === "info") return <Info className="h-4 w-4 text-muted" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <ServerCrash className="h-4 w-4 text-danger" />;
}

function RecRow({
  rec,
  onApply,
  applying,
}: {
  rec: PerformanceRecommendation;
  onApply: (r: PerformanceRecommendation) => void;
  applying: boolean;
}) {
  const canApply = Boolean(rec.apply && rec.apply.kind !== "none");
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-ink/10 py-2.5 last:border-0 dark:border-white/10">
      <span className="mt-0.5">{severityIcon(rec.severity)}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{rec.title}</p>
        <p className="text-xs text-muted">{rec.detail}</p>
        <p className="mt-0.5 text-[11px] text-muted">{rec.targetLabel}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {rec.href ? (
          <Link href={rec.href} className="btn-ghost btn-sm">
            Ver
          </Link>
        ) : null}
        {canApply ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={applying}
            onClick={() => onApply(rec)}
          >
            <Zap className="h-3.5 w-3.5" />
            Aplicar
          </button>
        ) : null}
      </div>
    </li>
  );
}

export default function PerformancePage() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [withTtfb, setWithTtfb] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["performance-advisor", withTtfb],
    queryFn: () =>
      apiFetch<PerformanceAdvisorResponse>(
        `/performance/advisor${withTtfb ? "?ttfb=1" : ""}`,
      ),
  });

  const applyMutation = useMutation({
    mutationFn: (rec: PerformanceRecommendation) =>
      apiFetch<{ jobId: string }>("/performance/advisor/apply", {
        method: "POST",
        body: JSON.stringify({
          recommendationId: rec.id,
          targetType: rec.targetType,
          targetId: rec.targetId,
          actionKey: rec.actionKey ?? rec.id,
          applyKind: rec.apply?.kind ?? "none",
          siteManageAction: rec.apply?.siteManageAction,
          stackAction: rec.apply?.stackAction,
          stackComponents: rec.apply?.stackComponents,
        }),
      }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["performance-advisor"] });
    },
  });

  const summary = data?.summary;
  const allRecs = [
    ...(data?.servers.flatMap((s) => s.recommendations) ?? []),
    ...(data?.sites.flatMap((s) => s.recommendations.filter((r) => r.severity !== "ok")) ?? []),
  ].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2, ok: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <AppShell title="Automação">
      <AutomationSubNav />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Performance Advisor</h1>
            <p className="mt-1 text-sm text-muted">
              Recomendações de cache, SSL, PHP e métricas a partir do inventário existente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={withTtfb}
                onChange={(e) => setWithTtfb(e.target.checked)}
                className="rounded border-ink/20"
              />
              Medir TTFB (amostra)
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void refetch()}
              disabled={isLoading || isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", (isLoading || isFetching) && "animate-spin")} />
              Atualizar
            </button>
          </div>
        </div>

        {jobId ? (
          <JobTracker
            jobId={jobId}
            onComplete={() => {
              setJobId(null);
              void refetch();
            }}
          />
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analisando performance…
          </div>
        ) : summary ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 text-muted">
                  <Gauge className="h-4 w-4" />
                  <span className="text-sm">Críticos</span>
                </div>
                <p className="mt-2 text-3xl font-semibold text-danger">{summary.critical}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Alertas</p>
                <p className="mt-2 text-3xl font-semibold text-warning">{summary.warning}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Servidores</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.servers}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Sites ok</p>
                <p className="mt-2 text-3xl font-semibold text-success">{summary.okSites}</p>
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Recomendações</h2>
              <p className="mt-1 text-xs text-muted">
                Clique em Aplicar para enfileirar a ação correspondente (cache, SSL, PHP, stack).
              </p>
              <ul className="mt-3">
                {allRecs.slice(0, 40).map((rec) => (
                  <RecRow
                    key={rec.id}
                    rec={rec}
                    applying={applyMutation.isPending}
                    onApply={(r) => applyMutation.mutate(r)}
                  />
                ))}
                {!allRecs.length ? (
                  <li className="py-4 text-sm text-muted">Nenhuma recomendação no momento.</li>
                ) : null}
              </ul>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="glass-card p-5">
                <h2 className="font-semibold text-ink">Por servidor</h2>
                <div className="mt-3 space-y-3">
                  {(data?.servers ?? []).map((s) => (
                    <div
                      key={s.serverId}
                      className="rounded-card border border-ink/10 p-3 dark:border-white/10"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-ink">{s.serverName}</p>
                          <p className="text-xs text-muted">
                            {s.host}
                            {s.cpuPct != null ? ` · CPU ${Math.round(s.cpuPct)}%` : ""}
                            {s.memPct != null ? ` · RAM ${Math.round(s.memPct)}%` : ""}
                          </p>
                        </div>
                        <Link href={`/servers/${s.serverId}`} className="btn-ghost btn-sm">
                          Abrir
                        </Link>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {s.recommendations.length} recomendação(ões)
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card p-5">
                <h2 className="font-semibold text-ink">Por site</h2>
                <div className="mt-3 space-y-3">
                  {(data?.sites ?? []).slice(0, 15).map((s) => (
                    <div
                      key={s.siteId}
                      className="rounded-card border border-ink/10 p-3 dark:border-white/10"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-ink">{s.domain}</p>
                          <p className="text-xs text-muted">
                            {s.phpVersion ? `PHP ${s.phpVersion}` : "PHP ?"}
                            {s.cacheBackend ? ` · ${s.cacheBackend}` : ""}
                            {s.sslEnabled === false ? " · sem SSL" : ""}
                            {s.ttfbMs != null ? ` · TTFB ${s.ttfbMs}ms` : ""}
                          </p>
                        </div>
                        <Link href={`/sites/${s.siteId}?tab=manage`} className="btn-ghost btn-sm">
                          Gerenciar
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
