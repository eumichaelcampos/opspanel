"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Eye, Filter, Globe, Plus, Search, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type ServerRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "healthy", label: "Saudável" },
  { value: "warning", label: "Atenção" },
  { value: "critical", label: "Crítico" },
  { value: "offline", label: "Offline" },
  { value: "pending", label: "Pendente" },
  { value: "connecting", label: "Conectando" },
  { value: "incompatible", label: "Incompatível" },
] as const;

export default function ServersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiFetch<{ servers: ServerRow[] }>("/servers"),
  });

  const servers = data?.servers ?? [];
  const activeFilterCount = [query.trim(), status].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return servers.filter((server) => {
      if (status && server.status !== status) return false;
      if (!q) return true;
      return `${server.name} ${server.host} ${server.port} ${server.status}`.toLowerCase().includes(q);
    });
  }, [servers, query, status]);

  function clearFilters() {
    setQuery("");
    setStatus("");
  }

  return (
    <AppShell title="Servidores">
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-[240px] flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nome ou host…"
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
          <Link href="/servers/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Adicionar servidor
          </Link>
        </div>

        {filtersOpen ? (
          <div className="grid gap-3 rounded-card border border-white/70 bg-white/70 p-4 sm:grid-cols-2">
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
          {isLoading
            ? "Carregando servidores…"
            : `${filtered.length} de ${servers.length} servidor${servers.length === 1 ? "" : "es"}`}
        </p>
      </div>

      {error ? <p className="mb-3 text-danger">{(error as Error).message}</p> : null}

      {!isLoading && servers.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink/20 bg-white/60 px-6 py-10 text-center">
          <p className="text-sm text-muted">Nenhum servidor cadastrado.</p>
          <Link href="/servers/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" />
            Conectar servidor
          </Link>
        </div>
      ) : null}

      {!isLoading && servers.length > 0 && filtered.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink/20 bg-white/60 px-6 py-8 text-center">
          <p className="text-sm text-muted">Nenhum servidor corresponde aos filtros.</p>
          <button type="button" className="btn-secondary mt-3" onClick={clearFilters}>
            Limpar filtros
          </button>
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-card border border-white/70">
          <table className="min-w-full bg-white/90 text-sm">
            <thead className="bg-white/95 text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Host</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((server) => (
                <tr key={server.id} className="border-t border-white/80 hover:bg-white/70">
                  <td className="px-4 py-3 font-medium">{server.name}</td>
                  <td className="px-4 py-3 text-muted">
                    {server.host}:{server.port}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={server.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Link href={`/servers/${server.id}`} className="btn-primary btn-sm">
                        <Eye className="h-3.5 w-3.5" />
                        Ver
                      </Link>
                      <Link href={`/sites?serverId=${server.id}`} className="btn-secondary btn-sm">
                        <Globe className="h-3.5 w-3.5" />
                        Sites
                      </Link>
                      <Link href={`/sites/new?serverId=${server.id}`} className="btn-accent-outline btn-sm">
                        <Plus className="h-3.5 w-3.5" />
                        Novo site
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
