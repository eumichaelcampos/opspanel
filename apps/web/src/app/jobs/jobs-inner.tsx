"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Eye, Filter, Search, X } from "lucide-react";
import { jobOperationLabel } from "@opspanel/contracts";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type JobRow = {
  id: string;
  operationKey: string;
  status: string;
  progress: number;
  createdAt: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "queued", label: "Na fila" },
  { value: "running", label: "Em execução" },
  { value: "succeeded", label: "Sucesso" },
  { value: "failed", label: "Falhou" },
  { value: "cancelled", label: "Cancelado" },
] as const;

export default function JobsPageInner() {
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get("status") ?? "";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(statusFromUrl);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(statusFromUrl));

  useEffect(() => {
    setStatus(statusFromUrl);
    if (statusFromUrl) setFiltersOpen(true);
  }, [statusFromUrl]);

  const { data, isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiFetch<JobRow[]>("/jobs"),
  });

  const jobs = data ?? [];
  const activeFilterCount = [query.trim(), status].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status && job.status !== status) return false;
      if (!q) return true;
      const label = jobOperationLabel(job.operationKey).toLowerCase();
      return `${job.operationKey} ${label} ${job.id} ${job.status}`.toLowerCase().includes(q);
    });
  }, [jobs, query, status]);

  function clearFilters() {
    setQuery("");
    setStatus("");
  }

  return (
    <AppShell title="Jobs">
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar operação…"
              className="w-full rounded-card border border-ink/20 bg-white/80 py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <button
            type="button"
            className={cn("btn-secondary", filtersOpen && "border-accent/40 bg-accent/5 text-accent")}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          {activeFilterCount > 0 ? (
            <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              Limpar
            </button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="grid gap-3 rounded-card border border-white/70 bg-white/70 p-4 sm:max-w-sm">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <p className="text-sm text-muted">
          {isLoading ? "Carregando…" : `${filtered.length} de ${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {!isLoading && jobs.length === 0 ? <p className="text-muted">Nenhum job registrado ainda.</p> : null}

      {!isLoading && jobs.length > 0 && filtered.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink/20 bg-white/60 px-6 py-8 text-center">
          <p className="text-sm text-muted">Nenhum job corresponde aos filtros.</p>
          <button type="button" className="btn-secondary mt-3" onClick={clearFilters}>
            Limpar filtros
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        {filtered.map((job) => (
          <div key={job.id} className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{jobOperationLabel(job.operationKey)}</p>
              <p className="text-xs text-muted">{new Date(job.createdAt).toLocaleString("pt-BR")}</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={job.status} />
                <span className="text-xs text-muted">{job.progress}%</span>
              </div>
            </div>
            <Link href={`/jobs/${job.id}`} className="btn-primary btn-sm">
              <Eye className="h-3.5 w-3.5" />
              Ver detalhes
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
