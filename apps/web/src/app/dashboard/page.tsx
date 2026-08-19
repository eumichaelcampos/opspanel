"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Globe,
  HardDrive,
  MemoryStick,
  Server,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DistributionBar } from "@/components/distribution-bar";
import { MetricBar } from "@/components/metric-bar";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { formatUptime, type HealthSnapshot } from "@/lib/server-health";
import { cn } from "@/lib/utils";

type AttentionItem = {
  id: string;
  kind: "job_failed" | "server" | "site";
  severity: "critical" | "warning";
  title: string;
  subtitle?: string;
  href: string;
};

type Overview = {
  stats: {
    servers: number;
    serversHealthy: number;
    serversOffline: number;
    serversWarning?: number;
    sites: number;
    sitesFailed?: number;
    sitesProvisioning?: number;
    jobsRunning: number;
    jobsFailed24h: number;
  };
  platform: { database: string; queue: string };
  attention?: AttentionItem[];
  servers: {
    id: string;
    name: string;
    host: string;
    status: string;
    wordopsVersion?: string | null;
    siteCount: number;
    healthSnapshot?: HealthSnapshot | null;
    healthObservedAt?: string | null;
    metricsSnapshot?: {
      gauges?: { id: string; formatted: string; value: number | null }[];
      netdataAvailable?: boolean;
    } | null;
    lastConnectedAt?: string | null;
  }[];
  recentJobs: {
    id: string;
    operationKey: string;
    label?: string;
    status: string;
    progress: number;
    createdAt: string;
    serverId?: string | null;
    serverName?: string | null;
    domain?: string | null;
    errorMessage?: string | null;
  }[];
};

const STALE_MS = 2 * 60 * 60 * 1000;

