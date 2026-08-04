"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Server, Globe, Zap, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { apiFetch } from "@/lib/api";

type ReportSummary = {
  overview: {
    servers: number;
    serversHealthy: number;
    serversOffline: number;
    sites: number;
    jobsRunning: number;
    jobsFailed24h: number;
  };
  platform: { database: string; queue: string };
  jobsByStatus: { status: string; count: number }[];
  dailyJobs: { date: string; total: number; failed: number; succeeded: number }[];
  topActions: { action: string; count: number }[];
  sitesByServer: { serverId: string; serverName: string; count: number }[];
  recentAudit: {
    id: string;
    action: string;
    targetType: string;
    result: string;
    createdAt: string;
  }[];
};

export default function ReportsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports-summary"],
    queryFn: () => apiFetch<ReportSummary>("/reports/summary"),
  });

  return (
    <AppShell title="Relatórios">
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {error ? <p className="text-danger">{(error as Error).message}</p> : null}

      {data ? (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Servidores" value={data.overview.servers} hint={`${data.overview.serversHealthy} saudáveis`} icon={Server} />
            <StatCard label="Sites" value={data.overview.sites} icon={Globe} />
            <StatCard label="Jobs ativos" value={data.overview.jobsRunning} icon={Zap} />
            <StatCard label="Falhas (24h)" value={data.overview.jobsFailed24h} icon={AlertTriangle} iconClass="bg-danger/15 text-danger" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass-card space-y-3 p-4">
              <h2 className="font-semibold">Jobs por status (30 dias)</h2>
              <ul className="space-y-1 text-sm">
                {data.jobsByStatus.map((r) => (
                  <li key={r.status} className="flex justify-between rounded-card bg-white/70 px-3 py-2">
                    <span className="capitalize">{r.status}</span>
                    <span className="font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glass-card space-y-3 p-4">
              <h2 className="font-semibold">Sites por servidor</h2>
              <ul className="space-y-1 text-sm">
                {data.sitesByServer.map((r) => (
                  <li key={r.serverId} className="flex justify-between rounded-card bg-white/70 px-3 py-2">
                    <Link href={`/servers/${r.serverId}`} className="text-accent hover:underline">
                      {r.serverName}
                    </Link>
                    <span className="font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="glass-card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Atividade recente</h2>
              <Link href="/audit" className="text-sm text-accent hover:underline">
                Ver auditoria completa
              </Link>
            </div>
            <div className="overflow-hidden rounded-card border border-white/70">
              <table className="min-w-full bg-white/90 text-sm">
                <thead className="bg-white/95 text-left text-muted">
                  <tr>
                    <th className="px-4 py-3">Quando</th>
                    <th className="px-4 py-3">Ação</th>
                    <th className="px-4 py-3">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAudit.map((log) => (
                    <tr key={log.id} className="border-t border-white/80">
                      <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3">{log.action}</td>
                      <td className="px-4 py-3">{log.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-muted">
            Plataforma: banco {data.platform.database}, fila {data.platform.queue}
          </p>
        </div>
      ) : null}
    </AppShell>
  );
}
