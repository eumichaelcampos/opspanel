"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SitesSubNav } from "@/components/sites-sub-nav";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";

type SiteRow = {
  id: string;
  domain: string;
  status: string;
  siteType?: string;
  server: { id: string; name: string };
};

export default function SitesPageInner() {
  const searchParams = useSearchParams();
  const serverId = searchParams.get("serverId") ?? undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["sites", serverId],
    queryFn: () => {
      const qs = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
      return apiFetch<{ sites: SiteRow[] }>(`/sites${qs}`);
    },
  });

  return (
    <AppShell title="Sites">
      <SitesSubNav />
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {error ? <p className="text-danger">{(error as Error).message}</p> : null}
      {!isLoading && data?.sites.length === 0 ? (
        <p className="text-muted">Nenhum site no inventário. Crie um site ou sincronize a partir de um servidor WordOps.</p>
      ) : null}
      <div className="overflow-hidden rounded-card border border-white/70">
        <table className="min-w-full bg-white/90 text-sm">
          <thead className="bg-white/95 text-left text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Domínio</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Servidor</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.sites.map((site) => (
              <tr key={site.id} className="border-t border-white/80">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/sites/${site.id}`} className="text-accent hover:underline">
                    {site.domain}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{site.siteType ?? "—"}</td>
                <td className="px-4 py-3 text-muted">
                  <Link href={`/servers/${site.server.id}`} className="hover:text-accent">
                    {site.server.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={site.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
