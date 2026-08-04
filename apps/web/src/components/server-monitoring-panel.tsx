"use client";

import { useState } from "react";
import { GaugeCard } from "@/components/gauge-card";
import { MetricsChart } from "@/components/metrics-chart";
import { formatObservedAt } from "@/lib/auto-sync";
import type { StackComponentState } from "@/lib/server-health";

export type ServerMetrics = {
  netdataAvailable: boolean;
  netdataState?: "available" | "service_running" | "installed" | "not_found";
  interfaceName?: string;
  gauges: { id: string; label: string; value: number | null; formatted: string }[];
  status: { label: string; status: string; value?: string }[];
  series: { chart: string; label: string; labels: string[]; points: number[][] }[];
  collectedAt?: string;
  source?: string;
};

type DashboardTools = {
  monitoring: { id: string; label: string; path: string; desc: string }[];
  database: { id: string; label: string; path: string; desc: string }[];
  cache: { id: string; label: string; path: string; desc: string }[];
  php: { id: string; label: string; path: string; desc: string }[];
};

type Props = {
  host: string;
  metrics?: ServerMetrics | null;
  metricsObservedAt?: string;
  stackComponents?: StackComponentState[];
  tools?: DashboardTools;
  syncing?: boolean;
};

const GAUGE_COLORS: Record<string, "orange" | "blue" | "green" | "red"> = {
  "system.cpu": "orange",
  "nginx_local.connections": "blue",
  "nginx_local.requests": "green",
  "net.received": "blue",
  "net.sent": "red",
};

const TABS = [
  { id: "monitoring", label: "Monitoring" },
  { id: "database", label: "Database" },
  { id: "cache", label: "Cache" },
  { id: "php", label: "PHP" },
] as const;

function statusClass(status: string): string {
  if (status === "ok") return "bg-success/15 text-success";
  if (status === "warning") return "bg-warning/15 text-warning";
  if (status === "critical") return "bg-danger/15 text-danger";
  return "bg-white/80 text-muted";
}

function toolUrl(host: string, path: string): string {
  return `https://${host}:22222${path}`;
}

function NetdataBanner({
  metrics,
  metricsObservedAt,
  stackComponents,
  syncing,
}: {
  metrics?: ServerMetrics | null;
  metricsObservedAt?: string;
  stackComponents?: StackComponentState[];
  syncing?: boolean;
}) {
  if (metrics?.netdataAvailable) return null;

  const netdataStack = stackComponents?.find((c) => c.id === "netdata");
  const neverCollected = !metricsObservedAt && !metrics?.collectedAt;

  if (neverCollected) {
    return (
      <div className="rounded-card border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
        {syncing
          ? "Coletando métricas do Netdata e Nginx automaticamente…"
          : "Métricas ainda não coletadas. A sincronização automática iniciará em instantes."}
      </div>
    );
  }

  if (netdataStack?.installed && (netdataStack.running || metrics?.netdataState === "service_running")) {
    return (
      <div className="rounded-card border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        Netdata está instalado e o serviço parece ativo, mas a API em{" "}
        <code className="text-xs">127.0.0.1:19999</code> não respondeu. Tente{" "}
        <code className="text-xs">wo stack restart --netdata</code> no servidor ou verifique firewall/bind da porta.
      </div>
    );
  }

  if (netdataStack?.installed) {
    return (
      <div className="rounded-card border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        Netdata instalado mas parado. Inicie com{" "}
        <code className="text-xs">wo stack start --netdata</code> no servidor.
      </div>
    );
  }

  if (metrics?.netdataState === "installed" || metrics?.netdataState === "service_running") {
    return (
      <div className="rounded-card border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        Binário/serviço Netdata detectado, mas a API não respondeu. Verifique{" "}
        <code className="text-xs">systemctl status netdata</code> e a porta 19999.
      </div>
    );
  }

  return (
    <div className="rounded-card border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
      Netdata não detectado. Instale com{" "}
      <code className="text-xs">wo stack install --netdata --dashboard</code> no servidor.
    </div>
  );
}

export function ServerMonitoringPanel({
  host,
  metrics,
  metricsObservedAt,
  stackComponents,
  tools,
  syncing,
}: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("monitoring");

  const gaugePct = (id: string, value: number | null): number => {
    if (value == null) return 0;
    if (id === "system.cpu") return Math.min(100, value);
    if (id === "nginx_local.connections") return Math.min(100, value * 5);
    if (id === "nginx_local.requests") return Math.min(100, value * 3);
    if (id === "net.received" || id === "net.sent") return Math.min(100, value / 50);
    return Math.min(100, value / 10);
  };

  const syncLabel = syncing
    ? "Sincronizando…"
    : `Atualizado: ${formatObservedAt(metricsObservedAt ?? metrics?.collectedAt)}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Monitoramento WordOps</h2>
          <p className="text-xs text-muted">
            Sincronização automática via Netdata (19999) + Nginx · estilo{" "}
            <a
              href="https://github.com/WordOps/wordops-dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              wordops-dashboard
            </a>
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${syncing ? "bg-accent/10 text-accent" : "bg-white/80 text-muted"}`}
        >
          {syncLabel}
        </span>
      </div>

      <NetdataBanner
        metrics={metrics}
        metricsObservedAt={metricsObservedAt}
        stackComponents={stackComponents}
        syncing={syncing}
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === t.id ? "bg-accent text-white" : "bg-white/90 text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "monitoring" && metrics ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {(metrics.gauges ?? []).map((g) => (
              <GaugeCard
                key={g.id}
                label={g.label}
                value={g.formatted}
                pct={gaugePct(g.id, g.value)}
                color={GAUGE_COLORS[g.id] ?? "blue"}
              />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2">
              {(metrics.series ?? []).map((s) => (
                <MetricsChart key={s.chart} label={s.label} labels={s.labels} points={s.points} />
              ))}
            </div>
            <div className="glass-card p-4">
              <p className="mb-3 text-sm font-medium">Status</p>
              <ul className="space-y-2">
                {(metrics.status ?? []).length > 0 ? (
                  (metrics.status ?? []).map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                      <span>{s.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(s.status)}`}>
                        {s.value ?? s.status}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted">Alarmes Netdata indisponíveis.</li>
                )}
              </ul>
              {metrics.collectedAt ? (
                <p className="mt-3 text-[10px] text-muted">
                  Coletado: {new Date(metrics.collectedAt).toLocaleString("pt-BR")} ({metrics.source})
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {tab !== "monitoring" && tools ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {tools[tab].map((tool) => (
            <a
              key={tool.id}
              href={toolUrl(host, tool.path)}
              target="_blank"
              rel="noreferrer"
              className="rounded-card border border-white/80 bg-white/90 px-4 py-3 hover:bg-white"
            >
              <p className="font-medium">{tool.label}</p>
              <p className="text-xs text-muted">{tool.desc}</p>
              <p className="mt-1 font-mono text-[10px] text-accent/80">:22222{tool.path}</p>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