function isStale(observedAt?: string | null): boolean {
  if (!observedAt) return true;
  const t = new Date(observedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}

function cpuPct(server: Overview["servers"][number]): number | null {
  const gauge = server.metricsSnapshot?.gauges?.find((g) => g.id === "system.cpu");
  if (gauge?.value != null && Number.isFinite(gauge.value)) return Math.round(gauge.value);
  if (gauge?.formatted) {
    const n = Number.parseFloat(gauge.formatted.replace("%", ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function usageLabel(pct: number | null | undefined): string {
  if (pct == null) return "Sem dado";
  if (pct >= 90) return "Crítico";
  if (pct >= 75) return "Alto";
  if (pct >= 50) return "Moderado";
  return "Tranquilo";
}

function fleetPlainSummary(servers: Overview["servers"]): string {
  if (!servers.length) return "Nenhum servidor cadastrado ainda.";
  const offline = servers.filter((s) => s.status === "offline" || s.status === "critical").length;
  const warn = servers.filter((s) => s.status === "warning").length;
  if (offline > 0) return `${offline} servidor(es) offline ou crítico(s). Veja os cartões abaixo.`;
  if (warn > 0) return `${warn} servidor(es) com alerta. O restante está operando.`;
  return "Todos os servidores estão saudáveis no momento.";
}

function jobSpark(recentJobs: Overview["recentJobs"]): number[] | undefined {
  if (recentJobs.length < 2) return undefined;
  return recentJobs
    .slice()
    .reverse()
    .map((j) => (j.status === "succeeded" ? 100 : j.status === "failed" ? 20 : j.progress || 50));
}

const ATTENTION_DISMISS_KEY = "opspanel.dashboard.attentionDismissed";

function attentionFingerprint(items: AttentionItem[]): string {
  return items
    .map((i) => i.id)
    .sort()
    .join("|");
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card h-32 p-5">
            <div className="h-11 w-11 rounded-2xl bg-white/60" />
            <div className="mt-4 h-3 w-20 rounded bg-white/60" />
            <div className="mt-2 h-8 w-16 rounded bg-white/60" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="glass-card h-72 xl:col-span-2" />
        <div className="glass-card h-72" />
      </div>
    </div>
  );
}

function ServerHealthCard({ server }: { server: Overview["servers"][number] }) {
  const h = server.healthSnapshot;
  const ram = h?.memoryUsedPct ?? null;
  const disk = h?.diskUsedPct ?? null;
  const cpu = cpuPct(server);
  const stale = isStale(server.healthObservedAt ?? h?.collectedAt ?? null);

  return (
    <article className="rounded-card border border-white/70 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold text-ink">{server.name}</h4>
            <StatusBadge status={server.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {server.host}
            {server.wordopsVersion ? ` · WordOps ${server.wordopsVersion}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={`/servers/${server.id}`} className="btn-primary btn-sm">
            Ver servidor
          </Link>
          <Link href={`/sites?serverId=${server.id}`} className="btn-secondary btn-sm">
            Sites ({server.siteCount})
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-white/90 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <MemoryStick className="h-3.5 w-3.5" />
            Memória (RAM)
          </div>
          <p className="text-lg font-semibold text-ink">{ram != null ? `${ram}% usada` : "—"}</p>
          <p className="text-[11px] text-muted">{usageLabel(ram)}</p>
          {ram != null ? (
            <div className="mt-2">
              <MetricBar label="" pct={ram} detail="" />
            </div>
          ) : null}
        </div>
        <div className="rounded-lg bg-white/90 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <HardDrive className="h-3.5 w-3.5" />
            Disco
          </div>
          <p className="text-lg font-semibold text-ink">{disk != null ? `${disk}% usado` : "—"}</p>
          <p className="text-[11px] text-muted">{usageLabel(disk)}</p>
          {disk != null ? (
            <div className="mt-2">
              <MetricBar label="" pct={disk} detail="" />
            </div>
          ) : null}
        </div>
        <div className="rounded-lg bg-white/90 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Activity className="h-3.5 w-3.5" />
            CPU
          </div>
          <p className="text-lg font-semibold text-ink">{cpu != null ? `${cpu}%` : "—"}</p>
          <p className="text-[11px] text-muted">{usageLabel(cpu)}</p>
          {cpu != null ? (
            <div className="mt-2">
              <MetricBar label="" pct={cpu} detail="" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Uptime: {formatUptime(h?.uptimeSeconds)}</span>
        <span>
          {server.siteCount} site{server.siteCount === 1 ? "" : "s"}
        </span>
        {stale ? <span className="text-amber-800">Dados de saúde podem estar desatualizados</span> : null}
        {ram == null && disk == null ? (
          <span>Sem métricas ainda. Abra o servidor e colete saúde/métricas.</span>
        ) : null}
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ user: { email: string; role: string } }>("/me"),
  });

  const { data: overview, isPending } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => apiFetch<Overview>("/dashboard/overview"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const stats = overview?.stats;
  const spark = overview ? jobSpark(overview.recentJobs) : undefined;
  const attention = overview?.attention ?? [];
  const attentionKey = useMemo(() => attentionFingerprint(attention), [attention]);
  const [attentionDismissedKey, setAttentionDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      setAttentionDismissedKey(sessionStorage.getItem(ATTENTION_DISMISS_KEY));
    } catch {
      setAttentionDismissedKey(null);
    }
  }, []);

  const showAttention =
    attention.length > 0 && attentionDismissedKey !== attentionKey;

  function dismissAttention() {
    try {
      sessionStorage.setItem(ATTENTION_DISMISS_KEY, attentionKey);
    } catch {
      /* ignore */
    }
    setAttentionDismissedKey(attentionKey);
  }

  const topServers = useMemo(() => {
    if (!overview) return [];
    return [...overview.servers].sort((a, b) => b.siteCount - a.siteCount).slice(0, 4);
  }, [overview]);

  const hasFailures = (stats?.jobsFailed24h ?? 0) > 0 || (stats?.serversOffline ?? 0) > 0;

  return (
    <AppShell title="Dashboard">
      <div className="space-y-5">
        <section className="dashboard-hero">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-lg font-bold text-accent">
                {me?.user.email?.slice(0, 2).toUpperCase() ?? "OP"}
              </div>
              <div>
                <p className="text-sm text-muted">Bem-vindo de volta</p>
                <h2 className="text-2xl font-semibold text-ink">
                  Olá, {me?.user.email?.split("@")[0] ?? "operador"}
                </h2>
                <p className="text-sm text-muted">
                  {hasFailures
                    ? "Há itens que precisam de atenção na frota."
                    : "Infraestrutura WordOps e plataforma OpsPanel"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasFailures ? (
                <Link href="/jobs?status=failed" className="btn-danger">
                  <AlertTriangle className="h-4 w-4" />
                  Ver falhas
                </Link>
              ) : null}
              <Link href="/sites/migrate" className="btn-accent-outline">
                <Upload className="h-4 w-4" />
                Migrar site
              </Link>
              <Link href="/servers/new" className="btn-primary">
                Novo servidor
              </Link>
              <Link href="/sites/new" className="btn-secondary">
                Criar site
              </Link>
            </div>
          </div>
        </section>

        {isPending && !overview ? <DashboardSkeleton /> : null}

        {overview && overview.stats.servers === 0 ? (
          <section className="rounded-card border border-accent/30 bg-accent/5 p-5">
            <h3 className="font-semibold text-ink">Falta conectar um servidor</h3>
            <p className="mt-1 text-sm text-muted">
              Diga se a VPS é nova ou se já tem WordOps. Em seguida o painel sincroniza sites e deixa tudo visível.
            </p>
            <Link href="/servers/new" className="btn-primary mt-3 inline-flex">
              <Server className="h-4 w-4" />
              Conectar servidor
            </Link>
          </section>
        ) : null}

        {showAttention ? (
          <section className="rounded-card border border-danger/25 bg-danger/5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-danger" />
                <h3 className="font-semibold text-ink">Precisa atenção</h3>
                <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                  {attention.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/jobs" className="btn-secondary btn-sm">
                  Ver jobs
                </Link>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  title="Fechar alerta"
                  aria-label="Fechar seção Precisa atenção"
                  onClick={dismissAttention}
                >
                  <X className="h-4 w-4" />
                  Fechar
                </button>
              </div>
            </div>
            <ul className="space-y-2">
              {attention.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-white/70 bg-white/80 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          item.severity === "critical"
                            ? "bg-danger/15 text-danger"
                            : "bg-amber-100 text-amber-900",
                        )}
                      >
                        {item.severity === "critical" ? "Crítico" : "Alerta"}
                      </span>
                      <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                    </div>
                    {item.subtitle ? (
                      <p className="mt-0.5 truncate text-xs text-muted">{item.subtitle}</p>
                    ) : null}
                  </div>
                  <Link
                    href={item.href}
                    className={cn("btn-sm shrink-0", item.severity === "critical" ? "btn-danger" : "btn-secondary")}
                  >
                    Ver
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {stats ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/servers" className="block transition hover:opacity-95">
              <StatCard
                label="Servidores"
                value={stats.servers}
                hint={`${stats.serversHealthy} saudáveis · ${stats.serversOffline} offline`}
                icon={Server}
                iconClass="bg-[#E8A87C]/25 text-[#C96D3A]"
                spark={spark}
              />
            </Link>
            <Link href="/sites" className="block transition hover:opacity-95">
              <StatCard
                label="Sites WordOps"
                value={stats.sites}
                hint={
                  (stats.sitesFailed ?? 0) > 0 || (stats.sitesProvisioning ?? 0) > 0
                    ? `${stats.sitesFailed ?? 0} com falha · ${stats.sitesProvisioning ?? 0} provisionando`
                    : "Domínios no inventário"
                }
                icon={Globe}
                iconClass="bg-[#D4A574]/20 text-[#8B6914]"
                trend={
                  (stats.sitesFailed ?? 0) > 0
                    ? { value: "Há sites com falha", positive: false }
                    : { value: "Inventário sincronizado", positive: true }
                }
              />
            </Link>
            <Link href="/jobs" className="block transition hover:opacity-95">
              <StatCard
                label="Jobs ativos"
                value={stats.jobsRunning}
                hint="Fila de operações"
                icon={Zap}
                iconClass="bg-accent/15 text-accent"
                spark={spark}
                trend={{
                  value: stats.jobsRunning > 0 ? "Processando agora" : "Fila ociosa",
                  positive: stats.jobsRunning === 0,
                }}
              />
            </Link>
            <Link href="/jobs?status=failed" className="block transition hover:opacity-95">
              <StatCard
                label="Falhas (24h)"
                value={stats.jobsFailed24h}
                hint="Jobs com erro"
                icon={AlertTriangle}
                iconClass="bg-danger/10 text-danger"
                trend={{
                  value: stats.jobsFailed24h > 0 ? "Requer atenção" : "Sem falhas recentes",
                  positive: stats.jobsFailed24h === 0,
                }}
              />
            </Link>
          </div>
        ) : null}

        {overview ? (
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="glass-card space-y-4 p-5 xl:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">Servidores agora</h3>
                  <p className="mt-1 text-sm text-muted">{fleetPlainSummary(overview.servers)}</p>
                  <p className="mt-1 text-xs text-muted">
                    Verde = uso normal. Amarelo = alto. Vermelho = crítico (≥90%).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {overview.platform ? (
                    <>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs",
                          overview.platform.database === "ok"
                            ? "bg-success/10 text-success"
                            : "bg-danger/10 text-danger",
                        )}
                      >
                        Banco do painel: {overview.platform.database}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs",
                          overview.platform.queue === "ok"
                            ? "bg-success/10 text-success"
                            : "bg-danger/10 text-danger",
                        )}
                      >
                        Fila Redis: {overview.platform.queue}
                      </span>
                    </>
                  ) : null}
                  <Link href="/servers" className="btn-secondary btn-sm">
                    Ver todos
                  </Link>
                </div>
              </div>

              {overview.servers.length ? (
                <div className="space-y-3">
                  {overview.servers.map((s) => (
                    <ServerHealthCard key={s.id} server={s} />
                  ))}
                </div>
              ) : (
                <div className="rounded-card border border-dashed border-ink/15 px-4 py-8 text-center">
                  <p className="font-medium text-ink">Conecte o servidor dos seus sites</p>
                  <p className="mt-1 text-sm text-muted">
                    Se já tem WordOps, o painel reconhece os sites. Se o servidor é novo, instalamos tudo para você.
                  </p>
                  <Link href="/servers/new" className="btn-primary btn-sm mt-3 inline-flex">
                    Conectar servidor
                  </Link>
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="glass-card-dark p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-accent" />
                  <h3 className="font-semibold">Atividade recente</h3>
                </div>
                <ul className="space-y-3">
                  {overview.recentJobs.slice(0, 5).map((job) => (
                    <li key={job.id}>
                      <div className="rounded-xl bg-white/5 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{job.label ?? job.operationKey}</p>
                            <p className="mt-0.5 truncate text-[11px] text-white/60">
                              {[job.domain, job.serverName].filter(Boolean).join(" · ") ||
                                new Date(job.createdAt).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <StatusBadge status={job.status} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-white/50">
                            {new Date(job.createdAt).toLocaleString("pt-BR")}
                          </span>
                          <Link href={`/jobs/${job.id}`} className="btn-accent-outline btn-sm">
                            Ver
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                  {!overview.recentJobs.length ? (
                    <li className="text-sm text-white/60">Nenhuma operação recente.</li>
                  ) : null}
                </ul>
                <Link href="/jobs" className="btn-accent-outline btn-sm mt-4">
                  Ver fila completa
                </Link>
              </div>

              {stats ? (
                <div className="glass-card p-5">
                  <h3 className="mb-4 font-semibold text-ink">Resumo da frota</h3>
                  <div className="space-y-4">
                    <DistributionBar
                      label="Saudáveis"
                      value={stats.serversHealthy}
                      total={stats.servers}
                      color="bg-success"
                    />
                    <DistributionBar
                      label="Offline / crítico"
                      value={stats.serversOffline}
                      total={stats.servers}
                      color="bg-danger"
                    />
                    <DistributionBar
                      label="Sites com falha"
                      value={stats.sitesFailed ?? 0}
                      total={Math.max(stats.sites, 1)}
                      color="bg-danger"
                    />
                    {(stats.sitesProvisioning ?? 0) > 0 ? (
                      <DistributionBar
                        label="Sites provisionando"
                        value={stats.sitesProvisioning ?? 0}
                        total={Math.max(stats.sites, 1)}
                        color="bg-accent"
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="glass-card p-5">
                <h3 className="mb-3 font-semibold text-ink">Mais sites</h3>
                <ul className="space-y-3">
                  {topServers.map((s, i) => {
                    const cpu = s.metricsSnapshot?.gauges?.find((g) => g.id === "system.cpu");
                    return (
                      <li key={s.id} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-muted">
                            {s.siteCount} sites · {formatUptime(s.healthSnapshot?.uptimeSeconds)}
                            {cpu ? ` · CPU ${cpu.formatted}` : ""}
                          </p>
                        </div>
                        <Link href={`/servers/${s.id}`} className="btn-ghost btn-sm">
                          Ver
                        </Link>
                      </li>
                    );
                  })}
                  {!topServers.length ? (
                    <li className="text-sm text-muted">Nenhum servidor ranqueado.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
