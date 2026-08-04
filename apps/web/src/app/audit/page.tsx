"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";

type AuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId?: string;
  result: string;
  createdAt: string;
  actor?: { email: string };
};

export default function AuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => apiFetch<{ logs: AuditRow[] }>("/audit-logs"),
  });

  return (
    <AppShell title="Auditoria">
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      <div className="overflow-hidden rounded-card border border-white/70">
        <table className="min-w-full bg-white/90 text-sm">
          <thead className="bg-white/95 text-left text-muted">
            <tr>
              <th className="px-4 py-3">Quando</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Ator</th>
              <th className="px-4 py-3">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((log) => (
              <tr key={log.id} className="border-t border-white/80">
                <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">{log.action}</td>
                <td className="px-4 py-3 text-muted">{log.actor?.email ?? "sistema"}</td>
                <td className="px-4 py-3">{log.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
