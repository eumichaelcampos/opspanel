"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";

type ServerRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
};

export default function ServersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiFetch<{ servers: ServerRow[] }>("/servers"),
  });

  return (
    <AppShell title="Servidores">
      <div className="mb-4 flex justify-end">
        <Link
          href="/servers/new"
          className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Adicionar servidor
        </Link>
      </div>
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {error ? <p className="text-danger">{(error as Error).message}</p> : null}
      {!isLoading && data?.servers.length === 0 ? (
        <p className="text-muted">Nenhum servidor cadastrado.</p>
      ) : null}
      <div className="overflow-hidden rounded-card border border-white/70">
        <table className="min-w-full bg-white/90 text-sm">
          <thead className="bg-white/95 text-left text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Host</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.servers.map((server) => (
              <tr key={server.id} className="border-t border-white/80">
                <td className="px-4 py-3 font-medium">{server.name}</td>
                <td className="px-4 py-3 text-muted">
                  {server.host}:{server.port}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={server.status} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/servers/${server.id}`} className="text-accent hover:underline">
                    Detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
