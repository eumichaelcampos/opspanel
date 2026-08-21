"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { JobTracker } from "@/components/job-tracker";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { countWpUpdates, type WpSiteDetailResponse, type WpSiteInventory } from "@opspanel/contracts";

type UpdateTargets = Array<"core" | "plugins" | "themes" | string>;

function UpdateBadge({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "ok" | "warn" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-success/10 text-success",
        tone === "warn" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-danger/10 text-danger",
      )}
    >
      {label}
      {count > 0 ? ` · ${count}` : ""}
    </span>
  );
}

function InventoryLists({ inventory }: { inventory: WpSiteInventory }) {
  const pluginPending = inventory.plugins.filter((p) => p.update && p.update !== "none");
  const themePending = inventory.themes.filter((t) => t.update && t.update !== "none");

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Package className="h-4 w-4" />
          Plugins ({inventory.plugins.length})
        </h4>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
          {inventory.plugins.map((p) => (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-ink/5 dark:hover:bg-white/5"
            >
              <span className="min-w-0 truncate font-mono text-xs text-ink">{p.title || p.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {p.version ?? "?"}
                {p.update && p.update !== "none" ? (
                  <span className="ml-1 text-warning">→ {p.updateVersion || "update"}</span>
                ) : null}
              </span>
            </li>
          ))}
          {!inventory.plugins.length ? <li className="text-xs text-muted">Nenhum plugin listado.</li> : null}
        </ul>
        {pluginPending.length ? (
          <p className="mt-2 text-xs text-warning">{pluginPending.length} com atualização disponível</p>
        ) : null}
      </div>
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Palette className="h-4 w-4" />
          Temas ({inventory.themes.length})
        </h4>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
          {inventory.themes.map((t) => (
            <li
              key={t.name}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-ink/5 dark:hover:bg-white/5"
            >
              <span className="min-w-0 truncate font-mono text-xs text-ink">{t.title || t.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {t.version ?? "?"}
                {t.update && t.update !== "none" ? (
                  <span className="ml-1 text-warning">→ {t.updateVersion || "update"}</span>
                ) : null}
              </span>
            </li>
          ))}
          {!inventory.themes.length ? <li className="text-xs text-muted">Nenhum tema listado.</li> : null}
        </ul>
        {themePending.length ? (
          <p className="mt-2 text-xs text-warning">{themePending.length} com atualização disponível</p>
        ) : null}
      </div>
    </div>
  );
}

export function SiteWordpressPanel({
  siteId,
  compact,
  onJobComplete,
}: {
  siteId: string;
  compact?: boolean;
  onJobComplete?: () => void;
}) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["site-wordpress", siteId],
    queryFn: () => apiFetch<WpSiteDetailResponse>(`/sites/${siteId}/wordpress`),
  });

  const inventoryMutation = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/sites/${siteId}/wordpress/inventory`, { method: "POST" }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const updateMutation = useMutation({
    mutationFn: (targets: UpdateTargets) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/wordpress/update`, {
        method: "POST",
        body: JSON.stringify({ targets }),
      }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const inv = data?.inventory ?? null;
  const counts = countWpUpdates(inv);
  const busy = inventoryMutation.isPending || updateMutation.isPending || Boolean(jobId);

  return (
    <div className={cn("space-y-4", !compact && "glass-card p-5")}>
      {!compact ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink">WordPress</h3>
            <p className="mt-0.5 text-xs text-muted">
              Core, plugins e temas via WP-CLI. {data?.domain ? data.domain : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => inventoryMutation.mutate()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", inventoryMutation.isPending && "animate-spin")} />
            Atualizar inventário
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => inventoryMutation.mutate()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", inventoryMutation.isPending && "animate-spin")} />
            Inventário
          </button>
        </div>
      )}

      {jobId ? (
        <JobTracker
          jobId={jobId}
          onComplete={() => {
            setJobId(null);
            void refetch();
            void qc.invalidateQueries({ queryKey: ["wordpress-hub"] });
            void qc.invalidateQueries({ queryKey: ["site-wordpress", siteId] });
            onJobComplete?.();
          }}
        />
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando inventário…
        </div>
      ) : null}

      {!isLoading && !inv ? (
        <div className="rounded-card border border-dashed border-ink/15 px-4 py-6 text-center dark:border-white/15">
          <p className="text-sm text-muted">Nenhum inventário ainda. Colete core, plugins e temas.</p>
          <button
            type="button"
            className="btn-primary btn-sm mt-3"
            disabled={busy}
            onClick={() => inventoryMutation.mutate()}
          >
            Coletar inventário
          </button>
        </div>
      ) : null}

      {inv ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">
              Core {inv.coreVersion ?? "?"}
              {inv.isMultisite ? " · Multisite" : ""}
            </span>
            {inv.coreUpdateAvailable ? (
              <UpdateBadge label="Core desatualizado" count={1} tone="danger" />
            ) : (
              <UpdateBadge label="Core OK" count={0} tone="ok" />
            )}
            <UpdateBadge
              label="Plugins"
              count={counts.plugins}
              tone={counts.plugins ? "warn" : "ok"}
            />
            <UpdateBadge
              label="Temas"
              count={counts.themes}
              tone={counts.themes ? "warn" : "ok"}
            />
            {data?.lastInventoryAt ? (
              <span className="text-xs text-muted">
                Coletado: {new Date(data.lastInventoryAt).toLocaleString("pt-BR")}
              </span>
            ) : null}
          </div>

          {inv.error ? (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />
              Erro no inventário: {inv.error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy || (!inv.coreUpdateAvailable && !counts.plugins && !counts.themes)}
              onClick={() => {
                const targets: UpdateTargets = [];
                if (inv.coreUpdateAvailable) targets.push("core");
                if (counts.plugins) targets.push("plugins");
                if (counts.themes) targets.push("themes");
                if (targets.length) updateMutation.mutate(targets);
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Atualizar tudo pendente
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy || !inv.coreUpdateAvailable}
              onClick={() => updateMutation.mutate(["core"])}
            >
              Só core
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy || !counts.plugins}
              onClick={() => updateMutation.mutate(["plugins"])}
            >
              Só plugins
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy || !counts.themes}
              onClick={() => updateMutation.mutate(["themes"])}
            >
              Só temas
            </button>
            <a
              href={`/sites/${siteId}?tab=staging`}
              className="btn-secondary btn-sm inline-flex items-center gap-1.5 border-warning/40 text-warning"
            >
              Rollback / Staging
            </a>
          </div>

          {!counts.total && !inv.error ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              Tudo atualizado neste site.
            </p>
          ) : null}

          <InventoryLists inventory={inv} />
        </>
      ) : null}
    </div>
  );
}
