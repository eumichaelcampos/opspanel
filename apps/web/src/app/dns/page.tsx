"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  dnsVerdictLabel,
  type DnsDoctorResult,
  type DnsHubResponse,
  type DnsRecordStatus,
} from "@opspanel/contracts";

function statusIcon(status: DnsRecordStatus) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  if (status === "error" || status === "missing") return <XCircle className="h-4 w-4 text-danger" />;
  return <Info className="h-4 w-4 text-muted" />;
}

function apexBadge(status: string) {
  if (status === "ok") return "bg-success/10 text-success";
  if (status === "cloudflare") return "bg-accent/10 text-accent";
  if (status === "unknown") return "bg-ink/5 text-muted";
  return "bg-danger/10 text-danger";
}

export default function DnsPage() {
  const [domainInput, setDomainInput] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<DnsDoctorResult | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["dns-hub"],
    queryFn: () => apiFetch<DnsHubResponse>("/dns"),
  });

  const doctorMutation = useMutation({
    mutationFn: (payload: { siteId?: string; domain?: string }) => {
      if (payload.siteId) {
        return apiFetch<DnsDoctorResult>(`/sites/${payload.siteId}/dns/doctor`, { method: "POST" });
      }
      const q = new URLSearchParams();
      if (payload.domain) q.set("domain", payload.domain);
      return apiFetch<DnsDoctorResult>(`/dns/doctor?${q.toString()}`);
    },
    onSuccess: (r) => setDoctor(r),
  });

  const summary = data?.summary;
  const templates = doctor?.templates ?? data?.templates ?? [];

  const problemSites = useMemo(
    () => (data?.sites ?? []).filter((s) => s.apexStatus !== "ok" && s.apexStatus !== "cloudflare"),
    [data?.sites],
  );

  return (
    <AppShell title="DNS">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">DNS Doctor</h1>
            <p className="mt-1 text-sm text-muted">
              Diagnóstico de A/AAAA/CNAME/MX/TXT e por que o domínio não abre.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void refetch()}
            disabled={isLoading || isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", (isLoading || isFetching) && "animate-spin")} />
            Atualizar hub
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando DNS dos sites…
          </div>
        ) : summary ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="glass-card p-5">
              <p className="text-sm text-muted">Sites</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{summary.sites}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-sm text-muted">OK direto</p>
              <p className="mt-2 text-3xl font-semibold text-success">{summary.ok}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-sm text-muted">Cloudflare</p>
              <p className="mt-2 text-3xl font-semibold text-accent">{summary.cloudflare}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-sm text-muted">Com problema</p>
              <p className="mt-2 text-3xl font-semibold text-danger">{summary.problems}</p>
            </div>
          </section>
        ) : null}

        <section className="glass-card p-5 space-y-3">
          <h2 className="font-semibold text-ink">Diagnosticar domínio</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[220px] flex-1 rounded-card border border-ink/20 bg-white px-3 py-2 text-sm dark:bg-ink/20"
              placeholder="exemplo.com.br"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={doctorMutation.isPending || (!domainInput.trim() && !selectedSiteId)}
              onClick={() =>
                doctorMutation.mutate(
                  selectedSiteId
                    ? { siteId: selectedSiteId }
                    : { domain: domainInput.trim().toLowerCase() },
                )
              }
            >
              {doctorMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="h-4 w-4" />
              )}
              Diagnosticar
            </button>
          </div>
          {doctorMutation.error ? (
            <p className="text-sm text-danger">{(doctorMutation.error as Error).message}</p>
          ) : null}
        </section>

        {doctor ? (
          <section className="glass-card p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Veredito</p>
                <h2 className="text-xl font-semibold text-ink">
                  {dnsVerdictLabel(doctor.verdict)} · {doctor.domain}
                </h2>
                <p className="mt-1 text-sm text-muted">{doctor.serverName ?? doctor.serverHost}</p>
              </div>
              {doctor.cloudflareConnected ? (
                <Link
                  href={
                    selectedSiteId
                      ? `/sites/${selectedSiteId}?tab=cloudflare`
                      : "/settings/account"
                  }
                  className="btn-secondary btn-sm"
                >
                  Cloudflare
                </Link>
              ) : null}
            </div>

            <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
              <p className="text-sm font-medium text-ink">Por que o domínio não abriu?</p>
              <p className="mt-1 text-sm text-muted">{doctor.whyNotOpening}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink">Registros</h3>
              <ul className="mt-2 divide-y divide-ink/10 dark:divide-white/10">
                {doctor.records.map((r, idx) => (
                  <li key={`${r.type}-${r.name}-${idx}`} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="mt-0.5">{statusIcon(r.status)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">
                        {r.type} · <span className="font-mono">{r.name}</span>
                      </p>
                      <p className="text-xs text-muted">{r.detail}</p>
                      {r.values.length ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted">{r.values.join(" · ")}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink">Correções sugeridas</h3>
              <ul className="mt-2 space-y-2">
                {doctor.fixes.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-card border border-ink/10 px-3 py-2 dark:border-white/10"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{f.title}</p>
                      <p className="text-xs text-muted">{f.detail}</p>
                    </div>
                    {f.href ? (
                      <Link href={f.href} className="text-xs font-medium text-accent hover:underline">
                        Abrir
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="glass-card p-5">
          <h2 className="font-semibold text-ink">Sites</h2>
          <p className="mt-1 text-xs text-muted">Clique em Diagnosticar para o relatório completo.</p>
          <div className="mt-4 space-y-2">
            {(data?.sites ?? []).map((s) => (
              <div
                key={s.siteId}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3",
                  selectedSiteId === s.siteId
                    ? "border-accent/40 bg-accent/5"
                    : "border-ink/10 dark:border-white/10",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => {
                    setSelectedSiteId(s.siteId);
                    setDomainInput(s.domain);
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Globe2 className="h-4 w-4 text-muted" />
                    <span className="font-mono text-sm font-medium text-ink">{s.domain}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", apexBadge(s.apexStatus))}>
                      {s.apexStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{s.message}</p>
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={doctorMutation.isPending}
                    onClick={() => {
                      setSelectedSiteId(s.siteId);
                      setDomainInput(s.domain);
                      doctorMutation.mutate({ siteId: s.siteId });
                    }}
                  >
                    Diagnosticar
                  </button>
                  <Link href={`/sites/${s.siteId}?tab=cloudflare`} className="btn-ghost btn-sm">
                    Site
                  </Link>
                </div>
              </div>
            ))}
            {!data?.sites.length && !isLoading ? (
              <p className="text-sm text-muted">Nenhum site cadastrado.</p>
            ) : null}
          </div>
          {problemSites.length ? (
            <p className="mt-3 text-xs text-warning">{problemSites.length} site(s) com apontamento a revisar.</p>
          ) : null}
        </section>

        <section className="glass-card p-5">
          <h2 className="font-semibold text-ink">Templates DNS</h2>
          <p className="mt-1 text-xs text-muted">Sugestões estáticas para WordPress, e-mail e redirect.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-card border border-ink/10 p-4 dark:border-white/10">
                <p className="font-medium text-ink">{t.title}</p>
                <p className="mt-1 text-xs text-muted">{t.summary}</p>
                <ul className="mt-3 space-y-1 text-[11px] font-mono text-muted">
                  {t.records.map((r, i) => (
                    <li key={`${t.id}-${i}`}>
                      {r.type} {r.name} → {r.value}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
