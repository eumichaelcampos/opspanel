"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  LayoutTemplate,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { SiteWordpressPanel } from "@/components/site-wordpress-panel";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { countWpUpdates, type WpHubResponse, type WpSiteHubItem } from "@opspanel/contracts";

export default function WordpressPage() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["wordpress-hub"],
    queryFn: () => apiFetch<WpHubResponse>("/wordpress"),
  });

  const inventoryMutation = useMutation({
    mutationFn: (siteId: string) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/wordpress/inventory`, { method: "POST" }),
    onSuccess: (r) => {
      setJobId(r.jobId);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ siteId, targets }: { siteId: string; targets: Array<"core" | "plugins" | "themes"> }) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/wordpress/update`, {
        method: "POST",
        body: JSON.stringify({ targets }),
      }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const summary = data?.summary;

  async function refreshAllStale() {
    const stale = (data?.sites ?? []).filter((s) => s.needsRefresh || !s.inventory);
    for (const s of stale.slice(0, 8)) {
      const r = await apiFetch<{ jobId: string }>(`/sites/${s.siteId}/wordpress/inventory`, {
        method: "POST",
      });
      setJobId(r.jobId);
    }
    void qc.invalidateQueries({ queryKey: ["wordpress-hub"] });
  }

  return (
    <AppShell title="WordPress">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">WordPress Center</h1>
            <p className="mt-1 text-sm text-muted">
              Status de core, plugins e temas por site, com atualização em massa via WP-CLI.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void refetch()} disabled={isLoading}>
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              Atualizar lista
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={isLoading || !data?.sites.length}
              onClick={() => void refreshAllStale()}
            >
              Coletar inventários
            </button>
          </div>
        </div>

        {jobId ? (
          <JobTracker
            jobId={jobId}
            onComplete={() => {
              setJobId(null);
              void refetch();
              void qc.invalidateQueries({ queryKey: ["wordpress-hub"] });
            }}
          />
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando WordPress Center…
          </div>
        ) : summary ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 text-muted">
                  <LayoutTemplate className="h-4 w-4" />
                  <span className="text-sm">Sites WP</span>
                </div>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.sites}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Com inventário</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{summary.withInventory}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Core pendente</p>
                <p className="mt-2 text-3xl font-semibold text-danger">{summary.coreUpdates}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Plugins</p>
                <p className="mt-2 text-3xl font-semibold text-warning">{summary.pluginUpdates}</p>
              </div>
              <div className="glass-card p-5">
                <p className="text-sm text-muted">Temas</p>
                <p className="mt-2 text-3xl font-semibold text-warning">{summary.themeUpdates}</p>
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Sites WordPress</h2>
              <p className="mt-1 text-xs text-muted">
                Expanda para ver plugins/temas. Use inventário antes de atualizar.
              </p>
              <div className="mt-4 space-y-3">
                {(data?.sites ?? []).map((site) => (
                  <SiteRow
                    key={site.siteId}
                    site={site}
                    open={expanded === site.siteId}
                    busy={inventoryMutation.isPending || updateMutation.isPending || Boolean(jobId)}
                    onToggle={() => setExpanded(expanded === site.siteId ? null : site.siteId)}
                    onInventory={() => inventoryMutation.mutate(site.siteId)}
                    onUpdateAll={() => {
                      const c = countWpUpdates(site.inventory);
                      const targets: Array<"core" | "plugins" | "themes"> = [];
                      if (c.core) targets.push("core");
                      if (c.plugins) targets.push("plugins");
                      if (c.themes) targets.push("themes");
                      if (targets.length) updateMutation.mutate({ siteId: site.siteId, targets });
                    }}
                  />
                ))}
                {!data?.sites.length ? (
                  <p className="text-sm text-muted">
                    Nenhum site WordPress detectado. Sites com tipo wp* ou flag isWordPress aparecem aqui.
                  </p>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">Não foi possível carregar o WordPress Center.</p>
        )}
      </div>
    </AppShell>
  );
}

function SiteRow({
  site,
  open,
  busy,
  onToggle,
  onInventory,
  onUpdateAll,
}: {
  site: WpSiteHubItem;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onInventory: () => void;
  onUpdateAll: () => void;
}) {
  const counts = countWpUpdates(site.inventory);
  return (
    <div className="rounded-card border border-ink/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="min-w-0 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
            <span className="font-mono text-sm font-semibold text-ink">{site.domain}</span>
            {site.needsRefresh ? (
              <span className="rounded-lg bg-warning/10 px-2 py-0.5 text-xs text-warning">Desatualizado</span>
            ) : counts.total === 0 && site.inventory ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2 py-0.5 text-xs text-success">
                <CheckCircle2 className="h-3 w-3" />
                OK
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 pl-6 text-xs text-muted">
            {site.serverName ?? site.serverId}
            {site.inventory?.coreVersion ? ` · WP ${site.inventory.coreVersion}` : ""}
            {counts.total
              ? ` · ${counts.core ? "core " : ""}${counts.plugins ? `${counts.plugins} plugins ` : ""}${counts.themes ? `${counts.themes} temas` : ""}`
              : site.inventory
                ? " · sem atualizações"
                : " · sem inventário"}
          </p>
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onInventory}>
            Inventário
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy || !counts.total}
            onClick={onUpdateAll}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Atualizar
          </button>
          <Link href={`/sites/${site.siteId}?tab=wordpress`} className="btn-ghost btn-sm">
            Abrir site
          </Link>
        </div>
      </div>
      {open ? (
        <div className="mt-3 border-t border-ink/10 pt-3 dark:border-white/10">
          <SiteWordpressPanel siteId={site.siteId} compact />
        </div>
      ) : null}
    </div>
  );
}
