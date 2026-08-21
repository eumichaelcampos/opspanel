"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Play, RefreshCw, Workflow } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AutomationSubNav } from "@/components/automation-sub-nav";
import { JobTracker } from "@/components/job-tracker";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PlaybookListResponse, PlaybookRunResponse } from "@opspanel/contracts";

type ServerRow = { id: string; name: string; host: string; status: string };

export default function AutomationPage() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const [selectedPlaybook, setSelectedPlaybook] = useState<string>("hardening");

  const playbooksQuery = useQuery({
    queryKey: ["playbooks"],
    queryFn: () => apiFetch<PlaybookListResponse>("/playbooks"),
  });

  const serversQuery = useQuery({
    queryKey: ["servers-list-automation"],
    queryFn: () => apiFetch<{ servers: ServerRow[] }>("/servers"),
  });

  const runMutation = useMutation({
    mutationFn: () =>
      apiFetch<PlaybookRunResponse>(`/playbooks/${selectedPlaybook}/run`, {
        method: "POST",
        body: JSON.stringify({ serverId }),
      }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const playbooks = playbooksQuery.data?.playbooks ?? [];
  const servers = serversQuery.data?.servers ?? [];
  const active = playbooks.find((p) => p.id === selectedPlaybook) ?? playbooks[0];

  return (
    <AppShell title="Automação">
      <AutomationSubNav />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Playbooks</h1>
            <p className="mt-1 text-sm text-muted">
              Sequências prontas de hardening, limpeza e auditoria em um servidor.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void playbooksQuery.refetch()}
            disabled={playbooksQuery.isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", playbooksQuery.isFetching && "animate-spin")} />
            Atualizar
          </button>
        </div>

        {jobId ? (
          <JobTracker
            jobId={jobId}
            onComplete={() => {
              setJobId(null);
            }}
          />
        ) : null}

        {playbooksQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando playbooks…
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="space-y-3">
              {playbooks.map((p) => {
                const selected = (active?.id ?? selectedPlaybook) === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlaybook(p.id)}
                    className={cn(
                      "w-full rounded-card border p-4 text-left transition",
                      selected
                        ? "border-accent bg-accent/5 dark:bg-accent/10"
                        : "border-ink/10 dark:border-white/10 hover:border-ink/20",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-accent" />
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="text-xs text-muted">~{p.estimatedMinutes} min</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{p.description}</p>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted">
                      {p.steps.map((s) => (
                        <li key={s.id}>{s.label}</li>
                      ))}
                    </ol>
                  </button>
                );
              })}
            </section>

            <aside className="glass-card h-fit space-y-4 p-5">
              <h2 className="font-semibold text-ink">Executar</h2>
              <p className="text-xs text-muted">
                Playbook: <strong className="text-ink">{active?.name ?? "-"}</strong>
              </p>
              <label className="block text-sm">
                <span className="text-muted">Servidor</span>
                <select
                  className="mt-1 w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-ink dark:border-white/15"
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.host})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={!serverId || !active || runMutation.isPending}
                onClick={() => runMutation.mutate()}
              >
                <Play className="h-4 w-4" />
                Rodar playbook
              </button>
              {runMutation.isError ? (
                <p className="text-xs text-danger">
                  {(runMutation.error as Error)?.message ?? "Falha ao iniciar playbook."}
                </p>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
