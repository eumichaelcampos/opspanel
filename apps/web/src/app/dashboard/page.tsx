"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Activity, AlertTriangle, Globe, Server, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DistributionBar } from "@/components/distribution-bar";
import { MetricBar } from "@/components/metric-bar";
import { ResourceBarChart } from "@/components/resource-bar-chart";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { formatUptime, type HealthSnapshot } from "@/lib/server-health";

type Overview = {
  stats: {
    servers: number;
    serversHealthy: number;
    serversOffline: number;
    sites: number;
    jobsRunning: number;
    jobsFailed24h: number;
  };
  platform: { database: string; queue: string };
  servers: {
    id: string;
    name: string;
    host: string;
    status: string;
    wordopsVersion?: string | null;
    siteCount: number;
    healthSnapshot?: HealthSnapshot | null;
    metricsSnapshot?: {
      gauges?: { id: string; formatted: string; value: number | null }[];
      netdataAvailable?: boolean;
    } | null;
    lastConnectedAt?: string | null;
  }[];
  recentJobs: {
    id: string;
    operationKey: string;
    status: string;
    progress: number;
    createdAt: string;
    serverId?: string | null;
  }[];
};

function avgHealthScore(servers: Overview["servers"]): number {
  const pcts = servers
    .map((s) => {
      const h = s.healthSnapshot;
      if (!h?.memoryUsedPct && !h?.diskUsedPct) return null;
      const mem = h.memoryUsedPct ?? 0;
      const disk = h.diskUsedPct ?? 0;
      return 100 - (mem + disk) / 2;
    })
    .filter((v): v is number => v != null);
  if (!pcts.length) return 0;
  return Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100;
}

function jobSpark(recentJobs: Overview["recentJobs"]): number[] {
  return recentJobs
    .slice()
    .reverse()
    .map((j) => (j.status === "succeeded" ? 100 : j.status === "failed" ? 20 : j.progress || 50));
}

