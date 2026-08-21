"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  SecurityAlertItem,
  SecurityCheck,
  SecurityHubResponse,
  SecuritySeverity,
} from "@opspanel/contracts";

function severityIcon(severity: SecuritySeverity) {
  if (severity === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  if (severity === "critical") return <ShieldAlert className="h-4 w-4 text-danger" />;
  return <Shield className="h-4 w-4 text-muted" />;
}

function gradeClass(grade: string) {
  if (grade === "A") return "text-success";
  if (grade === "B") return "text-success";
  if (grade === "C") return "text-warning";
  return "text-danger";
}

function CheckList({ checks }: { checks: SecurityCheck[] }) {
  return (
    <ul className="divide-y divide-ink/10 dark:divide-white/10">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 py-2.5 text-sm">
          <span className="mt-0.5">{severityIcon(c.severity)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{c.label}</p>
            {c.detail ? <p className="text-xs text-muted">{c.detail}</p> : null}
          </div>
          {c.href ? (
            <Link href={c.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
              {c.actionHint ?? "Ver"}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AlertFeed({ alerts }: { alerts: SecurityAlertItem[] }) {
  const critical = alerts.filter((a) => a.severity === "critical");
  const warning = alerts.filter((a) => a.severity === "warning" || a.severity === "unknown");

  if (!alerts.length) {
    return (
      <div className="rounded-card border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
        Nenhum alerta aberto no momento.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {critical.length ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">
            Críticos ({critical.length})
          </h3>
          <ul className="divide-y divide-ink/10 rounded-card border border-danger/25 dark:divide-white/10">
            {critical.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-muted">
                    {a.scope === "server" ? "Servidor" : "Site"} · {a.targetLabel}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </p>
                </div>
                {a.href ? (
                  <Link href={a.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
                    {a.actionHint ?? "Corrigir"}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warning.length ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">
            Alertas ({warning.length})
          </h3>
          <ul className="divide-y divide-ink/10 rounded-card border border-warning/25 dark:divide-white/10">
            {warning.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-muted">
                    {a.scope === "server" ? "Servidor" : "Site"} · {a.targetLabel}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </p>
                </div>
                {a.href ? (
                  <Link href={a.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
                    {a.actionHint ?? "Ver"}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function SecurityPage() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["security-hub"],
    queryFn: () => apiFetch<SecurityHubResponse>("/security"),
  });

  const scanMutation = useMutation({
    mutationFn: (serverId: string) =>
      apiFetch<{ jobId: string }>(`/servers/${serverId}/security/scan`, { method: "POST" }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["security-hub"] });
    },
  });

  const healthMutation = useMutation({
    mutationFn: (serverId: string) =>
      apiFetch<{ jobId: string }>(`/servers/${serverId}/security/refresh-health`, { method: "POST" }),
    onSuccess: (r) => {
      setJobId(r.jobId);
    },
  });

  const summary = data?.summary;
  const openAlerts = data?.openAlerts ?? [];

  const fallbackAlerts = useMemo(() => {
    if (openAlerts.length || !data) return openAlerts;
    const items: SecurityAlertItem[] = [];
    for (const s of data.servers) {
      for (const c of s.checks) {
        if (c.severity !== "warning" && c.severity !== "critical" && c.severity !== "unknown") continue;
        items.push({
          id: `server:${s.serverId}:${c.id}`,
          severity: c.severity === "unknown" ? "unknown" : c.severity,
          scope: "server",
          title: c.label,
          detail: c.detail,
          targetLabel: s.serverName,
          href: c.href,
          actionHint: c.actionHint,
          checkId: c.id,
        });
      }
    }
    for (const site of data.sitesAtRisk) {
      for (const c of site.checks) {
        if (c.severity !== "warning" && c.severity !== "critical" && c.severity !== "unknown") continue;
        items.push({
          id: `site:${site.siteId}:${c.id}`,
          severity: c.severity === "unknown" ? "unknown" : c.severity,
          scope: "site",
          title: c.label,
          detail: c.detail,
          targetLabel: site.domain,
          href: c.href,
          actionHint: c.actionHint,
          checkId: c.id,
        });
      }
    }
    return items;
  }, [data, openAlerts]);

  return (
    <AppShell title="Segurança">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Security Center</h1>
            <p className="mt-1 text-sm text-muted">
              Hardening WordOps, CVEs (WPVulnerability), Lynis, ClamAV, CrowdSec, AIDE e patches do SO.
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
            Carregando segurança…
          </div>
        ) : summary ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 text-muted">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-sm">Nota geral</span>
                </div>
                <p className={cn("mt-2 text-4xl font-bold", gradeClass(summary.grade))}>{summary.grade}</p>
                <p className="text-sm text-muted">{summary.score}/100</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Servidores</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.servers}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Alertas</p>
                <p className="mt-2 text-3xl font-semibold text-warning">{summary.warning}</p>
                <p className="text-xs text-muted">listados abaixo</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Críticos</p>
                <p className="mt-2 text-3xl font-semibold text-danger">{summary.critical}</p>
                <p className="text-xs text-muted">listados abaixo</p>
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Alertas abertos</h2>
              <p className="mt-1 text-xs text-muted">
                Cada item com problema: o que falhou, onde e o que fazer. Fontes gratuitas: WordOps,
                WPVulnerability, Lynis, ClamAV, rootkits, CrowdSec, unattended-upgrades e AIDE.
              </p>
              <div className="mt-4">
                <AlertFeed alerts={fallbackAlerts} />
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Servidores</h2>
              <p className="mt-1 text-xs text-muted">
                Scan: UFW, fail2ban, SSH, Lynis, ClamAV, CrowdSec, AIDE e patches automáticos.
              </p>
              <div className="mt-4 space-y-3">
                {(data?.servers ?? []).map((s) => {
                  const open = expandedServer === s.serverId;
                  const openChecks = s.checks.filter((c) => c.severity !== "ok");
                  return (
                    <div key={s.serverId} className="rounded-card border border-ink/10 p-4 dark:border-white/10">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => setExpandedServer(open ? null : s.serverId)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("text-lg font-bold", gradeClass(s.score.grade))}>{s.score.grade}</span>
                            <span className="font-semibold text-ink">{s.serverName}</span>
                            <span className="text-xs text-muted">{s.host}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {s.score.score}/100 · {s.score.critical} críticos · {s.score.warning} alertas
                            {!open && openChecks[0] ? ` · ex.: ${openChecks[0].label}` : ""}
                          </p>
                        </button>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={healthMutation.isPending}
                            onClick={() => healthMutation.mutate(s.serverId)}
                          >
                            Saúde
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={scanMutation.isPending}
                            onClick={() => scanMutation.mutate(s.serverId)}
                          >
                            Scan
                          </button>
                          <Link href={`/servers/${s.serverId}?tab=stack`} className="btn-ghost btn-sm">
                            Stack
                          </Link>
                        </div>
                      </div>
                      {!open && openChecks.length ? (
                        <ul className="mt-3 space-y-1 border-t border-ink/10 pt-3 dark:border-white/10">
                          {openChecks.slice(0, 4).map((c) => (
                            <li key={c.id} className="flex items-start gap-2 text-xs text-muted">
                              {severityIcon(c.severity)}
                              <span>
                                <span className="font-medium text-ink">{c.label}</span>
                                {c.detail ? ` · ${c.detail}` : ""}
                              </span>
                            </li>
                          ))}
                          {openChecks.length > 4 ? (
                            <li className="text-xs text-muted">+{openChecks.length - 4} (expanda para ver todos)</li>
                          ) : null}
                        </ul>
                      ) : null}
                      {open ? (
                        <div className="mt-3 border-t border-ink/10 pt-3 dark:border-white/10">
                          <CheckList checks={s.checks} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!data?.servers.length ? (
                  <p className="text-sm text-muted">Nenhum servidor. Conecte um servidor primeiro.</p>
                ) : null}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Sites em risco</h2>
              <p className="mt-1 text-xs text-muted">
                SSL, HSTS, PHP, atualizações WP e CVEs via WPVulnerability.
              </p>
              <div className="mt-4 space-y-3">
                {(data?.sitesAtRisk ?? []).map((site) => {
                  const open = expandedSite === site.siteId;
                  const openChecks = site.checks.filter((c) => c.severity !== "ok");
                  return (
                    <div
                      key={site.siteId}
                      className="rounded-card border border-ink/10 px-4 py-3 dark:border-white/10"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => setExpandedSite(open ? null : site.siteId)}
                        >
                          <div className="flex items-center gap-2">
                            <span className={cn("font-bold", gradeClass(site.score.grade))}>{site.score.grade}</span>
                            <span className="font-mono text-sm font-medium text-ink">{site.domain}</span>
                          </div>
                          <p className="text-xs text-muted">
                            {site.serverName ?? site.serverId} · {site.score.critical} críticos ·{" "}
                            {site.score.warning} alertas
                            {!open && openChecks[0] ? ` · ${openChecks[0].label}` : ""}
                          </p>
                        </button>
                        <Link href={`/sites/${site.siteId}?tab=manage`} className="btn-secondary btn-sm">
                          Corrigir
                        </Link>
                      </div>
                      {!open && openChecks.length ? (
                        <ul className="mt-2 space-y-1">
                          {openChecks.slice(0, 3).map((c) => (
                            <li key={c.id} className="flex items-start gap-2 text-xs text-muted">
                              {severityIcon(c.severity)}
                              <span>
                                <span className="font-medium text-ink">{c.label}</span>
                                {c.detail ? ` · ${c.detail}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {open ? (
                        <div className="mt-3 border-t border-ink/10 pt-3 dark:border-white/10">
                          <CheckList checks={site.checks} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!data?.sitesAtRisk.length ? (
                  <p className="text-sm text-success">Nenhum site com alerta no momento.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">Não foi possível carregar o Security Center.</p>
        )}
      </div>
    </AppShell>
  );
}
