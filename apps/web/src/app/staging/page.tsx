"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Copy, FlaskConical, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  suggestStagingDomain,
  type StagingHubResponse,
  type StagingCloneCandidate,
} from "@opspanel/contracts";

function CloneRow({
  candidate,
  onClone,
  busy,
}: {
  candidate: StagingCloneCandidate;
  onClone: (siteId: string, targetDomain: string) => void;
  busy: boolean;
}) {
  const [target, setTarget] = useState(candidate.suggestedTarget);
  return (
    <li className="flex flex-col gap-3 rounded-card border border-white/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-medium text-ink">{candidate.domain}</p>
          <p className="text-xs text-muted">
            {candidate.serverName ?? candidate.serverId}
            {candidate.isWordPress ? " · WordPress" : ""}
            {candidate.siteType ? ` · ${candidate.siteType}` : ""}
          </p>
        </div>
        <label className="block text-xs font-medium text-muted">
          Destino
          <input
            className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm dark:border-white/15 dark:bg-ink/20"
            value={target}
            onChange={(e) => setTarget(e.target.value.toLowerCase().trim())}
            placeholder={suggestStagingDomain(candidate.domain)}
            disabled={busy}
          />
        </label>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link href={`/sites/${candidate.siteId}?tab=staging`} className="btn-secondary btn-sm">
          Abrir site
        </Link>
        <button
          type="button"
          className="btn-primary btn-sm inline-flex items-center gap-1.5"
          disabled={busy || !target}
          onClick={() => onClone(candidate.siteId, target)}
        >
          <Copy className="h-3.5 w-3.5" />
          Clonar
        </button>
      </div>
    </li>
  );
}

export default function StagingPage() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["staging-hub"],
    queryFn: () => apiFetch<StagingHubResponse>("/staging"),
  });

  const cloneMutation = useMutation({
    mutationFn: ({ siteId, targetDomain }: { siteId: string; targetDomain: string }) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/clone`, {
        method: "POST",
        body: JSON.stringify({ targetDomain, asStaging: true }),
      }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const rollbackMutation = useMutation({
    mutationFn: (siteId: string) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/rollback`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const summary = data?.summary;

  return (
    <AppShell title="Staging">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Staging</h1>
            <p className="mt-1 text-sm text-muted">
              Clone sites para um subdomínio de testes e faça rollback pelo último backup após
              atualizações.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            Atualizar
          </button>
        </div>

        {jobId ? (
          <JobTracker
            jobId={jobId}
            onComplete={() => {
              setJobId(null);
              void refetch();
              void qc.invalidateQueries({ queryKey: ["staging-hub"] });
              void qc.invalidateQueries({ queryKey: ["sites"] });
            }}
          />
        ) : null}

        {cloneMutation.error ? (
          <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {(cloneMutation.error as Error).message}
          </p>
        ) : null}
        {rollbackMutation.error ? (
          <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {(rollbackMutation.error as Error).message}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-white/80 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Ambientes staging</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{summary?.stagingSites ?? 0}</p>
          </div>
          <div className="rounded-card border border-white/80 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Prontos para clonar</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{summary?.cloneCandidates ?? 0}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <FlaskConical className="h-5 w-5" />
            Ambientes de staging
          </h2>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : !data?.stagingSites.length ? (
            <p className="rounded-card border border-dashed border-ink/15 px-4 py-6 text-sm text-muted dark:border-white/15">
              Nenhum site de staging ainda. Clone um site abaixo ou use a aba Staging no detalhe do site.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.stagingSites.map((s) => (
                <li
                  key={s.siteId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-white/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/5"
                >
                  <div>
                    <p className="font-medium text-ink">{s.domain}</p>
                    <p className="text-xs text-muted">
                      {s.clonedFrom ? `Clone de ${s.clonedFrom}` : "Staging"}
                      {s.serverName ? ` · ${s.serverName}` : ""}
                      {s.isWordPress ? " · WordPress" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/sites/${s.siteId}`} className="btn-secondary btn-sm">
                      Abrir
                    </Link>
                    <button
                      type="button"
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5 border-warning/40 text-warning"
                      disabled={Boolean(jobId) || rollbackMutation.isPending}
                      onClick={() => rollbackMutation.mutate(s.siteId)}
                      title="Rollback no próprio staging (último backup dele)"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Rollback
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-ink">Clonar site de produção</h2>
          <p className="text-sm text-muted">
            Proxy e alias ficam de fora neste MVP. O clone cria o site no WordOps, copia arquivos e
            importa o banco com search-replace quando for WordPress.
          </p>
          {isLoading ? null : !data?.candidates.length ? (
            <p className="text-sm text-muted">Nenhum candidato disponível.</p>
          ) : (
            <ul className="space-y-2">
              {data.candidates.map((c) => (
                <CloneRow
                  key={c.siteId}
                  candidate={c}
                  busy={Boolean(jobId) || cloneMutation.isPending}
                  onClone={(siteId, targetDomain) => cloneMutation.mutate({ siteId, targetDomain })}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