export default function DashboardPage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ user: { email: string; role: string } }>("/me"),
  });

  const { data: overview, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => apiFetch<Overview>("/dashboard/overview"),
    refetchInterval: 30_000,
  });

  const stats = overview?.stats;
  const healthScore = overview ? avgHealthScore(overview.servers) : 0;
  const memBars = overview?.servers
    .filter((s) => s.healthSnapshot?.memoryUsedPct != null)
    .map((s) => ({ label: s.name.slice(0, 8), value: s.healthSnapshot!.memoryUsedPct!, sublabel: "RAM" })) ?? [];

  const spark = overview ? jobSpark(overview.recentJobs) : [];

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
                <p className="text-sm text-muted">Infraestrutura WordOps e plataforma OpsPanel</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/servers/new" className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm">
                Novo servidor
              </Link>
              <Link href="/sites/new" className="rounded-xl border border-white/80 bg-white/60 px-4 py-2.5 text-sm font-medium text-accent backdrop-blur-sm">
                Criar site
              </Link>
            </div>
          </div>
        </section>

        {isLoading ? <p className="text-muted">Carregando painel...</p> : null}

        {stats ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Servidores"
              value={stats.servers}
              hint={`${stats.serversHealthy} saudáveis · ${stats.serversOffline} offline`}
              icon={Server}
              iconClass="bg-[#E8A87C]/25 text-[#C96D3A]"
              spark={spark.length > 1 ? spark : [40, 55, 48, 62, 58, 70, stats.serversHealthy * 10 || 50]}
            />
            <StatCard
              label="Sites WordOps"
              value={stats.sites}
              hint="Domínios no inventário"
              icon={Globe}
              iconClass="bg-[#D4A574]/20 text-[#8B6914]"
              trend={{ value: "Sincronizados via wo site list", positive: true }}
            />
            <StatCard
              label="Jobs ativos"
              value={stats.jobsRunning}
              hint="Fila de operações"
              icon={Zap}
              iconClass="bg-accent/15 text-accent"
              spark={spark.length > 1 ? spark : undefined}
              trend={{
                value: stats.jobsRunning > 0 ? "Processando agora" : "Fila ociosa",
                positive: stats.jobsRunning === 0,
              }}
            />
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
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="glass-card space-y-6 p-5 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Score médio de saúde</p>
                <p className="text-4xl font-semibold tracking-tight text-ink">
                  {healthScore > 0 ? `${healthScore.toFixed(1)}%` : "—"}
                </p>
                <p className="mt-1 text-xs text-muted">Baseado em memória e disco dos servidores monitorados</p>
              </div>
              {overview?.platform ? (
                <div className="flex gap-3 text-xs">
                  <span className="rounded-full bg-success/10 px-3 py-1 text-success">
                    DB: {overview.platform.database}
                  </span>
                  <span className="rounded-full bg-success/10 px-3 py-1 text-success">
                    Redis: {overview.platform.queue}
                  </span>
                </div>
              ) : null}
            </div>

            {memBars.length > 0 ? (
              <ResourceBarChart title="Uso de memória por servidor" items={memBars.slice(0, 7)} />
            ) : (
              <p className="text-sm text-muted">
                Colete métricas nos servidores para ver gráficos de recursos.
              </p>
            )}

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-ink">Servidores</h3>
                <Link href="/servers" className="text-xs text-accent hover:underline">
                  Ver todos
                </Link>
              </div>
              {overview?.servers.length ? (
                <div className="overflow-x-auto rounded-xl border border-white/70 bg-white/40">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/60 text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-3 font-medium">Nome</th>
                        <th className="px-4 py-3 font-medium">Host</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Sites</th>
                        <th className="px-4 py-3 font-medium">Performance</th>
                        <th className="px-4 py-3 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {overview.servers.map((s) => {
                        const h = s.healthSnapshot;
                        const perf = h?.memoryUsedPct ?? h?.diskUsedPct;
                        return (
                          <tr key={s.id} className="dashboard-table-row">
                            <td className="px-4 py-3 font-medium">{s.name}</td>
                            <td className="px-4 py-3 text-muted">{s.host}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={s.status} />
                            </td>
                            <td className="px-4 py-3">{s.siteCount}</td>
                            <td className="px-4 py-3">
                              {perf != null ? (
                                <div className="w-32">
                                  <MetricBar label="" pct={perf} detail={`${perf}%`} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Link href={`/servers/${s.id}`} className="text-xs font-medium text-accent hover:underline">
                                Abrir
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Nenhum servidor.{" "}
                  <Link href="/servers/new" className="text-accent hover:underline">
                    Cadastre o primeiro
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="glass-card-dark p-5">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                <h3 className="font-semibold">Atividade recente</h3>
              </div>
              <ul className="space-y-3">
                {overview?.recentJobs.slice(0, 5).map((job) => (
                  <li key={job.id}>
                    <Link href={`/jobs/${job.id}`} className="block rounded-xl bg-white/5 px-3 py-2.5 transition hover:bg-white/10">
                      <p className="truncate text-sm font-medium">{job.operationKey}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-white/60">
                          {new Date(job.createdAt).toLocaleString("pt-BR")}
                        </span>
                        <StatusBadge status={job.status} />
                      </div>
                    </Link>
                  </li>
                ))}
                {!overview?.recentJobs.length ? (
                  <li className="text-sm text-white/60">Nenhuma operação recente.</li>
                ) : null}
              </ul>
              <Link href="/jobs" className="mt-4 inline-block text-xs text-accent hover:underline">
                Ver fila completa
              </Link>
            </div>

            {stats ? (
              <div className="glass-card p-5">
                <h3 className="mb-4 font-semibold text-ink">Distribuição da frota</h3>
                <div className="space-y-4">
                  <DistributionBar label="Saudáveis" value={stats.serversHealthy} total={stats.servers} color="bg-success" />
                  <DistributionBar label="Offline / crítico" value={stats.serversOffline} total={stats.servers} color="bg-danger" />
                  <DistributionBar label="Sites ativos" value={stats.sites} total={Math.max(stats.sites, stats.servers, 1)} color="bg-accent" />
                </div>
              </div>
            ) : null}

            <div className="glass-card p-5">
              <h3 className="mb-3 font-semibold text-ink">Top servidores</h3>
              <ul className="space-y-3">
                {overview?.servers.slice(0, 4).map((s, i) => {
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
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
