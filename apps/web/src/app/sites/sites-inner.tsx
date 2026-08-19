"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  Filter,
  FolderCog,
  Plus,
  Search,
  Server,
  Upload,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SitesSubNav } from "@/components/sites-sub-nav";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type SiteRow = {
  id: string;
  domain: string;
  status: string;
  siteType?: string | null;
  phpVersion?: string | null;
  cacheBackend?: string | null;
  isEnabled?: boolean | null;
  lastObservedAt?: string | null;
  server: { id: string; name: string; host?: string };
};

type ServerRow = {
  id: string;
  name: string;
  host: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "active", label: "Ativo" },
  { value: "disabled", label: "Desativado" },
  { value: "provisioning", label: "Provisionando" },
  { value: "failed", label: "Falhou" },
  { value: "unknown", label: "Desconhecido" },
] as const;

const ENABLED_OPTIONS = [
  { value: "", label: "Ativo ou pausado" },
  { value: "true", label: "Somente habilitados" },
  { value: "false", label: "Somente desabilitados" },
] as const;

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

function sitePublicUrl(domain: string): string {
  return `https://${domain.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
}

export default function SitesPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serverIdFromUrl = searchParams.get("serverId") ?? "";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [siteType, setSiteType] = useState("");
  const [phpVersion, setPhpVersion] = useState("");
  const [cacheBackend, setCacheBackend] = useState("");
  const [enabled, setEnabled] = useState("");
  const [serverId, setServerId] = useState(serverIdFromUrl);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(serverIdFromUrl));

  useEffect(() => {
    setServerId(serverIdFromUrl);
    if (serverIdFromUrl) setFiltersOpen(true);
  }, [serverIdFromUrl]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiFetch<{ sites: SiteRow[] }>("/sites"),
  });

  const { data: serversData } = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiFetch<{ servers: ServerRow[] }>("/servers"),
  });

  const sites = data?.sites ?? [];
  const servers = serversData?.servers ?? [];

  const typeOptions = useMemo(() => uniqueSorted(sites.map((s) => s.siteType)), [sites]);
  const phpOptions = useMemo(() => uniqueSorted(sites.map((s) => s.phpVersion)), [sites]);
  const cacheOptions = useMemo(() => uniqueSorted(sites.map((s) => s.cacheBackend)), [sites]);

  const activeFilterCount = [
    query.trim(),
    status,
    siteType,
    phpVersion,
    cacheBackend,
    enabled,
    serverId,
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((site) => {
      if (serverId && site.server.id !== serverId) return false;
      if (status && site.status !== status) return false;
      if (siteType && (site.siteType ?? "") !== siteType) return false;
      if (phpVersion && (site.phpVersion ?? "") !== phpVersion) return false;
      if (cacheBackend && (site.cacheBackend ?? "") !== cacheBackend) return false;
      if (enabled === "true" && site.isEnabled === false) return false;
      if (enabled === "false" && site.isEnabled !== false) return false;
      if (!q) return true;
      const haystack = [
        site.domain,
        site.siteType,
        site.phpVersion,
        site.cacheBackend,
        site.server.name,
        site.server.host,
        site.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sites, query, serverId, status, siteType, phpVersion, cacheBackend, enabled]);

  function syncServerInUrl(nextServerId: string) {
    setServerId(nextServerId);
    const params = new URLSearchParams(searchParams.toString());
    if (nextServerId) params.set("serverId", nextServerId);
    else params.delete("serverId");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearFilters() {
    setQuery("");
    setStatus("");
    setSiteType("");
    setPhpVersion("");
    setCacheBackend("");
    setEnabled("");
    syncServerInUrl("");
  }

  return (
    <AppShell title="Sites">
      <SitesSubNav />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar domínio, tipo, PHP, servidor…"
              className="w-full rounded-card border border-ink/20 bg-white/80 py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <button
            type="button"
            className={cn("btn-secondary", filtersOpen && "border-accent/40 bg-accent/5 text-accent")}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Filter className="h-4 w-4" />
            Filtros avançados
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            ) : null}
            <ChevronDown className={cn("h-4 w-4 transition", filtersOpen && "rotate-180")} />
          </button>
          {activeFilterCount > 0 ? (
            <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              Limpar
            </button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="grid gap-3 rounded-card border border-white/70 bg-white/70 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Servidor</span>
              <select
                value={serverId}
                onChange={(e) => syncServerInUrl(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                <option value="">Todos os servidores</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name} ({server.host})
                  </option>
                ))}
              </select>
            </label>

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

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Tipo WordOps</span>
              <select
                value={siteType}
                onChange={(e) => setSiteType(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                <option value="">Todos os tipos</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">PHP</span>
              <select
                value={phpVersion}
                onChange={(e) => setPhpVersion(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                <option value="">Todas as versões</option>
                {phpOptions.map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Cache</span>
              <select
                value={cacheBackend}
                onChange={(e) => setCacheBackend(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                <option value="">Todos os caches</option>
                {cacheOptions.map((cache) => (
                  <option key={cache} value={cache}>
                    {cache}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Habilitação</span>
              <select
                value={enabled}
                onChange={(e) => setEnabled(e.target.value)}
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                {ENABLED_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <p>
            {isLoading
              ? "Carregando sites…"
              : `${filtered.length} de ${sites.length} site${sites.length === 1 ? "" : "s"}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/sites/new" className="btn-primary btn-sm">
              <Plus className="h-3.5 w-3.5" />
              Criar site
            </Link>
            <Link href="/sites/migrate" className="btn-accent-outline btn-sm">
              <Upload className="h-3.5 w-3.5" />
              Migrar
            </Link>
          </div>
        </div>
      </div>

      {error ? <p className="mb-3 text-danger">{(error as Error).message}</p> : null}

      {!isLoading && sites.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink/20 bg-white/60 px-6 py-10 text-center">
          <p className="text-sm text-muted">
            Nenhum site no inventário. Crie um site ou sincronize a partir de um servidor WordOps.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/sites/new" className="btn-primary">
              <Plus className="h-4 w-4" />
              Criar primeiro site
            </Link>
            <Link href="/servers" className="btn-secondary">
              <Server className="h-4 w-4" />
              Ir para servidores
            </Link>
          </div>
        </div>
      ) : null}

      {!isLoading && sites.length > 0 && filtered.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink/20 bg-white/60 px-6 py-8 text-center">
          <p className="text-sm text-muted">Nenhum site corresponde aos filtros.</p>
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
                <th className="px-4 py-3 font-medium">Domínio</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Tipo</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">PHP / Cache</th>
                <th className="px-4 py-3 font-medium">Servidor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => (
                <tr key={site.id} className="border-t border-white/80 hover:bg-white/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{site.domain}</div>
                    <div className="mt-0.5 text-xs text-muted md:hidden">{site.siteType ?? "sem tipo"}</div>
                  </td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{site.siteType ?? "—"}</td>
                  <td className="hidden px-4 py-3 text-muted lg:table-cell">
                    <div>{site.phpVersion ?? "—"}</div>
                    <div className="text-xs">{site.cacheBackend ?? "sem cache"}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <div>{site.server.name}</div>
                    {site.server.host ? <div className="text-xs">{site.server.host}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={site.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Link href={`/sites/${site.id}`} className="btn-primary btn-sm" title="Gerenciar site">
                        <Eye className="h-3.5 w-3.5" />
                        Ver
                      </Link>
                      <Link
                        href={`/sites/${site.id}?tab=ops`}
                        className="btn-secondary btn-sm"
                        title="Editar domínio, cache e opções"
                      >
                        <FolderCog className="h-3.5 w-3.5" />
                        Editar
                      </Link>
                      <a
                        href={sitePublicUrl(site.domain)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-accent-outline btn-sm"
                        title="Abrir site no navegador"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir
                      </a>
                      <Link
                        href={`/sites/migrate?siteId=${site.id}`}
                        className="btn-secondary btn-sm"
                        title="Migrar via FTP"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Migrar
                      </Link>
                      <Link
                        href={`/servers/${site.server.id}`}
                        className="btn-ghost btn-sm"
                        title="Ver servidor"
                      >
                        <Server className="h-3.5 w-3.5" />
                        Servidor
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
