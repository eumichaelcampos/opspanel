"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Archive,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  backupContentsLabel,
  backupIntegrityLabel,
  backupScheduleLabel,
  type BackupHubResponse,
  type BackupIntegrity,
} from "@opspanel/contracts";

function formatBackupTimestamp(ts: string) {
  if (!/^\d{14}$/.test(ts)) return ts;
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10);
  const mi = ts.slice(10, 12);
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function integrityIcon(integrity?: BackupIntegrity) {
  if (integrity === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (integrity === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
  return <Shield className="h-3.5 w-3.5 text-muted" />;
}

export default function BackupsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["backups-hub"],
    queryFn: () => apiFetch<BackupHubResponse>("/backups"),
  });

  const summary = data?.summary;

  return (
    <AppShell title="Backups">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Backup Pro</h1>
            <p className="mt-1 text-sm text-muted">
              Visão dos backups locais e Google Drive em todos os sites, com integridade e política.
            </p>
          </div>
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

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando backups…
          </div>
        ) : summary ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Sites</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.sites}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Backups listados</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.totalBackups}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Com agendamento</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.withSchedule}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Cópias no Drive</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.driveCopies}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Alertas de integridade</p>
                <p className="mt-2 text-3xl font-semibold text-warning">{summary.integrityWarnings}</p>
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Backups recentes</h2>
              <p className="mt-1 text-xs text-muted">Até 50 entradas, ordenadas do mais novo.</p>
              <div className="mt-4 space-y-2">
                {(data?.recent ?? []).map((b) => (
                  <div
                    key={`${b.siteId}-${b.timestamp}-${b.location}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink/10 px-4 py-3 dark:border-white/10"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-ink">{b.domain}</span>
                        <span className="text-xs text-muted">{formatBackupTimestamp(b.timestamp)}</span>
                        {b.hasDatabase ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                            <Database className="h-3 w-3" />
                            Banco
                          </span>
                        ) : null}
                        {b.hasFiles ? (
                          <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-muted">Arquivos</span>
                        ) : null}
                        {(b.location === "drive" || b.location === "both") && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-muted">
                            <Cloud className="h-3 w-3" />
                            Drive
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                          {integrityIcon(b.integrity)}
                          {backupIntegrityLabel(b.integrity)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {b.serverName ?? b.serverId} · {formatSize(b.filesSizeBytes)}
                      </p>
                    </div>
                    <Link href={`/sites/${b.siteId}?tab=backup`} className="btn-secondary btn-sm">
                      Abrir site
                    </Link>
                  </div>
                ))}
                {!data?.recent.length ? (
                  <p className="text-sm text-muted">Nenhum backup encontrado nos servidores consultados.</p>
                ) : null}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Política por site</h2>
              <div className="mt-4 space-y-2">
                {(data?.sites ?? []).map((s) => (
                  <div
                    key={s.siteId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink/10 px-4 py-3 dark:border-white/10"
                  >
                    <div>
                      <p className="font-mono text-sm font-medium text-ink">{s.domain}</p>
                      <p className="text-xs text-muted">
                        {backupContentsLabel(s.contents)} · {backupScheduleLabel(s.schedule)} ·{" "}
                        {s.backupCount} backup(s)
                        {s.listError ? ` · Erro: ${s.listError}` : ""}
                      </p>
                    </div>
                    <Link href={`/sites/${s.siteId}?tab=backup`} className="btn-ghost btn-sm">
                      <Archive className="h-3.5 w-3.5" />
                      Gerenciar
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">Não foi possível carregar o hub de backups.</p>
        )}
      </div>
    </AppShell>
  );
}
